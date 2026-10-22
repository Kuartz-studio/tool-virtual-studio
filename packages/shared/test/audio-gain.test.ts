import { describe, expect, test } from 'vitest';
import {
  AUDIO_FULL_DISTANCE_PX,
  AUDIO_SILENT_DISTANCE_PX,
  DEV_OFFICE,
  EMPTY_GROUPING,
  OFFICE,
  OPEN_SPACE_GROUPING,
  TILE_SIZE,
  audioGain,
  buildTiledMap,
  computeGroups,
  gainBetween,
  parseOfficeMap,
  type ProximityPlayer,
} from '../src';

const tile = (n: number) => n * TILE_SIZE;

describe('audioGain : le volume selon la distance', () => {
  test('plein dans un grand rayon, jusqu\'à AUDIO_FULL_DISTANCE_PX compris', () => {
    expect(audioGain(0)).toBe(1);
    expect(audioGain(tile(3))).toBe(1);
    expect(audioGain(AUDIO_FULL_DISTANCE_PX)).toBe(1);
  });

  test('puis de plus en plus faible, sans jamais remonter, jusqu\'au silence à AUDIO_SILENT_DISTANCE_PX', () => {
    let previous = 1;
    for (let d = AUDIO_FULL_DISTANCE_PX + 1; d < AUDIO_SILENT_DISTANCE_PX; d += 4) {
      const gain = audioGain(d);
      expect(gain, `à ${d} px`).toBeLessThan(previous);
      expect(gain).toBeGreaterThan(0);
      previous = gain;
    }
    expect(audioGain(AUDIO_SILENT_DISTANCE_PX)).toBe(0);
    expect(audioGain(AUDIO_SILENT_DISTANCE_PX + tile(20))).toBe(0);
  });

  test('à mi-chemin, la moitié du volume ; une courbe douce : peu de perte au début et peu de reste à la fin', () => {
    const middle = (AUDIO_FULL_DISTANCE_PX + AUDIO_SILENT_DISTANCE_PX) / 2;
    expect(audioGain(middle)).toBeCloseTo(0.5, 10);
    expect(audioGain(AUDIO_FULL_DISTANCE_PX + tile(1))).toBeGreaterThan(0.95);
    expect(audioGain(AUDIO_SILENT_DISTANCE_PX - tile(1))).toBeLessThan(0.05);
  });

  test('toujours entre 0 et 1 ; une distance qui n\'est pas un nombre : silence', () => {
    for (const d of [-5, 0, 1, 100, 191, 192, 193, 300, 447, 448, 449, 1e9]) {
      expect(audioGain(d)).toBeGreaterThanOrEqual(0);
      expect(audioGain(d)).toBeLessThanOrEqual(1);
    }
    expect(audioGain(Number.NaN)).toBe(0);
    expect(audioGain(Number.POSITIVE_INFINITY)).toBe(0);
  });

  test('le plein volume couvre une grande zone (au moins 5 cases), et l\'écoute va bien plus loin (au moins 3 fois)', () => {
    expect(AUDIO_FULL_DISTANCE_PX).toBeGreaterThanOrEqual(tile(5));
    expect(AUDIO_SILENT_DISTANCE_PX).toBeGreaterThanOrEqual(3 * AUDIO_FULL_DISTANCE_PX / 2);
  });
});

