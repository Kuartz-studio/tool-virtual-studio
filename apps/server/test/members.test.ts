import { DEV_AVATAR_KEYS } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, test, vi } from 'vitest';
import { user } from '../src/db/schema';
import { createTestApp } from './helpers/test-app';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

// Ce que la base garde d'un compte, pour vérifier qu'une requête a (ou n'a pas) changé quelque chose.
async function accountOf(t: TestApp, userId: string) {
  const [found] = await t.db.select({ name: user.name, email: user.email, role: user.role, avatarKey: user.avatarKey }).from(user).where(eq(user.id, userId));
  return found;
}

function patchMe(t: TestApp, cookie: string, body: unknown) {
  return request(t.app).patch('/api/me').set('Cookie', cookie).send(body as object);
}

describe('GET /api/members', () => {
  test('sans session → 401', async () => {
    const t = await createTestApp();
    const res = await request(t.app).get('/api/members');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(res.get('Cache-Control')).toBe('no-store');
  });

  test('id, nom et avatar des membres, et rien d\'autre (ni e-mail ni rôle)', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
    const tom = await t.inviteAndAccept('tom@x.fr', { name: 'Tom', role: 'admin' });
    await t.db.update(user).set({ avatarKey: 'dev-blue' }).where(eq(user.id, tom.userId));

    // Un membre et un admin voient la même liste, dans l'ordre d'arrivée.
    for (const { cookie } of [lea, tom]) {
      const res = await request(t.app).get('/api/members').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.get('Cache-Control')).toBe('no-store');   // des données privées : pas de copie gardée par le navigateur
      expect(res.body).toEqual([
        { id: lea.userId, name: 'Léa', avatarKey: null },
        { id: tom.userId, name: 'Tom', avatarKey: 'dev-blue' },
      ]);
    }
  });

  test('GET /api/members exclut les comptes désactivés', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
    const tom = await t.inviteAndAccept('tom@x.fr', { name: 'Tom' });
    await t.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, tom.userId));

    const res = await request(t.app).get('/api/members').set('Cookie', lea.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: lea.userId, name: 'Léa', avatarKey: null }]);
  });

  test('un compte désactivé dont la session a survécu est refusé quand même', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
    expect((await request(t.app).get('/api/members').set('Cookie', lea.cookie)).status).toBe(200);

    // On désactive le compte sans toucher à ses sessions (une connexion en cours pendant le retrait, par exemple).
    await t.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, lea.userId));
    const members = await request(t.app).get('/api/members').set('Cookie', lea.cookie);
    expect(members.status).toBe(401);
    const patch = await patchMe(t, lea.cookie, { name: 'Pirate' });
    expect(patch.status).toBe(401);
    expect((await accountOf(t, lea.userId))?.name).toBe('Léa');
  });
});

