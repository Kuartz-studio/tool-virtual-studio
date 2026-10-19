import { createHash } from 'node:crypto';
import { INVITATION_TTL_MS, SESSION_TTL_S } from '@bureau/shared';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { invitationContext } from '../src/auth/invitation-context';
import { createInvitationService } from '../src/auth/invitations';
import { countUsers, createTestApp, findUserByEmail } from './helpers/test-app';

const DAY_MS = 24 * 3600 * 1000;

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

function accept(t: TestApp, body: Record<string, unknown>) {
  return request(t.app).post('/api/invitations/accept').send(body);
}

test('inscription directe sans invitation refusée', async () => {
  const t = await createTestApp();
  const res = await request(t.app).post('/api/auth/sign-up/email').send({ email: 'x@x.fr', password: 'motdepasse1', name: 'X' });
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(await countUsers(t.db)).toBe(0);
});

test('invitation valide → compte vérifié, rôle, cookie de session', async () => {
  const t = await createTestApp();
  const { token } = await t.invitations.create({ email: 'Lea@X.fr', role: 'member', invitedBy: null });
  const res = await request(t.app).post('/api/invitations/accept').send({ token, name: 'Léa', password: 'motdepasse1' });
  expect(res.status).toBe(201);
  expect(res.body).toEqual({ ok: true });
  expect(res.get('Set-Cookie')?.join(';')).toMatch(/session_token/);
  const u = await findUserByEmail(t.db, 'lea@x.fr');
  expect(u).toMatchObject({ emailVerified: true, role: 'member', name: 'Léa' });
  expect((await t.invitations.check(token)).status).toBe('used');
});

test('le cookie renvoyé ouvre bien une session Better Auth', async () => {
  const t = await createTestApp();
  const { cookie, userId } = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
  const res = await request(t.app).get('/api/auth/get-session').set('Cookie', cookie);
  expect(res.status).toBe(200);
  expect(res.body.user).toMatchObject({ id: userId, email: 'lea@x.fr', name: 'Léa', role: 'member' });
});

// Le cookie de session posé par l'acceptation d'une invitation.
async function sessionCookieAfterAccept(t: TestApp): Promise<string | undefined> {
  const { token } = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
  const res = await accept(t, { token, name: 'Léa', password: 'motdepasse1' });
  expect(res.status).toBe(201);
  return res.get('Set-Cookie')?.find((cookie) => cookie.includes('session_token='));
}

test('cookie de session : HttpOnly, SameSite=Lax, valable 30 jours', async () => {
  const cookie = await sessionCookieAfterAccept(await createTestApp());
  expect(cookie).toMatch(/^better-auth\.session_token=/);
  expect(cookie).toMatch(/;\s*HttpOnly/i);
  expect(cookie).toMatch(/;\s*SameSite=Lax/i);
  expect(cookie).toMatch(new RegExp(`;\\s*Max-Age=${SESSION_TTL_S}(;|$)`, 'i'));
});

test('cookie de session en production : Secure, avec le préfixe __Secure-', async () => {
  const cookie = await sessionCookieAfterAccept(await createTestApp({ env: { NODE_ENV: 'production' } }));
  expect(cookie).toMatch(/^__Secure-better-auth\.session_token=/);
  expect(cookie).toMatch(/;\s*Secure(;|$)/i);
  expect(cookie).toMatch(/;\s*HttpOnly/i);
  expect(cookie).toMatch(/;\s*SameSite=Lax/i);
});

test('rôle admin transmis', async () => {
  const t = await createTestApp();
  const { token } = await t.invitations.create({ email: 'admin@x.fr', role: 'admin', invitedBy: null });
  const res = await accept(t, { token, name: 'Admin', password: 'motdepasse1' });
  expect(res.status).toBe(201);
  const u = await findUserByEmail(t.db, 'admin@x.fr');
  expect(u?.role).toBe('admin');
});

