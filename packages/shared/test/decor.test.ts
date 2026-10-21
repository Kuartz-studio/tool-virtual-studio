import { describe, expect, test } from 'vitest';
import {
  CHARACTER_PARTS,
  DECOR_CATEGORIES,
  DECOR_ITEMS,
  DEFAULT_DESK_DECOR,
  DESK_ROOM,
  FLOOR_THEMES,
  MAX_DECOR_ITEMS,
  WALL_THEMES,
  checkDecor,
  decorItem,
  decorItemsOf,
  floorTheme,
  isFloorTheme,
  isWallTheme,
  overlappingItems,
  type DeskDecor,
  type PlacedItem,
} from '../src';

const decor = (items: PlacedItem[], more: Partial<DeskDecor> = {}): DeskDecor => ({ ...DEFAULT_DESK_DECOR, items, ...more });

describe('la banque d\'éléments', () => {
  test('au plus 10 catégories, le poste de travail d\'abord, toutes remplies', () => {
    expect(DECOR_CATEGORIES.length).toBeLessThanOrEqual(10);
    expect(DECOR_CATEGORIES.slice(0, 3).map((c) => c.id)).toEqual(['ecrans', 'bureaux', 'sieges']);
    for (const { id } of DECOR_CATEGORIES) expect(decorItemsOf(id).length, id).toBeGreaterThan(0);
  });

  test('chaque élément a une clé unique, une taille entière en cases, et une empreinte qui tient dans son image', () => {
    expect(new Set(DECOR_ITEMS.map((item) => item.id)).size).toBe(DECOR_ITEMS.length);
    for (const item of DECOR_ITEMS) {
      expect(Number.isInteger(item.w) && Number.isInteger(item.h), item.id).toBe(true);
      expect(item.claim, item.id).toBeGreaterThanOrEqual(item.kind === 'wall' ? 0 : 1);
      expect(item.claim, item.id).toBeLessThanOrEqual(item.h);
      expect(item.fx % 1 === 0 && item.fy % 1 === 0, item.id).toBe(true);
      if (item.kind === 'wall') expect(item.h, item.id).toBeLessThanOrEqual(2);
    }
  });

  test('une centaine d\'éléments au moins, des écrans aux plantes', () => {
    expect(DECOR_ITEMS.length).toBeGreaterThan(150);
    expect(decorItem('of-14-12')?.cat).toBe('ecrans');
    expect(decorItem('of-7-28')?.cat).toBe('bureaux');
    expect(decorItem('nope')).toBeUndefined();
  });

  test('des thèmes de sol et de mur à choisir', () => {
    expect(FLOOR_THEMES.length).toBeGreaterThanOrEqual(12);
    expect(WALL_THEMES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(FLOOR_THEMES.map((t) => t.id)).size).toBe(FLOOR_THEMES.length);
    expect(isFloorTheme('parquet-clair')).toBe(true);
    expect(isWallTheme('creme')).toBe(true);
    expect(isFloorTheme('creme-pas-un-sol')).toBe(false);
    expect(floorTheme('sable')?.gid).toBeGreaterThan(0);
  });

  test('les pièces du personnage : des corps, des yeux, des tenues, des coiffures, des accessoires, des personnages prêts', () => {
    expect(CHARACTER_PARTS.bodies).toBeGreaterThanOrEqual(5);
    expect(CHARACTER_PARTS.eyes).toBeGreaterThanOrEqual(5);
    expect(CHARACTER_PARTS.premade).toBeGreaterThanOrEqual(10);
    expect(CHARACTER_PARTS.outfits.length).toBeGreaterThan(10);
    expect(CHARACTER_PARTS.hair.length).toBeGreaterThan(10);
    expect(CHARACTER_PARTS.accessories.length).toBeGreaterThan(5);
  });
});

