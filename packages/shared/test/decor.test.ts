import { describe, expect, test } from 'vitest';
import {
  CHARACTER_PARTS,
  CLOCK_ATLAS,
  CLOCK_ITEMS,
  DECOR_CATALOG,
  DECOR_CATEGORIES,
  DECOR_ITEMS,
  DEFAULT_DESK_DECOR,
  DESK_ROOMS,
  FLOOR_THEMES,
  MAX_DECOR_ITEMS,
  PLAN_ITEMS,
  POOL_TILES,
  SHOP_WALL_THEMES,
  TILESET,
  WALL_THEMES,
  blockedCells,
  buildOfficeTiledMap,
  buildTiledMap,
  checkDecor,
  decorAtlasNames,
  decorAtlasOf,
  decorAtlasUrl,
  decorItem,
  defaultDeskDecor,
  deskRoomSpecOf,
  doorEntryCells,
  decorItemsOf,
  floorTheme,
  isClockId,
  isDecorId,
  isDecorStep,
  isFloorTheme,
  isWallTheme,
  outsideRow,
  overlappingItems,
  parseOfficeMap,
  shopPriceOf,
  snapToDecorStep,
  wallPrice,
  wallTheme,
  type DeskDecor,
  type DeskRoomSpec,
  type PlacedItem,
  type ZoneInput,
} from '../src';

const decor = (items: PlacedItem[], more: Partial<DeskDecor> = {}): DeskDecor => ({ ...DEFAULT_DESK_DECOR, items, ...more });

