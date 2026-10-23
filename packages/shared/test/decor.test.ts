import { describe, expect, test } from 'vitest';
import {
  CHARACTER_PARTS,
  DECOR_CATEGORIES,
  DECOR_ITEMS,
  DEFAULT_DESK_DECOR,
  DESK_ROOMS,
  FLOOR_THEMES,
  MAX_DECOR_ITEMS,
  WALL_THEMES,
  blockedCells,
  checkDecor,
  decorItem,
  defaultDeskDecor,
  doorEntryCells,
  decorItemsOf,
  floorTheme,
  isDecorStep,
  isFloorTheme,
  isWallTheme,
  overlappingItems,
  snapToDecorStep,
  type DeskDecor,
  type DeskRoomSpec,
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
    // Au dixième de case près, pas plus fin.
    expect(checkDecor(decor([{ id: 'of-7-28', x: 0.55, y: 0 }]))).toEqual({ ok: false, error: 'bad_position', index: 0 });
  });

  test('un élément qui déborde de la pièce : refusé', () => {
    expect(checkDecor(decor([{ id: 'of-7-28', x: DESK_ROOMS.standard.width - 2, y: 0 }]))).toEqual({ ok: false, error: 'out_of_room', index: 0 });
    expect(checkDecor(decor([{ id: 'of-7-28', x: 0, y: DESK_ROOMS.standard.height - 1 }]))).toEqual({ ok: false, error: 'out_of_room', index: 0 });
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
    const doorRow = DESK_ROOMS.standard.height - 1;
    expect(checkDecor(decor([{ id: 'of-7-28', x: DESK_ROOMS.standard.door.x - 1, y: doorRow - 1 }]))).toMatchObject({ ok: false });
    // Un réfrigérateur (1 case au sol, 3 d'image) est un gros élément : il bloque, et une rangée en travers enferme le fond de la pièce.
    const wall = Array.from({ length: DESK_ROOMS.standard.width }, (_, x) => ({ id: 'ki-9-23', x, y: 3 }));
    expect(checkDecor(decor(wall))).toEqual({ ok: false, error: 'unreachable' });
    // Un mur de plantes avec un passage laisse tout atteignable.
    expect(checkDecor(decor(wall.slice(1)))).toEqual({ ok: true });
  });

  test('un petit élément ne bloque pas : une rangée de plantes d\'une case, de bout en bout, laisse passer', () => {
    const small = Array.from({ length: DESK_ROOMS.standard.width }, (_, x) => ({ id: 'of-6-12', x, y: 3 }));
    expect(decorItem('of-6-12')!.solid).toBe(false);
    expect(checkDecor(decor(small))).toEqual({ ok: true });
  });

  test('une chaise ne bloque pas le passage ; un tapis non plus', () => {
    const blocked = Array.from({ length: DESK_ROOMS.standard.width }, (_, x) => ({ id: 'of-0-8', x, y: 3 }));
    expect(checkDecor(decor(blocked))).toEqual({ ok: true });
    expect(checkDecor(decor([{ id: 'cf-0-8', x: 0, y: 3 }]))).toEqual({ ok: true });
  });
});