describe('PATCH /api/me', () => {
  test('sans session → 401, rien ne change', async () => {
    const t = await createTestApp();
    const { userId } = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
    const changed = vi.fn();
    t.events.on('profile:changed', changed);

    const res = await request(t.app).patch('/api/me').send({ name: 'Pirate' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect((await accountOf(t, userId))?.name).toBe('Léa');
    expect(changed).not.toHaveBeenCalled();
  });

  test('PATCH /api/me', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
    const changed = vi.fn();
    t.events.on('profile:changed', changed);

    // Un avatar inconnu est refusé : rien ne change, aucun événement.
    const refused = await patchMe(t, cookie, { avatarKey: 'nope' });
    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({ error: 'invalid' });
    expect(await accountOf(t, userId)).toMatchObject({ name: 'Léa', avatarKey: null });
    expect(changed).not.toHaveBeenCalled();

    // Le nom : 200, enregistré, et profile:changed part avec le profil complet.
    const renamed = await patchMe(t, cookie, { name: 'Léa B.' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toEqual({ id: userId, name: 'Léa B.', avatarKey: null });
    expect(await accountOf(t, userId)).toMatchObject({ name: 'Léa B.', avatarKey: null });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenLastCalledWith({ id: userId, name: 'Léa B.', avatarKey: null });

    // L'avatar : le profil envoyé aux autres porte aussi le nom actuel.
    const avatarKey = DEV_AVATAR_KEYS[1];
    const withAvatar = await patchMe(t, cookie, { avatarKey });
    expect(withAvatar.status).toBe(200);
    expect(withAvatar.body).toEqual({ id: userId, name: 'Léa B.', avatarKey });
    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenLastCalledWith({ id: userId, name: 'Léa B.', avatarKey });

    // Les deux ensemble, dans une seule requête et un seul événement.
    const both = await patchMe(t, cookie, { name: 'Léa', avatarKey: DEV_AVATAR_KEYS[2] });
    expect(both.status).toBe(200);
    expect(changed).toHaveBeenCalledTimes(3);
    expect(changed).toHaveBeenLastCalledWith({ id: userId, name: 'Léa', avatarKey: DEV_AVATAR_KEYS[2] });

    // Better Auth relit la même base : la session voit le nouveau profil.
    const me = await request(t.app).get('/api/auth/get-session').set('Cookie', cookie);
    expect(me.body.user).toMatchObject({ id: userId, name: 'Léa', avatarKey: DEV_AVATAR_KEYS[2] });
  });

  test('le nom suit displayNameSchema : espaces retirés, vide ou trop long refusé', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });

    const trimmed = await patchMe(t, cookie, { name: '  Léa B.  ' });
    expect(trimmed.status).toBe(200);
    expect(trimmed.body.name).toBe('Léa B.');
    expect((await accountOf(t, userId))?.name).toBe('Léa B.');

    for (const name of ['', '   ', 'x'.repeat(41), 42, null, ['Léa']]) {
      const res = await patchMe(t, cookie, { name });
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect(res.body).toEqual({ error: 'invalid' });
    }
    expect((await patchMe(t, cookie, { name: 'x'.repeat(40) })).status).toBe(200);   // 40 caractères : la limite
  });

  test('avatarKey doit être une clé d\'avatar connue', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr');
    for (const avatarKey of ['', 'DEV-RED', ' dev-red', 'dev-red ', null, 3, {}]) {
      const res = await patchMe(t, cookie, { avatarKey });
      expect(res.status, JSON.stringify(avatarKey)).toBe(400);
    }
    expect((await accountOf(t, userId))?.avatarKey).toBeNull();
    expect((await patchMe(t, cookie, { avatarKey: DEV_AVATAR_KEYS[0] })).status).toBe(200);
  });

  test('un corps sans nom ni avatar → 400, pas d\'événement', async () => {
    const t = await createTestApp();
    const { cookie } = await t.inviteAndAccept('lea@x.fr');
    const changed = vi.fn();
    t.events.on('profile:changed', changed);

    for (const body of [{}, { role: 'admin' }, [], 'Léa']) {
      const res = await patchMe(t, cookie, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body).toEqual({ error: 'invalid' });
    }
    expect((await request(t.app).patch('/api/me').set('Cookie', cookie)).status).toBe(400);   // sans corps
    expect(changed).not.toHaveBeenCalled();
  });

  test('seuls le nom et l\'avatar se changent : le client ne choisit ni son rôle, ni son adresse, ni son identifiant', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
    const tom = await t.inviteAndAccept('tom@x.fr', { name: 'Tom' });

    const res = await patchMe(t, lea.cookie, {
      name: 'Léa B.', role: 'admin', email: 'pirate@x.fr', id: tom.userId, disabledAt: new Date().toISOString(), emailVerified: false,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: lea.userId, name: 'Léa B.', avatarKey: null });
    expect(await accountOf(t, lea.userId)).toEqual({ name: 'Léa B.', email: 'lea@x.fr', role: 'member', avatarKey: null });
    expect(await accountOf(t, tom.userId)).toEqual({ name: 'Tom', email: 'tom@x.fr', role: 'member', avatarKey: null });
    const [stored] = await t.db.select({ disabledAt: user.disabledAt, emailVerified: user.emailVerified }).from(user).where(eq(user.id, lea.userId));
    expect(stored).toEqual({ disabledAt: null, emailVerified: true });
  });
});

// Better Auth sait modifier le profil sans passer par PATCH /api/me, et sans appliquer les règles de displayNameSchema (un nom
// de 41 caractères passe). Ces routes sont fermées : PATCH /api/me est le seul chemin.
describe('routes de profil de Better Auth fermées', () => {
  test('POST /api/auth/update-user : { role: "admin" } ou un nom de 41 caractères sont rejetés, rien ne change', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });

    for (const body of [{ role: 'admin' }, { name: 'x'.repeat(41) }, { name: 'Pirate' }, { avatarKey: 'nope' }, { image: 'https://x.fr/a.png' }]) {
      const res = await request(t.app).post('/api/auth/update-user').set('Cookie', cookie).send(body);
      expect(res.status, JSON.stringify(body)).toBe(404);
    }
    expect(await accountOf(t, userId)).toEqual({ name: 'Léa', email: 'lea@x.fr', role: 'member', avatarKey: null });
    const [stored] = await t.db.select({ image: user.image }).from(user).where(eq(user.id, userId));
    expect(stored?.image).toBeNull();
  });

  test('changement d\'adresse et suppression de compte : fermés aussi, y compris avec une barre finale', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });

    const attempts: Array<[string, object]> = [
      ['/api/auth/change-email', { newEmail: 'pirate@x.fr' }],
      ['/api/auth/change-email/', { newEmail: 'pirate@x.fr' }],
      ['/api/auth/delete-user', {}],
      ['/api/auth/delete-user/', {}],
      ['/api/auth/update-user/', { role: 'admin' }],
    ];
    for (const [path, body] of attempts) {
      const res = await request(t.app).post(path).set('Cookie', cookie).send(body);
      expect(res.status, path).toBe(404);
    }
    expect(await accountOf(t, userId)).toEqual({ name: 'Léa', email: 'lea@x.fr', role: 'member', avatarKey: null });
  });
});
