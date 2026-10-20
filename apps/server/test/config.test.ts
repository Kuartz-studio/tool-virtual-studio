import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { createNoneTestApp, createTestApp } from './helpers/test-app';

// GET /api/config : ce que la page doit savoir avant toute session.
describe('GET /api/config', () => {
  test.each(['resend', 'none', 'memory'] as const)('MAILER=%s → { mail } et rien d\'autre, sans authentification', async (mail) => {
    const t = mail === 'none' ? await createNoneTestApp() : await createTestApp({ env: { MAILER: mail } });
    const res = await request(t.app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mail });
    expect(res.get('Content-Type')).toMatch(/json/);
    expect(res.get('Cache-Control')).toBe('no-store');
    expect(res.get('Set-Cookie')).toBeUndefined();
  });

  test('aucune session n\'est lue : un cookie périmé ou inventé ne change pas la réponse', async () => {
    const t = await createNoneTestApp();
    const res = await request(t.app).get('/api/config').set('Cookie', 'better-auth.session_token=inventé.signature; autre=1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mail: 'none' });
    expect(res.get('Set-Cookie')).toBeUndefined();
  });

  test('connecté ou non, la réponse est la même, et aucune route voisine n\'existe', async () => {
    const t = await createNoneTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr');
    const signedIn = await request(t.app).get('/api/config').set('Cookie', lea.cookie);
    expect(signedIn.body).toEqual((await request(t.app).get('/api/config')).body);
    expect((await request(t.app).post('/api/config').send({ mail: 'resend' })).status).toBe(404);
    expect((await request(t.app).get('/api/config/autre')).status).toBe(404);
  });
});
