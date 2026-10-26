import { describe, expect, test } from 'vitest';
import {
  DEFAULT_DESK_DECOR,
  FLOOR_LOOKS,
  FLOOR_THEMES,
  SHOP_WALL_THEMES,
  THEME_COLORS,
  THEME_MATERIALS,
  WALL_LOOKS,
  WALL_THEMES,
  checkDecor,
  floorTheme,
  isFloorTheme,
  isWallTheme,
  shopPriceOf,
  tileAnimation,
  wallTheme,
  type ThemeLook,
} from '../src';

const floors: Array<{ id: string; look: ThemeLook | undefined }> = FLOOR_THEMES.map((theme) => ({ id: theme.id, look: FLOOR_LOOKS[theme.id] }));
const walls: Array<{ id: string; look: ThemeLook | undefined }> = [...WALL_THEMES, ...SHOP_WALL_THEMES].map((theme) => ({ id: theme.id, look: WALL_LOOKS[theme.id] }));

describe('la couleur et la matière de chaque thème', () => {
  test('chaque sol et chaque mur, ceux de la boutique compris, a une couleur et une matière des listes ; aucun thème inconnu n\'en a', () => {
    for (const { id, look } of [...floors, ...walls]) {
      expect(THEME_COLORS, id).toContain(look?.color);
      expect(THEME_MATERIALS, id).toContain(look?.material);
    }
    expect(Object.keys(FLOOR_LOOKS).sort()).toEqual(floors.map((floor) => floor.id).sort());
    expect(Object.keys(WALL_LOOKS).sort()).toEqual(walls.map((wall) => wall.id).sort());
  });

  test('chaque couleur et chaque matière des listes sert : le sélecteur ne propose rien de vide', () => {
    const looks = [...floors, ...walls].map((theme) => theme.look!);
    for (const color of THEME_COLORS) expect(looks.some((look) => look.color === color), color).toBe(true);
    for (const material of THEME_MATERIALS) expect(looks.some((look) => look.material === material), material).toBe(true);
  });

  test('quelques thèmes, d\'après leur dessin : le marbre est une pierre, le lin rayé un motif, la moquette lilas une moquette violette', () => {
    expect(FLOOR_LOOKS.marbre).toEqual({ color: 'blanc', material: 'pierre' });
    expect(WALL_LOOKS.lin).toEqual({ color: 'beige', material: 'motif' });
    expect(FLOOR_LOOKS.lilas).toEqual({ color: 'violet', material: 'moquette' });
    expect(WALL_LOOKS['mur-marbre-or']).toEqual({ color: 'noir', material: 'pierre' });
  });
});

describe('les sols et les murs noirs', () => {
  const blackFloors = ['bois-noir', 'moquette-noire', 'carrelage-noir', 'noir-mat'] as const;
  const blackWalls = ['noir-mat', 'lambris-noir', 'brique-noire', 'carrelage-noir'] as const;

  test('quatre sols (bois, moquette, carrelage, uni) et quatre murs (uni, bois, brique, carrelage), tous noirs', () => {
    expect(blackFloors.map((id) => FLOOR_LOOKS[id])).toEqual(['bois', 'moquette', 'carrelage', 'uni'].map((material) => ({ color: 'noir', material })));
    expect(blackWalls.map((id) => WALL_LOOKS[id])).toEqual(['uni', 'bois', 'brique', 'carrelage'].map((material) => ({ color: 'noir', material })));
  });

  test('libres et fixes : aucun n\'a de prix, aucune de leurs tuiles ne bouge', () => {
    for (const id of blackWalls) {
      expect(shopPriceOf(id), id).toBeUndefined();
      const wall = wallTheme(id)!;
      for (const gid of [wall.top, wall.bottom, wall.stem]) expect(tileAnimation(gid), `${id} ${gid}`).toBeUndefined();
    }
    for (const id of blackFloors) expect(tileAnimation(floorTheme(id)!.gid), id).toBeUndefined();
  });

  test('le serveur les accepte : ce sont des thèmes que checkDecor connaît', () => {
    for (const id of blackFloors) expect(isFloorTheme(id), id).toBe(true);
    for (const id of blackWalls) expect(isWallTheme(id), id).toBe(true);
    expect(checkDecor({ ...DEFAULT_DESK_DECOR, floor: 'noir-mat', wall: 'brique-noire', items: [] })).toEqual({ ok: true });
  });
});