describe('checkDecor', () => {
  test('le poste de travail par défaut est valable', () => {
    expect(checkDecor(DEFAULT_DESK_DECOR)).toEqual({ ok: true });
  });

  test('une pièce vide est valable ; au plus MAX_DECOR_ITEMS éléments', () => {
    expect(checkDecor(decor([]))).toEqual({ ok: true });
    const many = Array.from({ length: MAX_DECOR_ITEMS + 1 }, () => ({ id: 'of-14-12', x: 0, y: 0 }));
    expect(checkDecor(decor(many))).toEqual({ ok: false, error: 'too_many' });
  });

  test('un thème inconnu, un élément inconnu, une position qui n\'est pas une case : refusés', () => {
    expect(checkDecor(decor([], { floor: 'lave' }))).toEqual({ ok: false, error: 'unknown_theme' });
    expect(checkDecor(decor([], { wall: 'lave' }))).toEqual({ ok: false, error: 'unknown_theme' });
    expect(checkDecor(decor([{ id: 'nope', x: 0, y: 0 }]))).toEqual({ ok: false, error: 'unknown_item', index: 0 });
    expect(checkDecor(decor([{ id: 'of-7-28', x: 0.5, y: 0 }]))).toEqual({ ok: false, error: 'bad_position', index: 0 });
  });

  test('un élément qui déborde de la pièce : refusé', () => {
    expect(checkDecor(decor([{ id: 'of-7-28', x: DESK_ROOM.width - 2, y: 0 }]))).toEqual({ ok: false, error: 'out_of_room', index: 0 });
    expect(checkDecor(decor([{ id: 'of-7-28', x: 0, y: DESK_ROOM.height - 1 }]))).toEqual({ ok: false, error: 'out_of_room', index: 0 });
    expect(checkDecor(decor([{ id: 'of-7-28', x: -1, y: 0 }]))).toEqual({ ok: false, error: 'out_of_room', index: 0 });
  });

  test('deux meubles sur les mêmes cases : refusé ; un objet posé sur un meuble : permis', () => {
    expect(checkDecor(decor([{ id: 'of-7-28', x: 0, y: 0 }, { id: 'of-7-28', x: 2, y: 1 }]))).toEqual({ ok: false, error: 'overlap', index: 1 });
    expect(checkDecor(decor([{ id: 'of-7-28', x: 0, y: 0 }, { id: 'of-14-12', x: 1, y: 0 }]))).toEqual({ ok: true });
    expect(checkDecor(decor([{ id: 'of-14-12', x: 1, y: 0 }, { id: 'of-14-13', x: 1, y: 0 }]))).toEqual({ ok: false, error: 'overlap', index: 1 });
  });

  test('un élément mural se pose sur la bande de mur (y = 0), jamais deux au même endroit', () => {
    expect(checkDecor(decor([{ id: 'of-15-0', x: 0, y: 0 }]))).toEqual({ ok: true });
    expect(checkDecor(decor([{ id: 'of-15-0', x: 0, y: 2 }]))).toEqual({ ok: false, error: 'bad_position', index: 0 });
    expect(checkDecor(decor([{ id: 'of-9-12', x: 0, y: 0 }, { id: 'of-15-0', x: 1, y: 0 }]))).toEqual({ ok: false, error: 'overlap', index: 1 });
  });

  test('on ne mure pas sa porte, et on n\'enferme pas un coin de la pièce', () => {
    const doorRow = DESK_ROOM.height - 1;
    expect(checkDecor(decor([{ id: 'of-7-28', x: DESK_ROOM.doorX - 1, y: doorRow - 1 }]))).toMatchObject({ ok: false });
    const wall = Array.from({ length: DESK_ROOM.width }, (_, x) => ({ id: 'of-6-10', x, y: 3 }));
    expect(checkDecor(decor(wall))).toEqual({ ok: false, error: 'unreachable' });
    // Un mur de plantes avec un passage laisse tout atteignable.
    expect(checkDecor(decor(wall.slice(1)))).toEqual({ ok: true });
  });

  test('une chaise ne bloque pas le passage ; un tapis non plus', () => {
    const blocked = Array.from({ length: DESK_ROOM.width }, (_, x) => ({ id: 'of-0-8', x, y: 3 }));
    expect(checkDecor(decor(blocked))).toEqual({ ok: true });
    expect(checkDecor(decor([{ id: 'cf-0-8', x: 0, y: 3 }]))).toEqual({ ok: true });
  });
});

describe('overlappingItems', () => {
  const desk = { id: 'of-7-28', x: 0, y: 0 };
  const onTop = { id: 'of-14-12', x: 1, y: 0 };

  test('les éléments de la même sorte dont l\'empreinte touche celle-ci, par leur rang', () => {
    expect(overlappingItems([desk, onTop], 'of-7-28', { x: 2, y: 1 })).toEqual([0]);
    expect(overlappingItems([onTop, desk], 'of-7-28', { x: 2, y: 1 })).toEqual([1]);
  });

  test('une autre sorte ne gêne pas : un objet posé sur un meuble, un meuble sous un objet posé', () => {
    expect(overlappingItems([desk], 'of-14-12', { x: 1, y: 0 })).toEqual([]);
    expect(overlappingItems([onTop], 'of-7-28', { x: 0, y: 0 })).toEqual([]);
  });

  test('rien dans le voisinage, ou un élément inconnu : aucun', () => {
    expect(overlappingItems([desk], 'of-7-28', { x: 5, y: 3 })).toEqual([]);
    expect(overlappingItems([desk], 'nope', { x: 0, y: 0 })).toEqual([]);
  });

  test('ce que checkDecor refuse pour chevauchement est exactement ce que cette fonction trouve', () => {
    const items = [desk, { id: 'of-7-28', x: 2, y: 1 }];
    expect(checkDecor(decor(items))).toMatchObject({ ok: false, error: 'overlap' });
    expect(overlappingItems([desk], 'of-7-28', { x: 2, y: 1 })).toHaveLength(1);
  });
});
