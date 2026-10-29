import { INVITATION_TTL_MS } from '@bureau/shared';
import { and, eq, isNull } from 'drizzle-orm';
import request, { type Response } from 'supertest';
import { describe, expect, test, vi } from 'vitest';
import { inviteAdmin } from '../src/admin/invite-admin';
import { removeMember } from '../src/admin/remove-member';
import { createInvitationService } from '../src/auth/invitations';
import { session, user } from '../src/db/schema';
import type { SentMail } from '../src/mail/mailer';
import { captureLogs } from './helpers/logs';
import { createTestApp, findUserByEmail, TEST_PASSWORD } from './helpers/test-app';

const DAY_MS = 24 * 3600 * 1000;
// Un identifiant d'invitation bien formé, qu'aucune invitation ne porte.
const NO_INVITATION = '00000000-0000-4000-8000-000000000000';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const asAdmin = (t: TestApp, email = 'admin@x.fr', name = 'Camille') => t.inviteAndAccept(email, { role: 'admin', name });

function invite(t: TestApp, cookie: string, body: object) {
  return request(t.app).post('/api/admin/invitations').set('Cookie', cookie).send(body);
}

function listInvitations(t: TestApp, cookie: string) {
  return request(t.app).get('/api/admin/invitations').set('Cookie', cookie);
}

function resend(t: TestApp, cookie: string, id: string) {
  return request(t.app).post(`/api/admin/invitations/${id}/resend`).set('Cookie', cookie);
}

function cancel(t: TestApp, cookie: string, id: string) {
  return request(t.app).delete(`/api/admin/invitations/${id}`).set('Cookie', cookie);
}

function removeVia(t: TestApp, cookie: string, userId: string) {
  return request(t.app).delete(`/api/admin/members/${userId}`).set('Cookie', cookie);
}

function accept(t: TestApp, token: string, name = 'Nouvelle') {
  return request(t.app).post('/api/invitations/accept').send({ token, name, password: TEST_PASSWORD });
}

// Le jeton du lien d'un e-mail d'invitation.
function tokenOf(mail: SentMail | undefined): string {
  const token = mail ? new URL(mail.link).searchParams.get('token') : null;
  if (!token) throw new Error('aucun jeton dans le lien de l\'e-mail');
  return token;
}

function cookieOf(res: Response): string {
  return (res.get('Set-Cookie') ?? []).map((setCookie) => setCookie.split(';')[0]).join('; ');
}

