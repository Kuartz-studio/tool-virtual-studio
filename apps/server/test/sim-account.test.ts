import { PASSWORD_MIN_LENGTH } from '@bureau/shared';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { SIM_ACCOUNT, ensureSimAccount, wantsSimAccount } from '../src/sim/sim-account';
import { countUsers, createTestApp, findUserByEmail } from './helpers/test-app';

const signIn = (app: Parameters<typeof request>[0], email: string, password: string) =>
  request(app).post('/api/auth/sign-in/email').set('Origin', 'http://localhost:4000').send({ email, password });

describe('compte de test du faux live', () => {
  test('un identifiant et un mot de passe que l\'on retient, mais que l\'appli accepte', () => {
    expect(SIM_ACCOUNT.email).toBe('admin@bureau.test');
    expect(SIM_ACCOUNT.password).toBe('1234567890');
    expect(SIM_ACCOUNT.password.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
  });

  test('seulement avec SIM=1, et sur une base locale (PGlite) : jamais sur PostgreSQL', () => {
    expect(wantsSimAccount({ SIM: '1', DATABASE_URL: 'pglite://.data/dev' })).toBe(true);
    expect(wantsSimAccount({ SIM: '1', DATABASE_URL: 'memory://' })).toBe(true);
    expect(wantsSimAccount({ SIM: '1', DATABASE_URL: 'postgres://u:p@db:5432/bureau' })).toBe(false);
    expect(wantsSimAccount({ SIM: '1', DATABASE_URL: 'postgresql://u:p@db/bureau' })).toBe(false);
    expect(wantsSimAccount({ SIM: undefined, DATABASE_URL: 'pglite://.data/dev' })).toBe(false);
  });

  test('créé admin, et la vraie connexion (e-mail et mot de passe) l\'ouvre ; un autre mot de passe, non', async () => {
    const t = await createTestApp();
    expect(await ensureSimAccount(t)).toBe('created');
    expect(await findUserByEmail(t.db, SIM_ACCOUNT.email)).toMatchObject({ name: 'Admin', role: 'admin', emailVerified: true });

    const ok = await signIn(t.app, SIM_ACCOUNT.email, SIM_ACCOUNT.password);
    expect(ok.status).toBe(200);
    const cookie = (ok.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]).join('; ');
    // La session ouverte donne accès au panneau Admin (route réservée aux admins) et au faux live.
    expect((await request(t.app).get('/api/admin/members').set('Cookie', cookie)).status).toBe(200);
    expect((await signIn(t.app, SIM_ACCOUNT.email, 'autre-mot-de-passe')).status).toBe(401);
  });

  test('l\'adresse saisie avec des majuscules ou des espaces convient aussi (le formulaire la retaille)', async () => {
    const t = await createTestApp();
    await ensureSimAccount(t);
    expect((await signIn(t.app, 'Admin@Bureau.Test', SIM_ACCOUNT.password)).status).toBe(200);
  });

  test('déjà là : rien n\'est créé ni changé, même si son mot de passe a été changé', async () => {
    const t = await createTestApp();
    await t.inviteAndAccept(SIM_ACCOUNT.email, { role: 'member', password: 'un-autre-mot-de-passe' });
    expect(await ensureSimAccount(t)).toBe('exists');
    expect(await countUsers(t.db)).toBe(1);
    expect(await findUserByEmail(t.db, SIM_ACCOUNT.email)).toMatchObject({ role: 'member' });
    expect((await signIn(t.app, SIM_ACCOUNT.email, SIM_ACCOUNT.password)).status).toBe(401);
    expect((await signIn(t.app, SIM_ACCOUNT.email, 'un-autre-mot-de-passe')).status).toBe(200);
  });

  test('deux appels de suite : un seul compte', async () => {
    const t = await createTestApp();
    expect(await ensureSimAccount(t)).toBe('created');
    expect(await ensureSimAccount(t)).toBe('exists');
    expect(await countUsers(t.db)).toBe(1);
  });
});
