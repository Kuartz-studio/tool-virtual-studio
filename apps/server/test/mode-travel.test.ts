import {
  DEFAULT_MODES,
  TREADMILL_ID,
  buildOfficeTiledMap,
  freeSpotIn,
  isWalkablePoint,
  parseOfficeMap,
  placeAt,
  placeByKey,
  treadmillBelt,
  zoneAt,
  type ActivityState,
  type PlacedItem,
  type PublicPlayer,
  type TreadmillRef,
} from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { deskSlots } from '../src/desks/desk-service';
import { createModeTravel } from '../src/modes/mode-travel';
import { World } from '../src/realtime/world';
import { createTeleport } from '../src/teleport';

// La grande carte, comme le serveur la lit : la salle de sport et la salle de jeu sont des destinations, avec leurs places libres.
const map = parseOfficeMap(buildOfficeTiledMap());
const slots = deskSlots(map);
const gym = placeByKey(map, 'gym')!;
// Les modes par défaut, tels que la base les rend (un identifiant en plus).
const sport = { id: 'sport', ...DEFAULT_MODES.find((mode) => mode.label === 'Sport')! };
const focus = { id: 'focus', ...DEFAULT_MODES.find((mode) => mode.label === 'Concentration')! };
const toGame: ActivityState = { id: 'u-game', label: 'Jeux', color: '#0ea5e9', icon: 'gamepad-2', allowEntry: true, hear: true, heard: true, place: 'game' };
const toCafe: ActivityState = { id: 'u-cafe', label: 'Café', color: '#f59e0b', allowEntry: true, hear: true, heard: true, place: 'cafe' };

const middleOf = (place: ReturnType<typeof placeByKey>) => ({ x: place!.rects[0]!.x + place!.rects[0]!.width / 2, y: place!.rects[0]!.y + place!.rects[0]!.height / 2 });
const inside = (key: string, at: { x: number; y: number }) => placeAt(map, at.x, at.y)?.key === key;

// Les bureaux, de poche : chaque place de la carte, qui l'occupe (`owners` : la place de chacun) et ce qui y est posé (`items`, par place ; rien par défaut).
function deskBook(owners: Record<string, string>, items: Record<string, PlacedItem[]> = {}) {
  const info = (key: string) => ({ key, ownerId: Object.entries(owners).find(([, desk]) => desk === key)?.[0] ?? null, items: items[key] ?? [] });
  return {
    deskOf: (id: string) => (owners[id] ? info(owners[id]) : undefined),
    get: (key: string) => (slots.some((slot) => slot.key === key) ? info(key) : undefined),
    list: () => slots.map((slot) => info(slot.key)),
    slot: (key: string) => slots.find((slot) => slot.key === key),
  };
}

// Un monde de poche : des joueurs à leur position, un bureau pour qui en a un, et ce que `teleport` a reçu.
function setup(players: Record<string, { x: number; y: number }>, desks: Record<string, string> = {}) {
  const calls: Array<{ id: string; at: { x: number; y: number }; reason?: 'teleport' }> = [];
  const travel = createModeTravel({
    world: {
      get: (id: string) => (players[id] ? ({ id, ...players[id] } as PublicPlayer) : undefined),
      list: () => Object.entries(players).map(([id, at]) => ({ id, ...at }) as PublicPlayer),
      setTreadmill: () => false,
    },
    map,
    desks: deskBook(desks),
    teleport: (id, at, reason) => {
      calls.push({ id, at, ...(reason ? { reason } : {}) });
      if (players[id]) players[id] = { x: at.x, y: at.y };
      return true;
    },
    announceTreadmill: () => {},
  });
  return { travel, calls, players };
}

const reception = { x: map.spawn.x, y: map.spawn.y };

