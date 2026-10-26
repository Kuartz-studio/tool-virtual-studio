import { join } from 'node:path';
import { FLOOR_THEMES, POOL_TILES, SHOP_WALL_THEMES, TILE_ANIMATIONS, TILESET, WALL_THEMES } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { BLACK_FLOOR_PICKS, BLACK_WALL_PICKS, DARKEST, blacken, isWallFrame, luminance } from './black-themes';
import { ASSETS_DIR } from './build-assets';
import { Img, readImage, type Rgba } from './image';
import { rgb } from './pixel-art';
import { CAP, OUTLINE } from './shop-walls';

// Une rangée de pixels de ces couleurs.
const strip = (colors: readonly Rgba[]): Img => {
  const img = new Img(colors.length, 1);
  colors.forEach((color, x) => img.set(x, 0, color));
  return img;
};
const pixels = (img: Img): Rgba[] => Array.from({ length: img.width }, (_, x) => img.get(x, 0));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('porter une matière vers le noir (blacken)', () => {
  test('la couleur la plus présente prend le noir du ton ; les autres gardent leur écart de luminosité, multiplié par le contraste', () => {
    const grey = (v: number) => rgb(v, v, v);
    const [dark] = blacken([strip([grey(200), grey(200), grey(220), grey(180)])], { body: grey(30), contrast: 0.5 });
    expect(pixels(dark!)).toEqual([grey(30), grey(30), grey(40), grey(20)]);
  });

  test('le noir garde la teinte du ton, plus clair comme plus sombre, et ne descend jamais sous le plus sombre permis', () => {
    const [dark] = blacken([strip([rgb(200, 180, 150), rgb(200, 180, 150), rgb(10, 10, 10), rgb(255, 255, 255)])], { body: rgb(40, 34, 32), contrast: 0.6 });
    const [, , deepest, lightest] = pixels(dark!);
    expect(luminance(deepest!)).toBeCloseTo(DARKEST, 0);
    expect(deepest!.r > deepest!.g && deepest!.g > deepest!.b, 'un noir brun, comme le ton').toBe(true);
    expect(luminance(lightest!)).toBeGreaterThan(luminance(rgb(40, 34, 32)));
    expect(lightest!.r / lightest!.g).toBeCloseTo(40 / 34, 1);
    expect(lightest!.b / lightest!.g).toBeCloseTo(32 / 34, 1);
  });

  test('les tuiles passées ensemble suivent la même règle ; la construction d\'un mur et le transparent ne changent pas', () => {
    const clear: Rgba = { r: 0, g: 0, b: 0, a: 0 };
    const paint = rgb(150, 90, 70);
    // La couleur la plus présente est dans la première tuile : la seconde se règle sur elle.
    const [first, second] = blacken(
      [strip([paint, paint, paint, OUTLINE]), strip([CAP, rgb(170, 110, 90), clear, paint])],
      { body: rgb(30, 30, 34), contrast: 1 },
      isWallFrame,
    );
    expect(pixels(first!)).toEqual([rgb(30, 30, 34), rgb(30, 30, 34), rgb(30, 30, 34), OUTLINE]);
    const [cap, lighter, hole, same] = pixels(second!);
    expect([cap, hole, same]).toEqual([CAP, clear, rgb(30, 30, 34)]);
    expect(luminance(lighter!)).toBeCloseTo(luminance(rgb(30, 30, 34)) + luminance(rgb(170, 110, 90)) - luminance(paint), 0);
  });
});