describe('gainBetween : dans un bureau rien ne change', () => {
  const map = parseOfficeMap(buildTiledMap({ ...OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
  const inRoom = { x: tile(4) + 16, y: tile(3) + 16 };                  // dans le bureau A1
  const hall = { x: tile(60), y: tile(20) };                              // dans la salle de conférence
  const farOpen = { x: tile(30), y: tile(15) };                           // espace ouvert (la place centrale), loin
  const nearOpen = { x: tile(30), y: tile(12) };                          // espace ouvert (la rue nord)

  test('soi-même dans une zone : plein volume, même d\'une personne très loin', () => {
    expect(gainBetween(map, inRoom, farOpen)).toBe(1);
    expect(gainBetween(map, hall, { x: tile(60), y: tile(40) })).toBe(1);
  });

  test('dans un espace ouvert : le volume baisse avec la distance', () => {
    expect(gainBetween(map, nearOpen, { x: nearOpen.x + tile(2), y: nearOpen.y })).toBe(1);
    const mid = gainBetween(map, nearOpen, { x: nearOpen.x + tile(10), y: nearOpen.y });
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(gainBetween(map, nearOpen, { x: nearOpen.x + tile(20), y: nearOpen.y })).toBe(0);
    expect(gainBetween(map, farOpen, nearOpen)).toBe(1);   // 3 cases
  });
});

describe('le calcul des groupes avec la règle du bureau (OPEN_SPACE_GROUPING)', () => {
  const dev = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
  const office = parseOfficeMap(buildTiledMap({ ...OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
  const p = (id: string, x: number, y: number, moving = false): ProximityPlayer => ({ id, x, y, moving, status: 'available' });
  const settle = (players: ProximityPlayer[], m = office) => {
    let s = computeGroups(players, m, EMPTY_GROUPING, 0, OPEN_SPACE_GROUPING);
    for (let t = 250; t <= 750; t += 250) s = computeGroups(players, m, s, t, OPEN_SPACE_GROUPING);
    return s;
  };

  test('on rejoint ceux qu\'on pourrait entendre (moins de 14 cases), même en marchant', () => {
    const s = settle([p('a', tile(30), tile(12), true), p('b', tile(30) + tile(10), tile(12), true)]);
    expect(s.assignment).toEqual({ a: 'g1', b: 'g1' });
  });

  test('au-delà de 14 cases : pas de groupe ; les liens se font de proche en proche', () => {
    expect(settle([p('a', tile(10), tile(12)), p('b', tile(10) + tile(15), tile(12))]).assignment).toEqual({ a: null, b: null });
    // Dans le couloir, qui est un espace ouvert de bout en bout.
    const chain = settle([p('a', tile(4), tile(12)), p('b', tile(14), tile(12)), p('c', tile(24), tile(12))]);
    expect(chain.assignment).toEqual({ a: 'g1', b: 'g1', c: 'g1' });
  });

  test('on reste dans le groupe une case au-delà (hystérésis) : à 14,5 cases, ensemble tant qu\'ils l\'étaient', () => {
    const together = [p('a', tile(10), tile(12)), p('b', tile(10) + tile(10), tile(12))];
    let s = settle(together);
    const apart = [p('a', tile(10), tile(12)), p('b', tile(10) + tile(14) + 16, tile(12))];
    s = computeGroups(apart, office, s, 1000, OPEN_SPACE_GROUPING);
    expect(s.assignment).toEqual({ a: 'g1', b: 'g1' });
    const gone = [p('a', tile(10), tile(12)), p('b', tile(10) + tile(16), tile(12))];
    s = computeGroups(gone, office, s, 1250, OPEN_SPACE_GROUPING);
    s = computeGroups(gone, office, s, 1750, OPEN_SPACE_GROUPING);
    expect(s.assignment).toEqual({ a: null, b: null });
  });

  test('une salle ou un bureau : toujours tout le monde, quelle que soit la distance (la règle des zones ne change pas)', () => {
    // La salle de conférence, d'un bout à l'autre de ses 22 cases.
    const s = settle([p('a', tile(52), tile(18)), p('b', tile(71), tile(22))]);
    expect(s.assignment).toEqual({ a: 'g1', b: 'g1' });
    expect(s.groups.g1?.zoneId).not.toBeNull();
    // La détente aussi : d'un bout à l'autre de ses 43 cases, de la piscine au coin musique.
    const lounge = settle([p('a', tile(38), tile(33)), p('b', tile(79), tile(42))]);
    expect(lounge.assignment).toEqual({ a: 'g1', b: 'g1' });
  });

  test('la carte de développement : le tout petit bureau s\'entend déjà d\'un bout à l\'autre', () => {
    const s = settle([p('a', 80, 240), p('b', 400, 240)], dev);
    expect(s.assignment).toEqual({ a: 'g1', b: 'g1' });
  });
});

describe('hors de toute conversation (excluded) : comme en Ne pas déranger', () => {
  const office = parseOfficeMap(buildTiledMap({ ...OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
  const p = (id: string, x: number, y: number, more: Partial<ProximityPlayer> = {}): ProximityPlayer => ({
    id,
    x,
    y,
    moving: false,
    status: 'available',
    ...more,
  });
  const settle = (players: ProximityPlayer[], from = EMPTY_GROUPING, t0 = 0) => {
    let s = from;
    for (let t = t0; t <= t0 + 750; t += 250) s = computeGroups(players, office, s, t, OPEN_SPACE_GROUPING);
    return s;
  };

  test('dans un espace ouvert : personne ne le rejoint, il ne rejoint personne', () => {
    const s = settle([p('a', tile(4), tile(12)), p('b', tile(8), tile(12), { excluded: true }), p('c', tile(10), tile(12))]);
    expect(s.assignment).toEqual({ a: 'g1', b: null, c: 'g1' });
  });

  test('dans un bureau : il n\'est pas compté, les autres s\'entendent', () => {
    const room = { x: tile(4) + 16, y: tile(3) + 16 };
    const s = settle([p('a', room.x, room.y), p('b', room.x + 32, room.y, { excluded: true }), p('c', room.x - 32, room.y)]);
    expect(s.assignment).toEqual({ a: 'g1', b: null, c: 'g1' });
  });

  test('l\'état prend en cours de conversation : il sort tout de suite de son groupe, sans attendre', () => {
    const together = [p('a', tile(4), tile(12)), p('b', tile(8), tile(12))];
    const s = settle(together);
    expect(s.assignment).toEqual({ a: 'g1', b: 'g1' });
    const next = computeGroups([together[0]!, { ...together[1]!, excluded: true }], office, s, 1000, OPEN_SPACE_GROUPING);
    expect(next.assignment).toEqual({ a: null, b: null });   // b sort ; a reste seul : le groupe est dissous
    expect(next.pending).toEqual({});
  });

  test('l\'état s\'arrête : on le reprend dans un groupe après le délai habituel', () => {
    const players = [p('a', tile(4), tile(12)), p('b', tile(8), tile(12), { excluded: true })];
    const s = settle(players);
    const back = [players[0]!, { ...players[1]!, excluded: false }];
    const waiting = computeGroups(back, office, s, 1000, OPEN_SPACE_GROUPING);
    expect(waiting.assignment).toEqual({ a: null, b: null });
    const joined = computeGroups(back, office, waiting, 1500, OPEN_SPACE_GROUPING);
    expect(joined.assignment).toEqual({ a: 'g1', b: 'g1' });
  });
});