describe('prendre un mode qui a un emplacement', () => {
  test('on est conduit dans la pièce, à une place libre, avec la raison « teleport » (le jeu souligne le saut)', () => {
    const { travel, calls } = setup({ ana: reception });
    travel.change('ana', null, sport);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 'ana', reason: 'teleport' });
    expect(inside('gym', calls[0]!.at)).toBe(true);
    expect(isWalkablePoint(map, calls[0]!.at.x, calls[0]!.at.y)).toBe(true);
  });

  test('la place est celle de freeSpotIn : loin des autres, qui sont déjà là', () => {
    const first = freeSpotIn(map, gym, [])!;
    const { travel, calls } = setup({ ana: reception, bob: first });
    travel.change('ana', null, sport);
    const spot = calls[0]!.at;
    expect(Math.hypot(spot.x - first.x, spot.y - first.y)).toBeGreaterThanOrEqual(2 * map.tileSize);
    expect(spot).toEqual(freeSpotIn(map, gym, [first]));
  });

  test('déjà dans la pièce : on ne bouge pas (un serveur redémarré qui relit son mode n\'y déplace personne)', () => {
    const here = middleOf(gym);
    const { travel, calls } = setup({ ana: here });
    travel.change('ana', null, sport);
    expect(calls).toEqual([]);
  });

  test('la pièce est pleine : on reste où l\'on est, et le mode s\'applique quand même (rien à dire de plus)', () => {
    const taken: Array<{ x: number; y: number }> = [];
    for (let spot = freeSpotIn(map, gym, taken); spot !== null; spot = freeSpotIn(map, gym, taken)) taken.push(spot);
    const players: Record<string, { x: number; y: number }> = { ana: reception };
    taken.forEach((at, index) => (players[`autre${index}`] = at));
    const { travel, calls } = setup(players);
    travel.change('ana', null, sport);
    expect(calls).toEqual([]);
  });

  test('une personne qui n\'est pas au monde : rien', () => {
    const { travel, calls } = setup({});
    travel.change('fantome', null, sport);
    expect(calls).toEqual([]);
  });

  test('un emplacement qui n\'est pas une destination de la carte (le café, une clé inconnue) : ignoré', () => {
    const { travel, calls } = setup({ ana: reception });
    travel.change('ana', null, toCafe);
    travel.change('ana', null, { ...toCafe, place: 'nulle-part' });
    expect(calls).toEqual([]);
  });

  test('un mode sans emplacement (Concentration) : rien ne bouge', () => {
    const { travel, calls } = setup({ ana: reception }, { ana: slots[0]!.key });
    travel.change('ana', null, focus);
    expect(calls).toEqual([]);
  });
});

describe('en sortir', () => {
  test('retour au bureau : au centre de sa pièce', () => {
    const slot = slots[0]!;
    const { travel, calls } = setup({ ana: middleOf(gym) }, { ana: slot.key });
    travel.change('ana', sport, null);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 'ana', reason: 'teleport' });
    expect(zoneAt(map, calls[0]!.at.x, calls[0]!.at.y, ['desk'])?.name).toBe(slot.key);
  });

  test('retour au bureau aussi en prenant un mode sans emplacement', () => {
    const slot = slots[1]!;
    const { travel, calls } = setup({ ana: middleOf(gym) }, { ana: slot.key });
    travel.change('ana', sport, focus);
    expect(zoneAt(map, calls[0]!.at.x, calls[0]!.at.y, ['desk'])?.name).toBe(slot.key);
  });

  test('sans bureau : à l\'apparition', () => {
    const { travel, calls } = setup({ ana: middleOf(gym) });
    travel.change('ana', sport, null);
    expect(calls).toEqual([{ id: 'ana', at: { x: map.spawn.x, y: map.spawn.y }, reason: 'teleport' }]);
  });

  test('d\'un mode à emplacement à un autre : directement au nouveau lieu, sans passer par le bureau', () => {
    const { travel, calls } = setup({ ana: middleOf(gym) }, { ana: slots[0]!.key });
    travel.change('ana', sport, toGame);
    expect(calls).toHaveLength(1);
    expect(inside('game', calls[0]!.at)).toBe(true);
    // Et le retour, ensuite, est le bureau.
    travel.change('ana', toGame, null);
    expect(zoneAt(map, calls[1]!.at.x, calls[1]!.at.y, ['desk'])?.name).toBe(slots[0]!.key);
  });

  test('reprendre le même mode alors qu\'on est dans la pièce : rien ne bouge', () => {
    const { travel, calls } = setup({ ana: middleOf(gym) }, { ana: slots[0]!.key });
    travel.change('ana', sport, sport);
    expect(calls).toEqual([]);
  });

  test('on est parti à pied de la pièce du mode : en sortir ne ramène pas au bureau', () => {
    const { travel, calls } = setup({ ana: reception }, { ana: slots[0]!.key });
    travel.change('ana', sport, null);
    expect(calls).toEqual([]);
  });

  test('sortir d\'un mode sans emplacement (Concentration → Normal) : on reste où l\'on est', () => {
    const { travel, calls } = setup({ ana: reception }, { ana: slots[0]!.key });
    travel.change('ana', focus, null);
    travel.change('ana', toCafe, null);
    expect(calls).toEqual([]);
  });

  test('le centre de la pièce n\'est pas praticable : on est posé devant la porte', () => {
    // Un bureau dont le centre est sur un mur n'existe pas sur cette carte : on le simule avec une pièce posée hors de la carte.
    const slot = slots[0]!;
    const blocked = { ...slot, zone: { ...slot.zone, x: -1000, y: -1000 } };
    const players = { ana: middleOf(gym) };
    const calls: Array<{ x: number; y: number }> = [];
    const travel = createModeTravel({
      world: { get: (id: string) => ({ id, ...players.ana }) as PublicPlayer, list: () => [], setTreadmill: () => false },
      map,
      desks: { ...deskBook({ ana: slot.key }), slot: () => blocked },
      teleport: (_id, at) => {
        calls.push(at);
        return true;
      },
      announceTreadmill: () => {},
    });
    travel.change('ana', sport, null);
    expect(calls).toEqual([slot.exit]);
  });
});

