import { describe, expect, test } from 'vitest';
import { buildOfficeTiledMap, buildTiledMap, furnitureTiles, parseOfficeMap, spotNear, type ZoneInput } from '../src';

// Une carte de 20 × 10 cases : une pièce fermée (l'intérieur de la colonne 9 à 13, des rangées 4 et 5), dont la porte est un trou dans son mur du bas, en (11, 6).
const ascii = [
  '####################',
  '#..................#',
  '#..................#',
  '#.......#######....#',
  '#.......#.....#....#',
  '#.......#.....#....#',
  '#.......###.###....#',
  '#..................#',
  '#..................#',
  '####################',
];
const map = parseOfficeMap(buildTiledMap({ ascii, zones: [{ type: 'spawn', x: 2, y: 2, w: 1, h: 1 }], tileset: { name: 'dev', image: 'tiles.png' } }));
// Le centre d'une case, en pixels.
const at = (tx: number, ty: number) => ({ x: tx * 32 + 16, y: ty * 32 + 16 });
const inRoom = (x: number, y: number) => x >= 9 * 32 && x < 14 * 32 && y >= 4 * 32 && y < 6 * 32;

describe('spotNear', () => {
  test('à découvert : la case voisine la plus proche du point ; à égalité, la plus haute, puis la plus à gauche', () => {
    expect(spotNear(map, at(3, 7))).toEqual(at(3, 6));
    // Le point est au bord droit de sa case : la voisine de droite est la plus proche.
    expect(spotNear(map, { x: 3 * 32 + 28, y: 7 * 32 + 16 })).toEqual(at(4, 7));
  });

  test('jamais de l\'autre côté d\'un mur : on sort de la pièce par sa porte, même si la case derrière la cloison est plus près', () => {
    // De (13, 4), la case (15, 4) est à deux cases, derrière le mur : on ne peut pas s'arrêter dans la pièce, on en sort par la porte, à quatre pas.
    expect(spotNear(map, at(13, 4), { canStand: (x, y) => !inRoom(x, y) })).toEqual(at(11, 6));
    expect(spotNear(map, at(13, 4), { canStand: (x, y) => !inRoom(x, y), maxSteps: 3 })).toBeNull();
  });

  test('pas sur quelqu\'un : une case voisine occupée est laissée', () => {
    expect(spotNear(map, at(3, 7), { taken: [at(3, 6)], apartPx: 20 })).toEqual(at(2, 7));
  });

  test('ce que `blocked` ferme n\'est ni pris ni traversé', () => {
    const column = (tx: number) => tx === 4;
    expect(spotNear(map, at(5, 7), { blocked: column, canStand: (x) => x < 4 * 32, maxSteps: 30 })).toBeNull();
    expect(spotNear(map, at(5, 7), { canStand: (x) => x < 4 * 32 })).toEqual(at(3, 7));
  });

  test('la case du point n\'est prise que si on le demande ; hors de la carte, rien', () => {
    expect(spotNear(map, at(3, 7), { includeStart: true })).toEqual(at(3, 7));
    expect(spotNear(map, { x: -40, y: 10 })).toBeNull();
  });
});

describe('furnitureTiles', () => {
  // Une carte de 14 × 11 cases, avec un bureau de la taille standard (9 × 7) et sa porte au sud, et un autre bureau sans porte (pas de décor).
  const rows = Array.from({ length: 11 }, (_, y) => (y === 0 || y === 10 ? '#'.repeat(14) : `#${'.'.repeat(12)}#`));
  const zones: ZoneInput[] = [
    { type: 'desk', name: 'A1', x: 2, y: 1, w: 9, h: 7 },
    { type: 'door', name: 'A1', x: 5, y: 8, w: 2, h: 1 },
    { type: 'desk', name: 'B1', x: 11, y: 1, w: 2, h: 2 },
    { type: 'spawn', x: 1, y: 9, w: 1, h: 1 },
  ];
  const office = parseOfficeMap(buildTiledMap({ ascii: rows, zones, tileset: { name: 'dev', image: 'tiles.png' } }));
  const fridge = { id: 'ki-9-23', x: 2.5, y: 3.2 };

  test('un meuble solide bloque, en cases de la carte, toutes celles qu\'il touche dans sa pièce', () => {
    const tiles = furnitureTiles(office, [{ key: 'A1', items: [fridge] }]);
    const index = (tx: number, ty: number) => ty * office.widthTiles + tx;
    expect([...tiles].sort((a, b) => a - b)).toEqual([index(4, 4), index(5, 4), index(4, 5), index(5, 5)]);
  });

  test('une pièce sans porte (pas de décor), ou une place dont on ne dit rien : aucune case', () => {
    expect(furnitureTiles(office, [{ key: 'B1', items: [fridge] }]).size).toBe(0);
    expect(furnitureTiles(office, []).size).toBe(0);
  });
});

describe('le dehors des bureaux, dans la rue', () => {
  // La grande carte : la rangée du dehors des six bureaux est la première de la rue (y 16) ; la pièce de A1 commence en x 26, celle de A3 en x 46.
  const big = parseOfficeMap(buildOfficeTiledMap());
  const index = (tx: number, ty: number) => ty * big.widthTiles + tx;
  const fountain = { id: 'of-12-15', x: 6, y: 9 };
  const pot = { id: 'of-6-10', x: 7, y: 9 };

  test('un meuble solide du dehors bloque sa case de la rue, devant chaque bureau ; un pot non', () => {
    expect([...furnitureTiles(big, [{ key: 'A1', items: [fountain, pot] }])]).toEqual([index(32, 16)]);
    expect([...furnitureTiles(big, [{ key: 'A3', items: [fountain, pot] }])]).toEqual([index(52, 16)]);
  });

  test('une téléportation, un « Rejoindre » le contournent : spotNear ne pose personne dans la fontaine, mais juste à côté', () => {
    const furniture = furnitureTiles(big, [{ key: 'A1', items: [fountain] }]);
    const blocked = (tx: number, ty: number) => furniture.has(index(tx, ty));
    expect(spotNear(big, at(32, 16), { includeStart: true })).toEqual(at(32, 16));
    const spot = spotNear(big, at(32, 16), { blocked, includeStart: true })!;
    expect(spot).not.toEqual(at(32, 16));
    expect(Math.abs(spot.x - at(32, 16).x) + Math.abs(spot.y - at(32, 16).y)).toBe(32);
  });
});
