import { describe, expect, test } from 'vitest';
import {
  DEV_OFFICE,
  EMPTY_GROUPING,
  GROUP_DEBOUNCE_MS,
  GROUP_MEMORY_MS,
  REJOIN_DEBOUNCE_MS,
  ZONE_JOIN_DEBOUNCE_MS,
  CLOSE_JOIN_DISTANCE_PX as JOIN_DISTANCE_PX,
  CLOSE_LEAVE_DISTANCE_PX as LEAVE_DISTANCE_PX,
  CLOSE_RANGE_GROUPING,
  OPEN_SPACE_GROUPING,
  buildTiledMap,
  busyZoneIds,
  computeGroups as computeGroupsWith,
  type GroupConfig,
  parseOfficeMap,
  zoneAt,
  type GroupingState,
  type ProximityPlayer,
  type Status,
} from '../src';

// Ces tests jouent le calcul avec le cercle serré d'origine (3 cases, à l'arrêt, 4 cases pour rester) : leurs scènes tiennent dans la petite
// carte de développement. La règle du bureau (OPEN_SPACE_GROUPING) a ses propres tests, tout en bas.
const computeGroups = (players: ProximityPlayer[], m: typeof map, prev: GroupingState, now: number, config: GroupConfig = CLOSE_RANGE_GROUPING) =>
  computeGroupsWith(players, m, prev, now, config);

// La carte de développement : 24 × 16 cases de 32 px. Ce qui sert ici :
//  - la salle de réunion (zone private n° 1) : cases x 8 à 13, y 1 à 4 ; sa porte est en (10, 5) ;
//  - les espaces des trois bureaux (zones desk n° 2, 3 et 4) : cases x 3 à 6, 10 à 13 et 17 à 20, y 10 à 12 ;
//  - ailleurs, des espaces ouverts : le couloir (lignes 6 à 8), les lignes 13 et 14, les allées entre les bureaux.
const map = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
const ROOM = map.zones.find((z) => z.type === 'private')!.id;

// Le centre de la case (tx, ty), en pixels.
const at = (tx: number, ty: number) => ({ x: tx * 32 + 16, y: ty * 32 + 16 });

type Pos = { x: number; y: number };
const player = (id: string, pos: Pos, more: { moving?: boolean; status?: Status } = {}): ProximityPlayer => ({
  id,
  x: pos.x,
  y: pos.y,
  moving: more.moving ?? false,
  status: more.status ?? 'available',
});

// Le pas des appels de ces tests, en ms : la période d'origine du calcul (le serveur le rappelle plus souvent, voir GROUPS_TICK_MS).
const TICK_MS = 250;

// Un appel du calcul, à l'heure t (en ms).
const run = (players: ProximityPlayer[], s: GroupingState, t: number): GroupingState => computeGroups(players, map, s, t);

// Les appels successifs avec les mêmes joueurs, toutes les 250 ms (TICK_MS, indépendant de la période du serveur) de `from` à `to`
// compris : un état par appel.
function steps(players: ProximityPlayer[], s: GroupingState, from: number, to: number): GroupingState[] {
  const states: GroupingState[] = [];
  for (let t = from; t <= to; t += TICK_MS) {
    s = run(players, s, t);
    states.push(s);
  }
  return states;
}
// L'état après ces appels.
const step = (players: ProximityPlayer[], s: GroupingState, from: number, to: number): GroupingState => steps(players, s, from, to).at(-1)!;

// ---- Les tests de la brief ------------------------------------------------------------------------------------------------

test('deux personnes arrêtées à 2 cases : groupe après 500 ms, pas avant', () => {
  const players = [player('A', at(4, 7)), player('B', at(6, 7))];
  const s0 = run(players, EMPTY_GROUPING, 0);
  const s1 = run(players, s0, 250);
  const s2 = run(players, s1, 500);
  for (const s of [s0, s1]) {
    expect(s.assignment).toEqual({ A: null, B: null });
    expect(s.groups).toEqual({});
  }
  expect(s2.assignment).toEqual({ A: 'g1', B: 'g1' });
  expect(s2.groups).toEqual({ g1: { id: 'g1', members: ['A', 'B'], zoneId: null } });
  expect(s2.pending).toEqual({});
});

test('en marchant : jamais de groupe', () => {
  // B est arrêté en at(6, 7). A marche vers la droite à 160 px/s (40 px tous les 250 ms) depuis at(2, 7) : à 128, 88, 48, 8 puis
  // 32 px de B.
  const B = player('B', at(6, 7));
  let s = EMPTY_GROUPING;
  for (let t = 0; t <= 1000; t += 250) {
    s = run([player('A', { x: 80 + (t / 250) * 40, y: 240 }, { moving: true }), B], s, t);
    expect(s.assignment).toEqual({ A: null, B: null });
    expect(s.groups).toEqual({});
    expect(s.pending).toEqual({});
  }
  // A s'arrête à 32 px de B : le groupe se forme 500 ms plus tard.
  const stopped = [player('A', { x: 240, y: 240 }), B];
  expect(steps(stopped, s, 1250, 1750).map((st) => st.assignment)).toEqual([
    { A: null, B: null },
    { A: null, B: null },
    { A: 'g1', B: 'g1' },
  ]);
});

test('hystérésis', () => {
  // Les écarts sont comptés depuis A, en at(2, 7), sur la ligne 7 (du sol de bout en bout).
  const A = player('A', at(2, 7));
  const B = (dx: number) => player('B', { x: A.x + dx, y: A.y });
  // Groupés à 64 px.
  let s = step([A, B(64)], EMPTY_GROUPING, 0, 500);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1' });
  // B à 112 px : trop loin pour former un groupe, assez près pour y rester. Toujours groupés 1000 ms plus tard, sans attente.
  const near = steps([A, B(112)], s, 750, 1750);
  for (const st of near) {
    expect(st.assignment).toEqual({ A: 'g1', B: 'g1' });
    expect(st.pending).toEqual({});
  }
  s = near.at(-1)!;
  // B à 144 px : groupés à +250 ms, séparés à +500 ms.
  expect(steps([A, B(144)], s, 2000, 2500).map((st) => st.assignment)).toEqual([
    { A: 'g1', B: 'g1' },   // 2000 : B vient de s'éloigner
    { A: 'g1', B: 'g1' },   // +250
    { A: null, B: null },   // +500
  ]);
});

test('chaîne', () => {
  // A et C sont à 128 px l'un de l'autre : trop loin pour se relier, mais B, à 64 px de chacun, les relie.
  const s = step([player('A', at(13, 7)), player('B', at(15, 7)), player('C', at(17, 7))], EMPTY_GROUPING, 0, 500);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1', C: 'g1' });
  expect(s.groups).toEqual({ g1: { id: 'g1', members: ['A', 'B', 'C'], zoneId: null } });
});

test('salle privée', () => {
  // A et B sont à 101 px l'un de l'autre, trop loin dans un espace ouvert, mais dans la même salle.
  const A = player('A', at(9, 2));
  const B = player('B', at(12, 3));
  const s = step([A, B, player('C', at(10, 6))], EMPTY_GROUPING, 0, 500);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1', C: null });
  expect(s.groups).toEqual({ g1: { id: 'g1', members: ['A', 'B'], zoneId: ROOM } });
  // Même collé à la porte, à 90 px de B, C n'entre pas dans leur conversation.
  for (const st of steps([A, B, player('C', at(10, 5))], s, 750, 1750)) expect(st.assignment).toEqual({ A: 'g1', B: 'g1', C: null });
});

test("allée à côté d'un bureau : pas de groupe ; entrer dans l'espace de bureau : groupe", () => {
  const A = player('A', at(6, 11));   // dans l'espace du bureau 1
  const C = player('C', at(7, 11));   // dans l'allée, à 32 px de A
  let s = step([A, C], EMPTY_GROUPING, 0, 1000);
  expect(s.assignment).toEqual({ A: null, C: null });
  expect(s.pending).toEqual({});
  // B entre dans l'espace du bureau 1, à 64 px de A : groupés 500 ms plus tard ; C reste seul.
  s = step([A, player('B', at(4, 11)), C], s, 1250, 1750);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1', C: null });
  expect(s.groups.g1).toEqual({ id: 'g1', members: ['A', 'B'], zoneId: zoneAt(map, A.x, A.y)!.id });
});