function activeAdmins(t: TestApp) {
  return t.db.$count(user, and(eq(user.role, 'admin'), isNull(user.disabledAt)));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Pour jouer une course à coup sûr au lieu de compter sur le hasard des délais : retient le premier appel de `target[method]`
// une fois sa lecture faite (la vérification, donc, pas encore l'écriture) jusqu'à `release()`, et laisse passer les suivants.
// `secondCall` se règle au deuxième appel : si les deux requêtes ne s'attendent pas, il arrive tout de suite ; si le serveur les
// passe l'une après l'autre, il n'arrive jamais pendant la retenue, et le test libère le premier appel après un court délai.
function holdFirstRead<T extends object>(target: T, method: keyof T & string) {
  const original = (target[method] as unknown as (...args: unknown[]) => Promise<unknown>).bind(target);
  let calls = 0;
  let release!: () => void;
  let markSecondCall!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const secondCall = new Promise<void>((resolve) => {
    markSecondCall = resolve;
  });
  vi.spyOn(target, method as never).mockImplementation((async (...args: unknown[]) => {
    calls += 1;
    const call = calls;
    const result = await original(...args);
    if (call === 1) await gate;
    if (call === 2) markSecondCall();
    return result;
  }) as never);
  return { release, secondCall };
}

const SECOND_REQUEST_GRACE_MS = 400;

describe('accès réservé aux admins', () => {
  test('anonyme → 401, membre → 403 sur /api/admin/members', async () => {
    const t = await createTestApp();
    const anonymous = await request(t.app).get('/api/admin/members');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ error: 'unauthorized' });

    const lea = await t.inviteAndAccept('lea@x.fr');
    const member = await request(t.app).get('/api/admin/members').set('Cookie', lea.cookie);
    expect(member.status).toBe(403);
    expect(member.body).toEqual({ error: 'forbidden' });

    const admin = await asAdmin(t);
    const allowed = await request(t.app).get('/api/admin/members').set('Cookie', admin.cookie);
    expect(allowed.status).toBe(200);
    for (const res of [anonymous, member, allowed]) expect(res.get('Cache-Control')).toBe('no-store');
  });

  test('chaque route admin refuse l\'anonyme (401) et le membre (403), sans rien faire', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr');
    const victim = await t.inviteAndAccept('victime@x.fr');
    const { invitation } = await t.invitations.create({ email: 'attente@x.fr', role: 'member', invitedBy: null });

    const routes = [
      ['get', '/api/admin/members', undefined],
      ['get', '/api/admin/invitations', undefined],
      ['post', '/api/admin/invitations', { email: 'nouveau@x.fr' }],
      ['post', `/api/admin/invitations/${invitation.id}/resend`, undefined],
      ['delete', `/api/admin/invitations/${invitation.id}`, undefined],
      ['delete', `/api/admin/members/${victim.userId}`, undefined],
    ] as const;
    const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body: object | undefined, cookie?: string) => {
      let req = request(t.app)[method](path);
      if (cookie) req = req.set('Cookie', cookie);
      return body ? req.send(body) : req;
    };
    for (const [method, path, body] of routes) {
      expect((await call(method, path, body)).status, `anonyme ${method} ${path}`).toBe(401);
      expect((await call(method, path, body, lea.cookie)).status, `membre ${method} ${path}`).toBe(403);
    }
    // Le garde couvre tout /api/admin, y compris une route qui n'existe pas (encore) : jamais de 404 pour qui n'est pas admin.
    for (const method of ['get', 'post', 'patch', 'delete'] as const) {
      expect((await call(method, '/api/admin/inconnue', undefined)).status, `anonyme ${method} inconnue`).toBe(401);
      expect((await call(method, '/api/admin/inconnue', undefined, lea.cookie)).status, `membre ${method} inconnue`).toBe(403);
    }

    // Aucun effet : l'invitation attend toujours (avec son jeton), aucune autre n'est née, le membre est actif et connecté.
    expect(await t.invitations.listPending()).toEqual([invitation]);
    expect(t.mailer.sent).toHaveLength(0);
    expect(await findUserByEmail(t.db, 'victime@x.fr')).toMatchObject({ disabledAt: null });
    expect(await t.db.$count(session, eq(session.userId, victim.userId))).toBe(1);
  });

  test('le rôle est relu à chaque requête : un admin rétrogradé ou retiré perd l\'accès aussitôt', async () => {
    const t = await createTestApp();
    const boss = await asAdmin(t, 'chef@x.fr');
    const other = await asAdmin(t, 'autre@x.fr');
    expect((await request(t.app).get('/api/admin/members').set('Cookie', other.cookie)).status).toBe(200);

    await t.db.update(user).set({ role: 'member' }).where(eq(user.id, other.userId));
    expect((await request(t.app).get('/api/admin/members').set('Cookie', other.cookie)).status).toBe(403);
    // Seul « admin » ouvre l'accès : une autre valeur du champ (il n'a pas de contrainte en base) vaut membre.
    await t.db.update(user).set({ role: 'Admin' }).where(eq(user.id, other.userId));
    expect((await request(t.app).get('/api/admin/members').set('Cookie', other.cookie)).status).toBe(403);

    // Un compte désactivé dont la session a survécu n'est pas non plus reconnu.
    await t.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, boss.userId));
    expect((await request(t.app).get('/api/admin/members').set('Cookie', boss.cookie)).status).toBe(401);
  });
});

describe('GET /api/admin/members', () => {
  test('id, nom, adresse, rôle, personnage et dernière présence des comptes actifs', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t);
    const lea = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
    const tom = await t.inviteAndAccept('tom@x.fr', { name: 'Tom' });
    await t.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, tom.userId));
    // Léa est venue au bureau, avec un personnage ; Camille jamais (ni personnage, ni présence).
    const seenAt = new Date('2026-10-28T09:30:00.000Z');
    await t.db.update(user).set({ avatarKey: 'premade-02', lastSeenAt: seenAt }).where(eq(user.id, lea.userId));

    const res = await request(t.app).get('/api/admin/members').set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: admin.userId, name: 'Camille', email: 'admin@x.fr', role: 'admin', avatarKey: null, lastSeenAt: null },
      { id: lea.userId, name: 'Léa', email: 'lea@x.fr', role: 'member', avatarKey: 'premade-02', lastSeenAt: seenAt.toISOString() },
    ]);
  });
});