describe('invitation inutilisable', () => {
  // Chaque cas fabrique un jeton dans l'état voulu et renvoie le nombre de comptes qui existent déjà.
  const setups = {
    async used(t: TestApp) {
      const { token } = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
      expect((await accept(t, { token, name: 'Léa', password: 'motdepasse1' })).status).toBe(201);
      return token;
    },
    async expired(t: TestApp) {
      // Créée il y a 8 jours : son délai de 7 jours est dépassé.
      const eightDaysAgo = () => new Date(Date.now() - 8 * DAY_MS);
      return (await createInvitationService(t.db, eightDaysAgo).create({ email: 'lea@x.fr', role: 'member', invitedBy: null })).token;
    },
    async revoked(t: TestApp) {
      const { invitation, token } = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
      await t.invitations.revoke(invitation.id);
      return token;
    },
  };

  test.each([
    ['jeton réutilisé', 'used'], ['expiré après 8 jours', 'expired'], ['révoqué', 'revoked'],
  ] as const)('%s → 410', async (_label, status) => {
    const t = await createTestApp();
    const token = await setups[status](t);
    const usersBefore = await countUsers(t.db);

    const res = await accept(t, { token, name: 'Autre', password: 'autremotdepasse' });
    expect(res.status).toBe(410);
    expect(res.body).toEqual({ error: status });
    expect(await countUsers(t.db)).toBe(usersBefore);   // aucun nouvel utilisateur

    const info = await request(t.app).get(`/api/invitations/${token}`);
    expect(info.status).toBe(410);
    expect(info.body).toEqual({ error: status });
  });
});

test('jeton inconnu → 404', async () => {
  const t = await createTestApp();
  expect((await request(t.app).get('/api/invitations/abc')).status).toBe(404);
  const res = await accept(t, { token: 'abc', name: 'Léa', password: 'motdepasse1' });
  expect(res.status).toBe(404);
  expect(await countUsers(t.db)).toBe(0);
});

test('mot de passe de 9 caractères → 400, invitation non consommée', async () => {
  const t = await createTestApp();
  const { token } = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
  const res = await accept(t, { token, name: 'Léa', password: 'motdepas9' });
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'invalid' });
  expect((await t.invitations.check(token)).status).toBe('valid');
  expect(await countUsers(t.db)).toBe(0);
});

test('mot de passe de 129 caractères → 400, invitation non consommée', async () => {
  const t = await createTestApp();
  const { token } = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
  const res = await accept(t, { token, name: 'Léa', password: 'x'.repeat(129) });
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'invalid' });
  expect((await t.invitations.check(token)).status).toBe('valid');
});

