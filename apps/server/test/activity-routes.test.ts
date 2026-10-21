import { ACTIVITY_MAX_PER_USER, type ActivityState } from '@bureau/shared';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { createTestApp } from './helpers/test-app';

const body = { label: 'En focus', color: '#6D28D9', allowEntry: false, hear: true, heard: false };

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const post = (t: TestApp, cookie: string, payload: unknown) => request(t.app).post('/api/me/states').set('Cookie', cookie).send(payload as object);

describe('/api/me/states', () => {
  test('sans session : 401, partout', async () => {
    const t = await createTestApp();
    expect((await request(t.app).get('/api/me/states')).status).toBe(401);
    expect((await request(t.app).post('/api/me/states').send(body)).status).toBe(401);
    expect((await request(t.app).put('/api/me/states/x').send(body)).status).toBe(401);
    expect((await request(t.app).delete('/api/me/states/x')).status).toBe(401);
  });

  test('créer : 201, l\'état avec son identifiant, la couleur en minuscules ; la liste le rend', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr');
    const created = await post(t, lea.cookie, body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ label: 'En focus', color: '#6d28d9', allowEntry: false, hear: true, heard: false });
    const list = await request(t.app).get('/api/me/states').set('Cookie', lea.cookie);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([created.body]);
  });

  test.each([
    ['un nom vide', { ...body, label: '   ' }],
    ['un nom trop long', { ...body, label: 'x'.repeat(25) }],
    ['une couleur qui n\'est pas #rrggbb', { ...body, color: 'rouge' }],
    ['une couleur courte', { ...body, color: '#fff' }],
    ['un interrupteur qui manque', { label: 'x', color: '#000000', allowEntry: true, hear: true }],
    ['un interrupteur qui n\'est pas un booléen', { ...body, hear: 'oui' }],
    ['rien du tout', undefined],
  ])('créer avec %s : 400', async (_name, payload) => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr');
    const res = await post(t, lea.cookie, payload);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid' });
  });

  test('au plus ACTIVITY_MAX_PER_USER : le suivant répond 409 limit', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr');
    for (let i = 0; i < ACTIVITY_MAX_PER_USER; i++) expect((await post(t, lea.cookie, { ...body, label: `État ${i}` })).status).toBe(201);
    const res = await post(t, lea.cookie, body);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'limit' });
  });

  test('chacun les siens : un autre compte ne voit, ne change ni ne supprime l\'état de Léa (404)', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr');
    const tom = await t.inviteAndAccept('tom@x.fr');
    const created = (await post(t, lea.cookie, body)).body as ActivityState;
    expect((await request(t.app).get('/api/me/states').set('Cookie', tom.cookie)).body).toEqual([]);
    expect((await request(t.app).put(`/api/me/states/${created.id}`).set('Cookie', tom.cookie).send(body)).status).toBe(404);
    expect((await request(t.app).delete(`/api/me/states/${created.id}`).set('Cookie', tom.cookie)).status).toBe(404);
    expect((await request(t.app).get('/api/me/states').set('Cookie', lea.cookie)).body).toEqual([created]);
  });

  test('modifier : l\'état remplacé, et le temps réel est prévenu (activity:edited) ; invalide : 400, inconnu : 404', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr');
    const created = (await post(t, lea.cookie, body)).body as ActivityState;
    const edited: unknown[] = [];
    t.events.on('activity:edited', (change) => edited.push(change));

    const res = await request(t.app).put(`/api/me/states/${created.id}`).set('Cookie', lea.cookie).send({ ...body, label: 'Pause', allowEntry: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.id, label: 'Pause', allowEntry: true });
    expect(edited).toEqual([{ userId: lea.userId, id: created.id, state: res.body }]);

    expect((await request(t.app).put(`/api/me/states/${created.id}`).set('Cookie', lea.cookie).send({ label: '' })).status).toBe(400);
    expect((await request(t.app).put('/api/me/states/00000000-0000-4000-8000-000000000000').set('Cookie', lea.cookie).send(body)).status).toBe(404);
    expect((await request(t.app).put('/api/me/states/pas-un-uuid').set('Cookie', lea.cookie).send(body)).status).toBe(404);
    expect(edited).toHaveLength(1);
  });

  test('supprimer : 204, et le temps réel est prévenu avec un état null ; une seconde fois : 404', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr');
    const created = (await post(t, lea.cookie, body)).body as ActivityState;
    const edited: unknown[] = [];
    t.events.on('activity:edited', (change) => edited.push(change));

    expect((await request(t.app).delete(`/api/me/states/${created.id}`).set('Cookie', lea.cookie)).status).toBe(204);
    expect(edited).toEqual([{ userId: lea.userId, id: created.id, state: null }]);
    expect((await request(t.app).delete(`/api/me/states/${created.id}`).set('Cookie', lea.cookie)).status).toBe(404);
    expect((await request(t.app).get('/api/me/states').set('Cookie', lea.cookie)).body).toEqual([]);
  });
});