test('Ne pas déranger', () => {
  const dnd = player('A', at(4, 7), { status: 'dnd' });
  const B = player('B', at(6, 7));
  // Jamais groupé, ni dans un espace ouvert, ni dans la salle.
  for (const st of steps([dnd, B], EMPTY_GROUPING, 0, 1000)) {
    expect(st.assignment).toEqual({ A: null, B: null });
    expect(st.pending).toEqual({});
  }
  for (const st of steps([player('A', at(9, 2), { status: 'dnd' }), player('B', at(12, 3))], EMPTY_GROUPING, 0, 1000)) {
    expect(st.assignment).toEqual({ A: null, B: null });
  }
  // Le groupe était à deux : A passe en Ne pas déranger, et les deux sont à null dans le même appel, sans attente.
  let s = step([player('A', at(4, 7)), B], EMPTY_GROUPING, 0, 500);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1' });
  s = run([dnd, B], s, 750);
  // La mémoire garde les deux : ils retrouveraient g1 s'ils se reparlaient dans la minute.
  expect(s).toEqual({ assignment: { A: null, B: null }, groups: {}, pending: {}, nextId: 2, recent: { g1: { zoneId: null, members: { A: 750, B: 750 } } } });
  // À trois, les deux autres restent ensemble.
  const C = player('C', at(8, 7));
  s = step([player('A', at(4, 7)), B, C], EMPTY_GROUPING, 0, 500);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1', C: 'g1' });
  s = run([dnd, B, C], s, 750);
  expect(s.assignment).toEqual({ A: null, B: 'g1', C: 'g1' });
  expect(s.pending).toEqual({});
});

test('sortir de la salle privée coupe tout de suite', () => {
  const B = player('B', at(12, 3));
  let s = step([player('A', at(9, 2)), B], EMPTY_GROUPING, 0, 500);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1' });
  s = run([player('A', at(10, 6)), B], s, 750);
  expect(s.assignment.A).toBeNull();
  // B, resté seul dans la salle, est libéré dans le même appel : un groupe d'une personne vers qui personne n'est en route est
  // dissous.
  expect(s).toEqual({ assignment: { A: null, B: null }, groups: {}, pending: {}, nextId: 2, recent: { g1: { zoneId: ROOM, members: { A: 750, B: 750 } } } });
  // À trois dans la salle, ceux qui restent gardent leur groupe.
  const C = player('C', at(11, 2));
  s = step([player('A', at(9, 2)), B, C], EMPTY_GROUPING, 0, 500);
  s = run([player('A', at(10, 6)), B, C], s, 750);
  expect(s.assignment).toEqual({ A: null, B: 'g1', C: 'g1' });
  expect(s.groups).toEqual({ g1: { id: 'g1', members: ['B', 'C'], zoneId: ROOM } });
});

test('fusion : le plus grand groupe garde son id', () => {
  // {D, E} se forme d'abord (g1), puis {A, B, C} (g2) : le plus grand groupe a l'id le plus grand dans l'ordre lexicographique.
  const D = player('D', at(13, 14));
  const E = player('E', at(15, 14));
  let s = step([D, E], EMPTY_GROUPING, 0, 500);
  const abc = [player('A', at(13, 7)), player('B', at(15, 7)), player('C', at(17, 7))];
  s = step([...abc, D, E], s, 750, 1250);
  expect(s.assignment).toEqual({ A: 'g2', B: 'g2', C: 'g2', D: 'g1', E: 'g1' });
  // D et E rejoignent la ligne 7, à 64 px de C : les cinq auront l'id de {A, B, C}, après 500 ms d'attente pour D et E.
  const merged = [...abc, player('D', at(19, 7)), player('E', at(21, 7))];
  const states = steps(merged, s, 1500, 2000);
  expect(states.map((st) => st.assignment)).toEqual([
    { A: 'g2', B: 'g2', C: 'g2', D: 'g1', E: 'g1' },
    { A: 'g2', B: 'g2', C: 'g2', D: 'g1', E: 'g1' },
    { A: 'g2', B: 'g2', C: 'g2', D: 'g2', E: 'g2' },
  ]);
  expect(states.at(-1)!.groups).toEqual({ g2: { id: 'g2', members: ['A', 'B', 'C', 'D', 'E'], zoneId: null } });
});

test('séparation : la plus grande partie garde son id', () => {
  const abc = [player('A', at(13, 7)), player('B', at(15, 7)), player('C', at(17, 7))];
  const s = step([...abc, player('D', at(19, 7))], EMPTY_GROUPING, 0, 500);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1', C: 'g1', D: 'g1' });
  // D part en at(21, 14) : A, B et C gardent l'id ; D le quitte après 500 ms.
  expect(steps([...abc, player('D', at(21, 14))], s, 750, 1250).map((st) => st.assignment)).toEqual([
    { A: 'g1', B: 'g1', C: 'g1', D: 'g1' },
    { A: 'g1', B: 'g1', C: 'g1', D: 'g1' },
    { A: 'g1', B: 'g1', C: 'g1', D: null },
  ]);
});

test("id stable pendant l'attente", () => {
  const players = [player('A', at(4, 7)), player('B', at(6, 7))];
  const s0 = run(players, EMPTY_GROUPING, 0);
  const s1 = run(players, s0, 250);
  const s2 = run(players, s1, 500);
  expect(s0.pending).toEqual({ A: { target: 'g1', since: 0 }, B: { target: 'g1', since: 0 } });
  expect(s1.pending.A).toEqual(s0.pending.A);
  expect(s2.assignment.A).toBe(s0.pending.A!.target);
  expect([s0.nextId, s1.nextId, s2.nextId]).toEqual([2, 2, 2]);   // un seul id créé
});

test('joueur parti', () => {
  const A = player('A', at(4, 7));
  let s = step([A, player('B', at(6, 7))], EMPTY_GROUPING, 0, 500);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1' });
  s = run([A], s, 750);
  expect('B' in s.assignment).toBe(false);
  expect(s).toEqual({ assignment: { A: null }, groups: {}, pending: {}, nextId: 2, recent: { g1: { zoneId: null, members: { A: 750, B: 750 } } } });
});

test('seul dans une zone : pas de groupe', () => {
  for (const st of steps([player('A', at(9, 2))], EMPTY_GROUPING, 0, 1000)) {
    expect(st).toEqual({ assignment: { A: null }, groups: {}, pending: {}, nextId: 1 });
  }
});

test('busyZoneIds', () => {
  const room = [player('A', at(9, 2)), player('B', at(12, 3))];
  const s0 = run(room, EMPTY_GROUPING, 0);
  expect(busyZoneIds(s0)).toEqual(new Set());   // en attente : pas encore de groupe
  const s = step(room, s0, 250, 500);
  expect(busyZoneIds(s)).toEqual(new Set([ROOM]));
  // Un groupe dans un espace ouvert n'occupe aucune zone ; un groupe de zone réduit à un membre ne l'occupe pas.
  const state: GroupingState = {
    assignment: { A: 'g1', B: 'g2', C: 'g2', D: 'g3', E: 'g3', F: null },
    groups: {
      g1: { id: 'g1', members: ['A'], zoneId: '3' },
      g2: { id: 'g2', members: ['B', 'C'], zoneId: '2' },
      g3: { id: 'g3', members: ['D', 'E'], zoneId: null },
    },
    pending: { F: { target: 'g1', since: 0 } },
    nextId: 4,
  };
  expect(busyZoneIds(state)).toEqual(new Set(['2']));
});

// ---- Les règles de l'algorithme, une à une ----------------------------------------------------------------------------------

test("EMPTY_GROUPING : l'état de départ, figé", () => {
  expect(EMPTY_GROUPING).toEqual({ assignment: {}, groups: {}, pending: {}, nextId: 1 });
  expect([EMPTY_GROUPING, EMPTY_GROUPING.assignment, EMPTY_GROUPING.groups, EMPTY_GROUPING.pending].every(Object.isFrozen)).toBe(true);
});

test("distances : entrée à moins de 3 cases, sortie au-delà de 4, à vol d'oiseau", () => {
  expect(JOIN_DISTANCE_PX).toBe(96);
  expect(LEAVE_DISTANCE_PX).toBe(128);
  const A = player('A', at(2, 6));   // (80, 208), dans le couloir
  const B = (dx: number, dy = 0) => player('B', { x: A.x + dx, y: A.y + dy });
  const together = (s: GroupingState) => s.assignment.A !== null && s.assignment.A === s.assignment.B;
  expect(steps([A, B(96)], EMPTY_GROUPING, 0, 1000).some(together)).toBe(false);
  expect(together(step([A, B(95)], EMPTY_GROUPING, 0, 500))).toBe(true);
  // En diagonale : 84,9 px forment un groupe, 99 px non (ni distance de Manhattan, ni plus grand des deux écarts).
  expect(together(step([A, B(60, 60)], EMPTY_GROUPING, 0, 500))).toBe(true);
  expect(steps([A, B(70, 70)], EMPTY_GROUPING, 0, 1000).some(together)).toBe(false);
  // Ensemble : on reste à 128 px, on part à 129 px.
  const atLimit = steps([A, B(128)], step([A, B(95)], EMPTY_GROUPING, 0, 500), 750, 1750);
  expect(atLimit.every(together)).toBe(true);
  expect(steps([A, B(129)], atLimit.at(-1)!, 2000, 2500).map(together)).toEqual([true, true, false]);
});