// ---- Sur son tapis de course -------------------------------------------------------------------------------------------------

// Le bureau A1 (la pièce standard, porte au sud : ses cases vont de (9, 2) à (17, 8) sur la carte) et un tapis de course posé en (1, 2) de sa pièce : son empreinte
// couvre les cases (10, 4) à (11, 5) de la carte ; la rangée juste au sud est la 6.
const treadmillAt = (x: number, y: number): PlacedItem => ({ id: TREADMILL_ID, x, y });
const ref = (x: number, y: number, desk = 'A1'): TreadmillRef => ({ desk, x, y });
const belt = treadmillBelt(map, ref(1, 2))!;
// La case (10, 6), sous le tapis : la première de la rangée du sud (à égalité avec sa voisine, la plus à gauche).
const inFront = { x: 336, y: 208 };

// Le vrai monde (ses positions, et qui court) et des bureaux de poche : Ana a A1, où est posé `placed` (que le test peut changer : `items.A1`). `calls` : ce que teleport a
// reçu ; `announced` : qui s'est mis à courir (qu'on en descend, le monde le dit lui-même : drainTreadmillStops).
function onTreadmills(placed: PlacedItem[], owners: Record<string, string> = { ana: 'A1' }) {
  const world = new World(map, () => 0);
  const items: Record<string, PlacedItem[]> = { A1: placed };
  const desks = deskBook(owners, items);
  const calls: Array<{ id: string; at: { x: number; y: number }; reason?: 'teleport' }> = [];
  const announced: Array<{ id: string; treadmill: TreadmillRef }> = [];
  const inWorld = createTeleport({ world, socketsOf: () => [] });
  const travel = createModeTravel({
    world,
    map,
    desks,
    teleport: (id, at, reason) => {
      calls.push({ id, at, ...(reason ? { reason } : {}) });
      return inWorld(id, at, reason);
    },
    announceTreadmill: (id, treadmill) => announced.push({ id, treadmill }),
  });
  const join = (id: string, at: { x: number; y: number }) => world.join({ id, name: id, avatarKey: null, ...at, dir: 'down', status: 'available' });
  // Ana court sur son tapis, comme après « Sport » sur le tapis ; on oublie ce que ce départ a dit.
  const running = () => {
    travel.change('ana', null, sport, { treadmill: true });
    calls.length = 0;
    announced.length = 0;
  };
  return { world, travel, calls, announced, items, desks, join, running };
}

