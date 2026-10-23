import {
  DEFAULT_MODES,
  buildOfficeTiledMap,
  freeSpotIn,
  isWalkablePoint,
  parseOfficeMap,
  placeAt,
  placeByKey,
  zoneAt,
  type ActivityState,
  type PublicPlayer,
} from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { deskSlots } from '../src/desks/desk-service';
import { createModeTravel } from '../src/modes/mode-travel';

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

// Un monde de poche : des joueurs à leur position, un bureau pour qui en a un, et ce que `teleport` a reçu.
function setup(players: Record<string, { x: number; y: number }>, desks: Record<string, string> = {}) {
  const calls: Array<{ id: string; at: { x: number; y: number }; reason?: 'teleport' }> = [];
  const travel = createModeTravel({
    world: {
      get: (id: string) => (players[id] ? ({ id, ...players[id] } as PublicPlayer) : undefined),
      list: () => Object.entries(players).map(([id, at]) => ({ id, ...at }) as PublicPlayer),
    },
    map,
    desks: { deskOf: (id: string) => (desks[id] ? { key: desks[id] } : undefined), slot: (key: string) => slots.find((slot) => slot.key === key) },
    teleport: (id, at, reason) => {
      calls.push({ id, at, ...(reason ? { reason } : {}) });
      if (players[id]) players[id] = { x: at.x, y: at.y };
      return true;
    },
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
      world: { get: (id: string) => ({ id, ...players.ana }) as PublicPlayer, list: () => [] },
      map,
      desks: { deskOf: () => ({ key: slot.key }), slot: () => blocked },
      teleport: (_id, at) => {
        calls.push(at);
        return true;
      },
    });
    travel.change('ana', sport, null);
    expect(calls).toEqual([slot.exit]);
  });
});