test("se remettre en marche pendant l'attente annule l'attente", () => {
  const A = player('A', at(4, 7));
  const B = player('B', at(6, 7));
  let s = run([A, B], EMPTY_GROUPING, 0);
  expect(s.pending.A).toEqual({ target: 'g1', since: 0 });
  s = run([player('A', at(4, 7), { moving: true }), B], s, 250);
  expect(s.pending).toEqual({});
  // Arrêtée de nouveau à 500 ms, A attend 500 ms de plus : groupée à 1000 ms, pas avant. L'attente annulée ne laisse pas de cible,
  // la grappe reçoit donc un nouvel id.
  expect(steps([A, B], s, 500, 1000).map((st) => st.assignment.A)).toEqual([null, null, 'g2']);
});

test('marcher dans son groupe, à 4 cases au plus, ne le quitte pas', () => {
  let s = step([player('A', at(4, 7)), player('B', at(6, 7))], EMPTY_GROUPING, 0, 500);
  for (const [t, dx] of [[750, 100], [1000, 128], [1250, 90], [1500, 30]] as const) {
    s = run([player('A', at(4, 7)), player('B', { x: at(4, 7).x + dx, y: 240 }, { moving: true })], s, t);
    expect(s.assignment).toEqual({ A: 'g1', B: 'g1' });
    expect(s.pending).toEqual({});
  }
});

test("séparation en deux groupes : la plus grande partie garde l'id, à égalité celle qui a le plus petit id de membre", () => {
  // A et B quittent une chaîne de cinq : {C, D, E} garde g1, {A, B} reçoit g2, après 500 ms.
  const row7 = (id: string, tx: number) => player(id, at(tx, 7));
  let s = step([row7('A', 13), row7('B', 15), row7('C', 17), row7('D', 19), row7('E', 21)], EMPTY_GROUPING, 0, 500);
  const leaving = [player('A', at(13, 14)), player('B', at(15, 14))];
  s = step([...leaving, row7('C', 17), row7('D', 19), row7('E', 21)], s, 750, 1250);
  expect(s.assignment).toEqual({ A: 'g2', B: 'g2', C: 'g1', D: 'g1', E: 'g1' });
  // Une chaîne de quatre coupée en deux moitiés : celle de A garde g1, même si c'est elle qui part.
  s = step([row7('A', 13), row7('B', 15), row7('C', 17), row7('D', 19)], EMPTY_GROUPING, 0, 500);
  s = step([...leaving, row7('C', 17), row7('D', 19)], s, 750, 1250);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1', C: 'g2', D: 'g2' });
});

test("fusion à égalité : l'id le plus petit dans l'ordre lexicographique", () => {
  // {C, D} se forme d'abord (g1), puis {A, B} (g2) ; C et D rejoignent A et B : les quatre auront g1.
  let s = step([player('C', at(13, 14)), player('D', at(15, 14))], EMPTY_GROUPING, 0, 500);
  const ab = [player('A', at(13, 7)), player('B', at(15, 7))];
  s = step([...ab, player('C', at(13, 14)), player('D', at(15, 14))], s, 750, 1250);
  expect(s.assignment).toEqual({ A: 'g2', B: 'g2', C: 'g1', D: 'g1' });
  s = step([...ab, player('C', at(17, 7)), player('D', at(19, 7))], s, 1500, 2000);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1', C: 'g1', D: 'g1' });
});

test("un groupe réduit à une personne reste ouvert si quelqu'un est en route vers lui", () => {
  const B = player('B', at(6, 7));
  let s = step([player('A', at(4, 7)), B], EMPTY_GROUPING, 0, 500);
  // C s'arrête à 64 px de B à 750 ms : il attend de rejoindre g1.
  const C = player('C', at(8, 7));
  s = run([player('A', at(4, 7)), B, C], s, 750);
  expect(s.pending).toEqual({ C: { target: 'g1', since: 750 } });
  // A passe en Ne pas déranger : B reste seul dans g1, que C est en route pour rejoindre ; B n'a pas à changer de room.
  s = run([player('A', at(4, 7), { status: 'dnd' }), B, C], s, 1000);
  expect(s.assignment).toEqual({ A: null, B: 'g1', C: null });
  expect(s.groups).toEqual({ g1: { id: 'g1', members: ['B'], zoneId: null } });
  expect(s.pending).toEqual({ C: { target: 'g1', since: 750 } });
  s = run([player('A', at(4, 7), { status: 'dnd' }), B, C], s, 1250);
  expect(s.assignment).toEqual({ A: null, B: 'g1', C: 'g1' });
});

test("entrer dans la salle où un groupe parle : l'attente est courte (ZONE_JOIN_DEBOUNCE_MS), celle des espaces ouverts reste de 500 ms", () => {
  const room = [player('A', at(9, 2)), player('B', at(12, 3))];
  const s = step(room, EMPTY_GROUPING, 0, 500);
  // Arrivé à 750 ms, C attend ; au pas suivant (250 ms plus tard, plus que ZONE_JOIN_DEBOUNCE_MS), il est dans le groupe de la salle.
  const states = steps([...room, player('C', at(10, 4))], s, 750, 1250);
  expect(states.map((st) => st.assignment.C)).toEqual([null, 'g1', 'g1']);
  expect(states[0]!.pending).toEqual({ C: { target: 'g1', since: 750 } });
});

test("rejoindre une zone attend moins de 500 ms, mais pas zéro : quelqu'un qui en effleure le bord et ressort n'y entre pas", () => {
  expect(ZONE_JOIN_DEBOUNCE_MS).toBeGreaterThan(0);
  expect(ZONE_JOIN_DEBOUNCE_MS).toBeLessThan(GROUP_DEBOUNCE_MS);
  const room = [player('A', at(9, 2)), player('B', at(12, 3))];
  const s = step(room, EMPTY_GROUPING, 0, 500);
  // C entre à 750 ms et ressort à 800 ms, avant la fin de l'attente : il n'a jamais été dans le groupe.
  let t = run([...room, player('C', at(10, 4))], s, 750);
  t = computeGroups([...room, player('C', at(10, 6))], map, t, 800);
  t = computeGroups([...room, player('C', at(10, 6))], map, t, 1000);
  expect(t.assignment.C).toBeNull();
});

test('sortir de la salle à deux : coupés tout de suite, ensemble dans le couloir 500 ms plus tard, dans un nouveau groupe', () => {
  const s = step([player('A', at(9, 2)), player('B', at(12, 3))], EMPTY_GROUPING, 0, 500);
  expect(s.groups.g1?.zoneId).toBe(ROOM);
  // A et B sortent ensemble et s'arrêtent dans le couloir, à 64 px l'un de l'autre. L'id du groupe de la salle ne sort pas de la
  // salle : leur grappe du couloir reçoit g2, qu'ils rejoignent avec le délai habituel.
  const states = steps([player('A', at(9, 7)), player('B', at(11, 7))], s, 750, 1250);
  expect(states[0]).toEqual({
    assignment: { A: null, B: null },
    groups: {},
    pending: { A: { target: 'g2', since: 750 }, B: { target: 'g2', since: 750 } },
    nextId: 3,
    // L'id du groupe de la salle reste dans la mémoire, mais ne sort pas de la salle : le couloir ne le reprend pas.
    recent: { g1: { zoneId: ROOM, members: { A: 750, B: 750 } } },
  });
  expect(states.map((st) => st.assignment.A)).toEqual([null, null, 'g2']);
  expect(states.at(-1)!.groups).toEqual({ g2: { id: 'g2', members: ['A', 'B'], zoneId: null } });
  expect(busyZoneIds(states.at(-1)!)).toEqual(new Set());
});

// ---- Décisions du contrôleur, après la première version ---------------------------------------------------------------------