describe('prendre un mode sur son tapis de course', () => {
  test('« Sport » sur le tapis : posée sur la bande, d\'un voyage (son anneau), tournée vers la console ; le bureau l\'apprend, et le monde la dit courir', () => {
    const { world, travel, calls, announced, join } = onTreadmills([treadmillAt(1, 2)]);
    join('ana', reception);
    travel.change('ana', null, sport, { treadmill: true });
    expect(belt).toEqual({ x: 352, y: 167 });
    expect(isWalkablePoint(map, belt.x, belt.y)).toBe(true);
    expect(calls).toEqual([{ id: 'ana', at: belt, reason: 'teleport' }]);
    expect(world.get('ana')).toMatchObject({ ...belt, dir: 'up', treadmill: ref(1, 2) });
    expect(announced).toEqual([{ id: 'ana', treadmill: ref(1, 2) }]);
    expect(world.drainTreadmillStops()).toEqual([]);
  });

  test('sa pièce n\'a pas de tapis, ou elle n\'a pas de bureau : la salle de sport, comme toujours', () => {
    for (const { placed, owners } of [{ placed: [], owners: { ana: 'A1' } }, { placed: [treadmillAt(1, 2)], owners: {} }]) {
      const { world, travel, calls, announced, join } = onTreadmills(placed, owners);
      join('ana', reception);
      travel.change('ana', null, sport, { treadmill: true });
      expect(calls).toHaveLength(1);
      expect(inside('gym', calls[0]!.at)).toBe(true);
      expect(world.get('ana')?.treadmill).toBeUndefined();
      expect(announced).toEqual([]);
    }
  });

  test('sans le choix du tapis, « Sport » conduit à la salle de sport, tapis ou non ; et le tapis n\'est proposé qu\'aux modes de la salle de sport', () => {
    const { world, travel, calls, join } = onTreadmills([treadmillAt(1, 2)]);
    join('ana', reception);
    travel.change('ana', null, sport);
    expect(inside('gym', calls[0]!.at)).toBe(true);
    travel.change('ana', sport, toGame, { treadmill: true });
    expect(inside('game', calls[1]!.at)).toBe(true);
    expect(world.get('ana')?.treadmill).toBeUndefined();
  });

  test('plusieurs tapis : le premier de la déco où personne ne court', () => {
    const { world, travel, join } = onTreadmills([treadmillAt(1, 2), treadmillAt(5, 2)]);
    join('ana', reception);
    join('bob', treadmillBelt(map, ref(1, 2))!);
    world.setTreadmill('bob', ref(1, 2));
    travel.change('ana', null, sport, { treadmill: true });
    expect(world.get('ana')).toMatchObject({ ...treadmillBelt(map, ref(5, 2)), treadmill: ref(5, 2) });
  });

  test('déjà sur son tapis : le reprendre ne bouge rien, et ne se redit pas', () => {
    const { travel, calls, announced, join, running } = onTreadmills([treadmillAt(1, 2)]);
    join('ana', reception);
    running();
    travel.change('ana', sport, sport, { treadmill: true });
    expect(calls).toEqual([]);
    expect(announced).toEqual([]);
  });
});

