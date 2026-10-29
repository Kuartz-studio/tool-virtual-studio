import { CURRENT_RELEASE } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { user } from '../src/db/schema';
import { createTestApp } from './helpers/test-app';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

// Ce que la base garde : la dernière version dont la personne a vu les nouveautés.
async function seenBy(t: TestApp, userId: string): Promise<string | null | undefined> {
  const [found] = await t.db.select({ lastReleaseSeen: user.lastReleaseSeen }).from(user).where(eq(user.id, userId));
  return found?.lastReleaseSeen;
}

// Comme un compte d'avant la fenêtre « Quoi de neuf ? » (migration 0014) : aucune version vue, ou celle-ci.
async function setSeen(t: TestApp, userId: string, version: string | null): Promise<void> {
  await t.db.update(user).set({ lastReleaseSeen: version }).where(eq(user.id, userId));
}

// La session telle que le client la lit (authClient.getSession).
async function sessionUser(t: TestApp, cookie: string): Promise<Record<string, unknown>> {
  const res = await request(t.app).get('/api/auth/get-session').set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body.user as Record<string, unknown>;
}

describe('les nouveautés vues, par compte', () => {
  test('un compte créé maintenant part à jour : il ne verra pas les nouveautés d\'avant son arrivée', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr');
    expect(await seenBy(t, userId)).toBe(CURRENT_RELEASE);
    expect((await sessionUser(t, cookie)).lastReleaseSeen).toBe(CURRENT_RELEASE);
  });

  test('un compte d\'avant (null) : la session le dit en null, et non en champ absent', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr');
    await setSeen(t, userId, null);
    const found = await sessionUser(t, cookie);
    expect(found).toHaveProperty('lastReleaseSeen', null);
  });

  test('le client ne choisit pas sa version vue : ni à la création du compte, ni par PATCH /api/me', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr');
    await request(t.app).patch('/api/me').set('Cookie', cookie).send({ name: 'Léa', lastReleaseSeen: '99.99' });
    expect(await seenBy(t, userId)).toBe(CURRENT_RELEASE);
  });
});

describe('POST /api/me/release-seen', () => {
  test('sans session → 401', async () => {
    const t = await createTestApp();
    const res = await request(t.app).post('/api/me/release-seen');
    expect(res.status).toBe(401);
  });

  test('enregistre la version du serveur, quel que soit le corps, et s\'appelle deux fois sans rien changer', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr');
    await setSeen(t, userId, null);

    const first = await request(t.app).post('/api/me/release-seen').set('Cookie', cookie).send({ version: '99.99' });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ lastReleaseSeen: CURRENT_RELEASE });
    expect(await seenBy(t, userId)).toBe(CURRENT_RELEASE);
    expect((await sessionUser(t, cookie)).lastReleaseSeen).toBe(CURRENT_RELEASE);

    const again = await request(t.app).post('/api/me/release-seen').set('Cookie', cookie);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ lastReleaseSeen: CURRENT_RELEASE });
    expect(await seenBy(t, userId)).toBe(CURRENT_RELEASE);
  });

  test('ne touche qu\'au compte de la session, et ne fait jamais reculer une version vue plus récente', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr');
    const max = await t.inviteAndAccept('max@x.fr');
    await setSeen(t, lea.userId, null);
    await setSeen(t, max.userId, null);

    await request(t.app).post('/api/me/release-seen').set('Cookie', lea.cookie).expect(200);
    expect(await seenBy(t, max.userId)).toBeNull();

    // Un serveur revenu à une version plus ancienne : le compte garde celle qu'il avait vue.
    await setSeen(t, max.userId, '99.99');
    const res = await request(t.app).post('/api/me/release-seen').set('Cookie', max.cookie);
    expect(res.body).toEqual({ lastReleaseSeen: '99.99' });
    expect(await seenBy(t, max.userId)).toBe('99.99');
  });
});

describe('POST /api/test/release-seen/reset (E2E=1)', () => {
  test('remet un compte à « aucune version vue » ; 404 pour une adresse sans compte ; absente sans E2E=1', async () => {
    const t = await createTestApp({ env: { E2E: '1' } });
    const { userId } = await t.inviteAndAccept('lea@x.fr');
    const res = await request(t.app).post('/api/test/release-seen/reset').send({ email: 'Lea@X.fr' });
    expect(res.status).toBe(204);
    expect(await seenBy(t, userId)).toBeNull();
    expect((await request(t.app).post('/api/test/release-seen/reset').send({ email: 'personne@x.fr' })).status).toBe(404);
    expect((await request(t.app).post('/api/test/release-seen/reset').send({ email: 'pas une adresse' })).status).toBe(400);

    const plain = await createTestApp();
    expect((await request(plain.app).post('/api/test/release-seen/reset').send({ email: 'lea@x.fr' })).status).toBe(404);
  });
});
