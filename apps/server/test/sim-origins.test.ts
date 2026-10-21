import { describe, expect, test } from 'vitest';
import { simOrigins } from '../src/sim/sim-origins';
import { connectError, enter, startTestServer } from './helpers/realtime';
import { createTestApp } from './helpers/test-app';

// Une page ouverte à http://127.0.0.1:PORT au lieu de http://localhost:PORT (Vite affiche la première dans son journal) a une autre
// origine pour le navigateur. Avec le faux live (SIM=1), les deux sont acceptées ; sans lui, rien ne change.
describe('simOrigins', () => {
  test('SIM=1 : les autres écritures de l\'adresse de la machine, même schéma et même port', () => {
    expect(simOrigins({ SIM: '1', APP_URL: 'http://localhost:3057' })).toEqual(['http://127.0.0.1:3057', 'http://[::1]:3057']);
    expect(simOrigins({ SIM: '1', APP_URL: 'http://127.0.0.1:5173' })).toEqual(['http://localhost:5173', 'http://[::1]:5173']);
    expect(simOrigins({ SIM: '1', APP_URL: 'http://localhost' })).toEqual(['http://127.0.0.1', 'http://[::1]']);
  });

  test('sans SIM=1, ou pour une adresse qui n\'est pas celle de la machine : rien', () => {
    expect(simOrigins({ SIM: undefined, APP_URL: 'http://localhost:3057' })).toEqual([]);
    expect(simOrigins({ SIM: '1', APP_URL: 'https://bureau.exemple.fr' })).toEqual([]);
    expect(simOrigins({ SIM: '1', APP_URL: 'http://192.168.1.20:3057' })).toEqual([]);
  });
});

// Better Auth ne contrôle pas l'origine sous NODE_ENV=test (isTest) : on lit donc la liste d'origines de confiance qu'il a reçue, celle
// qu'il appliquera en développement et en production.
describe('connexion (Better Auth)', () => {
  test('SIM=1 : l\'origine de APP_URL et ses alias de la machine, rien d\'autre', async () => {
    const t = await createTestApp({ env: { SIM: '1' } });
    // testEnv : APP_URL vaut http://localhost:4000.
    // (Better Auth y ajoute lui-même l'origine de baseURL : on compare les origines, pas la liste.)
    expect(new Set((await t.auth.$context).trustedOrigins)).toEqual(new Set(['http://localhost:4000', 'http://127.0.0.1:4000', 'http://[::1]:4000']));
  });

  test('sans SIM=1 (la prod) : seule l\'origine de APP_URL, comme avant', async () => {
    const t = await createTestApp();
    expect(new Set((await t.auth.$context).trustedOrigins)).toEqual(new Set(['http://localhost:4000']));
  });
});

describe('temps réel', () => {
  test('SIM=1 : une page de 127.0.0.1 entre au bureau, un autre port ou site reste refusé', async () => {
    const srv = await startTestServer({ env: { SIM: '1' } });
    const cookie = await srv.inviteAndLogin('a@x.fr');
    const { socket } = await enter(srv, cookie, { extraHeaders: { cookie, origin: 'http://127.0.0.1:4000' } });
    socket.disconnect();
    for (const origin of ['https://pirate.example', 'http://127.0.0.1:4001']) {
      expect(await connectError(srv.connect(cookie, { extraHeaders: { cookie, origin } })), origin).toBe('forbidden_origin');
    }
  });

  test('sans SIM=1 : 127.0.0.1 reste refusée', async () => {
    const srv = await startTestServer();
    const cookie = await srv.inviteAndLogin('a@x.fr');
    expect(await connectError(srv.connect(cookie, { extraHeaders: { cookie, origin: 'http://127.0.0.1:4000' } }))).toBe('forbidden_origin');
  });
});