describe('le placement libre, au dixième de case', () => {
  test('isDecorStep et snapToDecorStep : les dixièmes, à l\'arrondi des nombres à virgule près', () => {
    expect([0, 3, 2.5, 0.1 + 0.2, -1.7].every(isDecorStep)).toBe(true);
    expect([0.55, 0.01, Number.NaN, Number.POSITIVE_INFINITY].some(isDecorStep)).toBe(false);
    expect(snapToDecorStep(0.1 + 0.2)).toBe(0.3);
    expect(snapToDecorStep(2.26)).toBe(2.3);
  });

  test('un meuble se pose au dixième près ; deux meubles peuvent se toucher, pas se chevaucher d\'un dixième', () => {
    expect(checkDecor(decor([{ id: 'of-7-28', x: 0.3, y: 1.7 }]))).toEqual({ ok: true });
    expect(checkDecor(decor([{ id: 'of-7-28', x: 0.3, y: 0 }, { id: 'of-7-28', x: 3.3, y: 0 }]))).toEqual({ ok: true });
    expect(checkDecor(decor([{ id: 'of-7-28', x: 0.3, y: 0 }, { id: 'of-7-28', x: 3.2, y: 0 }]))).toEqual({ ok: false, error: 'overlap', index: 1 });
    expect(overlappingItems([{ id: 'of-7-28', x: 0.3, y: 0 }], 'of-7-28', { x: 3.2, y: 0 })).toEqual([0]);
    expect(overlappingItems([{ id: 'of-7-28', x: 0.3, y: 0 }], 'of-7-28', { x: 3.3, y: 0 })).toEqual([]);
  });

  test('un dixième de trop, et c\'est hors de la pièce ; un élément mural reste contre le mur', () => {
    expect(checkDecor(decor([{ id: 'of-7-28', x: DESK_ROOMS.standard.width - 3, y: 0 }]))).toEqual({ ok: true });
    expect(checkDecor(decor([{ id: 'of-7-28', x: DESK_ROOMS.standard.width - 2.9, y: 0 }]))).toEqual({ ok: false, error: 'out_of_room', index: 0 });
    expect(checkDecor(decor([{ id: 'of-15-0', x: 2.5, y: 0 }]))).toEqual({ ok: true });
    expect(checkDecor(decor([{ id: 'of-15-0', x: 2.5, y: 0.1 }]))).toEqual({ ok: false, error: 'bad_position', index: 0 });
  });

  test('un meuble à cheval sur des cases les bloque toutes : la règle de passage compte en cases entières', () => {
    const width = DESK_ROOMS.standard.width;
    expect([...blockedCells([{ id: 'ki-9-23', x: 2.5, y: 3.2 }])].sort((a, b) => a - b)).toEqual([3 * width + 2, 3 * width + 3, 4 * width + 2, 4 * width + 3]);
    // Une rangée de frigos décalée d'une demi-case en travers de la pièce : il ne reste qu'une demi-case au bout, où l'avatar ne passe pas.
    const row = Array.from({ length: width - 1 }, (_, x) => ({ id: 'ki-9-23', x: x + 0.5, y: 3 }));
    expect(checkDecor(decor(row))).toEqual({ ok: false, error: 'unreachable' });
    // Collée au mur, la même rangée laisse une case entière au bout : on passe.
    expect(checkDecor(decor(row.map((placed) => ({ ...placed, x: placed.x - 0.5 }))))).toEqual({ ok: true });
  });

  test('un meuble qui déborde d\'un dixième sur la dernière case libre de l\'entrée mure la porte', () => {
    const doorRow = DESK_ROOMS.standard.height - 1;
    expect(checkDecor(decor([{ id: 'of-7-28', x: 1, y: doorRow - 1 }]))).toEqual({ ok: true });
    expect(checkDecor(decor([{ id: 'of-7-28', x: 1.1, y: doorRow - 1 }]))).toEqual({ ok: false, error: 'blocks_door' });
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

// ---- Des pièces de tailles différentes, et des portes au nord ---------------------------------------------------------------

const STANDARD = DESK_ROOMS.standard;
const COMPACT = DESK_ROOMS.compact;
const NORTH_STANDARD: DeskRoomSpec = { ...STANDARD, door: { side: 'north', x: 3, width: 2 } };
const NORTH_COMPACT: DeskRoomSpec = { ...COMPACT, door: { side: 'north', x: 2, width: 2 } };

describe('DESK_ROOMS', () => {
  test('la pièce standard fait 9 × 7, porte au sud sur les colonnes 3 et 4 ; la compacte 6 × 7, porte sur les colonnes 2 et 3', () => {
    expect(STANDARD).toEqual({ width: 9, height: 7, door: { side: 'south', x: 3, width: 2 } });
    expect(COMPACT).toEqual({ width: 6, height: 7, door: { side: 'south', x: 2, width: 2 } });
  });

  test('doorEntryCells : les cases juste derrière la porte, en bas pour une porte au sud, en haut pour une porte au nord', () => {
    expect(doorEntryCells(STANDARD)).toEqual([{ x: 3, y: 6 }, { x: 4, y: 6 }]);
    expect(doorEntryCells(NORTH_STANDARD)).toEqual([{ x: 3, y: 0 }, { x: 4, y: 0 }]);
    expect(doorEntryCells(COMPACT)).toEqual([{ x: 2, y: 6 }, { x: 3, y: 6 }]);
    expect(doorEntryCells(NORTH_COMPACT)).toEqual([{ x: 2, y: 0 }, { x: 3, y: 0 }]);
  });
});

describe('checkDecor dans une pièce compacte', () => {
  test('le poste réduit est valable dans la pièce compacte', () => {
    expect(checkDecor(defaultDeskDecor(COMPACT), COMPACT)).toEqual({ ok: true });
  });

  test('un élément qui dépasse les 6 cases de large est refusé, alors qu\'il tient dans la pièce standard', () => {
    // Un bureau de 3 cases en x = 4 : de 4 à 6, la 7e case n'existe pas ici.
    const desk = decor([{ id: 'of-7-28', x: 4, y: 1 }]);
    expect(checkDecor(desk, COMPACT)).toEqual({ ok: false, error: 'out_of_room', index: 0 });
    expect(checkDecor(desk, STANDARD)).toEqual({ ok: true });
    expect(checkDecor(decor([{ id: 'of-7-28', x: 3, y: 1 }]), COMPACT)).toEqual({ ok: true });
  });

  test('sans pièce donnée, c\'est la pièce standard (comme avant)', () => {
    const desk = decor([{ id: 'of-7-28', x: 4, y: 1 }]);
    expect(checkDecor(desk)).toEqual(checkDecor(desk, STANDARD));
  });

  test('le poste standard est refusé dans la pièce compacte : il ne tient pas', () => {
    expect(checkDecor(DEFAULT_DESK_DECOR, COMPACT)).toMatchObject({ ok: false });
  });

  test('la porte compacte est murée par un bureau de 2 cases devant elle : refusé', () => {
    // Le bureau long (2 × 2) sur les cases 2 et 3 de la rangée du bas.
    expect(checkDecor(decor([{ id: 'of-0-34', x: 2, y: 5 }]), COMPACT)).toEqual({ ok: false, error: 'blocks_door' });
  });
});

describe('checkDecor avec une porte au nord', () => {
  test('un meuble devant la porte (sur ses deux cases d\'entrée) est refusé', () => {
    expect(checkDecor(decor([{ id: 'of-7-28', x: 2, y: 0 }]), NORTH_STANDARD)).toEqual({ ok: false, error: 'blocks_door' });
    // Une seule des deux cases murée : on passe encore par l'autre.
    expect(checkDecor(decor([{ id: 'of-0-34', x: 4, y: 0 }]), NORTH_STANDARD)).toEqual({ ok: true });
  });

  test('un élément mural au-dessus de la porte est refusé, qu\'il la couvre en partie ou en entier', () => {
    expect(checkDecor(decor([{ id: 'of-9-12', x: 3, y: 0 }]), NORTH_STANDARD)).toEqual({ ok: false, error: 'blocks_door', index: 0 });
    expect(checkDecor(decor([{ id: 'of-9-12', x: 2, y: 0 }]), NORTH_STANDARD)).toEqual({ ok: false, error: 'blocks_door', index: 0 });
    expect(checkDecor(decor([{ id: 'of-15-0', x: 4, y: 0 }]), NORTH_STANDARD)).toEqual({ ok: false, error: 'blocks_door', index: 0 });
    // À côté de la porte : permis.
    expect(checkDecor(decor([{ id: 'of-9-12', x: 5, y: 0 }, { id: 'of-15-0', x: 2, y: 0 }]), NORTH_STANDARD)).toEqual({ ok: true });
  });

  test('porte au sud, un élément mural se pose où l\'on veut sur le mur du nord', () => {
    expect(checkDecor(decor([{ id: 'of-9-12', x: 3, y: 0 }]), STANDARD)).toEqual({ ok: true });
  });

  test('la pièce compacte, porte au nord : mêmes règles sur ses colonnes 2 et 3', () => {
    expect(checkDecor(decor([{ id: 'of-15-0', x: 2, y: 0 }]), NORTH_COMPACT)).toEqual({ ok: false, error: 'blocks_door', index: 0 });
    expect(checkDecor(decor([{ id: 'of-15-0', x: 4, y: 0 }]), NORTH_COMPACT)).toEqual({ ok: true });
  });
});

const DEFAULT_ROOMS: Array<[string, DeskRoomSpec]> = [
  ['standard, porte au sud', STANDARD],
  ['standard, porte au nord', NORTH_STANDARD],
  ['compacte, porte au sud', COMPACT],
  ['compacte, porte au nord', NORTH_COMPACT],
];

describe('defaultDeskDecor', () => {
  test.each(DEFAULT_ROOMS)('le poste par défaut (%s) : chaque siège est vu de dos, il regarde le bureau (la chaise, le canapé)', (_name, room) => {
    const seats = defaultDeskDecor(room).items.map((placed) => decorItem(placed.id)!).filter((item) => item.cat === 'sieges');
    expect(seats.length).toBeGreaterThanOrEqual(1);
    for (const seat of seats) expect(seat.name, seat.id).toContain('(de dos)');
  });

  test.each(DEFAULT_ROOMS)('la pièce par défaut (%s) passe checkDecor de sa pièce', (_name, room) => {
    const fitted = defaultDeskDecor(room);
    expect(checkDecor(fitted, room)).toEqual({ ok: true });
    // Un vrai poste : un bureau, un écran et une chaise.
    const ids = fitted.items.map((item) => item.id);
    expect(ids.filter((id) => decorItem(id)?.cat === 'bureaux').length).toBeGreaterThanOrEqual(1);
    expect(ids.filter((id) => decorItem(id)?.cat === 'ecrans').length).toBeGreaterThanOrEqual(1);
    expect(ids.filter((id) => decorItem(id)?.cat === 'sieges').length).toBeGreaterThanOrEqual(1);
  });

  test('le poste standard à porte au sud est DEFAULT_DESK_DECOR : rien ne change pour ceux qui l\'ont', () => {
    expect(defaultDeskDecor(STANDARD)).toEqual(DEFAULT_DESK_DECOR);
    expect(checkDecor(DEFAULT_DESK_DECOR)).toEqual({ ok: true });
  });

  test('les pièces par défaut sont des copies : en changer une ne change pas la suivante', () => {
    const first = defaultDeskDecor(COMPACT);
    first.items.push({ id: 'of-6-12', x: 0, y: 3 });
    expect(defaultDeskDecor(COMPACT).items.length).toBe(first.items.length - 1);
  });

  test('une pièce d\'une autre taille : vide, donc valable, avec les thèmes par défaut', () => {
    const odd: DeskRoomSpec = { width: 4, height: 3, door: { side: 'south', x: 1, width: 2 } };
    expect(defaultDeskDecor(odd)).toEqual({ floor: DEFAULT_DESK_DECOR.floor, wall: DEFAULT_DESK_DECOR.wall, items: [] });
    expect(checkDecor(defaultDeskDecor(odd), odd)).toEqual({ ok: true });
  });
});