test("une cible en attente ne reprend pas l'id d'un groupe qui existe : ceux qui n'ont pas bougé gardent leur room", () => {
  const A = player('A', at(2, 7));
  const B = player('B', at(4, 7));
  let s = step([A, B], EMPTY_GROUPING, 0, 500);
  // C s'arrête à 64 px de B : il attend de rejoindre g1. D et E marchent, loin de là.
  s = run([A, B, player('C', at(6, 7)), player('D', at(12, 14), { moving: true }), player('E', at(14, 14), { moving: true })], s, 750);
  expect(s.pending).toEqual({ C: { target: 'g1', since: 750 } });
  // Moins de 500 ms plus tard, C s'arrête près de D et E, qui s'arrêtent aussi. {C, D, E}, la plus grande grappe, ne reprend pas
  // g1 par la cible de C : A et B le prennent dès la première passe, par leurs deux voix d'id actuel, et une cible en attente ne
  // prend jamais un groupe qui existe. {C, D, E} reçoit g2 ; A et B ne changent de rien, et C n'entre jamais dans g1.
  const states = steps([A, B, player('C', at(13, 13)), player('D', at(12, 14)), player('E', at(14, 14))], s, 1000, 1500);
  expect(states.map((st) => st.assignment)).toEqual([
    { A: 'g1', B: 'g1', C: null, D: null, E: null },
    { A: 'g1', B: 'g1', C: null, D: null, E: null },
    { A: 'g1', B: 'g1', C: 'g2', D: 'g2', E: 'g2' },
  ]);
  for (const st of states) expect('A' in st.pending || 'B' in st.pending).toBe(false);
  expect(states.at(-1)!.groups).toEqual({
    g1: { id: 'g1', members: ['A', 'B'], zoneId: null },
    g2: { id: 'g2', members: ['C', 'D', 'E'], zoneId: null },
  });
});

test("une cible en attente ne suit pas un groupe qui existe quand ses membres s'en vont : ceux qui attendaient en forment un nouveau", () => {
  let s = step([player('A', at(2, 7)), player('B', at(4, 7))], EMPTY_GROUPING, 0, 500);   // g1 = {A, B}
  // C et D s'arrêtent près de B à 750 ms : ils attendent g1.
  const C = player('C', at(6, 7));
  const D = player('D', at(6, 8));
  s = run([player('A', at(2, 7)), player('B', at(4, 7)), C, D], s, 750);
  expect(s.pending).toEqual({ C: { target: 'g1', since: 750 }, D: { target: 'g1', since: 750 } });
  // A et B s'éloignent l'un de l'autre à 1000 ms : chacun seul, ils attendent de quitter g1. {C, D} ne reprend pas g1, qui existe
  // encore : g2, qu'ils attendent depuis 1000 ms. Sans cela, ils entreraient dans g1 à 1250 ms, avec A et B déjà loin.
  const states = steps([player('A', at(2, 13)), player('B', at(20, 13)), C, D], s, 1000, 1500);
  expect(states.map((st) => st.assignment)).toEqual([
    { A: 'g1', B: 'g1', C: null, D: null },
    { A: 'g1', B: 'g1', C: null, D: null },
    { A: null, B: null, C: 'g2', D: 'g2' },
  ]);
});

test("sortir de la salle et s'arrêter près de quelqu'un : hors du groupe de la salle dans le même appel, dans le nouveau groupe 500 ms plus tard", () => {
  const room = [player('B', at(12, 3)), player('D', at(11, 2))];
  const C = player('C', at(10, 7));   // dans le couloir, seul
  const s = step([player('A', at(9, 2)), ...room, C], EMPTY_GROUPING, 0, 500);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1', C: null, D: 'g1' });
  // A sort et s'arrête à 32 px de C. Leur grappe passe avant celle de la salle ({A, C} contre {B, D} : A < B), mais ne reprend pas
  // g1, l'id d'un groupe de la salle.
  const states = steps([player('A', at(10, 6)), ...room, C], s, 750, 1250);
  expect(states.map((st) => st.assignment)).toEqual([
    { A: null, B: 'g1', C: null, D: 'g1' },   // 750 : A n'est plus dans le groupe de la salle
    { A: null, B: 'g1', C: null, D: 'g1' },
    { A: 'g2', B: 'g1', C: 'g2', D: 'g1' },   // 1250 : A et C ensemble, dans un nouveau groupe
  ]);
  expect(states[0]!.pending).toEqual({ A: { target: 'g2', since: 750 }, C: { target: 'g2', since: 750 } });
  expect(states.at(-1)!.groups).toEqual({
    g1: { id: 'g1', members: ['B', 'D'], zoneId: ROOM },
    g2: { id: 'g2', members: ['A', 'C'], zoneId: null },
  });
});

test("un groupe du couloir dont deux membres entrent dans la salle : celui qui reste dehors en sort dans le même appel", () => {
  const C = player('C', at(10, 6));
  let s = step([player('A', at(9, 6)), player('B', at(11, 6)), C], EMPTY_GROUPING, 0, 500);
  expect(s.groups).toEqual({ g1: { id: 'g1', members: ['A', 'B', 'C'], zoneId: null } });
  // A et B entrent dans la salle : leur grappe de la salle reprend g1, qui devient le groupe de la salle dans ce même appel.
  s = run([player('A', at(9, 4)), player('B', at(11, 4)), C], s, 750);
  expect(s).toEqual({
    assignment: { A: 'g1', B: 'g1', C: null },
    groups: { g1: { id: 'g1', members: ['A', 'B'], zoneId: ROOM } },
    pending: {},
    nextId: 2,
    recent: { g1: { zoneId: ROOM, members: { C: 750 } } },
  });
});

// ---- Revue, tour 1 : un id va à la grappe qui compte le plus de ses membres -------------------------------------------------

// Toutes les façons d'ordonner la liste.
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

test("un membre du groupe du couloir entre dans la salle : ceux qui restent gardent l'id, lui rejoint la salle après ZONE_JOIN_DEBOUNCE_MS", () => {
  // g1 = {B, C, D} dans le couloir ; A est seul dans la salle.
  const A = player('A', at(12, 3));
  const C = player('C', at(12, 6));
  const D = player('D', at(14, 6));
  const s = step([A, player('B', at(10, 6)), C, D], EMPTY_GROUPING, 0, 500);
  expect(s.assignment).toEqual({ A: null, B: 'g1', C: 'g1', D: 'g1' });
  // B entre dans la salle. {A, B} et {C, D} ont la même taille et A < C, mais g1 a deux voix chez {C, D}, une seule chez {A, B} :
  // C et D, qui n'ont pas bougé, gardent g1 ; B attend ZONE_JOIN_DEBOUNCE_MS le groupe de la salle, g2.
  const states = steps([A, player('B', at(10, 4)), C, D], s, 750, 1250);
  expect(states.map((st) => st.assignment)).toEqual([
    { A: null, B: 'g1', C: 'g1', D: 'g1' },
    { A: 'g2', B: 'g2', C: 'g1', D: 'g1' },
    { A: 'g2', B: 'g2', C: 'g1', D: 'g1' },
  ]);
  expect(states.at(-1)!.groups).toEqual({
    g1: { id: 'g1', members: ['C', 'D'], zoneId: null },
    g2: { id: 'g2', members: ['A', 'B'], zoneId: ROOM },
  });
});

test("même scène, quel que soit l'ordre des ids : les 24 façons de nommer les quatre personnes", () => {
  for (const [inRoom, mover, stay1, stay2] of permutations(['A', 'B', 'C', 'D'])) {
    const still = [player(inRoom, at(12, 3)), player(stay1, at(12, 6)), player(stay2, at(14, 6))];
    const s = step([...still, player(mover, at(10, 6))], EMPTY_GROUPING, 0, 500);
    const states = steps([...still, player(mover, at(10, 4))], s, 750, 1250);
    const roles = (st: GroupingState) => [st.assignment[inRoom], st.assignment[mover], st.assignment[stay1], st.assignment[stay2]];
    expect(states.map(roles), `${inRoom} dans la salle, ${mover} y entre, ${stay1} et ${stay2} restent`).toEqual([
      [null, 'g1', 'g1', 'g1'],
      ['g2', 'g2', 'g1', 'g1'],
      ['g2', 'g2', 'g1', 'g1'],
    ]);
  }
});

test("une grappe plus grande ne prend pas l'id d'un groupe sur une seule voix ; l'attente de ses membres continue", () => {
  const C = player('C', at(12, 6));
  const D = player('D', at(14, 6));
  let s = step([player('B', at(10, 6)), C, D], EMPTY_GROUPING, 0, 500);   // g1 = {B, C, D} dans le couloir
  // A et E arrivent dans la salle à 750 ms : ils attendent un nouveau groupe, g2.
  const A = player('A', at(12, 3));
  const E = player('E', at(9, 2));
  s = run([A, player('B', at(10, 6)), C, D, E], s, 750);
  expect(s.pending).toEqual({ A: { target: 'g2', since: 750 }, E: { target: 'g2', since: 750 } });
  // B entre dans la salle à 1000 ms. {A, B, E} (3) est plus grande que {C, D} (2), mais g1 n'y a qu'une voix, contre deux : C et D
  // gardent g1, et {A, B, E} reprend g2, la cible de A et E, dont l'attente continue.
  const states = steps([A, player('B', at(10, 4)), C, D, E], s, 1000, 1500);
  expect(states.map((st) => st.assignment)).toEqual([
    { A: 'g2', B: 'g1', C: 'g1', D: 'g1', E: 'g2' },   // 1000 : A et E attendent g2 depuis 250 ms (plus que ZONE_JOIN_DEBOUNCE_MS)
    { A: 'g2', B: 'g2', C: 'g1', D: 'g1', E: 'g2' },   // 1250 : B, entré à 1000 ms, y est aussi
    { A: 'g2', B: 'g2', C: 'g1', D: 'g1', E: 'g2' },
  ]);
});

