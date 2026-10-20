import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { expect, test } from 'vitest';
import { loadEnv } from '../src/env';

const valid = { APP_URL: 'http://localhost:4000', DATABASE_URL: 'memory://', BETTER_AUTH_SECRET: 'x'.repeat(32) };

test('APP_URL manquante → erreur qui la nomme', () =>
  expect(() => loadEnv({ DATABASE_URL: 'memory://', BETTER_AUTH_SECRET: 'x'.repeat(32) })).toThrow(/APP_URL/));
test('production refuse memory:// et MAILER=memory', () => {
  const base = { NODE_ENV: 'production', APP_URL: 'https://b.fr', BETTER_AUTH_SECRET: 'x'.repeat(32) };
  expect(() => loadEnv({ ...base, DATABASE_URL: 'memory://', MAILER: 'resend', RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.fr' })).toThrow(/DATABASE_URL/);
  expect(() => loadEnv({ ...base, DATABASE_URL: 'pglite://.data/dev', MAILER: 'resend', RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.fr' })).toThrow(/DATABASE_URL/);
  expect(() => loadEnv({ ...base, DATABASE_URL: 'postgres://x', MAILER: 'memory' })).toThrow(/MAILER/);
});

// Sans e-mail (MAILER=none), l'admin copie lui-même les liens d'invitation et de mot de passe : c'est le mode le moins cher, et il est
// accepté en production. Seul memory, qui ne livre rien à personne, y reste refusé.
test('production accepte MAILER=none, sans RESEND_API_KEY ni MAIL_FROM, et refuse toujours MAILER=memory', () => {
  const production = { NODE_ENV: 'production', APP_URL: 'https://b.fr', BETTER_AUTH_SECRET: 'x'.repeat(32), DATABASE_URL: 'postgres://u:p@db:5432/bureau' };
  const env = loadEnv({ ...production, MAILER: 'none' });
  expect(env).toMatchObject({ NODE_ENV: 'production', MAILER: 'none' });
  expect([env.RESEND_API_KEY, env.MAIL_FROM]).toEqual([undefined, undefined]);
  expect(() => loadEnv({ ...production, MAILER: 'memory' })).toThrow(/MAILER : doit valoir resend ou none en production/);
  // Sans MAILER, le défaut est memory : refusé en production, où il faut choisir.
  expect(() => loadEnv(production)).toThrow(/MAILER : doit valoir resend ou none en production/);
});

test('MAILER=none ne demande rien d\'autre, en développement non plus', () => {
  expect(loadEnv({ ...valid, MAILER: 'none' }).MAILER).toBe('none');
  // Des variables Resend laissées dans le fichier .env ne gênent pas.
  expect(loadEnv({ ...valid, MAILER: 'none', RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.fr' }).MAILER).toBe('none');
});

// Les routes de test (E2E=1) créent des invitations sans session admin et lisent les e-mails envoyés.
test('production refuse E2E=1', () => {
  const production = {
    NODE_ENV: 'production', APP_URL: 'https://b.fr', BETTER_AUTH_SECRET: 'x'.repeat(32),
    DATABASE_URL: 'postgres://u:p@db:5432/bureau', MAILER: 'resend', RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.fr',
  };
  expect(loadEnv(production).E2E).toBeUndefined();
  expect(() => loadEnv({ ...production, E2E: '1' })).toThrow(/E2E : interdite en production/);
});

// Avec Resend, les tests e2e enverraient de vrais e-mails à leurs adresses inventées, et /api/test/mails/last n'aurait rien à lire.
test('E2E=1 exige MAILER=memory', () => {
  expect(() => loadEnv({ ...valid, E2E: '1', MAILER: 'resend', RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.fr' })).toThrow(/E2E : exige MAILER=memory/);
  expect(() => loadEnv({ ...valid, E2E: '1', MAILER: 'none' })).toThrow(/E2E : exige MAILER=memory/);
  expect(loadEnv({ ...valid, E2E: '1', MAILER: 'memory' }).E2E).toBe('1');
});

test('production sans DATABASE_URL → erreur qui la nomme', () => {
  expect(() => loadEnv({ NODE_ENV: 'production', APP_URL: 'https://b.fr', BETTER_AUTH_SECRET: 'x'.repeat(32), MAILER: 'resend' })).toThrow(/DATABASE_URL/);
});

test('production valide : PostgreSQL et Resend', () => {
  const env = loadEnv({
    NODE_ENV: 'production', APP_URL: 'https://b.fr', BETTER_AUTH_SECRET: 'x'.repeat(32),
    DATABASE_URL: 'postgres://u:p@db:5432/bureau', MAILER: 'resend', RESEND_API_KEY: 'k', MAIL_FROM: 'Bureau <a@b.fr>',
  });
  expect(env).toMatchObject({ NODE_ENV: 'production', MAILER: 'resend', RESEND_API_KEY: 'k', MAIL_FROM: 'Bureau <a@b.fr>' });
});

test('valeurs par défaut', () => {
  const env = loadEnv(valid);
  expect(env).toMatchObject({
    NODE_ENV: 'development', PORT: 4000, MAILER: 'memory', MAP_KEY: 'dev-office', AUTH_RATE_LIMIT: 'on',
    APP_URL: 'http://localhost:4000', DATABASE_URL: 'memory://',
  });
  expect(env.MAPS_DIR).toBe(resolve(import.meta.dirname, '../../client/public/assets/maps'));
  for (const name of ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'CLIENT_DIST_DIR', 'E2E', 'RESEND_API_KEY', 'MAIL_FROM'] as const) {
    expect(env[name], name).toBeUndefined();
  }
});

test('valeurs fournies', () => {
  const env = loadEnv({
    ...valid, PORT: '3100', MAP_KEY: 'office', MAPS_DIR: '/maps', CLIENT_DIST_DIR: 'apps/client/dist', E2E: '1', AUTH_RATE_LIMIT: 'off',
    LIVEKIT_URL: 'wss://x.livekit.cloud', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'secret',
  });
  expect(env).toMatchObject({
    PORT: 3100, MAP_KEY: 'office', MAPS_DIR: '/maps', CLIENT_DIST_DIR: 'apps/client/dist', E2E: '1', AUTH_RATE_LIMIT: 'off',
    LIVEKIT_URL: 'wss://x.livekit.cloud', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'secret',
  });
});

test('une variable vide vaut une variable absente', () => {
  const env = loadEnv({ ...valid, PORT: '', MAP_KEY: '', MAPS_DIR: '  ', LIVEKIT_URL: '', CLIENT_DIST_DIR: '', E2E: '', MAILER: '', AUTH_RATE_LIMIT: '' });
  expect(env).toMatchObject({ PORT: 4000, MAP_KEY: 'dev-office', MAILER: 'memory', AUTH_RATE_LIMIT: 'on' });
  expect([env.LIVEKIT_URL, env.CLIENT_DIST_DIR, env.E2E]).toEqual([undefined, undefined, undefined]);
  expect(() => loadEnv({ ...valid, APP_URL: '' })).toThrow(/APP_URL/);
});

test('APP_URL : barre finale retirée, http(s) seulement', () => {
  expect(loadEnv({ ...valid, APP_URL: 'https://bureau.exemple.fr/' }).APP_URL).toBe('https://bureau.exemple.fr');
  expect(() => loadEnv({ ...valid, APP_URL: 'ftp://bureau.exemple.fr' })).toThrow(/APP_URL/);
  expect(() => loadEnv({ ...valid, APP_URL: 'localhost:4000' })).toThrow(/APP_URL/);
});

test('MAILER=resend exige RESEND_API_KEY et MAIL_FROM', () => {
  expect(() => loadEnv({ ...valid, MAILER: 'resend', MAIL_FROM: 'a@b.fr' })).toThrow(/RESEND_API_KEY/);
  expect(() => loadEnv({ ...valid, MAILER: 'resend', RESEND_API_KEY: 'k' })).toThrow(/MAIL_FROM/);
  expect(loadEnv({ ...valid, MAILER: 'resend', RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.fr' }).MAILER).toBe('resend');
});

test.each([
  ['BETTER_AUTH_SECRET', 'de 31 caractères', { BETTER_AUTH_SECRET: 'x'.repeat(31) }],
  ['BETTER_AUTH_SECRET', 'absente', { BETTER_AUTH_SECRET: undefined }],
  ['DATABASE_URL', 'absente', { DATABASE_URL: undefined }],
  ['APP_URL', 'qui n\'est pas une URL', { APP_URL: 'pas une url' }],
  ['NODE_ENV', 'inconnu', { NODE_ENV: 'staging' }],
  ['PORT', 'qui n\'est pas un nombre', { PORT: 'abc' }],
  ['PORT', 'trop grand', { PORT: '70000' }],
  ['MAILER', 'inconnu', { MAILER: 'smtp' }],
  ['MAILER', 'inconnu (casse)', { MAILER: 'None' }],
  ['AUTH_RATE_LIMIT', 'inconnu', { AUTH_RATE_LIMIT: 'maybe' }],
  ['E2E', 'autre que 1', { E2E: 'true' }],
])('%s %s → erreur qui le nomme', (name, _case, patch) => {
  expect(() => loadEnv({ ...valid, ...patch })).toThrow(new RegExp(name));
});

test('toutes les erreurs sont signalées ensemble', () => {
  expect(() => loadEnv({})).toThrow(/APP_URL[^]*DATABASE_URL[^]*BETTER_AUTH_SECRET/);
});

// En développement, APP_URL est l'adresse du serveur Vite (apps/client/vite.config.ts) : c'est l'origine que voit le navigateur.
test('.env.example est une configuration valide', () => {
  const example = readFileSync(resolve(import.meta.dirname, '../../../.env.example'), 'utf8');
  const env = loadEnv(parseEnv(example));
  expect(env).toMatchObject({ NODE_ENV: 'development', PORT: 4000, DATABASE_URL: 'pglite://.data/dev', MAILER: 'memory', APP_URL: 'http://localhost:5173' });
});