describe('GET /api/admin/invitations', () => {
  test('en attente, expirées comprises (signalées), jamais le jeton ni son empreinte', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t);
    const eightDaysAgo = () => new Date(Date.now() - 8 * DAY_MS);
    const expired = await createInvitationService(t.db, eightDaysAgo).create({ email: 'ancienne@x.fr', role: 'member', invitedBy: null });
    const waiting = await t.invitations.create({ email: 'attente@x.fr', role: 'admin', invitedBy: admin.userId });
    await t.inviteAndAccept('lea@x.fr');   // acceptée : n'est plus en attente
    const revoked = await t.invitations.create({ email: 'tom@x.fr', role: 'member', invitedBy: null });
    await t.invitations.revoke(revoked.invitation.id);

    const res = await listInvitations(t, admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: waiting.invitation.id, email: 'attente@x.fr', role: 'admin', invitedBy: admin.userId,
        createdAt: waiting.invitation.createdAt.toISOString(), expiresAt: waiting.invitation.expiresAt.toISOString(), expired: false,
      },
      {
        id: expired.invitation.id, email: 'ancienne@x.fr', role: 'member', invitedBy: null,
        createdAt: expired.invitation.createdAt.toISOString(), expiresAt: expired.invitation.expiresAt.toISOString(), expired: true,
      },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
  });
});