test("à voix égales, la plus grande grappe garde l'id, même si l'autre a le plus petit id de membre", () => {
  const row7 = (id: string, tx: number) => player(id, at(tx, 7));
  const s = step([row7('A', 13), row7('B', 15), row7('C', 17), row7('D', 19)], EMPTY_GROUPING, 0, 500);   // g1 = {A, B, C, D}
  // A et B partent ensemble ligne 14 ; E s'arrête près de D. g1 a deux voix chez {C, D, E} comme chez {A, B} : {C, D, E}, plus
  // grande, le garde ; {A, B} reçoit g2.
  const states = steps([player('A', at(13, 14)), player('B', at(15, 14)), row7('C', 17), row7('D', 19), row7('E', 21)], s, 750, 1250);
  expect(states.at(-1)!.assignment).toEqual({ A: 'g2', B: 'g2', C: 'g1', D: 'g1', E: 'g1' });
});

test("une cible en attente se prend aussi aux voix : ceux qui l'attendent le plus nombreux gardent leur attente", () => {
  // A, B et D s'arrêtent en ligne à 0 ms : ils attendent g1. C est seul, loin.
  const B = player('B', at(6, 7));
  const D = player('D', at(8, 7));
  const C = player('C', at(2, 14));
  const s = run([player('A', at(4, 7)), B, C, D], EMPTY_GROUPING, 0);
  expect(s.pending).toEqual({ A: { target: 'g1', since: 0 }, B: { target: 'g1', since: 0 }, D: { target: 'g1', since: 0 } });
  // À 250 ms, A s'arrête près de C. {A, C} et {B, D} ont la même taille et A < B, mais g1 a deux voix chez {B, D}, une chez {A, C} :
  // B et D, qui n'ont pas bougé, gardent leur attente et sont groupés à 500 ms ; {A, C} reçoit g2.
  const states = steps([player('A', at(4, 14)), B, C, D], s, 250, 750);
  expect(states[0]!.pending).toEqual({
    A: { target: 'g2', since: 250 },
    B: { target: 'g1', since: 0 },
    C: { target: 'g2', since: 250 },
    D: { target: 'g1', since: 0 },
  });
  expect(states.map((st) => st.assignment)).toEqual([
    { A: null, B: null, C: null, D: null },
    { A: null, B: 'g1', C: null, D: 'g1' },
    { A: 'g2', B: 'g1', C: 'g2', D: 'g1' },
  ]);
});

// ---- Revue, tour 2 : à voix égales, la grappe qui garde la zone du groupe -----------------------------------------------------

test("à voix égales, la grappe qui garde la zone du groupe l'emporte : deux des quatre du couloir entrent dans la salle vide, les deux autres gardent g1 (24 façons de les nommer)", () => {
  // g1 = quatre personnes en ligne dans le couloir. Les deux de gauche entrent dans la salle vide ; les deux de droite, qui n'ont pas
  // bougé, gardent g1 (2 voix contre 2, mais g1 reste un groupe d'espace ouvert chez elles) ; les deux de la salle forment g2 dès
  // ZONE_JOIN_DEBOUNCE_MS.
  const failures: string[] = [];
  for (const [in1, in2, stay1, stay2] of permutations(['A', 'B', 'C', 'D'])) {
    const stay = [player(stay1, at(13, 6)), player(stay2, at(15, 6))];
    const s = step([player(in1, at(9, 6)), player(in2, at(11, 6)), ...stay], EMPTY_GROUPING, 0, 500);
    const states = steps([player(in1, at(9, 4)), player(in2, at(11, 4)), ...stay], s, 750, 1250);
    const roles = (st: GroupingState) => [st.assignment[in1], st.assignment[in2], st.assignment[stay1], st.assignment[stay2]];
    const got = JSON.stringify([...[s, ...states].map(roles), [states.at(-1)!.groups.g1?.zoneId, states.at(-1)!.groups.g2?.zoneId]]);
    const expected = JSON.stringify([
      ['g1', 'g1', 'g1', 'g1'],   // 500 : g1 formé
      ['g1', 'g1', 'g1', 'g1'],   // 750 : les deux entrent dans la salle, et attendent g2
      ['g2', 'g2', 'g1', 'g1'],   // 1000 : plus de ZONE_JOIN_DEBOUNCE_MS d'attente
      ['g2', 'g2', 'g1', 'g1'],   // 1250
      [null, ROOM],
    ]);
    if (got !== expected) failures.push(`${in1} et ${in2} entrent, ${stay1} et ${stay2} restent : ${got}`);
  }
  expect(failures).toEqual([]);
});

test("à voix égales, garder la zone du groupe passe avant la taille : la grappe de la salle, plus grande, ne prend pas g1", () => {
  const stay = [player('C', at(13, 6)), player('D', at(15, 6))];
  const X = player('X', at(12, 2));   // seul dans la salle
  const s = step([player('A', at(9, 6)), player('B', at(11, 6)), ...stay, X], EMPTY_GROUPING, 0, 500);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1', C: 'g1', D: 'g1', X: null });
  // A et B entrent dans la salle : {A, B, X} (3) et {C, D} (2) ont deux voix chacune pour g1 ; {C, D} garde la zone de g1 (un espace
  // ouvert) et l'emporte malgré sa taille. A, B et X forment g2 dès ZONE_JOIN_DEBOUNCE_MS.
  const states = steps([player('A', at(9, 4)), player('B', at(11, 4)), ...stay, X], s, 750, 1250);
  expect(states.map((st) => st.assignment)).toEqual([
    { A: 'g1', B: 'g1', C: 'g1', D: 'g1', X: null },
    { A: 'g2', B: 'g2', C: 'g1', D: 'g1', X: 'g2' },
    { A: 'g2', B: 'g2', C: 'g1', D: 'g1', X: 'g2' },
  ]);
});

// ---- La mémoire des groupes : les mêmes gens retrouvent leur room (octobre 2026) ---------------------------------------------------

test("deux qui se séparent puis se retrouvent dans la minute : l'id de leur groupe défait (sa room, où ils sont parqués), après REJOIN_DEBOUNCE_MS", () => {
  const A = player('A', at(4, 7));
  let s = step([A, player('B', at(6, 7))], EMPTY_GROUPING, 0, 500);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1' });
  // B s'éloigne : le groupe se défait 500 ms plus tard, et la mémoire garde les deux.
  s = step([A, player('B', at(14, 7))], s, 750, 1250);
  expect(s.groups).toEqual({});
  expect(s.recent).toEqual({ g1: { zoneId: null, members: { A: 1250, B: 1250 } } });
  // B revient 4 s plus tard : leur grappe reprend g1, et l'attente n'est que de REJOIN_DEBOUNCE_MS (le pas suivant, 250 ms plus tard).
  expect(REJOIN_DEBOUNCE_MS).toBeLessThan(TICK_MS);
  const states = steps([A, player('B', at(6, 7))], s, 5000, 5250);
  expect(states[0]!.pending).toEqual({ A: { target: 'g1', since: 5000 }, B: { target: 'g1', since: 5000 } });
  expect(states[1]!.assignment).toEqual({ A: 'g1', B: 'g1' });
  expect(states[1]!.nextId).toBe(2);   // aucun id neuf
  // De retour dans le groupe, ils ne sont plus dans sa mémoire.
  expect(states[1]!.recent).toBeUndefined();
});

test('au-delà de GROUP_MEMORY_MS, la mémoire a oublié : un id neuf, et 500 ms', () => {
  const A = player('A', at(4, 7));
  let s = step([A, player('B', at(6, 7))], EMPTY_GROUPING, 0, 500);
  s = step([A, player('B', at(14, 7))], s, 750, 1250);
  const back = 1250 + GROUP_MEMORY_MS;
  const states = steps([A, player('B', at(6, 7))], s, back, back + 500);
  expect(states[0]!.recent).toBeUndefined();
  expect(states[0]!.pending).toEqual({ A: { target: 'g2', since: back }, B: { target: 'g2', since: back } });
  expect(states.map((st) => st.assignment.A)).toEqual([null, null, 'g2']);
});

