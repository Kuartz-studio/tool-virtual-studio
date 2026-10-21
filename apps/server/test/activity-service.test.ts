import { ACTIVITY_MAX_PER_USER, type ActivityInput } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { createActivityService } from '../src/activity/activity-service';
import { activityState, user } from '../src/db/schema';
import { createTestDb } from './helpers/test-db';

const focus: ActivityInput = { label: 'En focus', color: '#6d28d9', allowEntry: false, hear: true, heard: false };

async function setup() {
  const db = await createTestDb();
  for (const id of ['ana', 'bob']) await db.insert(user).values({ id, name: id, email: `${id}@example.test` });
  return { db, service: createActivityService(db) };
}

describe('créer, lire', () => {
  test('un état : son identifiant (uuid), ses trois interrupteurs ; la liste les rend dans l\'ordre de création', async () => {
    const { service } = await setup();
    const first = await service.create('ana', focus);
    const second = await service.create('ana', { label: 'À table', color: '#f59e0b', allowEntry: true, hear: false, heard: false });
    expect(first).toMatchObject({ ok: true, state: { label: 'En focus', color: '#6d28d9', allowEntry: false, hear: true, heard: false } });
    if (!first.ok || !second.ok) throw new Error('création refusée');
    expect(first.state.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect((await service.list('ana')).map((s) => s.label)).toEqual(['En focus', 'À table']);
    expect(await service.get('ana', second.state.id)).toEqual(second.state);
  });

  test('chacun les siens : la liste, la lecture, la modification et la suppression d\'un état d\'un autre ne trouvent rien', async () => {
    const { service } = await setup();
    const created = await service.create('ana', focus);
    if (!created.ok) throw new Error('création refusée');
    expect(await service.list('bob')).toEqual([]);
    expect(await service.get('bob', created.state.id)).toBeUndefined();
    expect(await service.update('bob', created.state.id, { ...focus, label: 'Volé' })).toBeUndefined();
    expect(await service.remove('bob', created.state.id)).toBe(false);
    expect((await service.get('ana', created.state.id))?.label).toBe('En focus');
  });

  test('au plus ACTIVITY_MAX_PER_USER par personne : le suivant est refusé (limit), et ce plafond ne gêne pas les autres', async () => {
    const { service } = await setup();
    for (let i = 0; i < ACTIVITY_MAX_PER_USER; i++) expect(await service.create('ana', { ...focus, label: `État ${i}` })).toMatchObject({ ok: true });
    expect(await service.create('ana', focus)).toEqual({ ok: false, error: 'limit' });
    expect(await service.list('ana')).toHaveLength(ACTIVITY_MAX_PER_USER);
    expect(await service.create('bob', focus)).toMatchObject({ ok: true });
  });

  test('créations simultanées au plafond : jamais plus de ACTIVITY_MAX_PER_USER', async () => {
    const { service } = await setup();
    await Promise.all(Array.from({ length: ACTIVITY_MAX_PER_USER + 6 }, (_, i) => service.create('ana', { ...focus, label: `État ${i}` })));
    expect((await service.list('ana')).length).toBeLessThanOrEqual(ACTIVITY_MAX_PER_USER);
  });
});

describe('modifier, supprimer', () => {
  test('update remplace tout, et garde l\'identifiant', async () => {
    const { service } = await setup();
    const created = await service.create('ana', focus);
    if (!created.ok) throw new Error('création refusée');
    const changed = await service.update('ana', created.state.id, { label: 'Pause', color: '#22c55e', allowEntry: true, hear: true, heard: true });
    expect(changed).toEqual({ id: created.state.id, label: 'Pause', color: '#22c55e', allowEntry: true, hear: true, heard: true });
    expect(await service.list('ana')).toEqual([changed]);
  });

  test('remove supprime ; une seconde fois : faux', async () => {
    const { service } = await setup();
    const created = await service.create('ana', focus);
    if (!created.ok) throw new Error('création refusée');
    expect(await service.remove('ana', created.state.id)).toBe(true);
    expect(await service.remove('ana', created.state.id)).toBe(false);
    expect(await service.list('ana')).toEqual([]);
  });

  test('un identifiant qui n\'est pas un uuid : introuvable, sans erreur de la base', async () => {
    const { service } = await setup();
    expect(await service.get('ana', 'pas-un-uuid')).toBeUndefined();
    expect(await service.update('ana', 'pas-un-uuid', focus)).toBeUndefined();
    expect(await service.remove('ana', 'pas-un-uuid')).toBe(false);
  });

  test('les états partent avec le compte (suppression en cascade)', async () => {
    const { db, service } = await setup();
    await service.create('ana', focus);
    await db.delete(user).where(eq(user.id, 'ana'));
    expect(await db.select().from(activityState)).toEqual([]);
  });
});
