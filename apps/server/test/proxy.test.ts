import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { rateLimit } from '../src/db/schema';
import { createTestApp } from './helpers/test-app';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

// En production, le serveur est derrière le proxy de Railway, qui écrit l'adresse du client dans X-Real-IP (auth.ts). Ces tests
// jouent le proxy : la limitation des tentatives est la seule fonction qui dépende de cette adresse.
const CLIENT_A = '203.0.113.7';
const CLIENT_B = '203.0.113.8';

// Une tentative de connexion ratée (l'adresse n'a pas de compte : la limitation compte les tentatives, pas les comptes).
function attempt(t: TestApp, headers: Record<string, string>) {
  return request(t.app).post('/api/auth/sign-in/email').set(headers).send({ email: 'inconnu@x.fr', password: 'pas-le-bon-mot-de-passe' });
}

// Les seaux de la limitation, en base : « <adresse>|<route> ».
async function buckets(t: TestApp): Promise<string[]> {
  return (await t.db.select({ key: rateLimit.key }).from(rateLimit)).map((row) => row.key);
}

describe('derrière le proxy de Railway', () => {
  test('Express fait confiance à un seul saut de proxy', async () => {
    const { app } = await createTestApp();
    expect(app.get('trust proxy')).toBe(1);
  });

  test('la limitation des tentatives compte par X-Real-IP : chaque adresse a ses propres tentatives', async () => {
    const t = await createTestApp({ env: { AUTH_RATE_LIMIT: 'on' } });
    for (let n = 1; n <= 3; n++) expect((await attempt(t, { 'X-Real-IP': CLIENT_A })).status).toBe(401);
    expect((await attempt(t, { 'X-Real-IP': CLIENT_A })).status).toBe(429);   // la 4e du même client
    expect((await attempt(t, { 'X-Real-IP': CLIENT_B })).status).toBe(401);   // un autre client n'est pas touché

    expect((await buckets(t)).sort()).toEqual([`${CLIENT_A}|/sign-in/email`, `${CLIENT_B}|/sign-in/email`]);
  });

  test('changer X-Forwarded-For ou envoyer plusieurs adresses ne donne pas de nouvelles tentatives', async () => {
    const t = await createTestApp({ env: { AUTH_RATE_LIMIT: 'on' } });

    // Même X-Real-IP, X-Forwarded-For différent à chaque requête : c'est toujours le même client.
    const statuses: number[] = [];
    for (const spoofed of ['198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.4']) {
      statuses.push((await attempt(t, { 'X-Real-IP': CLIENT_A, 'X-Forwarded-For': spoofed })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);

    // Sans X-Real-IP, X-Forwarded-For seul ne désigne aucun seau : en test, la requête compte pour 127.0.0.1, et tous les
    // X-Forwarded-For possibles partagent ses tentatives (en production, ce serait le seau commun aux requêtes sans adresse).
    statuses.length = 0;
    for (const spoofed of ['198.51.100.5', '198.51.100.6', '198.51.100.7', '198.51.100.8']) {
      statuses.push((await attempt(t, { 'X-Forwarded-For': spoofed })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);

    // Un X-Real-IP à plusieurs valeurs (deux en-têtes envoyés, que Node réunit) ne désigne personne : l'appelant ne choisit
    // pas son seau, ni ne tombe dans celui d'une adresse qu'il aurait citée.
    expect((await attempt(t, { 'X-Real-IP': `${CLIENT_B}, 198.51.100.9` })).status).toBe(429);   // seau commun, déjà épuisé ci-dessus

    const keys = await buckets(t);
    expect(keys.sort()).toEqual(['127.0.0.1|/sign-in/email', `${CLIENT_A}|/sign-in/email`]);
  });
});