describe('descendre de son tapis de course', () => {
  test('en sortir (« Disponible », ou un mode sans emplacement) : elle descend sur la case libre devant le tapis, d\'un pas (sans anneau), et ne court plus', () => {
    for (const next of [null, focus]) {
      const { world, travel, calls, join, running } = onTreadmills([treadmillAt(1, 2)]);
      join('ana', reception);
      running();
      travel.change('ana', sport, next);
      expect(calls).toEqual([{ id: 'ana', at: inFront }]);
      expect(world.get('ana')).toMatchObject(inFront);
      expect(world.get('ana')?.treadmill).toBeUndefined();
      expect(world.drainTreadmillStops()).toEqual(['ana']);
    }
  });

  test('un mode qui conduit ailleurs, ou « Sport » à la salle de sport : directement au lieu (le voyage), et elle ne court plus', () => {
    for (const [next, place] of [[toGame, 'game'], [sport, 'gym']] as const) {
      const { world, travel, calls, join, running } = onTreadmills([treadmillAt(1, 2)]);
      join('ana', reception);
      running();
      travel.change('ana', sport, next);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ id: 'ana', reason: 'teleport' });
      expect(inside(place, calls[0]!.at)).toBe(true);
      expect(world.get('ana')?.treadmill).toBeUndefined();
    }
  });

  test('la case devant est prise : sa voisine sous le tapis, puis le côté (la rangée de la bande d\'abord)', () => {
    const { travel, calls, join, running } = onTreadmills([treadmillAt(1, 2)]);
    join('ana', reception);
    join('bob', inFront);
    running();
    travel.change('ana', sport, null);
    expect(calls[0]!.at).toEqual({ x: 368, y: 208 });

    const crowded = onTreadmills([treadmillAt(1, 2)]);
    crowded.join('ana', reception);
    crowded.join('bob', inFront);
    crowded.join('carl', { x: 368, y: 208 });
    crowded.running();
    crowded.travel.change('ana', sport, null);
    // Les deux côtés sont à égalité : celui de gauche, la case (9, 5).
    expect(crowded.calls[0]!.at).toEqual({ x: 304, y: 176 });
  });

  test('un tapis contre le mur du bas (sa rangée du sud est hors de la pièce) : on descend à côté', () => {
    const { world, travel, calls, join } = onTreadmills([treadmillAt(0, 5)]);
    join('ana', reception);
    travel.change('ana', null, sport, { treadmill: true });
    expect(world.get('ana')?.treadmill).toEqual(ref(0, 5));
    travel.change('ana', sport, null);
    expect(calls.at(-1)).toEqual({ id: 'ana', at: { x: 368, y: 272 } });
  });

  test('un pas de qui court : hors du tapis (son navigateur l\'a fait descendre), il passe comme un autre ; resté sur le tapis, le serveur la pose devant', () => {
    const { world, travel, calls, join, running } = onTreadmills([treadmillAt(1, 2)]);
    join('ana', reception);
    running();
    // Sa direction, à l'arrêt, sur la bande : ce n'est pas un pas, elle court toujours.
    expect(travel.move('ana', { ...belt, dir: 'up', moving: false })).toBe(false);
    expect(world.applyMove('ana', { ...belt, dir: 'up', moving: false })).toEqual({ ok: true });
    expect(world.get('ana')?.treadmill).toEqual(ref(1, 2));

    // Le pas de son navigateur, qui l'a posée devant : le monde l'applique, et la voit descendre.
    const step = { ...inFront, dir: 'left' as const, moving: true };
    expect(travel.move('ana', step)).toBe(false);
    expect(world.applyMove('ana', step)).toEqual({ ok: true });
    expect(world.get('ana')?.treadmill).toBeUndefined();
    expect(world.drainTreadmillStops()).toEqual(['ana']);
    expect(calls).toEqual([]);

    // Un pas qui la laisse sur le tapis (un vieux navigateur), ou qui marche sur place : le serveur la pose devant.
    for (const stuck of [{ x: belt.x - 6, y: belt.y, dir: 'left' as const, moving: true }, { ...belt, dir: 'up' as const, moving: true }]) {
      running();
      expect(travel.move('ana', stuck)).toBe(true);
      expect(calls).toEqual([{ id: 'ana', at: inFront }]);
      expect(world.get('ana')).toMatchObject(inFront);
      expect(world.get('ana')?.treadmill).toBeUndefined();
    }
    // Qui ne court pas : rien à voir.
    expect(travel.move('ana', { x: 300, y: 300, dir: 'down', moving: true })).toBe(false);
  });

  test('le tapis retiré de sa pièce, ou déplacé, ou la pièce rendue : elle en descend, devant sa place d\'avant ; un autre bureau qui change ne la touche pas', () => {
    const { world, travel, calls, items, desks, join, running } = onTreadmills([treadmillAt(1, 2)]);
    join('ana', reception);
    running();
    travel.desksChanged([desks.get('A2')!]);
    expect(world.get('ana')?.treadmill).toEqual(ref(1, 2));

    items.A1 = [];
    travel.desksChanged([desks.get('A1')!]);
    expect(calls).toEqual([{ id: 'ana', at: inFront }]);
    expect(world.get('ana')?.treadmill).toBeUndefined();

    items.A1 = [treadmillAt(1, 2)];
    running();
    items.A1 = [treadmillAt(5, 2)];
    travel.desksChanged([desks.get('A1')!]);
    expect(calls).toEqual([{ id: 'ana', at: inFront }]);
    expect(world.get('ana')?.treadmill).toBeUndefined();

    items.A1 = [treadmillAt(1, 2)];
    running();
    travel.desksChanged([{ key: 'A1', ownerId: null, items: [treadmillAt(1, 2)] }]);
    expect(world.get('ana')?.treadmill).toBeUndefined();
  });

  test('qui arrive sur la bande d\'un tapis (elle y courait en partant, ou quand le serveur s\'est arrêté) est posée devant lui ; ailleurs, là où on l\'attend', () => {
    const { travel } = onTreadmills([treadmillAt(1, 2)]);
    expect(travel.arrival('ana', belt)).toEqual(inFront);
    expect(travel.arrival('ana', { x: belt.x - 20, y: belt.y - 30 })).toEqual(inFront);
    expect(travel.arrival('ana', reception)).toEqual(reception);
    expect(travel.arrival('ana', inFront)).toEqual(inFront);
  });
});