describe('POST /api/admin/invitations', () => {
  test('invitation par un admin : 201 et e-mail', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t);

    const res = await invite(t, admin.cookie, { email: 'new@x.fr' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'new@x.fr', role: 'member', invitedBy: admin.userId, expired: false });
    expect(JSON.stringify(res.body)).not.toMatch(/token|rejoindre/i);   // le lien ne part que par e-mail

    const mail = t.mailer.last('new@x.fr');
    expect(mail?.link).toContain('/rejoindre?token=');
    expect(mail?.link.startsWith(`${t.env.APP_URL}/rejoindre?token=`)).toBe(true);
    expect(mail?.text).toContain('Camille');   // le nom de l'admin qui invite figure dans l'e-mail
    expect(t.mailer.sent).toHaveLength(1);

    const checked = await t.invitations.check(tokenOf(mail));
    expect(checked).toMatchObject({ status: 'valid', invitation: { id: res.body.id, email: 'new@x.fr', role: 'member', invitedBy: admin.userId } });
    // Le lien reçu ouvre bien un compte membre pour cette adresse.
    expect((await accept(t, tokenOf(mail))).status).toBe(201);
    expect(await findUserByEmail(t.db, 'new@x.fr')).toMatchObject({ role: 'member', emailVerified: true });
  });

  test('l\'adresse est normalisée, le rôle admin peut être donné, le client ne choisit ni l\'auteur ni l\'échéance', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t);

    const res = await invite(t, admin.cookie, {
      email: '  Chef@X.fr ', role: 'admin', invitedBy: 'quelqu-un-d-autre', expiresAt: '2099-01-01T00:00:00Z', acceptedAt: '2026-01-01T00:00:00Z',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'chef@x.fr', role: 'admin', invitedBy: admin.userId });
    expect(new Date(res.body.expiresAt as string).getTime()).toBeLessThanOrEqual(Date.now() + INVITATION_TTL_MS);
    const mail = t.mailer.last('chef@x.fr');
    expect(mail?.to).toBe('chef@x.fr');
    expect(await t.invitations.check(tokenOf(mail))).toMatchObject({ status: 'valid', invitation: { role: 'admin' } });
    expect((await accept(t, tokenOf(mail), 'Chef')).status).toBe(201);
    expect((await findUserByEmail(t.db, 'chef@x.fr'))?.role).toBe('admin');
  });

  test('adresse ou rôle invalide → 400 invalid, rien n\'est créé ni envoyé', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t);

    const bodies = [
      {}, { role: 'admin' }, { email: '' }, { email: 'pas-une-adresse' }, { email: 'a@b' }, { email: 42 }, { email: ['a@x.fr'] },
      { email: `${'a'.repeat(250)}@x.fr` }, { email: 'a@x.fr', role: 'root' }, { email: 'a@x.fr', role: 'ADMIN' }, { email: 'a@x.fr', role: 1 },
    ];
    for (const body of bodies) {
      const res = await invite(t, admin.cookie, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body).toEqual({ error: 'invalid' });
    }
    expect((await request(t.app).post('/api/admin/invitations').set('Cookie', admin.cookie)).status).toBe(400);   // sans corps
    expect(await t.invitations.listPending()).toEqual([]);
    expect(t.mailer.sent).toHaveLength(0);
  });

  test('double invitation → 409 already_invited ; membre existant → 409 already_member', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t);
    await t.inviteAndAccept('lea@x.fr');
    const tom = await t.inviteAndAccept('tom@x.fr');
    await t.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, tom.userId));
    const eightDaysAgo = () => new Date(Date.now() - 8 * DAY_MS);
    await createInvitationService(t.db, eightDaysAgo).create({ email: 'ancienne@x.fr', role: 'member', invitedBy: null });

    expect((await invite(t, admin.cookie, { email: 'new@x.fr' })).status).toBe(201);
    const mailsBefore = t.mailer.sent.length;

    // Déjà invitée, même avec une autre casse ou un autre rôle ; une invitation expirée attend toujours (on la relance).
    for (const email of ['new@x.fr', 'New@X.fr', ' new@x.fr ', 'ancienne@x.fr']) {
      const again = await invite(t, admin.cookie, { email });
      expect(again.status, email).toBe(409);
      expect(again.body).toEqual({ error: 'already_invited' });
    }
    expect((await invite(t, admin.cookie, { email: 'new@x.fr', role: 'admin' })).status).toBe(409);

    // Un compte existe déjà : actif, désactivé, ou celui de l'admin lui-même.
    for (const email of ['lea@x.fr', 'LEA@x.fr', 'tom@x.fr', 'admin@x.fr']) {
      const existing = await invite(t, admin.cookie, { email });
      expect(existing.status, email).toBe(409);
      expect(existing.body).toEqual({ error: 'already_member' });
    }

    expect(t.mailer.sent).toHaveLength(mailsBefore);   // aucun e-mail de plus
    expect((await t.invitations.listPending()).map((i) => i.email).sort()).toEqual(['ancienne@x.fr', 'new@x.fr']);
  });

  test('deux invitations simultanées pour la même adresse : une seule est créée', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t);
    // La première requête a vérifié que l'adresse n'est pas invitée, et attend avant de créer l'invitation : la seconde arrive.
    const hold = holdFirstRead(t.invitations, 'listPending');

    const first = invite(t, admin.cookie, { email: 'new@x.fr' }).then((res) => res);
    const second = invite(t, admin.cookie, { email: 'NEW@x.fr' }).then((res) => res);
    await Promise.race([hold.secondCall, sleep(SECOND_REQUEST_GRACE_MS)]);
    hold.release();

    const responses = await Promise.all([first, second]);
    expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(responses.find((res) => res.status === 409)?.body).toEqual({ error: 'already_invited' });
    expect(await t.invitations.listPending()).toHaveLength(1);
    expect(t.mailer.sent).toHaveLength(1);
  });

  test('échec de l\'envoi : 502 mail_failed, journalisé sans adresse ni lien, invitation toujours en attente et relançable', async () => {
    const { logger, lines } = captureLogs();
    const t = await createTestApp({ logger });
    const admin = await asAdmin(t);
    const send = vi.spyOn(t.mailer, 'sendInvitation').mockRejectedValueOnce(new Error('Resend est indisponible'));

    const failed = await invite(t, admin.cookie, { email: 'lea@x.fr' });
    expect(failed.status).toBe(502);
    expect(failed.body).toEqual({ error: 'mail_failed' });
    expect(t.mailer.sent).toHaveLength(0);

    const message = 'Envoi de l\'invitation impossible';
    expect(lines.find((line) => line.msg === message)).toMatchObject({ level: 50, err: { message: 'Resend est indisponible' } });
    // Le lien contient un jeton qui ouvre un compte, et l'adresse est une donnée personnelle : ni l'un ni l'autre dans le journal.
    const { link } = send.mock.calls[0]![0];
    const journal = JSON.stringify(lines);
    expect(journal).not.toContain(link);
    expect(journal).not.toContain(new URL(link).searchParams.get('token')!);
    expect(journal).not.toContain('lea@x.fr');

    // L'invitation existe, en attente : l'admin la voit, ne peut pas la recréer, mais peut la relancer.
    const pending = (await listInvitations(t, admin.cookie)).body as Array<{ id: string; email: string }>;
    expect(pending.map((i) => i.email)).toEqual(['lea@x.fr']);
    expect((await invite(t, admin.cookie, { email: 'lea@x.fr' })).status).toBe(409);
    expect((await resend(t, admin.cookie, pending[0]!.id)).status).toBe(200);
    expect(t.mailer.last('lea@x.fr')?.link).toContain('/rejoindre?token=');
  });
});

