import { format } from 'node:util';
import request from 'supertest';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { betterAuthLogger } from '../src/auth/auth-logger';
import { createLogger } from '../src/logger';
import { captureLogs } from './helpers/logs';
import { createTestApp } from './helpers/test-app';

afterEach(() => {
  vi.restoreAllMocks();
});

// Un jeton d'invitation tel qu'il apparaît dans un lien : il ne doit jamais finir dans le journal.
const SECRET_TOKEN = 'jeton-secret-de-l-invitation-0123456789';

describe('erreurs de l\'API, toujours en JSON', () => {
  test('corps JSON mal formé → 400 { error: invalid }', async () => {
    const { app } = await createTestApp();
    const res = await request(app).post('/api/invitations/accept').set('Content-Type', 'application/json').send('{"token": ');
    expect(res.status).toBe(400);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ error: 'invalid' });
  });

  test('corps trop gros → 413 { error: invalid }, sans rien journaliser', async () => {
    const { logger, lines } = captureLogs();
    const { app } = await createTestApp({ logger });
    const res = await request(app)
      .post('/api/invitations/accept')
      .send({ token: 'x', name: 'Léa', password: 'x'.repeat(200_000) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'invalid' });
    expect(lines).toEqual([]);
  });

  test('erreur imprévue → 500 { error: internal }, journalisée avec la route, sans le chemin reçu', async () => {
    const { logger, lines } = captureLogs();
    const t = await createTestApp({ logger });
    vi.spyOn(t.invitations, 'check').mockRejectedValue(new Error('la base ne répond plus'));

    const res = await request(t.app).get(`/api/invitations/${SECRET_TOKEN}`);
    expect(res.status).toBe(500);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ error: 'internal' });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 50, msg: 'Erreur pendant une requête', method: 'GET', route: '/:token', err: { message: 'la base ne répond plus' } });
    expect(JSON.stringify(lines)).not.toContain(SECRET_TOKEN);
  });

  test('journal muet (tests, e2e) : l\'erreur 500 s\'écrit aussi sur la sortie d\'erreur', async () => {
    const t = await createTestApp();
    vi.spyOn(t.invitations, 'check').mockRejectedValue(new Error('la base ne répond plus'));
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect((await request(t.app).get(`/api/invitations/${SECRET_TOKEN}`)).status).toBe(500);
    expect(stderr).toHaveBeenCalledOnce();
    // Ce que la console affiche réellement.
    const printed = format(...stderr.mock.calls[0]!);
    expect(printed).toContain('Erreur pendant une requête');
    expect(printed).toContain('method: \'GET\'');
    expect(printed).toContain('route: \'/:token\'');
    expect(printed).toContain('Error: la base ne répond plus');   // l'erreur, pile comprise
    expect(printed).not.toContain(SECRET_TOKEN);
  });

  // Drizzle cite les paramètres d'une requête qui échoue dans son erreur (DrizzleQueryError : message, pile, `params`). Pour la lecture
  // d'une session, c'est le jeton de la session : il ouvrirait le compte à qui lit le journal.
  test('la base tombe pendant la lecture d\'une session : le journal dit l\'erreur, sans le jeton de session', async () => {
    const { logger, lines } = captureLogs();
    const t = await createTestApp({ logger });
    const { cookie } = await t.inviteAndAccept('lea@x.fr');
    // Le cookie : « <nom>=<jeton>.<signature> » ; la base garde le jeton.
    const sessionToken = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)).split('.')[0]!;
    expect(sessionToken.length).toBeGreaterThan(20);
    const client = (t.db as unknown as { $client: { query(...args: unknown[]): Promise<unknown> } }).$client;
    vi.spyOn(client, 'query').mockRejectedValue(Object.assign(new Error('Connection terminated unexpectedly'), { code: '08006' }));

    const res = await request(t.app).get('/api/members').set('Cookie', cookie);
    expect(res.status).toBeGreaterThanOrEqual(500);
    const logged = JSON.stringify(lines);
    expect(lines.filter((line) => (line.level as number) >= 50).length).toBeGreaterThan(0);
    expect(logged).toContain('Failed query');   // c'est bien l'erreur de Drizzle qui est journalisée
    expect(logged).toContain('Connection terminated unexpectedly');
    expect(logged).not.toContain(sessionToken);
  });

  test('journal actif : l\'erreur 500 ne s\'écrit qu\'une fois, dans le journal', async () => {
    const { logger } = captureLogs();
    const t = await createTestApp({ logger });
    vi.spyOn(t.invitations, 'check').mockRejectedValue(new Error('la base ne répond plus'));
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect((await request(t.app).get(`/api/invitations/${SECRET_TOKEN}`)).status).toBe(500);
    expect(stderr).not.toHaveBeenCalled();
  });
});