test('nom vide ou de 41 caractères → 400', async () => {
  const t = await createTestApp();
  const { token } = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
  for (const name of ['', '   ', 'x'.repeat(41)]) {
    const res = await accept(t, { token, name, password: 'motdepasse1' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid' });
  }
  expect((await t.invitations.check(token)).status).toBe('valid');
  expect(await countUsers(t.db)).toBe(0);
});

test('jeton ou champs manquants → 400', async () => {
  const t = await createTestApp();
  const { token } = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
  for (const body of [{}, { name: 'Léa', password: 'motdepasse1' }, { token, password: 'motdepasse1' }, { token, name: 'Léa' }]) {
    const res = await accept(t, body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid' });
  }
  expect(await countUsers(t.db)).toBe(0);
});

test('nom entouré d\'espaces : enregistré sans ces espaces', async () => {
  const t = await createTestApp();
  const { token } = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
  expect((await accept(t, { token, name: '  Léa  ', password: 'motdepasse1' })).status).toBe(201);
  expect((await findUserByEmail(t.db, 'lea@x.fr'))?.name).toBe('Léa');
});

test('GET /api/invitations/:token renvoie l\'e-mail', async () => {
  const t = await createTestApp();
  const { token } = await t.invitations.create({ email: 'Lea@X.fr', role: 'member', invitedBy: null });
  const res = await request(t.app).get(`/api/invitations/${token}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ email: 'lea@x.fr' });
});

describe('verrou d\'invitation', () => {
  test('le compte reçoit l\'adresse et le rôle de l\'invitation, pas ceux envoyés par le client', async () => {
    const t = await createTestApp();
    const { token } = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
    const res = await accept(t, { token, name: 'Léa', password: 'motdepasse1', email: 'pirate@x.fr', role: 'admin', emailVerified: false });
    expect(res.status).toBe(201);
    expect(await findUserByEmail(t.db, 'pirate@x.fr')).toBeUndefined();
    expect(await findUserByEmail(t.db, 'lea@x.fr')).toMatchObject({ role: 'member', emailVerified: true });
    expect(await countUsers(t.db)).toBe(1);
  });

  test('inscription directe refusée même pour une adresse invitée, sans consommer l\'invitation', async () => {
    const t = await createTestApp();
    const { token } = await t.invitations.create({ email: 'lea@x.fr', role: 'admin', invitedBy: null });
    const res = await request(t.app).post('/api/auth/sign-up/email').send({ email: 'lea@x.fr', password: 'motdepasse1', name: 'Léa' });
    expect(res.status).toBe(403);
    expect(await countUsers(t.db)).toBe(0);
    expect((await t.invitations.check(token)).status).toBe('valid');
  });

  test('inscription directe refusée, même en demandant le rôle admin', async () => {
    const t = await createTestApp();
    const res = await request(t.app).post('/api/auth/sign-up/email').send({ email: 'x@x.fr', password: 'motdepasse1', name: 'X', role: 'admin' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await countUsers(t.db)).toBe(0);
  });

  test('signUpEmail côté serveur : refusé hors contexte d\'invitation, ou pour une autre adresse que celle invitée', async () => {
    const t = await createTestApp();
    const body = { email: 'autre@x.fr', password: 'motdepasse1', name: 'Autre' };
    await expect(t.auth.api.signUpEmail({ body })).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      invitationContext.run({ email: 'lea@x.fr', role: 'admin' }, () => t.auth.api.signUpEmail({ body })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await countUsers(t.db)).toBe(0);
  });

  test('une inscription directe simultanée ne profite pas du contexte d\'une acceptation en cours', async () => {
    const t = await createTestApp();
    const { token } = await t.invitations.create({ email: 'lea@x.fr', role: 'admin', invitedBy: null });
    const signUp = (email: string) => request(t.app).post('/api/auth/sign-up/email').send({ email, password: 'motdepasse1', name: 'Pirate' });
    const [accepted, otherEmail, sameEmail] = await Promise.all([
      accept(t, { token, name: 'Léa', password: 'motdepasse1' }),
      signUp('pirate@x.fr'),
      signUp('lea@x.fr'),
    ]);
    expect(accepted.status).toBe(201);
    expect(otherEmail.status).toBe(403);
    expect(sameEmail.status).toBeGreaterThanOrEqual(400);
    expect(await countUsers(t.db)).toBe(1);
    expect(await findUserByEmail(t.db, 'lea@x.fr')).toMatchObject({ name: 'Léa', role: 'admin' });
  });

  test('deux acceptations simultanées du même jeton → un seul compte, la seconde reçoit 410', async () => {
    const t = await createTestApp();
    const { token } = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
    const responses = await Promise.all([
      accept(t, { token, name: 'Léa', password: 'motdepasse1' }),
      accept(t, { token, name: 'Léa bis', password: 'motdepasse2' }),
    ]);
    expect(responses.map((res) => res.status).sort()).toEqual([201, 410]);
    expect(responses.find((res) => res.status === 410)?.body).toEqual({ error: 'used' });
    expect(await countUsers(t.db)).toBe(1);
  });

  test('un compte existe déjà pour l\'adresse invitée → 409 already_member, invitation laissée en attente', async () => {
    const t = await createTestApp();
    await t.inviteAndAccept('lea@x.fr');
    const { token } = await t.invitations.create({ email: 'lea@x.fr', role: 'admin', invitedBy: null });
    const res = await accept(t, { token, name: 'Léa', password: 'motdepasse1' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'already_member' });
    expect(await countUsers(t.db)).toBe(1);
    expect((await findUserByEmail(t.db, 'lea@x.fr'))?.role).toBe('member');
    expect((await t.invitations.check(token)).status).toBe('valid');
  });
});

describe('service d\'invitations', () => {
  test('le jeton : 32 octets aléatoires en base64url ; seule son empreinte sha256 est enregistrée', async () => {
    const t = await createTestApp();
    const { invitation, token } = await t.invitations.create({ email: ' Lea@X.fr ', role: 'member', invitedBy: null });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(invitation.email).toBe('lea@x.fr');
    const { rows } = await t.db.execute<{ token_hash: string }>(sql`select token_hash from invitation`);
    expect(rows).toEqual([{ token_hash: createHash('sha256').update(token).digest('hex') }]);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test('expiration 7 jours après la création', async () => {
    const t = await createTestApp();
    const now = new Date('2026-10-19T10:00:00Z');
    const { invitation, token } = await createInvitationService(t.db, () => now).create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
    expect(invitation.createdAt).toEqual(now);
    expect(invitation.expiresAt).toEqual(new Date(now.getTime() + INVITATION_TTL_MS));
    // Encore valable juste avant l'échéance, expirée à l'échéance.
    const justBefore = createInvitationService(t.db, () => new Date(now.getTime() + INVITATION_TTL_MS - 1));
    const atExpiry = createInvitationService(t.db, () => new Date(now.getTime() + INVITATION_TTL_MS));
    expect((await justBefore.check(token)).status).toBe('valid');
    expect((await atExpiry.check(token)).status).toBe('expired');
  });

  test('check renvoie l\'invitation complète quand elle est valide, et unknown pour un jeton inconnu', async () => {
    const t = await createTestApp();
    const { invitation, token } = await t.invitations.create({ email: 'lea@x.fr', role: 'admin', invitedBy: null });
    expect(await t.invitations.check(token)).toEqual({ status: 'valid', invitation });
    expect(invitation).toMatchObject({ email: 'lea@x.fr', role: 'admin', invitedBy: null, acceptedAt: null, revokedAt: null });
    expect(await t.invitations.check('inconnu')).toEqual({ status: 'unknown' });
    expect(await t.invitations.check('')).toEqual({ status: 'unknown' });
  });

  test('invitedBy garde l\'id de l\'admin qui invite', async () => {
    const t = await createTestApp();
    const { userId } = await t.inviteAndAccept('admin@x.fr', { role: 'admin' });
    const { invitation } = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: userId });
    expect(invitation.invitedBy).toBe(userId);
  });

  test('renew : nouveau jeton et nouvelle expiration ; l\'ancien jeton ne vaut plus rien', async () => {
    const t = await createTestApp();
    const created = await createInvitationService(t.db, () => new Date(Date.now() - 8 * DAY_MS)).create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
    expect((await t.invitations.check(created.token)).status).toBe('expired');

    const { token } = await t.invitations.renew(created.invitation.id);
    expect(token).not.toBe(created.token);
    expect((await t.invitations.check(created.token)).status).toBe('unknown');
    const renewed = await t.invitations.check(token);
    expect(renewed.status).toBe('valid');
    const expiresAt = renewed.status === 'valid' ? renewed.invitation.expiresAt.getTime() : 0;
    expect(expiresAt).toBeGreaterThan(Date.now() + INVITATION_TTL_MS - 60_000);
    expect((await accept(t, { token, name: 'Léa', password: 'motdepasse1' })).status).toBe(201);
  });

  test('renew refuse une invitation acceptée, révoquée ou inconnue', async () => {
    const t = await createTestApp();
    const accepted = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
    expect((await accept(t, { token: accepted.token, name: 'Léa', password: 'motdepasse1' })).status).toBe(201);
    const revoked = await t.invitations.create({ email: 'tom@x.fr', role: 'member', invitedBy: null });
    await t.invitations.revoke(revoked.invitation.id);

    await expect(t.invitations.renew(accepted.invitation.id)).rejects.toThrow();
    await expect(t.invitations.renew(revoked.invitation.id)).rejects.toThrow();
    await expect(t.invitations.renew('00000000-0000-4000-8000-000000000000')).rejects.toThrow();
    expect((await t.invitations.check(accepted.token)).status).toBe('used');
    expect((await t.invitations.check(revoked.token)).status).toBe('revoked');
  });

  test('listPending : ni acceptées ni révoquées (les expirées restent, pour pouvoir les relancer), les plus récentes d\'abord', async () => {
    const t = await createTestApp();
    const clock = (offsetDays: number) => () => new Date(Date.now() - offsetDays * DAY_MS);
    const expired = await createInvitationService(t.db, clock(9)).create({ email: 'ancienne@x.fr', role: 'member', invitedBy: null });
    const pending = await createInvitationService(t.db, clock(2)).create({ email: 'attente@x.fr', role: 'admin', invitedBy: null });
    const accepted = await createInvitationService(t.db, clock(1)).create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
    expect((await accept(t, { token: accepted.token, name: 'Léa', password: 'motdepasse1' })).status).toBe(201);
    const revoked = await t.invitations.create({ email: 'tom@x.fr', role: 'member', invitedBy: null });
    await t.invitations.revoke(revoked.invitation.id);

    expect(await t.invitations.listPending()).toEqual([pending.invitation, expired.invitation]);
  });

  test('markAccepted puis revoke : une invitation acceptée reste « used »', async () => {
    const t = await createTestApp();
    const { invitation, token } = await t.invitations.create({ email: 'lea@x.fr', role: 'member', invitedBy: null });
    await t.invitations.markAccepted(invitation.id);
    await t.invitations.revoke(invitation.id);
    expect((await t.invitations.check(token)).status).toBe('used');
  });
});