// Ce que le jeu de tuiles est devenu : le dépôt garde l'image produite (le pack n'y est pas), on la vérifie.
describe('les sols et les murs noirs du jeu de tuiles', () => {
  const tiles = readImage(join(ASSETS_DIR, 'tiles/office.png'));
  const crop = (gid: number) => tiles.crop(((gid - 1) % TILESET.columns) * 32, Math.floor((gid - 1) / TILESET.columns) * 32, 32, 32);
  const floorIds = new Set(BLACK_FLOOR_PICKS.map((pick) => pick.id));
  const wallIds = new Set(BLACK_WALL_PICKS.map((pick) => pick.id));
  const floors = FLOOR_THEMES.filter((theme) => floorIds.has(theme.id));
  const walls = WALL_THEMES.filter((theme) => wallIds.has(theme.id));
  const gids = [...floors.map((floor) => floor.gid), ...walls.flatMap((wall) => [wall.top, wall.bottom, wall.stem])];

  test('quatre sols et quatre murs, libres, aux noms demandés', () => {
    expect(floors.map((floor) => floor.label)).toEqual(['Bois noir', 'Moquette noire', 'Carrelage noir', 'Noir mat']);
    expect(walls.map((wall) => wall.label)).toEqual(['Noir mat', 'Lambris noir', 'Brique noire', 'Carrelage noir']);
    expect(SHOP_WALL_THEMES.map((wall): string => wall.id).filter((id) => wallIds.has(id))).toEqual([]);
  });

  test('leurs tuiles sont les dernières du jeu de tuiles : celles d\'avant gardent leur numéro (la carte, la piscine, la boutique, les murs qui bougent)', () => {
    expect(gids).toEqual(range(TILESET.tileCount - 15, TILESET.tileCount));
    expect(FLOOR_THEMES.filter((theme) => !floorIds.has(theme.id)).map((floor) => floor.gid)).toEqual(range(1, 22));
    expect(WALL_THEMES.filter((theme) => !wallIds.has(theme.id)).flatMap((wall) => [wall.top, wall.bottom, wall.stem])).toEqual(range(23, 82));
    expect(Object.values(POOL_TILES)).toEqual(range(83, 91));
    expect(SHOP_WALL_THEMES.flatMap((wall) => [wall.top, wall.bottom, wall.stem])).toEqual(range(92, 127));
    expect(Math.max(...TILE_ANIMATIONS.flatMap((animation) => animation.frames))).toBeLessThan(Math.min(...gids));
  });

  // La matière d'une tuile : ses pixels, sans la construction des murs.
  const material = (gid: number) => {
    const colors: Rgba[] = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (!isWallFrame(crop(gid).get(x, y))) colors.push(crop(gid).get(x, y));
    return colors;
  };

  test('noirs, et le grain lisible : sombres, jamais d\'un seul ton, même le noir mat', () => {
    for (const gid of gids) {
      const colors = material(gid);
      const lights = colors.map(luminance);
      expect(lights.reduce((sum, l) => sum + l, 0) / lights.length, `tuile ${gid}`).toBeLessThan(45);
      expect(new Set(colors.map((c) => `${c.r},${c.g},${c.b}`)).size, `tuile ${gid}`).toBeGreaterThanOrEqual(3);
      expect(Math.max(...lights) - Math.min(...lights), `tuile ${gid}`).toBeGreaterThanOrEqual(4);
    }
  });

  test('un mur noir est construit comme ceux du pack : le trait du haut, le liseré blanc et le trait dessous ; le trait du bas ; les deux traits du pan', () => {
    const row = (img: Img, y: number) => Array.from({ length: 32 }, (_, x) => img.get(x, y));
    const column = (img: Img, x: number) => Array.from({ length: 32 }, (_, y) => img.get(x, y));
    for (const wall of walls) {
      const [top, bottom, stem] = [crop(wall.top), crop(wall.bottom), crop(wall.stem)];
      for (const y of [0, 1, 10, 11]) expect(row(top, y), `${wall.id}, rangée ${y}`).toEqual(Array(32).fill(OUTLINE));
      for (const y of range(2, 9)) expect(row(top, y), `${wall.id}, rangée ${y}`).toEqual(Array(32).fill(CAP));
      expect(row(bottom, 31), wall.id).toEqual(Array(32).fill(OUTLINE));
      for (const x of [0, 1, 30, 31]) expect(column(stem, x), `${wall.id}, colonne ${x}`).toEqual(Array(32).fill(OUTLINE));
    }
  });
});
