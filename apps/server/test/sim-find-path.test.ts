import { DEV_OFFICE, avatarBodyFits, buildTiledMap, isWalkablePoint, isWalkableTile, parseOfficeMap, type OfficeMap } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { findPath } from '../src/sim/find-path';

// La carte de développement : 24 × 16 cases de 32 px. Les pièces du haut sont séparées de l'open space par le mur de la ligne 5, percé
// de trois portes (colonnes 3, 10 et 18). Les bureaux (cases bloquantes) sont sur la ligne 9.
const office = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
const SPAWN = { x: 80, y: 240 };
const center = (tx: number, ty: number) => ({ x: tx * 32 + 16, y: ty * 32 + 16 });

// Une petite carte à la main, `#` bloquant : de quoi vérifier les diagonales.
function grid(rows: string[]): OfficeMap {
  return {
    widthTiles: rows[0]!.length,
    heightTiles: rows.length,
    tileSize: 32,
    blocked: Uint8Array.from(rows.flatMap((row) => [...row].map((c) => (c === '#' ? 1 : 0)))),
    zones: [],
    spawn: { x: 16, y: 16 },
  };
}

describe('findPath', () => {
  test('même case : un seul point, celui que l\'on vise', () => {
    const found = findPath(office, SPAWN, { x: 90, y: 245 })!;
    expect(found.path).toEqual([{ x: 90, y: 245 }]);
    expect(found.goal).toEqual({ x: 90, y: 245 });
  });

  test('en ligne droite dans l\'open space : de case en case, puis le point visé', () => {
    const found = findPath(office, SPAWN, { x: 400, y: 250 })!;
    expect(found.goal).toEqual({ x: 400, y: 250 });
    expect(found.path.at(-1)).toEqual({ x: 400, y: 250 });
    // 10 cases à parcourir, plus la légère différence de ligne : jamais plus de pas qu'en 8 directions.
    expect(found.path.length).toBeLessThanOrEqual(11);
  });

  test('d\'une pièce à l\'autre : par une porte, jamais à travers un mur ou un bureau', () => {
    const found = findPath(office, SPAWN, center(10, 2))!;   // la salle de réunion
    expect(found.goal).toEqual(center(10, 2));
    const points = [SPAWN, ...found.path];
    for (const p of points) expect(isWalkablePoint(office, p.x, p.y)).toBe(true);
    // Chaque pas va à une case voisine (huit directions) : aucun saut par-dessus un mur.
    for (let i = 1; i < points.length - 1; i++) {
      expect(Math.abs(points[i]!.x - points[i - 1]!.x)).toBeLessThanOrEqual(32);
      expect(Math.abs(points[i]!.y - points[i - 1]!.y)).toBeLessThanOrEqual(32);
    }
    // Il faut bien passer par la ligne 5, sur une de ses portes.
    const crossing = found.path.filter((p) => Math.floor(p.y / 32) === 5);
    expect(crossing.length).toBeGreaterThan(0);
    for (const p of crossing) expect([3, 10, 18]).toContain(Math.floor(p.x / 32));
  });

  test('un point sur une case bloquante : la case libre la plus proche qu\'on atteint', () => {
    const desk = center(4, 9);   // un bureau
    expect(isWalkableTile(office, 4, 9)).toBe(false);
    const found = findPath(office, SPAWN, desk)!;
    expect(isWalkablePoint(office, found.goal.x, found.goal.y)).toBe(true);
    expect(Math.hypot(found.goal.x - desk.x, found.goal.y - desk.y)).toBeLessThanOrEqual(32);
    // Au centre d'une case : l'arrêt n'est pas le point lâché, qui est dans un meuble.
    expect(found.goal.x % 32).toBe(16);
    expect(found.goal.y % 32).toBe(16);
  });

  test('un point dans un mur ou hors de la carte : le bord libre le plus proche', () => {
    for (const to of [{ x: -50, y: -50 }, { x: 5000, y: 5000 }, { x: 400, y: 170 }, { x: 10, y: 10 }]) {
      const found = findPath(office, SPAWN, to)!;
      expect(isWalkablePoint(office, found.goal.x, found.goal.y)).toBe(true);
    }
    // Hors de la carte, en haut à gauche : la pièce du haut n'est pas la plus proche par le chemin, mais l'est par la distance.
    expect(findPath(office, SPAWN, { x: -50, y: -50 })!.goal).toEqual(center(1, 1));
  });

  test('l\'arrêt exact n\'est gardé que si le corps de l\'avatar y tient', () => {
    // Collé au mur du haut de l'open space (y = 192, la case de la ligne 6) : le corps (12 px de haut au-dessus des pieds) entre dans le mur.
    const found = findPath(office, SPAWN, { x: 400, y: 194 })!;
    expect(avatarBodyFits(office, 400, 194)).toBe(false);
    expect(found.goal).toEqual(center(12, 6));
  });

  test('départ sur une case bloquante, ou hors de la carte : null', () => {
    expect(findPath(office, center(4, 9), SPAWN)).toBeNull();
    expect(findPath(office, { x: -10, y: 10 }, SPAWN)).toBeNull();
  });

  test('une diagonale ne coupe jamais l\'angle d\'une case bloquante', () => {
    const map = grid(['...', '.#.', '...']);
    // De l'angle haut gauche à l'angle bas droit : la diagonale passe par le centre, qui est bloqué.
    const found = findPath(map, center(0, 0), center(2, 2))!;
    expect(found.path.map((p) => [Math.floor(p.x / 32), Math.floor(p.y / 32)])).not.toContainEqual([1, 1]);
    expect(found.goal).toEqual(center(2, 2));

    const corner = grid(['.#.', '...', '...']);
    // Un seul voisin de la diagonale bloqué suffit à l'interdire : (0,0) → (1,1) passe par (0,1), pas en diagonale.
    const around = findPath(corner, center(0, 0), center(1, 1))!;
    expect(around.path.map((p) => [Math.floor(p.x / 32), Math.floor(p.y / 32)])).toEqual([[0, 1], [1, 1]]);
  });

  test('une case que rien n\'atteint : la plus proche qu\'on atteint', () => {
    const map = grid(['..#..', '..#..', '..#..']);
    const found = findPath(map, center(0, 1), center(4, 1))!;
    expect(found.goal).toEqual(center(1, 1));
  });

  test('rien d\'autre que la case de départ n\'est atteignable : on y reste', () => {
    const map = grid(['.#', '#.']);
    const found = findPath(map, center(0, 0), center(1, 1))!;
    expect(found.goal).toEqual(center(0, 0));
    expect(found.path).toEqual([center(0, 0)]);
  });
});
