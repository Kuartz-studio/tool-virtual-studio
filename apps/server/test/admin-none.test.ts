import request, { type Response } from 'supertest';
import { describe, expect, test, vi } from 'vitest';
import { captureLogs } from './helpers/logs';
import { createNoneTestApp, createTestApp, findUserByEmail, TEST_PASSWORD } from './helpers/test-app';

// Les routes admin sans e-mail (MAILER=none) : l'admin reçoit les liens et les transmet lui-même.

type NoneApp = Awaited<ReturnType<typeof createNoneTestApp>>;
type AnyApp = NoneApp | Awaited<ReturnType<typeof createTestApp>>;

const asAdmin = (t: AnyApp, email = 'admin@x.fr', name = 'Camille') => t.inviteAndAccept(email, { role: 'admin', name });

function invite(t: AnyApp, cookie: string, body: object) {
  return request(t.app).post('/api/admin/invitations').set('Cookie', cookie).send(body);
}

function resend(t: AnyApp, cookie: string, id: string) {
  return request(t.app).post(`/api/admin/invitations/${id}/resend`).set('Cookie', cookie);
}

function accept(t: AnyApp, token: string, name = 'Nouvelle') {
  return request(t.app).post('/api/invitations/accept').send({ token, name, password: TEST_PASSWORD });
}

// Le jeton d'un lien d'invitation.
function tokenOf(link: unknown): string {
  expect(typeof link).toBe('string');
  const token = new URL(link as string).searchParams.get('token');
  if (!token) throw new Error('aucun jeton dans le lien');
  return token;
}

const bodyOf = (res: Response) => res.body as Record<string, unknown>;

describe('invitations sans e-mail', () => {
  test('inviter répond 201 avec le lien, et rien n\'est envoyé', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    const send = vi.spyOn(t.mailer, 'sendInvitation');

    const res = await invite(t, admin.cookie, { email: 'new@x.fr' });
    expect(res.status).toBe(201);
    // Le corps d'avant, plus le lien.
    expect(res.body).toMatchObject({ email: 'new@x.fr', role: 'member', invitedBy: admin.userId, expired: false });
    expect(Object.keys(bodyOf(res)).sort()).toEqual(['createdAt', 'email', 'expired', 'expiresAt', 'id', 'invitedBy', 'link', 'role']);
    const link = bodyOf(res).link as string;
    expect(link.startsWith(`${t.env.APP_URL}/rejoindre?token=`)).toBe(true);
    expect(res.get('Cache-Control')).toBe('no-store');
    expect(send).not.toHaveBeenCalled();

    // Le lien est celui de l'invitation créée, et il ouvre un compte pour cette adresse.
    expect(await t.invitations.check(tokenOf(link))).toMatchObject({
      status: 'valid',
      invitation: { id: res.body.id, email: 'new@x.fr', role: 'member', invitedBy: admin.userId },
    });
    expect((await accept(t, tokenOf(link), 'Nina')).status).toBe(201);
    expect(await findUserByEmail(t.db, 'new@x.fr')).toMatchObject({ role: 'member', emailVerified: true });
  });

  test('mail_failed ne peut pas arriver : même un mailer qui échouerait n\'est pas appelé', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    vi.spyOn(t.mailer, 'sendInvitation').mockRejectedValue(new Error('ne devrait pas être appelé'));

    const created = await invite(t, admin.cookie, { email: 'new@x.fr' });
    expect(created.status).toBe(201);
    const resent = await resend(t, admin.cookie, created.body.id as string);
    expect(resent.status).toBe(200);
    expect(JSON.stringify([created.body, resent.body])).not.toContain('mail_failed');
  });

  test('relancer répond { ok, link } avec un jeton neuf : l\'ancien lien ne marche plus', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    const created = await invite(t, admin.cookie, { email: 'new@x.fr' });
    const oldToken = tokenOf(created.body.link);

    const res = await resend(t, admin.cookie, created.body.id as string);
    expect(res.status).toBe(200);
    expect(Object.keys(bodyOf(res)).sort()).toEqual(['link', 'ok']);
    expect(res.body.ok).toBe(true);
    expect(res.get('Cache-Control')).toBe('no-store');
    const newToken = tokenOf(res.body.link);
    expect((res.body.link as string).startsWith(`${t.env.APP_URL}/rejoindre?token=`)).toBe(true);
    expect(newToken).not.toBe(oldToken);

    expect((await t.invitations.check(oldToken)).status).toBe('unknown');
    expect((await accept(t, oldToken)).status).toBe(404);
    expect((await t.invitations.check(newToken)).status).toBe('valid');
    expect((await accept(t, newToken)).status).toBe(201);
  });

  test('relancer une invitation inconnue répond toujours 404 not_found, sans lien', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    const res = await resend(t, admin.cookie, '00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  test('avec Resend ou en mémoire, les réponses n\'ont pas de lien', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t);
    const created = await invite(t, admin.cookie, { email: 'new@x.fr' });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty('link');
    const resent = await resend(t, admin.cookie, created.body.id as string);
    expect(resent.body).toEqual({ ok: true });
  });

  test('le lien ne se relit nulle part : ni dans la liste des invitations, ni dans celle des membres', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    const created = await invite(t, admin.cookie, { email: 'new@x.fr' });
    const token = tokenOf(created.body.link);
    const resent = await resend(t, admin.cookie, created.body.id as string);
    const newToken = tokenOf(resent.body.link);

    const invitations = await request(t.app).get('/api/admin/invitations').set('Cookie', admin.cookie);
    const members = await request(t.app).get('/api/admin/members').set('Cookie', admin.cookie);
    const publicMembers = await request(t.app).get('/api/members').set('Cookie', admin.cookie);
    const publicInvitation = await request(t.app).get(`/api/invitations/${newToken}`);
    for (const res of [invitations, members, publicMembers, publicInvitation]) {
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/link|rejoindre|token/i);
      expect(text).not.toContain(token);
      expect(text).not.toContain(newToken);
    }
    expect(invitations.body).toHaveLength(1);
  });

  test('le journal ne reçoit jamais le lien ni son jeton', async () => {
    const { logger, lines } = captureLogs();
    const t = await createNoneTestApp({ logger });
    const admin = await asAdmin(t);
    const created = await invite(t, admin.cookie, { email: 'new@x.fr' });
    const resent = await resend(t, admin.cookie, created.body.id as string);
    const tokens = [tokenOf(created.body.link), tokenOf(resent.body.link)];
    // Une relance sur une invitation disparue, et une invitation en double : les refus ne journalisent pas non plus.
    await resend(t, admin.cookie, '00000000-0000-4000-8000-000000000000');
    await invite(t, admin.cookie, { email: 'new@x.fr' });

    const journal = JSON.stringify(lines);
    for (const token of tokens) expect(journal).not.toContain(token);
    expect(journal).not.toContain('rejoindre');
  });
});