describe('POST /api/admin/invitations/:id/resend', () => {
  test('relance : l\'ancien jeton ne marche plus, le nouveau oui', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t);
    expect((await invite(t, admin.cookie, { email: 'new@x.fr' })).status).toBe(201);
    const oldToken = tokenOf(t.mailer.last('new@x.fr'));
    const [pending] = (await listInvitations(t, admin.cookie)).body as Array<{ id: string }>;

    const res = await resend(t, admin.cookie, pending!.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(t.mailer.sent).toHaveLength(2);
    const newToken = tokenOf(t.mailer.last('new@x.fr'));
    expect(newToken).not.toBe(oldToken);
    expect((await t.invitations.check(oldToken)).status).not.toBe('valid');
    expect((await accept(t, oldToken)).status).toBe(404);   // le vieux lien ne mène plus nulle part
    expect((await t.invitations.check(newToken)).status).toBe('valid');
    expect((await accept(t, newToken)).status).toBe(201);
  });

  test('relancer une invitation expirée la remet en validité', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t, 'admin@x.fr', 'Camille');
    const eightDaysAgo = () => new Date(Date.now() - 8 * DAY_MS);
    const { invitation, token } = await createInvitationService(t.db, eightDaysAgo).create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
    expect((await t.invitations.check(token)).status).toBe('expired');
    expect((await listInvitations(t, admin.cookie)).body).toMatchObject([{ id: invitation.id, expired: true }]);

    expect((await resend(t, admin.cookie, invitation.id)).status).toBe(200);
    const mail = t.mailer.last('lea@x.fr');
    expect(mail?.text).toContain('Camille');   // c'est l'admin qui relance qui invite, même si la commande avait créé l'invitation
    expect((await listInvitations(t, admin.cookie)).body).toMatchObject([{ id: invitation.id, expired: false }]);
    expect((await accept(t, tokenOf(mail), 'Léa')).status).toBe(201);
  });

  test('invitation inconnue, déjà acceptée ou révoquée → 404 not_found, aucun e-mail', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t);
    const accepted = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
    expect((await accept(t, accepted.token, 'Léa')).status).toBe(201);
    const revoked = await t.invitations.create({ email: 'tom@x.fr', role: 'member', invitedBy: null });
    await t.invitations.revoke(revoked.invitation.id);

    for (const id of [NO_INVITATION, accepted.invitation.id, revoked.invitation.id, 'pas-un-identifiant']) {
      const res = await resend(t, admin.cookie, id);
      expect(res.status, id).toBe(404);
      expect(res.body).toEqual({ error: 'not_found' });
    }
    expect(t.mailer.sent).toHaveLength(0);
    expect((await t.invitations.check(revoked.token)).status).toBe('revoked');
  });
});

describe('DELETE /api/admin/invitations/:id', () => {
  test('annulation : l\'invitation est révoquée, son lien ne marche plus', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t);
    const { invitation, token } = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: admin.userId });

    const res = await cancel(t, admin.cookie, invitation.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await t.invitations.check(token)).status).toBe('revoked');
    const refused = await accept(t, token);
    expect(refused.status).toBe(410);
    expect(refused.body).toEqual({ error: 'revoked' });
    expect((await listInvitations(t, admin.cookie)).body).toEqual([]);
    // Annuler deux fois : la seconde ne trouve plus d'invitation en attente.
    const twice = await cancel(t, admin.cookie, invitation.id);
    expect(twice.status).toBe(404);
    expect(twice.body).toEqual({ error: 'not_found' });
  });

  test('invitation inconnue ou déjà acceptée → 404 not_found, et un compte déjà créé reste en place', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t);
    const lea = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: admin.userId });
    expect((await accept(t, lea.token, 'Léa')).status).toBe(201);

    for (const id of [NO_INVITATION, lea.invitation.id, 'pas-un-identifiant']) {
      const res = await cancel(t, admin.cookie, id);
      expect(res.status, id).toBe(404);
      expect(res.body).toEqual({ error: 'not_found' });
    }
    expect((await t.invitations.check(lea.token)).status).toBe('used');
    expect(await findUserByEmail(t.db, 'lea@x.fr')).toMatchObject({ disabledAt: null });
  });
});

