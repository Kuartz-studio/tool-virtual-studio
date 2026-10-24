import { TILE_SIZE, WALK_SPEED_PX_PER_S, avatarBodyFits, buildTiledMap, parseOfficeMap, type Direction, type OfficeMap, type Point, type ZoneInput } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { planApproach } from './auto-walk';
import { FOLLOW_REPLAN_MS, FOLLOW_SPRINT_PX, FOLLOW_STOP_PX, Follow, followWalkMap } from './follow';

const cell = (tx: number, ty: number): Point => ({ x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 });
const tileOf = (p: Point) => ({ tx: Math.floor(p.x / TILE_SIZE), ty: Math.floor(p.y / TILE_SIZE) });

// Une carte de 16 × 10 cases, `#` bloquant : un mur coupe la carte en deux (la colonne 8), sauf une ouverture en (8, 7).
const ascii = [
  '################',
  '#.......#......#',
  '#.......#......#',
  '#.......#......#',
  '#.......#......#',
  '#.......#......#',
  '#.......#......#',
  '#..............#',
  '#.......#......#',
  '################',
];
const zones: ZoneInput[] = [{ type: 'spawn', x: 1, y: 1, w: 1, h: 1 }];
const map: OfficeMap = parseOfficeMap(buildTiledMap({ ascii, zones, tileset: { name: 'dev', image: 'tiles.png' } }));

// Un pas de marche, sans physique : la direction, à la vitesse de la marche (ou de la course), si le corps de l'avatar y tient.
const STEP_MS = 16;
function stepFeet(feet: Point, dir: Direction, sprint: boolean): Point {
  const px = (WALK_SPEED_PX_PER_S * (sprint ? 1.5 : 1) * STEP_MS) / 1000;
  const next = { x: feet.x + (dir === 'left' ? -px : dir === 'right' ? px : 0), y: feet.y + (dir === 'up' ? -px : dir === 'down' ? px : 0) };
  return avatarBodyFits(map, next.x, next.y) ? next : feet;
}

// Suit `goal` (qui peut bouger : `move`) image après image, pendant `ms` ; rend les pieds à la fin, et ce que la marche a dit.
function run(follow: Follow, feet: Point, goal: (now: number) => Point, ms: number, walkMap = map) {
  const seen = { blocked: false, sprinted: false };
  for (let now = 0; now <= ms; now += STEP_MS) {
    const step = follow.update(walkMap, feet, goal(now), now);
    if (step === 'blocked') {
      seen.blocked = true;
      break;
    }
    if (step === null) continue;
    seen.sprinted ||= step.sprint;
    feet = stepFeet(feet, step.dir, step.sprint);
  }
  return { feet, ...seen };
}

describe('planApproach', () => {
  test('le plus court chemin jusqu\'à la case d\'avant celle de la personne', () => {
    const route = planApproach(map, cell(1, 4), cell(5, 4))!;
    expect(route.at(-1)).toEqual(cell(4, 4));
    expect(route[0]).toEqual(cell(1, 4));
  });

  test('de l\'autre côté du mur : par l\'ouverture ; on arrive du côté d\'où l\'on vient', () => {
    const route = planApproach(map, cell(2, 2), cell(10, 2))!;
    // Les points sont les angles du trajet : il descend jusqu'à la rangée de l'ouverture (7) pour passer le mur.
    expect(route.some((p) => tileOf(p).ty === 7)).toBe(true);
    const last = tileOf(route.at(-1)!);
    expect(Math.abs(last.tx - 10) + Math.abs(last.ty - 2)).toBe(1);
  });

  test('déjà à côté : un seul point, on ne bouge pas ; pas de chemin : null', () => {
    expect(planApproach(map, cell(4, 4), cell(5, 4))).toEqual([cell(4, 4)]);
    const walled = followWalkMap({ ...map, zones: [...map.zones, { id: 99, type: 'door', name: 'Z9', x: 8 * 32, y: 7 * 32, width: 32, height: 32, props: {} } as never] }, [], ['Z9']);
    expect(planApproach(walled, cell(2, 2), cell(10, 2))).toBeNull();
  });
});

describe('followWalkMap', () => {
  test('une porte fermée pour soi devient un mur ; ouverte, rien ne change', () => {
    const door = { id: 99, type: 'door', name: 'Z9', x: 8 * 32, y: 7 * 32, width: 32, height: 32, props: {} } as never;
    const withDoor = { ...map, zones: [...map.zones, door] };
    expect(followWalkMap(withDoor, [], [])).toMatchObject({ widthTiles: map.widthTiles });
    expect(followWalkMap(withDoor, [], []).blocked[7 * map.widthTiles + 8]).toBe(0);
    expect(followWalkMap(withDoor, [], ['Z9']).blocked[7 * map.widthTiles + 8]).toBe(1);
    // La carte d'origine n'est pas touchée.
    expect(map.blocked[7 * map.widthTiles + 8]).toBe(0);
  });
});

describe('Follow', () => {
  test('à quatre cases : il la rejoint, et s\'arrête à une case d\'elle', () => {
    const follow = new Follow();
    follow.start('bob');
    const goal = cell(6, 4);
    const { feet, blocked } = run(follow, cell(2, 4), () => goal, 3000);
    expect(blocked).toBe(false);
    const gap = Math.hypot(goal.x - feet.x, goal.y - feet.y);
    expect(gap).toBeLessThanOrEqual(FOLLOW_STOP_PX);
    expect(gap).toBeGreaterThanOrEqual(TILE_SIZE - 4);
    expect(follow.id).toBe('bob');
  });

  test('elle s\'éloigne : il repart derrière elle, de l\'autre côté du mur, en courant quand elle est loin', () => {
    const follow = new Follow();
    follow.start('bob');
    // Elle part de (3, 4) et passe en (12, 3) au bout d'une seconde (un saut : elle est loin, il court).
    const goal = (now: number) => (now < 1000 ? cell(3, 4) : cell(12, 3));
    const { feet, sprinted } = run(follow, cell(1, 4), goal, 8000);
    expect(sprinted).toBe(true);
    expect(Math.hypot(cell(12, 3).x - feet.x, cell(12, 3).y - feet.y)).toBeLessThanOrEqual(FOLLOW_STOP_PX);
    expect(FOLLOW_SPRINT_PX).toBeGreaterThan(FOLLOW_STOP_PX);
  });

  test('à côté d\'elle, il ne bouge pas tant qu\'elle reste à moins de deux cases', () => {
    const follow = new Follow();
    follow.start('bob');
    const goal = (now: number) => (now < 1000 ? cell(5, 4) : { x: cell(5, 4).x + 20, y: cell(5, 4).y });
    const { feet } = run(follow, cell(4, 4), goal, 2000);
    expect(feet).toEqual(cell(4, 4));
  });

  test('plus de chemin jusqu\'à elle (une porte qui se ferme) : blocked', () => {
    const follow = new Follow();
    follow.start('bob');
    const door = { id: 99, type: 'door', name: 'Z9', x: 8 * 32, y: 7 * 32, width: 32, height: 32, props: {} } as never;
    const closed = followWalkMap({ ...map, zones: [...map.zones, door] }, [], ['Z9']);
    expect(run(follow, cell(2, 2), () => cell(12, 2), 500, closed).blocked).toBe(true);
  });

  test('stop : plus personne à suivre, plus de direction', () => {
    const follow = new Follow();
    follow.start('bob');
    follow.stop();
    expect(follow.id).toBeNull();
    expect(follow.update(map, cell(1, 1), cell(10, 2), FOLLOW_REPLAN_MS)).toBeNull();
  });
});
