import { describe, expect, test } from 'vitest';
import {
  DEV_OFFICE,
  EMPTY_GROUPING,
  GROUPS_TICK_MS,
  GROUP_DEBOUNCE_MS,
  JOIN_DISTANCE_PX,
  LEAVE_DISTANCE_PX,
  buildTiledMap,
  busyZoneIds,
  computeGroups,
  parseOfficeMap,
  zoneAt,
  type GroupingState,
  type ProximityPlayer,
  type Status,
} from '../src';

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

// Un appel du calcul, à l'heure t (en ms).
const run = (players: ProximityPlayer[], s: GroupingState, t: number): GroupingState => computeGroups(players, map, s, t);

// Les appels successifs avec les mêmes joueurs, toutes les 250 ms (GROUPS_TICK_MS) de `from` à `to` compris : un état par appel.
function steps(players: ProximityPlayer[], s: GroupingState, from: number, to: number): GroupingState[] {
  const states: GroupingState[] = [];
  for (let t = from; t <= to; t += GROUPS_TICK_MS) {
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
  expect(s).toEqual({ assignment: { A: null, B: null }, groups: {}, pending: {}, nextId: 2 });
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
  expect(s).toEqual({ assignment: { A: null, B: null }, groups: {}, pending: {}, nextId: 2 });
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
  expect(s).toEqual({ assignment: { A: null }, groups: {}, pending: {}, nextId: 2 });
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

test("entrer dans la salle où un groupe parle : 500 ms d'attente, comme ailleurs", () => {
  const room = [player('A', at(9, 2)), player('B', at(12, 3))];
  const s = step(room, EMPTY_GROUPING, 0, 500);
  expect(steps([...room, player('C', at(10, 4))], s, 750, 1250).map((st) => st.assignment.C)).toEqual([null, null, 'g1']);
});

test('sortir de la salle à deux : la conversation continue, hors de la salle', () => {
  let s = step([player('A', at(9, 2)), player('B', at(12, 3))], EMPTY_GROUPING, 0, 500);
  expect(s.groups.g1?.zoneId).toBe(ROOM);
  // A et B sortent ensemble et s'arrêtent dans le couloir, à 64 px l'un de l'autre : même groupe, qui n'est plus celui de la salle.
  s = run([player('A', at(9, 7)), player('B', at(11, 7))], s, 750);
  expect(s).toEqual({ assignment: { A: 'g1', B: 'g1' }, groups: { g1: { id: 'g1', members: ['A', 'B'], zoneId: null } }, pending: {}, nextId: 2 });
  expect(busyZoneIds(s)).toEqual(new Set());
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

// Ce qui doit être vrai de chaque état rendu, quel que soit le passé : la liste des écarts (vide si tout va bien).
function violations(s: GroupingState, prev: GroupingState, players: ProximityPlayer[], now: number): string[] {
  const out: string[] = [];
  const present = players.map((p) => p.id).sort();
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
  }
  for (const [id, w] of Object.entries(s.pending)) {
    if (!present.includes(id)) out.push(`${id} est parti mais attend encore`);
    if (w.target === s.assignment[id]) out.push(`${id} attend ${w.target}, où il est déjà`);
    if (!(now - w.since >= 0 && now - w.since < GROUP_DEBOUNCE_MS)) out.push(`${id} attend depuis ${now - w.since} ms`);
  }
  for (const p of players) {
    const g = s.assignment[p.id] ?? null;
    const before = prev.assignment[p.id] ?? null;
    const waited = prev.pending[p.id];
    const matured = waited !== undefined && waited.target === g && now - waited.since >= GROUP_DEBOUNCE_MS;
    if (p.status === 'dnd' && (g !== null || p.id in s.pending)) out.push(`${p.id} est en Ne pas déranger mais affecté ou en attente`);
    // Entrer dans un groupe, ou en changer, attend toujours 500 ms.
    if (g !== null && g !== before && !matured) out.push(`${p.id} entre dans ${g} sans avoir attendu 500 ms`);
    // Personne n'entre dans un groupe depuis une autre zone : un nouveau membre est dans la zone du groupe (null : espace ouvert).
    if (g !== null && g !== before && zoneOf(p) !== s.groups[g]?.zoneId) {
      out.push(`${p.id} entre dans ${g} (zone ${s.groups[g]?.zoneId}) depuis la zone ${zoneOf(p)}`);
    }
    // Quitter son groupe : après 500 ms, ou tout de suite en Ne pas déranger, hors de la zone d'un groupe de zone, ou quand le
    // groupe est dissous (il n'y reste personne).
    if (g === null && before !== null) {
      const zone = prev.groups[before]?.zoneId ?? null;
      const dissolved = !Object.values(s.assignment).includes(before);
      if (!matured && p.status !== 'dnd' && !(zone !== null && zoneOf(p) !== zone) && !dissolved) out.push(`${p.id} quitte ${before} sans attendre`);
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
    const seen = { openGroups: 0, zoneGroups: 0, alone: 0, immediate: 0, switches: 0 };
    for (const seed of SEEDS) {
      const random = mulberry32(seed + 1);
      let s = EMPTY_GROUPING;
      for (const [k, { players, now }] of randomWalk(seed, 300).entries()) {
        // Figés : computeGroups lèverait une TypeError en modifiant l'état reçu ou la liste des joueurs.
        const prev = deepFreeze(s);
        const next = computeGroups(deepFreeze(players), map, prev, now);
        const context = `graine ${seed}, appel ${k} (t = ${now})`;
        expect(violations(next, prev, players, now), context).toEqual([]);
        expect(JSON.stringify(computeGroups(shuffled(players, random), map, prev, now)), context).toBe(JSON.stringify(next));
        // Ce que la marche a fait passer par le calcul, pour vérifier qu'elle couvre les cas intéressants.
        const groups = Object.values(next.groups);
        if (groups.some((g) => g.zoneId === null)) seen.openGroups++;
        if (groups.some((g) => g.zoneId !== null)) seen.zoneGroups++;
        if (groups.some((g) => g.members.length === 1)) seen.alone++;
        for (const { id } of players) {
          const before = prev.assignment[id] ?? null;
          const after = next.assignment[id];
          if (before !== null && after === null && prev.pending[id]?.target !== null) seen.immediate++;
          if (before !== null && after !== null && before !== after) seen.switches++;
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
        expect(computeGroups(players, map, still, now + 3250), context).toEqual(still);
        expect(clusterViolations(still, players), context).toEqual([]);
      }
    }
  });
});