describe('la banque d\'éléments', () => {
  test('au plus 11 catégories, le poste de travail d\'abord, la collection à part en dernier, toutes remplies', () => {
    expect(DECOR_CATEGORIES.length).toBeLessThanOrEqual(11);
    expect(DECOR_CATEGORIES.at(-1)?.id).toBe('boutique');
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

  test('seuls les éléments de la boutique ont un prix : un entier d\'au moins 1 pour chacun, aucun pour les autres', () => {
    const shop = decorItemsOf('boutique');
    expect(shop.length).toBeGreaterThan(0);
    for (const item of shop) expect(Number.isInteger(item.price) && item.price! >= 1, item.name).toBe(true);
    for (const item of DECOR_ITEMS.filter((i) => i.cat !== 'boutique')) expect(item.price, item.name).toBeUndefined();
  });

  test('une centaine d\'éléments au moins, des écrans aux plantes', () => {
    expect(DECOR_ITEMS.length).toBeGreaterThan(150);
    expect(decorItem('of-14-12')?.cat).toBe('ecrans');
    expect(decorItem('of-7-28')?.cat).toBe('bureaux');
    expect(decorItem('nope')).toBeUndefined();
  });

  test('les horloges murales sont dans la banque, à part du pack : quatre tailles, au mur, gratuites, dans leur propre atlas', () => {
    expect(CLOCK_ITEMS.map((item) => item.id)).toEqual(['horloge-ronde', 'horloge-led', 'horloge-gare', 'horloge-balancier']);
    expect(new Set(CLOCK_ITEMS.map((item) => `${item.w}×${item.h}`)).size).toBe(4);
    for (const item of CLOCK_ITEMS) {
      expect(item, item.id).toMatchObject({ cat: 'deco', kind: 'wall', claim: 0, solid: false, atlas: CLOCK_ATLAS.name });
      expect(item.h, item.id).toBeLessThanOrEqual(2);
      expect(isClockId(item.id) && isDecorId(item.id), item.id).toBe(true);
      expect(decorItem(item.id), item.id).toBe(item);
      // L'image et son cadran nu tiennent dans l'atlas.
      expect(item.fx + item.w * 32, item.id).toBeLessThanOrEqual(CLOCK_ATLAS.width);
      expect(item.fy + CLOCK_ATLAS.bareRowOffset + item.h * 32, item.id).toBeLessThanOrEqual(CLOCK_ATLAS.height);
    }
    expect(isClockId('of-15-0')).toBe(false);
    // Aucune clé du pack n'est prise, et la banque entière n'a pas de doublon ; les horloges ouvrent « Déco & murs ».
    expect(new Set(DECOR_CATALOG.map((item) => item.id)).size).toBe(DECOR_CATALOG.length);
    expect(DECOR_CATALOG).toHaveLength(DECOR_ITEMS.length + CLOCK_ITEMS.length + PLAN_ITEMS.length);
    expect(decorItemsOf('deco').slice(0, 4)).toEqual(CLOCK_ITEMS);
  });

  test('les éléments de la carte seule (le jardin, les meubles composés) : dans la banque, que la carte pose, jamais proposés ni posables dans un bureau', () => {
    expect(PLAN_ITEMS.length).toBeGreaterThan(0);
    for (const item of PLAN_ITEMS) {
      expect(item.mapOnly, item.id).toBe(true);
      expect(item.atlas, item.id).toBe('plan');
      expect(decorItem(item.id), item.id).toBe(item);
      expect(decorItemsOf(item.cat), item.id).not.toContain(item);
    }
    expect(checkDecor({ ...DEFAULT_DESK_DECOR, items: [{ id: 'jardiniere-1', x: 2, y: 2 }] })).toEqual({ ok: false, error: 'unknown_item', index: 0 });
  });

  test('l\'atlas d\'un élément : celui de sa catégorie, ou le sien', () => {
    expect(decorAtlasOf(decorItem('of-15-0')!)).toBe('deco');
    expect(decorAtlasOf(decorItem('horloge-gare')!)).toBe('horloges');
    expect(decorAtlasUrl('horloges')).toBe('/assets/decor/horloges.png');
    expect(decorAtlasNames()).toEqual([...DECOR_CATEGORIES.map((c) => c.id), 'horloges', 'plan']);
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

describe('les murs de la boutique', () => {
  test('des identifiants « mur-… », uniques, qui ne se confondent ni avec un mur libre ni avec un élément de décor', () => {
    const ids = SHOP_WALL_THEMES.map((wall) => wall.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^mur-[a-z0-9-]+$/);
      expect(WALL_THEMES.map((wall): string => wall.id)).not.toContain(id);
      expect(isDecorId(id)).toBe(false);
    }
  });

  test('chacun a un prix entier, Rare au moins (300 kuartzons), et c\'est celui de la boutique ; un mur libre n\'en a pas', () => {
    for (const wall of SHOP_WALL_THEMES) {
      expect(Number.isInteger(wall.price) && wall.price >= 300, wall.label).toBe(true);
      expect(wallPrice(wall.id)).toBe(wall.price);
      expect(shopPriceOf(wall.id)).toBe(wall.price);
      expect(isWallTheme(wall.id)).toBe(true);
      expect(wallTheme(wall.id)).toEqual(wall);
    }
    expect(wallPrice('creme')).toBeUndefined();
    expect(shopPriceOf('creme')).toBeUndefined();
  });

  test('leurs tuiles viennent après toutes les autres (celles de la carte gardent leur numéro), dans le jeu de tuiles', () => {
    for (const wall of SHOP_WALL_THEMES) {
      for (const gid of [wall.top, wall.bottom, wall.stem]) {
        expect(gid).toBeGreaterThan(POOL_TILES.se);
        expect(gid).toBeLessThanOrEqual(TILESET.tileCount);
      }
    }
  });

  test('un mur de la boutique est un thème que checkDecor accepte (l\'achat, seul le serveur le vérifie)', () => {
    expect(checkDecor(decor([], { wall: SHOP_WALL_THEMES[0].id }), DESK_ROOMS.standard)).toEqual({ ok: true });
  });
});

describe('la boutique tient dans une pièce de bureau', () => {
  test('chaque élément se pose seul dans la pièce compacte (6 × 7) comme dans la standard (9 × 7), contre le mur du fond', () => {
    for (const room of [DESK_ROOMS.compact, DESK_ROOMS.standard]) {
      for (const item of decorItemsOf('boutique')) {
        expect(checkDecor(decor([{ id: item.id, x: 0, y: 0 }]), room), `${item.name} (${room.width} × ${room.height})`).toEqual({ ok: true });
      }
    }
  });

  test('un élément mural fait deux cases de haut au plus, un meuble ne dépasse pas trois rangées au sol', () => {
    for (const item of decorItemsOf('boutique')) {
      if (item.kind === 'wall') expect(item.h, item.name).toBeLessThanOrEqual(2);
      if (item.kind === 'object') expect(item.claim, item.name).toBeLessThanOrEqual(3);
    }
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

  test('les horloges se posent au mur comme les autres éléments muraux : côte à côte, jamais l\'une sur l\'autre, ni ailleurs que sur la bande', () => {
    const clocks = [
      { id: 'horloge-ronde', x: 0, y: 0 },
      { id: 'horloge-led', x: 1, y: 0 },
      { id: 'horloge-gare', x: 3, y: 0 },
      { id: 'horloge-balancier', x: 5.5, y: 0 },
    ];
    expect(checkDecor(decor(clocks))).toEqual({ ok: true });
    expect(checkDecor(decor([{ id: 'horloge-ronde', x: 2, y: 3 }]))).toEqual({ ok: false, error: 'bad_position', index: 0 });
    expect(checkDecor(decor([{ id: 'horloge-gare', x: 0, y: 0 }, { id: 'horloge-ronde', x: 1.5, y: 0 }]))).toEqual({ ok: false, error: 'overlap', index: 1 });
    expect(checkDecor(decor([{ id: 'horloge-led', x: DESK_ROOMS.standard.width - 1, y: 0 }]))).toEqual({ ok: false, error: 'out_of_room', index: 0 });
    // Un élément mural ne gêne pas le passage.
    expect(blockedCells(clocks).size).toBe(0);
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

// ---- Le dehors : la face du mur sud et la rangée de la rue juste dessous ---------------------------------------------------------

// Les pièces de la grande carte, lues comme le serveur les lit : toutes ont leur porte au sud, sur la rue, et rien d'accroché sur la face de leur mur (A1). Pour
// les règles que cette carte n'exerce pas, des pièces écrites à la main : A2 avec l'interrupteur sur la face de son mur sud (colonne 8), A3 sa porte au nord,
// A5 et A6 (compactes) un panneau de sortie à l'ouest sur la face de leur mur, A6 sa porte au nord.
const OFFICE_MAP = parseOfficeMap(buildOfficeTiledMap());
const roomOf = (key: string): DeskRoomSpec => deskRoomSpecOf(OFFICE_MAP, key)!;
const A1 = roomOf('A1');
const SIGN = { x: 0, y: 8, w: 1, h: 1 };
const A2: DeskRoomSpec = { ...DESK_ROOMS.standard, outside: { fixtures: [{ x: 8, y: 8, w: 1, h: 1 }] } };
const A3: DeskRoomSpec = { ...DESK_ROOMS.standard, door: { ...DESK_ROOMS.standard.door, side: 'north' }, outside: { fixtures: [] } };
const A5: DeskRoomSpec = { ...DESK_ROOMS.compact, outside: { fixtures: [SIGN] } };
const A6: DeskRoomSpec = { ...DESK_ROOMS.compact, door: { ...DESK_ROOMS.compact.door, side: 'north' }, outside: { fixtures: [SIGN] } };
// La rangée du dehors des pièces de 7 rangées : 7 et 8 sont la bande de mur sud, 9 la rue.
const OUT = 9;
// Une plante en pot (1 × 2, une rangée au sol), une fontaine à eau (solide, 1 × 3), un bureau (deux rangées au sol), une natte (un tapis d'une rangée) et
// un grand tapis (trois rangées), une horloge ronde (1 × 1 au mur) et un tableau (2 × 2 au mur).
const POT = 'of-6-10';
const FOUNTAIN = 'of-12-15';
const DESK = 'of-7-28';
const MAT = 'jp-5-2';
const RUG = 'cf-0-8';
const CLOCK = 'horloge-ronde';
const BOARD = 'of-9-12';

describe('le dehors : devant sa pièce', () => {
  test('les pièces de la carte ont un dehors à la rangée 9, leur porte au sud, rien d\'accroché devant elles ; DESK_ROOMS, non (c\'est la carte qui le donne)', () => {
    expect(outsideRow(STANDARD)).toBe(OUT);
    for (const key of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) expect(roomOf(key), key).toMatchObject({ door: { side: 'south' }, outside: { fixtures: [] } });
    expect('outside' in STANDARD).toBe(false);
    expect('outside' in COMPACT).toBe(false);
  });

  test('une horloge sur la face du mur sud, un pot sur la rangée de la rue : dans un bureau du haut comme dans un bureau du bas', () => {
    for (const room of [A1, A3, A5, A6]) {
      expect(checkDecor(decor([{ id: CLOCK, x: 5, y: OUT }, { id: POT, x: 5, y: OUT }]), room), JSON.stringify(room.door)).toEqual({ ok: true });
    }
    // Au dixième près, comme dedans ; un tableau de deux cases de haut couvre toute la bande.
    expect(checkDecor(decor([{ id: BOARD, x: 4.5, y: OUT }, { id: POT, x: 0.3, y: OUT }]), A3)).toEqual({ ok: true });
  });

  test('pile sur la rangée, et une case de profondeur au plus : un bureau, un grand tapis, ou entre deux rangées, c\'est hors de la place', () => {
    expect(checkDecor(decor([{ id: DESK, x: 5, y: OUT }]), A3)).toEqual({ ok: false, error: 'out_of_room', index: 0 });
    expect(checkDecor(decor([{ id: RUG, x: 4, y: OUT }]), A3)).toEqual({ ok: false, error: 'out_of_room', index: 0 });
    expect(checkDecor(decor([{ id: MAT, x: 5, y: OUT }]), A3)).toEqual({ ok: true });
    for (const y of [7, 8, 8.5, 9.5, 10]) expect(checkDecor(decor([{ id: POT, x: 5, y }]), A3), `y = ${y}`).toEqual({ ok: false, error: 'out_of_room', index: 0 });
    for (const y of [8, 9.5]) expect(checkDecor(decor([{ id: CLOCK, x: 5, y }]), A3), `y = ${y}`).toEqual({ ok: false, error: 'bad_position', index: 0 });
  });

  test('sur la largeur de la pièce seulement : ni devant ses pans de mur, ni chez le voisin', () => {
    expect(checkDecor(decor([{ id: POT, x: -1, y: OUT }]), A3)).toEqual({ ok: false, error: 'out_of_room', index: 0 });
    expect(checkDecor(decor([{ id: POT, x: A3.width - 0.9, y: OUT }]), A3)).toEqual({ ok: false, error: 'out_of_room', index: 0 });
    expect(checkDecor(decor([{ id: POT, x: A3.width - 1, y: OUT }]), A3)).toEqual({ ok: true });
    expect(checkDecor(decor([{ id: BOARD, x: A3.width - 1, y: OUT }]), A3)).toEqual({ ok: false, error: 'out_of_room', index: 0 });
  });

  test('la porte d\'un bureau du haut : aucun élément mural ne la recouvre, rien de solide devant elle (même d\'un dixième) ; un pot, une natte, si', () => {
    const doorX = A1.door.x;
    expect(checkDecor(decor([{ id: CLOCK, x: doorX, y: OUT }]), A1)).toEqual({ ok: false, error: 'blocks_door', index: 0 });
    expect(checkDecor(decor([{ id: BOARD, x: doorX - 1, y: OUT }]), A1)).toEqual({ ok: false, error: 'blocks_door', index: 0 });
    expect(checkDecor(decor([{ id: FOUNTAIN, x: doorX + 1, y: OUT }]), A1)).toEqual({ ok: false, error: 'blocks_door', index: 0 });
    expect(checkDecor(decor([{ id: FOUNTAIN, x: doorX - 0.9, y: OUT }]), A1)).toEqual({ ok: false, error: 'blocks_door', index: 0 });
    expect(checkDecor(decor([{ id: FOUNTAIN, x: doorX - 1, y: OUT }, { id: FOUNTAIN, x: doorX + A1.door.width, y: OUT }]), A1)).toEqual({ ok: true });
    expect(checkDecor(decor([{ id: POT, x: doorX, y: OUT }, { id: MAT, x: doorX, y: OUT }]), A1)).toEqual({ ok: true });
    // Un bureau du bas a sa porte de l'autre côté : devant son mur sud, rien ne la gêne.
    expect(checkDecor(decor([{ id: CLOCK, x: doorX, y: OUT }, { id: FOUNTAIN, x: doorX, y: OUT }]), A3)).toEqual({ ok: true });
  });

  test('l\'interrupteur (devant A2) et le panneau de sortie (devant A5 et A6) restent visibles : ni un élément mural ni un objet devant eux ne les cache', () => {
    expect(checkDecor(decor([{ id: CLOCK, x: 8, y: OUT }]), A2)).toEqual({ ok: false, error: 'overlap', index: 0 });
    expect(checkDecor(decor([{ id: BOARD, x: 7, y: OUT }]), A2)).toEqual({ ok: false, error: 'overlap', index: 0 });
    expect(checkDecor(decor([{ id: POT, x: 7.5, y: OUT }]), A2)).toEqual({ ok: false, error: 'overlap', index: 0 });
    // À côté, ou à plat sur la rangée (une natte ne monte pas sur le mur) : permis.
    expect(checkDecor(decor([{ id: CLOCK, x: 7, y: OUT }, { id: POT, x: 6, y: OUT }, { id: MAT, x: 7, y: OUT }]), A2)).toEqual({ ok: true });
    for (const room of [A5, A6]) {
      expect(checkDecor(decor([{ id: CLOCK, x: 0, y: OUT }]), room)).toEqual({ ok: false, error: 'overlap', index: 0 });
      expect(checkDecor(decor([{ id: POT, x: 0, y: OUT }]), room)).toEqual({ ok: false, error: 'overlap', index: 0 });
      expect(checkDecor(decor([{ id: CLOCK, x: 1, y: OUT }, { id: POT, x: 1, y: OUT }]), room)).toEqual({ ok: true });
    }
  });

  test('deux éléments de la même sorte ne se chevauchent pas dehors non plus ; dehors et dedans ne se gênent pas', () => {
    expect(checkDecor(decor([{ id: POT, x: 5, y: OUT }, { id: POT, x: 5.5, y: OUT }]), A3)).toEqual({ ok: false, error: 'overlap', index: 1 });
    expect(checkDecor(decor([{ id: CLOCK, x: 5, y: OUT }, { id: CLOCK, x: 5, y: 0 }, { id: POT, x: 5, y: OUT }, { id: POT, x: 5, y: 6 }]), A3)).toEqual({ ok: true });
  });

  test('une rangée de fontaines dehors ne ferme rien dans la pièce : la règle de passage n\'y compte que la pièce', () => {
    const row = Array.from({ length: A3.width }, (_, x) => ({ id: FOUNTAIN, x, y: OUT }));
    expect(checkDecor(decor(row), A3)).toEqual({ ok: true });
    expect(blockedCells(row, A3.width).size).toBe(A3.width);
  });

  test('le dehors compte dans les 80 éléments', () => {
    const inside = Array.from({ length: MAX_DECOR_ITEMS - 1 }, () => ({ id: 'of-14-12', x: 0, y: 0 }));
    expect(checkDecor(decor([...inside, { id: POT, x: 5, y: OUT }, { id: POT, x: 6, y: OUT }]), A3)).toEqual({ ok: false, error: 'too_many' });
  });

  test('une pièce sans dehors : rien ne se pose sous son mur sud', () => {
    expect(checkDecor(decor([{ id: POT, x: 5, y: OUT }]), STANDARD)).toEqual({ ok: false, error: 'out_of_room', index: 0 });
    expect(checkDecor(decor([{ id: CLOCK, x: 5, y: OUT }]), STANDARD)).toEqual({ ok: false, error: 'bad_position', index: 0 });
  });

  test('une déco qui suit son occupant dans un bureau de l\'autre rangée : le dehors suit les mêmes règles que le dedans', () => {
    // Une fontaine dans l'axe de la colonne 3 : rien ne la gêne en bas (A3), elle bloquerait la porte en haut (A1).
    const below = decor([{ id: FOUNTAIN, x: 3, y: OUT }]);
    expect(checkDecor(below, A3)).toEqual({ ok: true });
    expect(checkDecor(below, A1)).toEqual({ ok: false, error: 'blocks_door', index: 0 });
    // Une horloge à la colonne 8 : libre devant A1, sur l'interrupteur devant A2.
    expect(checkDecor(decor([{ id: CLOCK, x: 8, y: OUT }]), A1)).toEqual({ ok: true });
    expect(checkDecor(decor([{ id: CLOCK, x: 8, y: OUT }]), A2)).toMatchObject({ ok: false });
  });

  test('libre, une pièce de la carte montre son poste et, devant elle, son dehors par défaut, le même pour toutes celles d\'une taille', () => {
    const front = (room: DeskRoomSpec) => defaultDeskDecor(room).items.filter((placed) => placed.y === OUT);
    for (const room of [A1, A2, A3, A5, A6]) {
      expect(checkDecor(defaultDeskDecor(room), room)).toEqual({ ok: true });
      expect(front(room).length).toBeGreaterThanOrEqual(1);
      expect(defaultDeskDecor(room).items.slice(0, -front(room).length)).toEqual(defaultDeskDecor({ ...room, outside: undefined }).items);
    }
    expect(front(A1)).toEqual(front(A3));
    expect(front(A5)).toEqual(front(A6));
    expect(front(STANDARD)).toEqual([]);
  });
});

describe('deskRoomSpecOf : le dehors que la carte donne', () => {
  // Une pièce de 3 × 2, sa porte au sud (colonne 1), sous elle sa bande de mur de deux rangées et une rangée libre ; à côté, d'autres sous lesquelles la rue
  // n'est pas libre.
  const spec = (rows: string[], zones: ZoneInput[] = []) =>
    deskRoomSpecOf(
      parseOfficeMap(
        buildTiledMap({
          ascii: rows,
          zones: [{ type: 'desk', name: 'P', x: 1, y: 1, w: 3, h: 2 }, { type: 'door', name: 'P', x: 2, y: 3, w: 1, h: 2 }, { type: 'spawn', x: 6, y: 6, w: 1, h: 1 }, ...zones],
          tileset: { name: 'dev', image: 'tiles.png' },
        }),
      ),
      'P',
    );
  const ROWS = ['########', '#...#..#', '#...#..#', '##.###.#', '##.###.#', '#......#', '#......#', '########'];

  test('une bande de mur percée de la porte, puis une rangée libre : un dehors, et l\'interrupteur posé sur la bande en est un obstacle', () => {
    expect(spec(ROWS)?.outside).toEqual({ fixtures: [] });
    expect(spec(ROWS, [{ type: 'switch', x: 3, y: 4, w: 1, h: 1 }])?.outside).toEqual({ fixtures: [{ x: 2, y: 3, w: 1, h: 1 }] });
    // Un interrupteur ailleurs n'en est pas un.
    expect(spec(ROWS, [{ type: 'switch', x: 5, y: 4, w: 1, h: 1 }])?.outside).toEqual({ fixtures: [] });
  });

  test('pas de dehors sans mur sous la pièce, ni sans rue libre dessous', () => {
    expect(spec(ROWS.map((row, y) => (y === 3 ? '#....#.#' : row)))?.outside).toBeUndefined();
    expect(spec(ROWS.map((row, y) => (y === 5 ? '#..#...#' : row)))?.outside).toBeUndefined();
    expect(spec(ROWS)?.width).toBe(3);
  });
});
