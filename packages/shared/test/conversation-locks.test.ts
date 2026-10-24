import { describe, expect, test } from 'vitest';
import {
  CLOSE_RANGE_GROUPING,
  DEV_OFFICE,
  EMPTY_GROUPING,
  buildTiledMap,
  busyZoneIds,
  computeGroups,
  overlayLocks,
  parseOfficeMap,
  withGroup,
  withoutGroup,
  type ConversationLock,
  type GroupingState,
  type ProximityPlayer,
} from '../src';

// Les conversations verrouillées au-dessus du calcul des groupes (conversation-locks.ts), sur la carte de développement et le cercle serré des
// tests du calcul (3 cases, à l'arrêt) : sortir un groupe du calcul, l'y faire revenir, et l'état que voient les autres.
const map = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
const ROOM = map.zones.find((z) => z.type === 'private')!.id;
const at = (tx: number, ty: number) => ({ x: tx * 32 + 16, y: ty * 32 + 16 });
const player = (id: string, pos: { x: number; y: number }): ProximityPlayer => ({ id, ...pos, moving: false, status: 'available' });
const run = (players: ProximityPlayer[], s: GroupingState, t: number) => computeGroups(players, map, s, t, CLOSE_RANGE_GROUPING);
const lockOf = (id: string, members: string[]): ConversationLock => ({ id, members, by: { id: members[0]!, name: members[0]! }, at: 0 });

// {A, B} dans g1, puis C qui s'arrête près d'eux et attend de les rejoindre.
function scene(): GroupingState {
  let s = run([player('A', at(4, 7)), player('B', at(6, 7))], EMPTY_GROUPING, 0);
  s = run([player('A', at(4, 7)), player('B', at(6, 7))], s, 500);
  return run([player('A', at(4, 7)), player('B', at(6, 7)), player('C', at(8, 7))], s, 750);
}

describe('withoutGroup : verrouiller sort le groupe du calcul', () => {
  test('ni ses membres, ni le groupe, ni ceux qui allaient le rejoindre, ni sa mémoire ; nextId ne bouge pas', () => {
    const s = scene();
    expect(s.pending).toEqual({ C: { target: 'g1', since: 750 } });
    const locked = withoutGroup({ ...s, recent: { g1: { zoneId: null, members: { Z: 700 } }, g9: { zoneId: null, members: { Y: 700 } } } }, 'g1');
    expect(locked).toEqual({ assignment: { C: null }, groups: {}, pending: {}, nextId: s.nextId, recent: { g9: { zoneId: null, members: { Y: 700 } } } });
  });

  test("le calcul ne voit plus les membres : C, seul, n'attend plus rien ; personne ne prend g1", () => {
    let s = withoutGroup(scene(), 'g1');
    for (let t = 1000; t <= 3000; t += 250) s = run([player('C', at(8, 7)), player('D', at(9, 7))], s, t);
    expect(s.assignment).toEqual({ C: 'g2', D: 'g2' });
    expect(Object.keys(s.groups)).toEqual(['g2']);
  });
});

describe('overlayLocks : ce que voient le coordinateur, le faux live et les zones occupées', () => {
  test('le calcul plus chaque conversation verrouillée, sous son id, sans zone', () => {
    const base = run([player('C', at(9, 2)), player('D', at(12, 3))], EMPTY_GROUPING, 0);
    const settled = run([player('C', at(9, 2)), player('D', at(12, 3))], base, 500);
    const merged = overlayLocks(settled, [lockOf('g7', ['A', 'B'])]);
    expect(merged.assignment).toEqual({ A: 'g7', B: 'g7', C: 'g1', D: 'g1' });
    expect(merged.groups.g7).toEqual({ id: 'g7', members: ['A', 'B'], zoneId: null });
    // Une conversation verrouillée n'occupe aucune zone, même si ses membres sont dans la salle.
    expect(busyZoneIds(merged)).toEqual(new Set([ROOM]));
    expect(busyZoneIds(overlayLocks(EMPTY_GROUPING, [lockOf('g7', ['A', 'B'])]))).toEqual(new Set());
  });
});

describe('withGroup : déverrouiller rend le groupe au calcul', () => {
  test('ensemble : le calcul les garde dans le même groupe, sans attente ni changement de room', () => {
    let s = withGroup(EMPTY_GROUPING, 'g4', ['A', 'B'], [player('A', at(4, 7)), player('B', at(6, 7))], map);
    expect(s.groups).toEqual({ g4: { id: 'g4', members: ['A', 'B'], zoneId: null } });
    for (let t = 0; t <= 1000; t += 250) {
      s = run([player('A', at(4, 7)), player('B', at(6, 7))], s, t);
      expect(s.assignment).toEqual({ A: 'g4', B: 'g4' });
      expect(s.pending).toEqual({});
    }
  });

  test('tous dans la même salle : un groupe de la salle ; dispersés : un groupe sans zone', () => {
    const inRoom = [player('A', at(9, 2)), player('B', at(12, 3))];
    expect(withGroup(EMPTY_GROUPING, 'g4', ['A', 'B'], inRoom, map).groups.g4?.zoneId).toBe(ROOM);
    const apart = [player('A', at(9, 2)), player('B', at(20, 13))];
    expect(withGroup(EMPTY_GROUPING, 'g4', ['A', 'B'], apart, map).groups.g4?.zoneId).toBeNull();
  });

  test('loin les uns des autres : ils quittent le groupe comme on quitte un groupe ordinaire (500 ms), puis il se défait', () => {
    const apart = [player('A', at(2, 13)), player('B', at(20, 13))];
    let s = withGroup(EMPTY_GROUPING, 'g4', ['A', 'B'], apart, map);
    const seen: Array<string | null | undefined> = [];
    for (let t = 0; t <= 500; t += 250) {
      s = run(apart, s, t);
      seen.push(s.assignment.A);
    }
    expect(seen).toEqual(['g4', 'g4', null]);
    expect(s.groups).toEqual({});
  });

  test("un membre absent n'y revient pas ; seul, le groupe se défait au calcul suivant", () => {
    let s = withGroup(EMPTY_GROUPING, 'g4', ['A', 'B'], [player('A', at(4, 7))], map);
    expect(s.groups.g4?.members).toEqual(['A']);
    s = run([player('A', at(4, 7))], s, 0);
    expect(s.assignment).toEqual({ A: null });
    expect(withGroup(EMPTY_GROUPING, 'g4', ['A'], [], map)).toBe(EMPTY_GROUPING);
  });
});
