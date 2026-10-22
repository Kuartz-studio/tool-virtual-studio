import { eq, sql } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { roomMusic, user } from '../src/db/schema';
import { MusicService } from '../src/music/music-service';
import { createTestDb } from './helpers/test-db';

const ANA = { id: 'ana', name: 'Ana' };
const BOB = { id: 'bob', name: 'Bob' };

// Un service sur une base neuve, avec deux comptes et une horloge que le test fait avancer.
async function setup() {
  const db = await createTestDb();
  for (const who of [ANA, BOB]) await db.insert(user).values({ id: who.id, name: who.name, email: `${who.id}@example.test` });
  const clock = { t: 1_800_000_000_000 };
  const service = await MusicService.create(db, { clock: () => clock.t });
  return { db, clock, service };
}

describe('l\'état de la musique d\'une pièce', () => {
  test('une pièce que personne n\'a touchée : allumée, son ambiance par défaut ; rien n\'est enregistré', async () => {
    const { db, service } = await setup();
    expect(service.get('game')).toEqual({ on: true, scene: null, by: null, at: 0 });
    expect(service.all()).toEqual({});
    expect(await db.select().from(roomMusic)).toEqual([]);
  });

  test('éteindre : l\'état rendu dit qui, et quand ; seule cette pièce change, et la base le garde', async () => {
    const { db, clock, service } = await setup();
    const changed = await service.set('game', { on: false }, ANA);
    expect(changed).toEqual({ on: false, scene: null, by: ANA, at: clock.t });
    expect(service.get('game')).toEqual(changed);
    expect(service.get('gym')).toEqual({ on: true, scene: null, by: null, at: 0 });
    expect(service.all()).toEqual({ game: changed });
    const rows = await db.select().from(roomMusic);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ placeKey: 'game', on: false, scene: null, changedBy: 'ana' });
    expect(rows[0]!.changedAt.getTime()).toBe(clock.t);
  });

  test('choisir une ambiance : elle remplace celle par défaut, sans toucher à « allumée » ; null revient à celle par défaut', async () => {
    const { clock, service } = await setup();
    clock.t += 10;
    expect(await service.set('game', { scene: 'quest' }, ANA)).toEqual({ on: true, scene: 'quest', by: ANA, at: clock.t });
    clock.t += 10;
    expect(await service.set('game', { on: false }, BOB)).toEqual({ on: false, scene: 'quest', by: BOB, at: clock.t });
    clock.t += 10;
    expect(await service.set('game', { scene: null }, ANA)).toEqual({ on: false, scene: null, by: ANA, at: clock.t });
  });

  test('les deux d\'un coup : allumée avec une ambiance', async () => {
    const { service } = await setup();
    await service.set('game', { on: false }, ANA);
    expect(await service.set('game', { on: true, scene: 'dusk' }, BOB)).toMatchObject({ on: true, scene: 'dusk', by: BOB });
  });

  test('une demande qui ne change rien (déjà éteinte, même ambiance, allumée sans y avoir touché) est ignorée : rien ne change, ni son auteur ni sa date', async () => {
    const { db, clock, service } = await setup();
    expect(await service.set('game', { on: true }, ANA)).toBeNull();
    expect(await service.set('game', { scene: null }, ANA)).toBeNull();
    expect(await db.select().from(roomMusic)).toEqual([]);

    const off = await service.set('game', { on: false, scene: 'drift' }, ANA);
    clock.t += 1000;
    expect(await service.set('game', { on: false }, BOB)).toBeNull();
    expect(await service.set('game', { scene: 'drift' }, BOB)).toBeNull();
    expect(await service.set('game', { on: false, scene: 'drift' }, BOB)).toBeNull();
    expect(service.get('game')).toEqual(off);
  });

  test('wouldChange : dit d\'avance si une demande changerait quelque chose', async () => {
    const { service } = await setup();
    expect(service.wouldChange('game', { on: true })).toBe(false);
    expect(service.wouldChange('game', { on: false })).toBe(true);
    expect(service.wouldChange('game', { scene: 'quest' })).toBe(true);
    await service.set('game', { on: false, scene: 'quest' }, ANA);
    expect(service.wouldChange('game', { on: false })).toBe(false);
    expect(service.wouldChange('game', { scene: 'quest' })).toBe(false);
    expect(service.wouldChange('game', { scene: null })).toBe(true);
    expect(service.wouldChange('game', { on: true })).toBe(true);
  });

  test('deux demandes en même temps pour la même pièce : un seul changement, l\'autre ne trouve plus rien à changer', async () => {
    const { service } = await setup();
    const results = await Promise.all([service.set('game', { on: false }, ANA), service.set('game', { on: false }, BOB)]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(service.get('game').on).toBe(false);
  });

  test('deux pièces différentes en même temps : les deux changent', async () => {
    const { service } = await setup();
    const results = await Promise.all([service.set('game', { on: false }, ANA), service.set('gym', { scene: 'sunny' }, BOB)]);
    expect(results.every((result) => result !== null)).toBe(true);
    expect(Object.keys(service.all()).sort()).toEqual(['game', 'gym']);
  });

  test('une écriture qui échoue laisse l\'état comme il était, et la promesse est rejetée', async () => {
    const { db, service } = await setup();
    await db.execute(sql`drop table "room_music"`);
    await expect(service.set('game', { on: false }, ANA)).rejects.toThrow();
    expect(service.get('game')).toEqual({ on: true, scene: null, by: null, at: 0 });
    expect(service.all()).toEqual({});
  });

  test('l\'état revient après un redémarrage : un nouveau service sur la même base relit tout, avec le nom actuel de l\'auteur', async () => {
    const { db, clock, service } = await setup();
    await service.set('game', { on: false }, ANA);
    clock.t += 5;
    await service.set('desk:A1', { scene: 'dusk' }, BOB);
    await db.update(user).set({ name: 'Ana Dupont' }).where(eq(user.id, 'ana'));

    const restarted = await MusicService.create(db, { clock: () => clock.t });
    expect(restarted.get('game')).toEqual({ on: false, scene: null, by: { id: 'ana', name: 'Ana Dupont' }, at: 1_800_000_000_000 });
    expect(restarted.get('desk:A1')).toEqual({ on: true, scene: 'dusk', by: BOB, at: clock.t });
    expect(Object.keys(restarted.all()).sort()).toEqual(['desk:A1', 'game']);
  });

  test('l\'auteur n\'a plus de compte : la pièce reste comme il l\'a laissée, sans nom', async () => {
    const { db, clock, service } = await setup();
    await service.set('game', { on: false }, ANA);
    await db.delete(user).where(eq(user.id, 'ana'));
    const restarted = await MusicService.create(db, { clock: () => clock.t });
    expect(restarted.get('game')).toEqual({ on: false, scene: null, by: null, at: 1_800_000_000_000 });
  });

  test('all() rend des copies : on ne change pas le service de l\'extérieur', async () => {
    const { service } = await setup();
    await service.set('game', { on: false }, ANA);
    const copy = service.all();
    copy.game!.on = true;
    copy.game!.by!.name = 'Autre';
    expect(service.get('game')).toMatchObject({ on: false, by: ANA });
    service.get('game').by!.name = 'Autre';
    expect(service.get('game').by).toEqual(ANA);
  });

  test('une ambiance que la base ne connaît plus (retirée d\'une version à l\'autre) revient à celle par défaut', async () => {
    const { db, service } = await setup();
    await service.set('game', { scene: 'quest' }, ANA);
    await db.update(roomMusic).set({ scene: 'disco' }).where(eq(roomMusic.placeKey, 'game'));
    const restarted = await MusicService.create(db);
    expect(restarted.get('game')).toMatchObject({ on: true, scene: null });
  });
});