describe('journaux de Better Auth', () => {
  function signInWithWrongPassword(app: Awaited<ReturnType<typeof createTestApp>>['app']) {
    return request(app).post('/api/auth/sign-in/email').send({ email: 'lea@x.fr', password: 'pas-le-bon-mot-de-passe' });
  }

  test('ils passent par le journal du serveur (une ligne JSON), pas par la console', async () => {
    const { logger, lines } = captureLogs();
    const t = await createTestApp({ logger });
    await t.inviteAndAccept('lea@x.fr');
    const consoleWarn = vi.spyOn(console, 'warn');

    expect((await signInWithWrongPassword(t.app)).status).toBe(401);
    expect(lines).toContainEqual(expect.objectContaining({ level: 40, source: 'better-auth', msg: 'Invalid password' }));
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  test('un refus ordinaire (401) n\'est pas journalisé comme une erreur', async () => {
    const { logger, lines } = captureLogs();
    const t = await createTestApp({ logger });
    await t.inviteAndAccept('lea@x.fr');

    expect((await signInWithWrongPassword(t.app)).status).toBe(401);
    expect(lines.filter((line) => (line.level as number) >= 50)).toEqual([]);
  });

  test('journal muet (tests) : rien sur la console', async () => {
    const t = await createTestApp();
    await t.inviteAndAccept('lea@x.fr');
    const consoleWarn = vi.spyOn(console, 'warn');
    const consoleError = vi.spyOn(console, 'error');
    const consoleLog = vi.spyOn(console, 'log');

    expect((await signInWithWrongPassword(t.app)).status).toBe(401);
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });

  // Better Auth répond 500 lui-même quand une de ses routes échoue (la base est tombée) : seul son journal le dit.
  test('une erreur de Better Auth garde son erreur (pile comprise) dans le journal', () => {
    const { logger, lines } = captureLogs();
    betterAuthLogger(logger).log?.('error', 'INTERNAL_SERVER_ERROR', new Error('la base ne répond plus'), { route: '/get-session' });
    expect(lines).toEqual([
      expect.objectContaining({
        level: 50,
        source: 'better-auth',
        msg: 'INTERNAL_SERVER_ERROR',
        err: expect.objectContaining({ message: 'la base ne répond plus', stack: expect.any(String) }),
        details: [{ route: '/get-session' }],
      }),
    ]);
  });

  test('journal muet (tests, e2e) : une erreur de Better Auth s\'écrit aussi sur la sortie d\'erreur, un avertissement non', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const silent = betterAuthLogger(createLogger({ NODE_ENV: 'test' }));
    silent.log?.('warn', 'Invalid password');
    expect(stderr).not.toHaveBeenCalled();
    silent.log?.('error', 'INTERNAL_SERVER_ERROR', new Error('la base ne répond plus'));
    expect(stderr).toHaveBeenCalledOnce();
    expect(stderr.mock.calls[0]).toContainEqual(expect.objectContaining({ err: expect.objectContaining({ message: 'la base ne répond plus' }) }));
  });
});