describe('DELETE /api/admin/members/:id', () => {
  test('retrait d\'un membre : sessions supprimées et événement émis', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t);
    const lea = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
    const leaSecondDevice = cookieOf(await request(t.app).post('/api/auth/sign-in/email').send({ email: 'lea@x.fr', password: TEST_PASSWORD }));
    const tom = await t.inviteAndAccept('tom@x.fr', { name: 'Tom' });
    const removed = vi.fn();
    t.events.on('member:removed', removed);
    for (const cookie of [lea.cookie, leaSecondDevice]) expect((await request(t.app).get('/api/members').set('Cookie', cookie)).status).toBe(200);
    expect(await t.db.$count(session, eq(session.userId, lea.userId))).toBe(2);

    const res = await removeVia(t, admin.cookie, lea.userId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Les anciens cookies sont morts sur-le-champ, toutes les sessions sont supprimées, l'événement part avec l'id.
    for (const cookie of [lea.cookie, leaSecondDevice]) {
      expect((await request(t.app).get('/api/members').set('Cookie', cookie)).status).toBe(401);
      const raw = await request(t.app).get('/api/auth/get-session').set('Cookie', cookie);
      expect(raw.body).toBeNull();
    }
    expect(await t.db.$count(session, eq(session.userId, lea.userId))).toBe(0);
    expect(removed).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith(lea.userId);

    // Le compte est désactivé, pas supprimé : il ne se reconnecte plus, et il disparaît des listes.
    const [account] = await t.db.select({ disabledAt: user.disabledAt }).from(user).where(eq(user.id, lea.userId));
    expect(account?.disabledAt).toBeInstanceOf(Date);
    const signIn = await request(t.app).post('/api/auth/sign-in/email').send({ email: 'lea@x.fr', password: TEST_PASSWORD });
    expect(signIn.status).toBe(403);
    expect(signIn.body.code).toBe('ACCOUNT_DISABLED');
    const members = await request(t.app).get('/api/admin/members').set('Cookie', admin.cookie);
    expect((members.body as Array<{ id: string }>).map((m) => m.id)).toEqual([admin.userId, tom.userId]);
    const directory = await request(t.app).get('/api/members').set('Cookie', tom.cookie);
    expect((directory.body as Array<{ id: string }>).map((m) => m.id)).toEqual([admin.userId, tom.userId]);

    // Les autres sessions ne bougent pas.
    expect((await request(t.app).get('/api/members').set('Cookie', tom.cookie)).status).toBe(200);
    expect((await request(t.app).get('/api/members').set('Cookie', admin.cookie)).status).toBe(200);
  });

  test('pas de retrait de soi-même : 400 self', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t);
    const removed = vi.fn();
    t.events.on('member:removed', removed);

    const res = await removeVia(t, admin.cookie, admin.userId);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'self' });
    expect(removed).not.toHaveBeenCalled();
    expect(await findUserByEmail(t.db, 'admin@x.fr')).toMatchObject({ disabledAt: null });
    expect((await request(t.app).get('/api/admin/members').set('Cookie', admin.cookie)).status).toBe(200);   // sa session vit toujours
  });

  test('un admin peut en retirer un autre tant qu\'il en reste un ; un membre inconnu ou déjà retiré → 404', async () => {
    const t = await createTestApp();
    const first = await asAdmin(t, 'premier@x.fr');
    const second = await asAdmin(t, 'second@x.fr');

    expect((await removeVia(t, first.cookie, second.userId)).status).toBe(200);
    expect(await activeAdmins(t)).toBe(1);
    // Le second ne peut plus agir.
    expect((await removeVia(t, second.cookie, first.userId)).status).toBe(401);
    // Retirer deux fois, ou retirer un identifiant inconnu : 404, et l'événement ne repart pas.
    const removed = vi.fn();
    t.events.on('member:removed', removed);
    for (const id of [second.userId, 'inconnu', NO_INVITATION]) {
      const res = await removeVia(t, first.cookie, id);
      expect(res.status, id).toBe(404);
      expect(res.body).toEqual({ error: 'not_found' });
    }
    expect(removed).not.toHaveBeenCalled();
    expect(await activeAdmins(t)).toBe(1);
  });

  // Une demande d'un compte déjà désactivé n'arrive pas jusqu'ici par HTTP (sa session est refusée), sauf en course avec un autre
  // retrait : on appelle donc la règle directement. Seuls les admins actifs comptent : un admin désactivé ne protège personne.
  test('le dernier admin actif ne peut pas être retiré, un admin désactivé ne compte pas : last_admin', async () => {
    const t = await createTestApp();
    const gone = await asAdmin(t, 'parti@x.fr');
    const last = await asAdmin(t, 'dernier@x.fr');
    await t.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, gone.userId));
    const removed = vi.fn();
    t.events.on('member:removed', removed);

    const outcome = await removeMember(t, { actorId: gone.userId, targetId: last.userId });
    expect(outcome).toBe('last_admin');
    expect(removed).not.toHaveBeenCalled();
    expect(await activeAdmins(t)).toBe(1);
    expect(await t.db.$count(session, eq(session.userId, last.userId))).toBe(1);

    // Avec un autre admin actif, le même retrait passe.
    const other = await asAdmin(t, 'autre@x.fr');
    expect(await removeMember(t, { actorId: other.userId, targetId: last.userId })).toBe('removed');
    expect(removed).toHaveBeenCalledWith(last.userId);
    expect(await removeMember(t, { actorId: other.userId, targetId: other.userId })).toBe('self');
  });

  test('pas de retrait du dernier admin actif, même quand deux admins se retirent en même temps : 200 et 400 last_admin', async () => {
    const t = await createTestApp();
    const a = await asAdmin(t, 'a@x.fr');
    const b = await asAdmin(t, 'b@x.fr');
    // Chaque requête a compté l'autre admin (actif) et attend avant de retirer : l'autre requête compte à son tour.
    const hold = holdFirstRead(t.db, '$count');

    const first = removeVia(t, a.cookie, b.userId).then((res) => res);
    const second = removeVia(t, b.cookie, a.userId).then((res) => res);
    await Promise.race([hold.secondCall, sleep(SECOND_REQUEST_GRACE_MS)]);
    hold.release();

    const responses = await Promise.all([first, second]);
    // Le serveur les passe l'une après l'autre : la première retire son admin, la seconde voit qu'il n'en reste qu'un.
    expect(responses.map((res) => res.status).sort()).toEqual([200, 400]);
    expect(responses.find((res) => res.status === 400)?.body).toEqual({ error: 'last_admin' });
    expect(await activeAdmins(t)).toBe(1);
  });
});