test("un seul ancien membre ne reprend pas l'id : il en faut deux du groupe défait", () => {
  const A = player('A', at(4, 7));
  let s = step([A, player('B', at(6, 7))], EMPTY_GROUPING, 0, 500);
  s = step([A, player('B', at(14, 14))], s, 750, 1250);
  // C s'arrête près de A : un id neuf, après 500 ms (C n'a jamais été de g1 ; A, si, mais seul il ne suffit pas).
  const states = steps([A, player('B', at(14, 14)), player('C', at(6, 7))], s, 2000, 2500);
  expect(states.map((st) => st.assignment)).toEqual([
    { A: null, B: null, C: null },
    { A: null, B: null, C: null },
    { A: 'g2', B: null, C: 'g2' },
  ]);
});

test("revenir dans un groupe qui continue sans soi : REJOIN_DEBOUNCE_MS ; un nouveau venu, lui, attend 500 ms", () => {
  const row7 = (id: string, tx: number) => player(id, at(tx, 7));
  let s = step([row7('A', 4), row7('B', 6), row7('C', 8)], EMPTY_GROUPING, 0, 500);   // g1 = {A, B, C}
  s = step([row7('A', 16), row7('B', 6), row7('C', 8)], s, 750, 1250);
  expect(s.assignment).toEqual({ A: null, B: 'g1', C: 'g1' });
  expect(s.recent).toEqual({ g1: { zoneId: null, members: { A: 1250 } } });
  // A revient, et D arrive en même temps de l'autre côté : A est dans g1 au pas suivant, D 500 ms après son arrivée.
  const states = steps([row7('A', 4), row7('B', 6), row7('C', 8), row7('D', 10)], s, 2000, 2500);
  expect(states.map((st) => [st.assignment.A, st.assignment.D])).toEqual([
    [null, null],
    ['g1', null],
    ['g1', 'g1'],
  ]);
});

test("revenir à deux dans la salle qu'on a quittée : l'id du groupe de la salle, qui n'en était pas sorti", () => {
  let s = step([player('A', at(9, 2)), player('B', at(12, 3))], EMPTY_GROUPING, 0, 500);
  s = step([player('A', at(4, 13)), player('B', at(14, 13))], s, 750, 1000);   // chacun de son côté, loin l'un de l'autre
  expect(s.recent).toEqual({ g1: { zoneId: ROOM, members: { A: 750, B: 750 } } });
  const states = steps([player('A', at(9, 2)), player('B', at(12, 3))], s, 3000, 3250);
  expect(states[0]!.pending).toEqual({ A: { target: 'g1', since: 3000 }, B: { target: 'g1', since: 3000 } });
  expect(states[1]!.groups).toEqual({ g1: { id: 'g1', members: ['A', 'B'], zoneId: ROOM } });
});

test("la mémoire ne prend pas l'id d'un groupe qui existe : partis de g1 puis séparés, C et D se retrouvent dans g2, pas dans g1 où A et B sont restés", () => {
  const row7 = (id: string, tx: number) => player(id, at(tx, 7));
  let s = step([row7('A', 4), row7('B', 6), row7('C', 8), row7('D', 10)], EMPTY_GROUPING, 0, 500);   // g1 = {A, B, C, D}
  // C et D partent ensemble ligne 14 : ils forment g2 (et la mémoire de g1 les garde).
  s = step([row7('A', 4), row7('B', 6), player('C', at(12, 14)), player('D', at(14, 14))], s, 750, 1250);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1', C: 'g2', D: 'g2' });
  // Puis ils se séparent : g2 se défait.
  s = step([row7('A', 4), row7('B', 6), player('C', at(2, 14)), player('D', at(20, 14))], s, 1500, 2000);
  expect(s.assignment).toEqual({ A: 'g1', B: 'g1', C: null, D: null });
  expect(s.recent).toEqual({ g1: { zoneId: null, members: { C: 1250, D: 1250 } }, g2: { zoneId: null, members: { C: 2000, D: 2000 } } });
  // Ils se retrouvent loin de A et B : g2 (défait), et non g1 (qui existe).
  const back = step([row7('A', 4), row7('B', 6), player('C', at(12, 14)), player('D', at(14, 14))], s, 3000, 3250);
  expect(back.assignment).toEqual({ A: 'g1', B: 'g1', C: 'g2', D: 'g2' });
});

// ---- Propriétés, sur des marches au hasard ----------------------------------------------------------------------------------

const ISOLATING_ZONES = new Set(map.zones.filter((z) => z.type === 'private' || z.type === 'desk').map((z) => z.id));
const zoneOf = (p: ProximityPlayer) => zoneAt(map, p.x, p.y)?.id ?? null;
const distance = (a: ProximityPlayer, b: ProximityPlayer) => Math.hypot(a.x - b.x, a.y - b.y);

// Un générateur pseudo-aléatoire à graine (mulberry32) : les mêmes marches à chaque exécution.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

interface Frame { players: ProximityPlayer[]; now: number }

// Des points de rendez-vous : deux dans la salle de réunion, un devant sa porte, deux dans le couloir, un dans l'espace du
// bureau 1 et un dans l'allée voisine.
const SPOTS = [at(10, 2), at(12, 3), at(10, 6), at(6, 7), at(13, 7), at(4, 11), at(7, 11)];

// Huit personnes vont de point de rendez-vous en point de rendez-vous (à 1,5 case près, au hasard), seules ou à deux, en pixels
// entiers comme les `move` : elles marchent à 160 px/s (40 px par appel), puis s'arrêtent de 0,5 à 6 s, en piétinant parfois (un
// pas de quelques pixels, en marche) ou « en marche » sur place (une touche appuyée contre un mur). De temps en temps, quelqu'un
// est téléporté, change de statut, part ou revient. Les murs ne comptent pas : le calcul ne les regarde pas. Les appels sont
// espacés de 200 à 300 ms ; la liste des joueurs arrive dans le désordre.
function randomWalk(seed: number, count: number): Frame[] {
  const random = mulberry32(seed);
  const between = (lo: number, hi: number) => Math.round(lo + random() * (hi - lo));
  const nearSpot = (): Pos => {
    const spot = SPOTS[Math.floor(random() * SPOTS.length)]!;
    return { x: spot.x + between(-48, 48), y: spot.y + between(-48, 48) };
  };
  const people = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((id) => ({
    id,
    ...nearSpot(),
    moving: false,
    status: 'available' as Status,
    present: true,
    target: null as Pos | null,
    wait: between(0, 24),   // appels à rester arrêté
  }));
  const frames: Frame[] = [];
  let now = 0;
  for (let k = 0; k < count; k++) {
    for (const p of people) {
      // Absent ou en Ne pas déranger environ une fois sur dix, quelques secondes de suite.
      if (random() < (p.present ? 0.005 : 0.05)) p.present = !p.present;
      if (random() < (p.status === 'dnd' ? 0.05 : 0.005)) p.status = p.status === 'dnd' ? (random() < 0.5 ? 'available' : 'busy') : 'dnd';
      if (random() < 0.02) {
        Object.assign(p, nearSpot(), { target: null, wait: between(2, 24), moving: false });
        continue;
      }
      if (p.wait > 0) {
        p.wait--;
        const r = random();
        if (r < 0.15) Object.assign(p, { x: p.x + between(-8, 8), y: p.y + between(-8, 8), moving: true });
        else p.moving = r < 0.22;
        continue;
      }
      if (p.target === null) {
        p.target = nearSpot();
        // Une fois sur deux, quelqu'un d'arrêté à 4 cases au plus part avec elle, côte à côte : un groupe qui se déplace, pour
        // en rejoindre un autre ou quitter le sien.
        const buddy = people.find((q) => q !== p && q.present && q.target === null && Math.hypot(q.x - p.x, q.y - p.y) <= LEAVE_DISTANCE_PX);
        if (buddy !== undefined && random() < 0.5) {
          Object.assign(buddy, { target: { x: p.target.x + buddy.x - p.x, y: p.target.y + buddy.y - p.y }, wait: 0 });
        }
      }
      const dx = p.target.x - p.x;
      const dy = p.target.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d <= 40) Object.assign(p, p.target, { target: null, wait: between(2, 24), moving: random() < 0.2 });
      else Object.assign(p, { x: Math.round(p.x + (dx / d) * 40), y: Math.round(p.y + (dy / d) * 40), moving: true });
    }
    const players = people.filter((p) => p.present).map(({ id, x, y, moving, status }) => ({ id, x, y, moving, status }));
    frames.push({ players: shuffled(players, random), now });
    now += between(200, 300);
  }
  return frames;
}

