import { DESK_ROOMS, OFFICE, buildTiledMap, defaultDeskDecor, isWalkablePoint, parseOfficeMap, type DeskDecor, type OfficeMap, type Zone } from '@bureau/shared';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { desk, deskSetup, user } from '../src/db/schema';
import { DeskService, deskSlots, exitPoint, type DeskServiceOptions } from '../src/desks/desk-service';
import { CUSTOM_DECOR, DEFAULT_SETUP, OTHER_DECOR, REFUSED_DECORS, defaultSetupOf } from './helpers/decor';
import { createTestDb } from './helpers/test-db';

// La grande carte (6 places A1…A6) et un compte par prénom, créés dans la base.
const map = parseOfficeMap(buildTiledMap({ ...OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));

async function setup(options: DeskServiceOptions = {}, onMap: OfficeMap = map) {
  const db = await createTestDb();
  const people = ['ana', 'bob', 'cleo'];
  for (const id of people) await db.insert(user).values({ id, name: id.toUpperCase(), email: `${id}@example.test` });
  const service = await DeskService.create(db, onMap, options);
  return { db, service, people };
}

const owner = (service: DeskService, key: string) => service.get(key)?.ownerId;

describe('les places de la carte', () => {
  test('6 places dans l\'ordre de la carte, chacune avec sa porte et un point de sortie hors de la pièce, devant la porte', () => {
    const slots = deskSlots(map);
    expect(slots.map((slot) => slot.key)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
    for (const slot of slots) {
      expect(slot.door, slot.key).not.toBeNull();
      const { x, y, width, height } = slot.zone;
      const inside = slot.exit.x >= x && slot.exit.x < x + width && slot.exit.y >= y && slot.exit.y < y + height;
      expect(inside, `sortie de ${slot.key}`).toBe(false);
      // La porte perce une bande de mur de 2 cases : la sortie est au-delà de son bord extérieur (dans la rue : en dessous d'une porte au sud, au-dessus d'une
      // porte au nord), sur une case où l'on marche.
      const south = slot.door!.y >= y;
      if (south) expect(slot.exit.y, `sortie de ${slot.key}`).toBeGreaterThanOrEqual(slot.door!.y + slot.door!.height);
      else expect(slot.exit.y, `sortie de ${slot.key}`).toBeLessThan(slot.door!.y);
      expect(isWalkablePoint(map, slot.exit.x, slot.exit.y), `sortie de ${slot.key}`).toBe(true);
    }
    // Les portes de A5, A1 et A2 sont au sud (cases 3-4, 12-13 et 23-24, au centre de la porte) : on sort vers le bas, dans la rue nord. Celles de A6, A3 et A4
    // sont au nord de leur pièce : on sort vers le haut, dans la même rue. Les petits bureaux (A5, A6) sont tout à l'ouest de leur rangée.
    const exit = (key: string) => slots.find((slot) => slot.key === key)!.exit;
    expect(exit('A5')).toEqual({ x: 4 * 32, y: 368 });
    expect(exit('A1')).toEqual({ x: 13 * 32, y: 368 });
    expect(exit('A2')).toEqual({ x: 24 * 32, y: 368 });
    expect(exit('A6')).toEqual({ x: 4 * 32, y: 15 * 32 - 16 });
    expect(exit('A3')).toEqual({ x: 13 * 32, y: 15 * 32 - 16 });
    expect(exit('A4')).toEqual({ x: 24 * 32, y: 15 * 32 - 16 });
  });
});

// Une zone pour ces tests, en pixels (cases de 32 px).
const area = (x: number, y: number, width: number, height: number, type: Zone['type'] = 'desk'): Zone => ({ id: 'z', type, name: null, text: null, x, y, width, height });

describe('le point de sortie devant une porte', () => {
  const tile = 32;
  const room = area(32, 352, 288, 224);   // 9 × 7 cases, dont le coin haut-gauche est la case (1, 11)

  test('une porte de 2 cases de haut en dessous de la pièce : une demi-case au-delà de son bord extérieur, hors de la bande de mur', () => {
    const door = area(128, 576, 64, 64, 'door');   // les cases (4..5, 18..19), juste sous la pièce
    expect(exitPoint(room, door, tile)).toEqual({ x: 160, y: 656 });   // le milieu de la case (5, 20) : la bande finit à y 640
  });

  test('une porte de 2 cases de haut au-dessus de la pièce : une demi-case au-delà de son bord supérieur', () => {
    const door = area(128, 288, 64, 64, 'door');   // les cases (4..5, 9..10), juste au-dessus
    expect(exitPoint(room, door, tile)).toEqual({ x: 160, y: 272 });
  });

  test('une porte d\'une case de haut : le point d\'avant les portes de 2 cases, une case au-delà de son centre', () => {
    expect(exitPoint(room, area(128, 576, 64, 32, 'door'), tile)).toEqual({ x: 160, y: 576 + 16 + tile });
    expect(exitPoint(room, area(128, 320, 64, 32, 'door'), tile)).toEqual({ x: 160, y: 320 + 16 - tile });
  });

  test('une porte sur le côté : au-delà de son bord extérieur, à la hauteur de son centre ; sans porte, sous la pièce', () => {
    const beside = area(128, 352, 288, 224);   // la pièce de la case (4, 11) à la case (12, 17)
    expect(exitPoint(beside, area(96, 416, 32, 64, 'door'), tile)).toEqual({ x: 80, y: 448 });   // à gauche : x 96 à 128
    expect(exitPoint(beside, area(416, 416, 32, 64, 'door'), tile)).toEqual({ x: 464, y: 448 });   // à droite : x 416 à 448
    expect(exitPoint(room, null, tile)).toEqual({ x: 176, y: 576 + 16 });
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
    const [first, second] = await Promise.all([service.claim('ana', 'Ana', 'A3'), service.claim('bob', 'Bob', 'A3')]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect(await db.select().from(desk)).toHaveLength(1);
  });

  test('déménager : l\'ancienne place est libérée, le nom et le verrou suivent, les exclus restent dans l\'ancienne pièce', async () => {
    const { db, service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    await service.rename('ana', 'Atelier');
    await service.setLocked('ana', true);
    service.kick('ana', 'bob', 'Bob');
    const moved = await service.claim('ana', 'Ana', 'A6');
    expect(moved).toMatchObject({ ok: true });
    if (moved.ok) expect(moved.changed.map((d) => d.key)).toEqual(['A1', 'A6']);
    expect(service.get('A1')).toMatchObject({ ownerId: null, name: null, locked: false });
    expect(service.get('A6')).toMatchObject({ ownerId: 'ana', name: 'Atelier', locked: true });
    expect(service.bansOf('ana')).toEqual([]);
    expect(await db.select().from(desk)).toMatchObject([{ key: 'A6', ownerId: 'ana', name: 'Atelier', locked: true }]);
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
    expect(reloaded.get('A3')).toEqual({ key: 'A3', ownerId: 'ana', ownerName: 'ANA', name: 'Chez Ana', locked: true, closedByState: false, ...defaultSetupOf('A3') });
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

describe('le décor de la pièce', () => {
  test('sans réglage : le poste par défaut, pour une place prise comme pour une place libre', async () => {
    const { service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    expect(service.get('A1')).toMatchObject(DEFAULT_SETUP);
    expect(service.get('A2')).toMatchObject(DEFAULT_SETUP);
    // Chaque pièce a le poste de sa taille et du côté de sa porte.
    expect(service.get('A3')).toMatchObject(defaultSetupOf('A3'));
    expect(service.get('A6')).toMatchObject(defaultSetupOf('A6'));
    expect(service.list().every((info) => info.floor === DEFAULT_SETUP.floor && info.items.length === defaultSetupOf(info.key).items.length)).toBe(true);
  });

  test('setDecor : enregistré en base au nom de la personne, gardé en mémoire, rediffusé pour sa seule place', async () => {
    const { db, service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    await service.claim('bob', 'Bob', 'A2');
    const result = await service.setDecor('ana', CUSTOM_DECOR);
    expect(result).toEqual({ ok: true, access: false, changed: [expect.objectContaining({ key: 'A1', ownerId: 'ana', ...CUSTOM_DECOR })] });
    expect(service.get('A1')).toMatchObject(CUSTOM_DECOR);
    expect(service.deskOf('ana')).toMatchObject(CUSTOM_DECOR);
    expect(service.get('A2')).toMatchObject(DEFAULT_SETUP);   // celle de bob n'a pas bougé
    expect(await db.select().from(deskSetup)).toMatchObject([{ ownerId: 'ana', ...CUSTOM_DECOR }]);
  });

  test('un nouveau réglage remplace le précédent, d\'un bloc : une seule ligne en base', async () => {
    const { db, service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    await service.setDecor('ana', CUSTOM_DECOR);
    await service.setDecor('ana', OTHER_DECOR);
    expect(service.get('A1')).toMatchObject(OTHER_DECOR);
    expect(await db.select().from(deskSetup)).toMatchObject([{ ownerId: 'ana', ...OTHER_DECOR }]);
    await service.setDecor('ana', { ...OTHER_DECOR, items: [] });   // tout enlever est permis
    expect(service.get('A1')?.items).toEqual([]);
  });

  test('sans bureau : no_desk, et rien n\'est écrit', async () => {
    const { db, service } = await setup();
    expect(await service.setDecor('ana', CUSTOM_DECOR)).toEqual({ ok: false, error: 'no_desk' });
    expect(await db.select().from(deskSetup)).toEqual([]);
  });

  test.each(REFUSED_DECORS)('une déco que checkDecor refuse ($reason) : bad_decor avec la raison, et rien ne change', async ({ decor, reason }) => {
    const { db, service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    await service.setDecor('ana', CUSTOM_DECOR);
    expect(await service.setDecor('ana', decor)).toEqual({ ok: false, error: 'bad_decor', reason });
    expect(service.get('A1')).toMatchObject(CUSTOM_DECOR);
    expect(await db.select().from(deskSetup)).toMatchObject([{ ownerId: 'ana', ...CUSTOM_DECOR }]);
  });

  test('le serveur ne retient que { id, x, y } et ne garde pas la liste de l\'appelant ; une DeskInfo ne laisse pas changer le décor', async () => {
    const { db, service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    const items = CUSTOM_DECOR.items.map((item) => ({ ...item, extra: 'en trop' }));
    await service.setDecor('ana', { ...CUSTOM_DECOR, items });
    items[0]!.x = 5;   // l'appelant change sa liste après coup
    expect(service.get('A1')?.items).toEqual(CUSTOM_DECOR.items);
    expect((await db.select().from(deskSetup))[0]!.items).toEqual(CUSTOM_DECOR.items);
    service.get('A1')!.items.length = 0;   // et une DeskInfo n'est qu'une copie
    service.get('A2')!.items.length = 0;   // y compris celle du poste par défaut
    expect(service.get('A1')?.items).toEqual(CUSTOM_DECOR.items);
    expect(service.get('A2')?.items).toEqual(DEFAULT_SETUP.items);
  });

  test('une base qui refuse l\'écriture : unavailable, et la mémoire n\'a pas changé', async () => {
    const { db, service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    await db.execute(sql`drop table "desk_setup"`);
    expect(await service.setDecor('ana', CUSTOM_DECOR)).toEqual({ ok: false, error: 'unavailable' });
    expect(service.get('A1')).toMatchObject(DEFAULT_SETUP);
  });

  test('deux réglages en même temps passent l\'un après l\'autre : le dernier l\'emporte, en mémoire comme en base', async () => {
    const { db, service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    await Promise.all([service.setDecor('ana', CUSTOM_DECOR), service.setDecor('ana', OTHER_DECOR)]);
    expect(service.get('A1')).toMatchObject(OTHER_DECOR);
    expect(await db.select().from(deskSetup)).toMatchObject([{ ownerId: 'ana', ...OTHER_DECOR }]);
  });

  test('après un redémarrage (une nouvelle instance sur la même base) : le décor est revenu', async () => {
    const { db, service } = await setup();
    await service.claim('ana', 'Ana', 'A4');
    await service.setDecor('ana', CUSTOM_DECOR);
    const reloaded = await DeskService.create(db, map);
    expect(reloaded.get('A4')).toEqual({ key: 'A4', ownerId: 'ana', ownerName: 'ANA', name: null, locked: false, closedByState: false, ...CUSTOM_DECOR });
    expect(reloaded.get('A1')).toMatchObject(DEFAULT_SETUP);
  });

  test('le décor est à la personne : il la suit quand elle déménage, et la place qu\'elle laisse montre le poste par défaut', async () => {
    const { db, service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    await service.setDecor('ana', CUSTOM_DECOR);
    const moved = await service.claim('ana', 'Ana', 'A6');
    expect(moved).toMatchObject({
      ok: true,
      changed: [expect.objectContaining({ key: 'A1', ownerId: null, ...DEFAULT_SETUP }), expect.objectContaining({ key: 'A6', ownerId: 'ana', ...CUSTOM_DECOR })],
    });
    expect(service.get('A1')).toMatchObject(DEFAULT_SETUP);
    expect(service.get('A6')).toMatchObject(CUSTOM_DECOR);
    expect(await db.select().from(deskSetup)).toMatchObject([{ ownerId: 'ana', ...CUSTOM_DECOR }]);   // toujours une seule ligne, la sienne
    // La place qu'elle a laissée, prise par quelqu'un d'autre, montre le réglage de celui-là (ici aucun) et non le sien.
    await service.claim('bob', 'Bob', 'A1');
    expect(service.get('A1')).toMatchObject({ ownerId: 'bob', ...DEFAULT_SETUP });
  });

  test('release : la place libre montre le poste par défaut, mais la personne garde son décor et le retrouve à sa prochaine place', async () => {
    const { db, service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    await service.setDecor('ana', CUSTOM_DECOR);
    expect(await service.release('ana')).toMatchObject({ ok: true, changed: [{ key: 'A1', ownerId: null, ...DEFAULT_SETUP }] });
    expect(service.get('A1')).toMatchObject(DEFAULT_SETUP);
    expect(await db.select().from(deskSetup)).toMatchObject([{ ownerId: 'ana', ...CUSTOM_DECOR }]);

    // Quelqu'un d'autre prend la place : le poste par défaut. Elle en reprend une autre : son décor est revenu avec elle.
    await service.claim('bob', 'Bob', 'A1');
    expect(service.get('A1')).toMatchObject(DEFAULT_SETUP);
    expect(await service.claim('ana', 'Ana', 'A3')).toMatchObject({ ok: true, changed: [expect.objectContaining({ key: 'A3', ...CUSTOM_DECOR })] });
    expect(service.get('A3')).toMatchObject(CUSTOM_DECOR);
  });

  test('le décor d\'une personne qui n\'a plus de bureau est lui aussi rechargé au démarrage', async () => {
    const { db, service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    await service.setDecor('ana', CUSTOM_DECOR);
    await service.release('ana');
    const reloaded = await DeskService.create(db, map);
    expect(reloaded.list().every((info) => info.ownerId === null)).toBe(true);
    expect(await reloaded.claim('ana', 'Ana', 'A2')).toMatchObject({ ok: true });
    expect(reloaded.get('A2')).toMatchObject(CUSTOM_DECOR);
  });

  test('le décor part avec le compte (ON DELETE CASCADE, comme le bureau)', async () => {
    const { db, service } = await setup();
    await service.claim('ana', 'Ana', 'A1');
    await service.setDecor('ana', CUSTOM_DECOR);
    await db.delete(user).where(eq(user.id, 'ana'));
    expect(await db.select().from(deskSetup)).toEqual([]);
  });

  test('si les décors sont illisibles au démarrage, ready est rejetée : le service ne s\'ouvre pas avec des pièces fausses', async () => {
    const { db } = await setup();
    await db.execute(sql`drop table "desk_setup"`);
    await expect(DeskService.create(db, map)).rejects.toThrow();
  });
});

// ---- Des pièces de tailles différentes ---------------------------------------------------------------------------------------

// Une carte à trois places : A1 standard (9 × 7, porte au sud), A5 compacte (6 × 7, porte au sud), A6 compacte, sa porte au nord de la pièce.
const SMALL_ROWS = Array.from({ length: 24 }, (_, y) => (y === 0 || y === 23 ? '#'.repeat(30) : `#${'.'.repeat(28)}#`));
const zonesOfSmallMap = (a5: { w: number } = { w: 6 }) => [
  { type: 'desk' as const, name: 'A1', x: 1, y: 2, w: 9, h: 7 },
  { type: 'door' as const, name: 'A1', x: 4, y: 9, w: 2, h: 2 },
  { type: 'desk' as const, name: 'A5', x: 12, y: 2, w: a5.w, h: 7 },
  { type: 'door' as const, name: 'A5', x: 12 + 2, y: 9, w: 2, h: 2 },
  { type: 'desk' as const, name: 'A6', x: 12, y: 15, w: 6, h: 7 },
  { type: 'door' as const, name: 'A6', x: 14, y: 13, w: 2, h: 2 },
  { type: 'spawn' as const, x: 25, y: 12, w: 1, h: 1 },
];
const smallMap = (a5Width = 6) => parseOfficeMap(buildTiledMap({ ascii: SMALL_ROWS, zones: zonesOfSmallMap({ w: a5Width }), tileset: { name: 'dev', image: 'tiles.png' } }));
const SMALL_MAP = smallMap();

describe('des pièces de tailles différentes', () => {
  test('chaque place lit sa pièce sur la carte : sa taille et le côté de sa porte', () => {
    const rooms = Object.fromEntries(deskSlots(SMALL_MAP).map((slot) => [slot.key, slot.room]));
    expect(rooms).toEqual({
      A1: { width: 9, height: 7, door: { side: 'south', x: 3, width: 2 } },
      A5: { width: 6, height: 7, door: { side: 'south', x: 2, width: 2 } },
      A6: { width: 6, height: 7, door: { side: 'north', x: 2, width: 2 } },
    });
    // Les places de la grande carte : quatre standard (A3 et A4 ont leur porte au nord), deux compactes (A6 a sa porte au nord).
    const standardNorth = { ...DESK_ROOMS.standard, door: { ...DESK_ROOMS.standard.door, side: 'north' as const } };
    const compactNorth = { ...DESK_ROOMS.compact, door: { ...DESK_ROOMS.compact.door, side: 'north' as const } };
    expect(Object.fromEntries(deskSlots(map).map((slot) => [slot.key, slot.room]))).toEqual({
      A1: DESK_ROOMS.standard,
      A2: DESK_ROOMS.standard,
      A3: standardNorth,
      A4: standardNorth,
      A5: DESK_ROOMS.compact,
      A6: compactNorth,
    });
  });

  test('une place sans porte (la petite carte de développement) garde la pièce standard', () => {
    const noDoor = parseOfficeMap(buildTiledMap({ ascii: SMALL_ROWS, zones: [{ type: 'desk', name: 'B1', x: 1, y: 2, w: 4, h: 3 }, { type: 'spawn', x: 25, y: 12, w: 1, h: 1 }], tileset: { name: 'dev', image: 'tiles.png' } }));
    expect(deskSlots(noDoor)[0]!.room).toEqual(DESK_ROOMS.standard);
  });

  test('la déco d\'une place compacte est validée avec sa pièce : ce qui tient dans une pièce standard peut ne pas tenir', async () => {
    const { service } = await setup({}, SMALL_MAP);
    await service.claim('ana', 'Ana', 'A5');
    await service.claim('bob', 'Bob', 'A1');
    const wide = { floor: 'noyer', wall: 'anthracite', items: [{ id: 'of-7-28', x: 4, y: 1 }] };
    expect(await service.setDecor('ana', wide)).toEqual({ ok: false, error: 'bad_decor', reason: 'out_of_room' });
    expect(await service.setDecor('bob', wide)).toMatchObject({ ok: true });
    expect(await service.setDecor('ana', defaultDeskDecor(DESK_ROOMS.compact))).toMatchObject({ ok: true });
  });

  test('une porte au nord : un tableau au-dessus d\'elle est refusé, à côté de la porte il est permis', async () => {
    const { service } = await setup({}, SMALL_MAP);
    await service.claim('ana', 'Ana', 'A6');
    const over = (x: number) => ({ floor: 'noyer', wall: 'anthracite', items: [{ id: 'of-15-0', x, y: 0 }] });
    expect(await service.setDecor('ana', over(2))).toEqual({ ok: false, error: 'bad_decor', reason: 'blocks_door' });
    expect(await service.setDecor('ana', over(4))).toMatchObject({ ok: true });
  });

  test('une place libre, ou une personne qui n\'a rien réglé, montre le poste par défaut de sa pièce', async () => {
    const { service } = await setup({}, SMALL_MAP);
    await service.claim('ana', 'Ana', 'A6');
    for (const [key, room] of [['A1', DESK_ROOMS.standard], ['A5', DESK_ROOMS.compact], ['A6', { ...DESK_ROOMS.compact, door: { ...DESK_ROOMS.compact.door, side: 'north' as const } }]] as const) {
      const expected = defaultDeskDecor(room);
      expect(service.get(key), key).toMatchObject({ floor: expected.floor, wall: expected.wall, items: expected.items });
    }
  });

  test('un décor enregistré qui ne tient plus dans la pièce est ignoré (la pièce par défaut), journalisé, et jamais effacé', async () => {
    const warn = vi.fn();
    // Un décor qui n'a de place que dans une pièce standard : un bureau à la colonne 5 (de 5 à 7) dépasse les 6 colonnes d'une pièce compacte.
    const WIDE: DeskDecor = { floor: 'noyer', wall: 'anthracite', items: [{ id: 'of-7-28', x: 5, y: 1 }] };
    // Ana règle sa pièce standard sur une carte où A5 est standard : le décor est écrit en base.
    const roomy = await setup({}, smallMap(9));
    await roomy.service.claim('ana', 'Ana', 'A5');
    expect(await roomy.service.setDecor('ana', WIDE)).toMatchObject({ ok: true });

    // La carte change : A5 est maintenant compacte. Le même décor ne tient plus.
    const service = await DeskService.create(roomy.db, SMALL_MAP, { logger: { warn } });
    const expected = defaultDeskDecor(DESK_ROOMS.compact);
    expect(service.get('A5')).toMatchObject({ ownerId: 'ana', floor: expected.floor, wall: expected.wall, items: expected.items });
    // La place le dit (`decorUnfit`), pour que son panneau prévienne la personne : enregistrer remplacerait son décor, que personne ne voit plus.
    expect(service.get('A5')?.decorUnfit).toBe(true);
    service.get('A5');
    service.list();
    // Journalisé une fois, avec de quoi retrouver la personne, la place et la raison.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ userId: 'ana', desk: 'A5', reason: 'out_of_room' });
    // Jamais effacé : la ligne est toujours en base, telle qu'elle était.
    expect(await roomy.db.select().from(deskSetup)).toMatchObject([{ ownerId: 'ana', ...WIDE }]);
    // Et si la pièce redevient assez grande, le décor revient.
    const again = await DeskService.create(roomy.db, smallMap(9));
    expect(again.get('A5')).toMatchObject(WIDE);
    expect(again.get('A5')?.decorUnfit).toBeUndefined();
  });

  test('une place libre, ou un décor qui tient, ne porte pas de `decorUnfit`', async () => {
    const { service } = await setup({}, SMALL_MAP);
    expect(service.get('A5')?.decorUnfit).toBeUndefined();
    await service.claim('ana', 'Ana', 'A5');
    expect(service.get('A5')?.decorUnfit).toBeUndefined();
    await service.setDecor('ana', { floor: 'noyer', wall: 'anthracite', items: [{ id: 'of-7-28', x: 0, y: 0 }] });
    expect(service.get('A5')?.decorUnfit).toBeUndefined();
  });

  test('un décor qui tient dans la pièce n\'est ni ignoré ni journalisé', async () => {
    const warn = vi.fn();
    const { db, service } = await setup({}, SMALL_MAP);
    await service.claim('ana', 'Ana', 'A5');
    await service.setDecor('ana', { floor: 'noyer', wall: 'anthracite', items: [{ id: 'of-7-28', x: 0, y: 0 }] });
    const reloaded = await DeskService.create(db, SMALL_MAP, { logger: { warn } });
    expect(reloaded.get('A5')).toMatchObject({ floor: 'noyer', items: [{ id: 'of-7-28', x: 0, y: 0 }] });
    expect(warn).not.toHaveBeenCalled();
  });
});