describe('inviteAdmin', () => {
  test('inviteAdmin renvoie un lien d\'invitation admin', async () => {
    const t = await createTestApp();

    const { link } = await inviteAdmin(' Root@X.fr ', t);
    expect(link.startsWith(`${t.env.APP_URL}/rejoindre?token=`)).toBe(true);
    const token = new URL(link).searchParams.get('token')!;
    const checked = await t.invitations.check(token);
    expect(checked).toMatchObject({ status: 'valid', invitation: { email: 'root@x.fr', role: 'admin', invitedBy: null } });

    // L'e-mail part avec ce même lien, sans nom d'admin (la commande n'en a pas).
    expect(t.mailer.sent).toHaveLength(1);
    expect(t.mailer.last('root@x.fr')).toMatchObject({ to: 'root@x.fr', link });
    // Et le lien ouvre un compte admin.
    expect((await accept(t, token, 'Root')).status).toBe(201);
    expect((await findUserByEmail(t.db, 'root@x.fr'))?.role).toBe('admin');
  });

  test('échec de l\'envoi : l\'erreur remonte, l\'invitation reste en attente', async () => {
    const t = await createTestApp();
    vi.spyOn(t.mailer, 'sendInvitation').mockRejectedValueOnce(new Error('Resend est indisponible'));

    await expect(inviteAdmin('root@x.fr', t)).rejects.toThrow('Resend est indisponible');
    expect(await t.invitations.listPending()).toMatchObject([{ email: 'root@x.fr', role: 'admin' }]);
  });
});