// Les groupes de prev dont aucun membre n'a bougé (position, marche), changé de statut ni quitté le bureau depuis l'appel précédent
// (previous : ses joueurs). Deux conditions de plus, sans lesquelles des changements voulus défont le groupe : au moins deux membres
// (un groupe d'un membre n'existe que tant que quelqu'un est en route vers lui, et se dissout s'il fait demi-tour), et aucun
// changement déjà en cours chez ses membres (une attente commencée plus tôt aboutit même si tout le monde reste immobile : c'est ainsi
// que D et E rejoignent g2 dans la fusion).
function unchangedGroups(prev: GroupingState, players: ProximityPlayer[], previous: ProximityPlayer[]): string[] {
  const now = new Map(players.map((p) => [p.id, p]));
  const was = new Map(previous.map((p) => [p.id, p]));
  const unchanged = (id: string) => {
    const a = was.get(id);
    const b = now.get(id);
    return a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.moving === b.moving && a.status === b.status;
  };
  return Object.values(prev.groups)
    .filter((g) => g.members.length >= 2 && g.members.every((m) => unchanged(m) && !Object.hasOwn(prev.pending, m)))
    .map((g) => g.id);
}

// Les membres du groupe sont reliés entre eux, sans personne d'autre : un groupe de zone (tous dans sa zone), ou, dans un espace
// ouvert, tous hors des zones et reliés de proche en proche à 4 cases au plus. Sinon, un tiers les tenait peut-être ensemble (quelqu'un
// en route vers eux, qui s'en va) et leur séparation est voulue.
function linkedAmongThemselves(g: GroupingState['groups'][string], players: ProximityPlayer[]): boolean {
  if (g.zoneId !== null) return true;
  const members = players.filter((p) => g.members.includes(p.id));
  if (members.length !== g.members.length || members.some((p) => zoneOf(p) !== null)) return false;
  const reached = new Set([members[0]!.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const a of members) {
      if (!reached.has(a.id) && members.some((b) => reached.has(b.id) && distance(a, b) <= LEAVE_DISTANCE_PX)) {
        reached.add(a.id);
        grew = true;
      }
    }
  }
  return reached.size === members.length;
}

// Ce qui doit être vrai de chaque état rendu, quel que soit le passé : la liste des écarts (vide si tout va bien). previous : les
// joueurs de l'appel précédent, celui qui a rendu prev.
function violations(s: GroupingState, prev: GroupingState, players: ProximityPlayer[], previous: ProximityPlayer[], now: number): string[] {
  const out: string[] = [];
  const present = players.map((p) => p.id).sort();
  const byId = new Map(players.map((p) => [p.id, p]));
  if (JSON.stringify(Object.keys(s.assignment).sort()) !== JSON.stringify(present)) {
    out.push(`assignment ne couvre pas exactement les joueurs présents : ${Object.keys(s.assignment)} / ${present}`);
  }
  for (const [id, g] of Object.entries(s.assignment)) {
    if (g !== null && !s.groups[g]?.members.includes(id)) out.push(`${id} est affecté à ${g}, qui ne le compte pas`);
  }
  const awaited = new Set(Object.values(s.pending).map((w) => w.target));
  for (const [gid, g] of Object.entries(s.groups)) {
    if (g.id !== gid) out.push(`le groupe rangé sous ${gid} s'appelle ${g.id}`);
    if (JSON.stringify(g.members) !== JSON.stringify([...new Set(g.members)].sort())) out.push(`${gid} : membres pas triés ou en double`);
    for (const m of g.members) if (s.assignment[m] !== gid) out.push(`${gid} compte ${m}, affecté à ${s.assignment[m]}`);
    if (g.members.length < 2 && !awaited.has(gid)) out.push(`${gid} : ${g.members.length} membre, et personne en route`);
    if (g.zoneId !== null && !ISOLATING_ZONES.has(g.zoneId)) out.push(`${gid} : zone ${g.zoneId} inconnue`);
    // Personne hors d'une zone n'est dans le groupe de cette zone.
    for (const m of g.members) {
      const where = byId.has(m) ? zoneOf(byId.get(m)!) : undefined;
      if (g.zoneId !== null && where !== g.zoneId) out.push(`${m} est dans ${gid}, le groupe de la zone ${g.zoneId}, depuis la zone ${where}`);
    }
  }
  for (const [id, w] of Object.entries(s.pending)) {
    if (!present.includes(id)) out.push(`${id} est parti mais attend encore`);
    if (w.target === s.assignment[id]) out.push(`${id} attend ${w.target}, où il est déjà`);
    if (!(now - w.since >= 0 && now - w.since < GROUP_DEBOUNCE_MS)) out.push(`${id} attend depuis ${now - w.since} ms`);
  }
  const unexcused = new Map<string, string[]>();   // groupe → ceux qui en sont sortis sans attente mûre, Ne pas déranger ni sortie de zone
  for (const p of players) {
    const g = s.assignment[p.id] ?? null;
    const before = prev.assignment[p.id] ?? null;
    const waited = prev.pending[p.id];
    // L'attente d'un groupe de zone est courte (ZONE_JOIN_DEBOUNCE_MS), comme celle d'un retour dans un groupe qu'on a quitté depuis moins de
    // GROUP_MEMORY_MS (REJOIN_DEBOUNCE_MS) ; celle des autres changements est de GROUP_DEBOUNCE_MS.
    const remembered = g !== null && prev.recent?.[g]?.members[p.id] !== undefined && now - prev.recent[g]!.members[p.id]! < GROUP_MEMORY_MS;
    const needed = g !== null && s.groups[g]?.zoneId != null ? ZONE_JOIN_DEBOUNCE_MS : remembered ? REJOIN_DEBOUNCE_MS : GROUP_DEBOUNCE_MS;
    const matured = waited !== undefined && waited.target === g && now - waited.since >= needed;
    if (p.status === 'dnd' && (g !== null || p.id in s.pending)) out.push(`${p.id} est en Ne pas déranger mais affecté ou en attente`);
    // Entrer dans un groupe, ou en changer, attend toujours : 500 ms, ou ZONE_JOIN_DEBOUNCE_MS pour le groupe d'une zone.
    if (g !== null && g !== before && !matured) out.push(`${p.id} entre dans ${g} sans avoir attendu ${needed} ms`);
    // Personne n'entre dans un groupe depuis une autre zone : un nouveau membre est dans la zone du groupe (null : espace ouvert).
    if (g !== null && g !== before && zoneOf(p) !== s.groups[g]?.zoneId) {
      out.push(`${p.id} entre dans ${g} (zone ${s.groups[g]?.zoneId}) depuis la zone ${zoneOf(p)}`);
    }
    // La zone de son ancien groupe à cet appel : celle du groupe rendu s'il existe encore (la grappe qui a repris son id l'a peut-être
    // fait entrer dans une zone), sinon celle qu'il avait.
    const beforeZone = before === null ? null : Object.hasOwn(s.groups, before) ? s.groups[before]!.zoneId : (prev.groups[before]?.zoneId ?? null);
    const leftZone = beforeZone !== null && zoneOf(p) !== beforeZone;
    // Sortir de la zone d'un groupe de zone : à null dans le même appel, quelle que soit la grappe voulue.
    if (leftZone && g !== null) out.push(`${p.id} est sorti de la zone ${beforeZone} de ${before}, mais est affecté à ${g}`);
    // Qui était dans le groupe d'une zone et y est resté n'est avec personne de l'extérieur : l'id du groupe ne sort pas de la zone.
    const wasZone = before === null ? null : (prev.groups[before]?.zoneId ?? null);
    if (wasZone !== null && zoneOf(p) === wasZone && g !== null) {
      const outsiders = (s.groups[g]?.members ?? []).filter((m) => byId.has(m) && zoneOf(byId.get(m)!) !== wasZone);
      if (outsiders.length > 0) out.push(`${p.id}, resté dans la zone ${wasZone}, est dans ${g} avec ${outsiders} qui sont dehors`);
    }
    if (g === null && before !== null && !matured && p.status !== 'dnd' && !leftZone) {
      unexcused.set(before, [...(unexcused.get(before) ?? []), p.id]);
    }
  }
  // Quitter son groupe : après 500 ms, ou tout de suite en Ne pas déranger ou hors de la zone d'un groupe de zone, ou par la
  // dissolution du groupe : il n'y restait que lui (les autres en sont sortis pour leur propre raison, ou sont partis), et personne
  // n'était en route vers lui.
  for (const [gid, leavers] of unexcused) {
    const dissolved = leavers.length === 1 && !Object.values(s.assignment).includes(gid) && !awaited.has(gid);
    if (!dissolved) out.push(`${leavers} quitte(nt) ${gid} sans attendre, et ${gid} n'a pas été dissous`);
  }
  // Un groupe garde son id quand aucun de ses membres n'a bougé, changé de statut ni quitté le bureau : tous y restent. Et si ses
  // membres sont reliés entre eux, aucun ne se met en route vers la sortie (null) ni vers un nouvel id (absent de prev.groups) : le
  // groupe ne change pas de room. Rejoindre un groupe qui existe reste permis : une fusion avec un groupe plus nombreux.
  for (const gid of unchangedGroups(prev, players, previous)) {
    const g = prev.groups[gid]!;
    const gone = g.members.filter((m) => s.assignment[m] !== gid);
    if (gone.length > 0) out.push(`${gid} : aucun membre n'a bougé ni changé, mais ${gone} n'y sont plus`);
    if (!linkedAmongThemselves(g, players)) continue;
    for (const m of g.members) {
      const w = s.pending[m];
      if (w !== undefined && (w.target === null || !Object.hasOwn(prev.groups, w.target))) {
        out.push(`${gid} : aucun membre n'a bougé ni changé, et ils sont reliés, mais ${m} se met en route vers ${w.target ?? 'la sortie'}`);
      }
    }
  }
  if (s.nextId < prev.nextId) out.push(`nextId recule : ${prev.nextId} → ${s.nextId}`);
  for (const id of [...Object.keys(s.groups), ...awaited]) {
    if (id === null) continue;
    const n = /^g(\d+)$/.exec(id);
    if (n === null || Number(n[1]) >= s.nextId) out.push(`id ${id} inattendu (nextId = ${s.nextId})`);
  }
  return out;
}

