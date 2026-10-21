import { OFFICE, buildTiledMap, parseOfficeMap } from '@bureau/shared';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { desk, user } from '../src/db/schema';
import { DeskService, deskSlots, type DeskServiceOptions } from '../src/desks/desk-service';
import { createTestDb } from './helpers/test-db';

// La grande carte (20 places A1…C4) et un compte par prénom, créés dans la base.
const map = parseOfficeMap(buildTiledMap({ ...OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));

async function setup(options: DeskServiceOptions = {}) {
  const db = await createTestDb();
  const people = ['ana', 'bob', 'cleo'];
  for (const id of people) await db.insert(user).values({ id, name: id.toUpperCase(), email: `${id}@example.test` });
  const service = await DeskService.create(db, map, options);
  return { db, service, people };
}

const owner = (service: DeskService, key: string) => service.get(key)?.ownerId;

describe('les places de la carte', () => {
  test('20 places dans l\'ordre de la carte, chacune avec sa porte et un point de sortie hors de la pièce, devant la porte', () => {
    const slots = deskSlots(map);
    expect(slots).toHaveLength(20);
    expect(slots[0]!.key).toBe('A1');
    for (const slot of slots) {
      expect(slot.door, slot.key).not.toBeNull();
      const { x, y, width, height } = slot.zone;
      const inside = slot.exit.x >= x && slot.exit.x < x + width && slot.exit.y >= y && slot.exit.y < y + height;
      expect(inside, `sortie de ${slot.key}`).toBe(false);
    }
    // Rangée A (porte au sud) : on sort vers le bas ; rangée B (porte au nord) : vers le haut.
    const a1 = slots.find((slot) => slot.key === 'A1')!;
    const b1 = slots.find((slot) => slot.key === 'B1')!;
    expect(a1.exit.y).toBeGreaterThan(a1.door!.y);
    expect(b1.exit.y).toBeLessThan(b1.door!.y);
  });
});

describe('prendre et rendre une place', () => {
  test('claim : la place est à la personne (en mémoire et en base), libre pour les autres tant qu\'elle l\'est', async () => {
    const { db, service } = await setup();
    expect(service.get('A1')).toMatchObject({ ownerId: null, ownerName: null, name: null, locked: false });
    const result = await service.claim('ana', 'Ana', 'A1');
    expect(result).toMatchObject({ ok: true, access: true });
    expect(service.get('A1')).toMatchObject({ ownerId: 'ana', ownerName: 'Ana' });
    expect(service.deskOf('ana')?.key).toBe('A1');
    expect(await db.select().from(desk)).toMatchObject([{ key: 'A1', ownerId: 'ana', name: null, locked: false }]);
  });

  test('une place prise ne se prend pas : taken, et rien ne change', async () => {
    const { service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    expect(await service.claim('bob', 'Bob', 'A1')).toEqual({ ok: false, error: 'taken' });
    expect(owner(service, 'A1')).toBe('ana');
    expect(service.deskOf('bob')).toBeUndefined();
  });

  test('une place qui n\'existe pas : unknown_desk', async () => {
    const { service } = await setup();
    expect(await service.claim('ana', 'Ana', 'Z9')).toEqual({ ok: false, error: 'unknown_desk' });
  });

  test('deux demandes en même temps pour la même place : une seule l\'obtient', async () => {
    const { db, service } = await setup();
    const [first, second] = await Promise.all([service.claim('ana', 'Ana', 'B2'), service.claim('bob', 'Bob', 'B2')]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect(await db.select().from(desk)).toHaveLength(1);
  });

  test('déménager : l\'ancienne place est libérée, le nom et le verrou suivent, les exclus restent dans l\'ancienne pièce', async () => {
    const { db, service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    await service.rename('ana', 'Atelier');
    await service.setLocked('ana', true);
    service.kick('ana', 'bob', 'Bob');
    const moved = await service.claim('ana', 'Ana', 'C3');
    expect(moved).toMatchObject({ ok: true });
    if (moved.ok) expect(moved.changed.map((d) => d.key)).toEqual(['A1', 'C3']);
    expect(service.get('A1')).toMatchObject({ ownerId: null, name: null, locked: false });
    expect(service.get('C3')).toMatchObject({ ownerId: 'ana', name: 'Atelier', locked: true });
    expect(service.bansOf('ana')).toEqual([]);
    expect(await db.select().from(desk)).toMatchObject([{ key: 'C3', ownerId: 'ana', name: 'Atelier', locked: true }]);
  });

  test('prendre sa propre place : rien ne change', async () => {
    const { service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    expect(await service.claim('ana', 'Ana', 'A1')).toEqual({ ok: true, changed: [], access: false });
  });

  test('release : la place est libre, le bureau n\'existe plus (en base non plus) ; sans bureau, no_desk', async () => {
    const { db, service } = await setup();
    expect(await service.release('ana')).toEqual({ ok: false, error: 'no_desk' });
    await service.claim('ana', 'Ana', 'A1');
    await service.setLocked('ana', true);
    expect(await service.release('ana')).toMatchObject({ ok: true, changed: [{ key: 'A1', ownerId: null, locked: false }] });
    expect(service.deskOf('ana')).toBeUndefined();
    expect(await db.select().from(desk)).toEqual([]);
    expect(await service.claim('bob', 'Bob', 'A1')).toMatchObject({ ok: true });
  });

  test('autoAssign : la première place libre, une seule par personne', async () => {
    const { service } = await setup();
    await service.autoAssign('ana', 'Ana');
    await service.autoAssign('bob', 'Bob');
    await service.autoAssign('ana', 'Ana');
    expect(service.deskOf('ana')?.key).toBe('A1');
    expect(service.deskOf('bob')?.key).toBe('A2');
    expect(service.list().filter((d) => d.ownerId === 'ana')).toHaveLength(1);
  });

  test('autoAssign avec toutes les places prises : personne n\'est servi, sans erreur', async () => {
    const { db, service } = await setup();
    for (const slot of service.slots) {
      await db.insert(user).values({ id: `u-${slot.key}`, name: slot.key, email: `${slot.key}@example.test` });
      await service.claim(`u-${slot.key}`, slot.key, slot.key);
    }
    expect(await service.autoAssign('ana', 'Ana')).toMatchObject({ ok: true, changed: [] });
    expect(service.deskOf('ana')).toBeUndefined();
  });

  test('une base qui refuse l\'écriture : unavailable, et la mémoire n\'a pas changé', async () => {
    const { db, service } = await setup();
    await db.execute(sql`drop table "desk"`);
    expect(await service.claim('ana', 'Ana', 'A1')).toEqual({ ok: false, error: 'unavailable' });
    expect(service.get('A1')?.ownerId).toBeNull();
  });
});

describe('au redémarrage', () => {
  test('les bureaux occupés reviennent de la base, avec leur nom, leur verrou et le nom de leur propriétaire', async () => {
    const { db, service } = await setup();
    await service.claim('ana', 'Ana', 'A3');
    await service.rename('ana', 'Chez Ana');
    await service.setLocked('ana', true);
    service.kick('ana', 'bob', 'Bob');
    const reloaded = await DeskService.create(db, map);
    expect(reloaded.get('A3')).toEqual({ key: 'A3', ownerId: 'ana', ownerName: 'ANA', name: 'Chez Ana', locked: true, closedByState: false });
    expect(reloaded.deskOf('ana')?.key).toBe('A3');
    // Les exclus et les admis ne sont pas gardés.
    expect(reloaded.bansOf('ana')).toEqual([]);
  });

  test('un compte désactivé, ou une place qui n\'est plus sur la carte : ignoré', async () => {
    const { db, service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    await service.claim('bob', 'Bob', 'A2');
    await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, 'bob'));
    await db.update(desk).set({ key: 'Z9' }).where(eq(desk.ownerId, 'ana'));
    const reloaded = await DeskService.create(db, map);
    expect(reloaded.list().every((d) => d.ownerId === null)).toBe(true);
  });
});

describe('nommer, fermer', () => {
  test('rename : rogné, borné à 40 caractères, vide = nom par défaut ; sans bureau, no_desk', async () => {
    const { db, service } = await setup();
    expect(await service.rename('ana', 'x')).toEqual({ ok: false, error: 'no_desk' });
    await service.claim('ana', 'Ana', 'A1');
    await service.rename('ana', '  Le labo  ');
    expect(service.get('A1')?.name).toBe('Le labo');
    await service.rename('ana', 'x'.repeat(100));
    expect(service.get('A1')?.name).toHaveLength(40);
    await service.rename('ana', '   ');
    expect(service.get('A1')?.name).toBeNull();
    expect((await db.select().from(desk))[0]!.name).toBeNull();
  });

  test('le nom affiché du propriétaire suit son profil', async () => {
    const { service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    expect(service.renameOwner('ana', 'Anaïs')).toMatchObject({ ok: true, changed: [{ key: 'A1', ownerName: 'Anaïs' }] });
    expect(service.renameOwner('bob', 'Bob')).toEqual({ ok: true, changed: [], access: false });
  });
});

describe('qui peut entrer', () => {
  test('une place libre, ou ouverte : tout le monde ; la sienne : toujours', async () => {
    const { service } = await setup();
    expect(service.canEnter('bob', 'A1')).toBe(true);
    await service.claim('ana', 'Ana', 'A1');
    expect(service.canEnter('bob', 'A1')).toBe(true);
    await service.setLocked('ana', true);
    expect(service.canEnter('ana', 'A1')).toBe(true);
    expect(service.canEnter('bob', 'A1')).toBe(false);
    expect(service.canEnter('bob', 'inconnue')).toBe(true);
  });

  test('porte fermée : seuls les admis entrent ; la refermer efface les admis ; la rouvrir laisse entrer tout le monde', async () => {
    const { service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    await service.setLocked('ana', true);
    expect(service.admit('ana', 'bob')).toMatchObject({ ok: true });
    expect(service.canEnter('bob', 'A1')).toBe(true);
    expect(service.canEnter('cleo', 'A1')).toBe(false);
    await service.setLocked('ana', true);
    expect(service.canEnter('bob', 'A1')).toBe(false);
    await service.setLocked('ana', false);
    expect(service.canEnter('cleo', 'A1')).toBe(true);
  });

  test('exclu : n\'entre plus, même porte ouverte ; réadmis (unban ou admit), il entre de nouveau', async () => {
    const { service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    expect(service.kick('ana', 'bob', 'Bob')).toMatchObject({ ok: true, access: true });
    expect(service.canEnter('bob', 'A1')).toBe(false);
    expect(service.canEnter('cleo', 'A1')).toBe(true);
    expect(service.bansOf('ana')).toEqual([{ id: 'bob', name: 'Bob' }]);
    service.unban('ana', 'bob');
    expect(service.canEnter('bob', 'A1')).toBe(true);
    service.kick('ana', 'cleo', 'Cléo');
    service.admit('ana', 'cleo');
    expect(service.canEnter('cleo', 'A1')).toBe(true);
    expect(service.bansOf('ana')).toEqual([]);
  });

  test('on ne s\'exclut ni ne s\'admet soi-même ; sans bureau, no_desk', async () => {
    const { service } = await setup();
    expect(service.kick('ana', 'bob', 'Bob')).toEqual({ ok: false, error: 'no_desk' });
    expect(service.admit('ana', 'bob')).toEqual({ ok: false, error: 'no_desk' });
    await service.claim('ana', 'Ana', 'A1');
    expect(service.kick('ana', 'ana', 'Ana')).toEqual({ ok: false, error: 'self' });
    expect(service.admit('ana', 'ana')).toEqual({ ok: false, error: 'self' });
  });

  test('closedFor : les places fermées pour cette personne, les siennes jamais', async () => {
    const { service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    await service.claim('bob', 'Bob', 'A2');
    await service.setLocked('ana', true);
    service.kick('bob', 'ana', 'Ana');
    expect(service.closedFor('ana')).toEqual(['A2']);
    expect(service.closedFor('bob')).toEqual(['A1']);
    expect(service.closedFor('cleo')).toEqual(['A1']);
  });

  test('un état d\'activité qui ne laisse entrer personne ferme la porte comme un verrou, sans toucher au verrou', async () => {
    let open = true;
    const { service } = await setup({ ownerAllowsEntry: () => open });
    await service.claim('ana', 'Ana', 'A1');
    expect(service.canEnter('bob', 'A1')).toBe(true);
    open = false;
    expect(service.refreshOwner('ana')).toMatchObject({ ok: true, access: true, changed: [{ key: 'A1', locked: false, closedByState: true }] });
    expect(service.canEnter('bob', 'A1')).toBe(false);
    expect(service.canEnter('ana', 'A1')).toBe(true);
    open = true;
    expect(service.canEnter('bob', 'A1')).toBe(true);
  });
});