// Ce qui doit être vrai d'un état stable : les groupes sont exactement les grappes de l'algorithme.
function clusterViolations(s: GroupingState, players: ProximityPlayer[]): string[] {
  const out: string[] = [];
  const eligible = players.filter((p) => p.status !== 'dnd');
  for (const p of players) if (p.status === 'dnd' && s.assignment[p.id] !== null) out.push(`${p.id} en Ne pas déranger, affecté`);
  // Dans une zone : tous les éligibles ensemble, entre eux seuls, à partir de deux.
  for (const zone of ISOLATING_ZONES) {
    const inside = eligible.filter((p) => zoneOf(p) === zone).map((p) => p.id).sort();
    const g = inside.length > 0 ? s.assignment[inside[0]!] : null;
    if (inside.length === 1 && g !== null) out.push(`${inside[0]} seul dans la zone ${zone}, affecté à ${g}`);
    if (inside.length >= 2 && (g === null || JSON.stringify(s.groups[g]?.members) !== JSON.stringify(inside) || s.groups[g]?.zoneId !== zone)) {
      out.push(`zone ${zone} : ${inside} ne forment pas un groupe à eux seuls`);
    }
  }
  // Dans les espaces ouverts : deux personnes arrêtées à moins de 3 cases sont ensemble ; un groupe est relié de proche en proche,
  // à 4 cases au plus, et tous ses membres sont dans un espace ouvert.
  const open = eligible.filter((p) => zoneOf(p) === null);
  for (const a of open) {
    for (const b of open) {
      if (a.id < b.id && !a.moving && !b.moving && distance(a, b) < JOIN_DISTANCE_PX && (s.assignment[a.id] === null || s.assignment[a.id] !== s.assignment[b.id])) {
        out.push(`${a.id} et ${b.id}, arrêtés à ${distance(a, b).toFixed(1)} px, ne sont pas ensemble`);
      }
    }
  }
  for (const g of Object.values(s.groups)) {
    if (g.zoneId !== null) continue;
    const members = open.filter((p) => g.members.includes(p.id));
    if (members.length !== g.members.length) out.push(`${g.id} : des membres hors des espaces ouverts`);
    const reached = new Set([g.members[0]]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const a of members) {
        if (reached.has(a.id)) continue;
        if (members.some((b) => reached.has(b.id) && distance(a, b) <= LEAVE_DISTANCE_PX)) {
          reached.add(a.id);
          grew = true;
        }
      }
    }
    if (reached.size !== g.members.length) out.push(`${g.id} : membres pas reliés à 4 cases au plus`);
  }
  return out;
}

describe('propriétés, sur des marches au hasard', () => {
  const SEEDS = Array.from({ length: 30 }, (_, i) => 1000 + i);

  test("à chaque appel : état cohérent, résultat indépendant de l'ordre des joueurs, état reçu jamais modifié", () => {
    const seen = {
      openGroups: 0,
      zoneGroups: 0,
      alone: 0,
      immediate: 0,
      switches: 0,
      zoneExitsToCluster: 0,
      openToZone: 0,
      unchangedGroups: 0,
      linkedUnchanged: 0,
      fromMemory: 0,
      rejoins: 0,
    };
    for (const seed of SEEDS) {
      const random = mulberry32(seed + 1);
      let s = EMPTY_GROUPING;
      let previous: ProximityPlayer[] = [];
      for (const [k, { players, now }] of randomWalk(seed, 300).entries()) {
        // Figés : computeGroups lèverait une TypeError en modifiant l'état reçu ou la liste des joueurs.
        const prev = deepFreeze(s);
        const next = computeGroups(deepFreeze(players), map, prev, now);
        const context = `graine ${seed}, appel ${k} (t = ${now})`;
        expect(violations(next, prev, players, previous, now), context).toEqual([]);
        const unchangedNow = unchangedGroups(prev, players, previous);
        seen.unchangedGroups += unchangedNow.length;
        seen.linkedUnchanged += unchangedNow.filter((gid) => linkedAmongThemselves(prev.groups[gid]!, players)).length;
        previous = players;
        expect(JSON.stringify(computeGroups(shuffled(players, random), map, prev, now)), context).toBe(JSON.stringify(next));
        // Ce que la marche a fait passer par le calcul, pour vérifier qu'elle couvre les cas intéressants.
        const groups = Object.values(next.groups);
        if (groups.some((g) => g.zoneId === null)) seen.openGroups++;
        if (groups.some((g) => g.zoneId !== null)) seen.zoneGroups++;
        if (groups.some((g) => g.members.length === 1)) seen.alone++;
        // Un groupe d'espace ouvert repris par la grappe d'une zone.
        if (groups.some((g) => g.zoneId !== null && Object.hasOwn(prev.groups, g.id) && prev.groups[g.id]!.zoneId === null)) seen.openToZone++;
        // Un id repris à la mémoire (une cible en attente qui n'est ni un groupe, ni un id neuf), et un retour dans un groupe qu'on avait quitté.
        if (Object.values(next.pending).some((w) => w.target !== null && !Object.hasOwn(prev.groups, w.target) && Object.hasOwn(prev.recent ?? {}, w.target))) seen.fromMemory++;
        if (players.some(({ id }) => { const g = next.assignment[id]; return g != null && g !== prev.assignment[id] && prev.recent?.[g]?.members[id] !== undefined; })) seen.rejoins++;
        for (const { id } of players) {
          const before = prev.assignment[id] ?? null;
          const after = next.assignment[id];
          if (before !== null && after === null && prev.pending[id]?.target !== null) seen.immediate++;
          if (before !== null && after !== null && before !== after) seen.switches++;
          // Sorti d'un groupe de zone tout de suite, et en route vers une grappe hors de la zone.
          if (before !== null && after === null && prev.groups[before]?.zoneId != null && next.pending[id]?.target != null) seen.zoneExitsToCluster++;
        }
        s = next;
      }
    }
    for (const [what, count] of Object.entries(seen)) expect(count, what).toBeGreaterThan(0);
  });

  test("sans mouvement ni changement, l'état se stabilise sur les grappes de l'algorithme", () => {
    for (const seed of SEEDS) {
      const frames = randomWalk(seed, 300);
      let s = EMPTY_GROUPING;
      for (const [k, { players, now }] of frames.entries()) {
        s = computeGroups(players, map, s, now);
        if (k % 25 !== 24) continue;
        // Tout le monde reste où il est, 3 s durant : plus rien n'attend, et un appel de plus ne change rien.
        let still = s;
        for (let t = now + 250; t <= now + 3000; t += 250) still = computeGroups(players, map, still, t);
        const context = `graine ${seed}, appel ${k}`;
        expect(still.pending, context).toEqual({});
        // La mémoire, elle, oublie avec le temps : on compare le reste.
        const withoutMemory = (st: GroupingState) => ({ ...st, recent: undefined });
        expect(withoutMemory(computeGroups(players, map, still, now + 3250)), context).toEqual(withoutMemory(still));
        expect(clusterViolations(still, players), context).toEqual([]);
      }
    }
  });
});
