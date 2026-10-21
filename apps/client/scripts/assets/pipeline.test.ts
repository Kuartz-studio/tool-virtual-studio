import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CHARACTER_PARTS, DECOR_CATEGORIES, DECOR_ITEMS, FLOOR_THEMES, POOL_TILES, TILESET, WALL_THEMES } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { Img, readImage } from './image';
import { ATLAS_MARGIN, packImages } from './pack';
import { extract, segmentSheet } from './segment';
import { ASSETS_DIR } from './build-assets';
import { mapFiles, MAPS_DIR } from './build-map';
import { BIG_FOOTPRINT_CELLS, BIG_ITEM_TILES, defaultsOf, type ResolvedEntry } from './decor';
import { readFileSync } from 'node:fs';

const solid = (w: number, h: number, a = 255): Img => {
  const img = new Img(w, h);
  img.fillRect(0, 0, w, h, { r: 200, g: 50, b: 50, a });
  return img;
};

describe('la découpe d\'une planche (segment.ts)', () => {
  test('deux objets séparés par du vide sont deux objets, rangés de haut en bas puis de gauche à droite', () => {
    const sheet = new Img(128, 96);
    sheet.paste(solid(20, 40), 70, 4);
    sheet.paste(solid(20, 20), 5, 5);
    const found = segmentSheet(sheet);
    expect(found.map(({ tx, ty, tw, th }) => ({ tx, ty, tw, th }))).toEqual([
      { tx: 0, ty: 0, tw: 1, th: 1 },
      { tx: 2, ty: 0, tw: 1, th: 2 },
    ]);
  });

  test('l\'image d\'un objet ne garde que ses pixels : un voisin qui déborde dans son rectangle n\'y est pas', () => {
    const sheet = new Img(96, 64);
    sheet.paste(solid(20, 20), 4, 4);
    sheet.paste(solid(10, 10), 40, 4);   // un autre objet, dans la case voisine
    const [first, second] = segmentSheet(sheet);
    expect(extract(sheet, first!).get(5, 5).a).toBe(255);
    expect(extract(sheet, first!).isEmpty()).toBe(false);
    expect(extract(sheet, second!).get(5, 5).a).toBe(0);   // la case 1 n'est pas le coin de l'objet de gauche
  });

  test('un objet de plusieurs pixels disjoints en diagonale reste un seul objet (8 voisins)', () => {
    const sheet = new Img(64, 64);
    sheet.set(1, 1, { r: 1, g: 1, b: 1, a: 255 });
    sheet.set(2, 2, { r: 1, g: 1, b: 1, a: 255 });
    expect(segmentSheet(sheet)).toHaveLength(1);
  });
});

describe('l\'atlas (pack.ts)', () => {
  test('les images tiennent dans la largeur, ne se touchent pas, et chacune se retrouve à sa place', () => {
    const inputs = [solid(64, 96), solid(32, 32), solid(96, 64), solid(32, 64), solid(160, 96)].map((image, i) => ({ key: `k${i}`, image }));
    const { atlas, frames } = packImages(inputs, 256);
    expect(atlas.width).toBe(256);
    const rects = [...frames.values()];
    for (const [i, a] of rects.entries()) {
      expect(a.x + a.w + ATLAS_MARGIN).toBeLessThanOrEqual(256);
      for (const b of rects.slice(i + 1)) {
        const apart = a.x + a.w + ATLAS_MARGIN <= b.x || b.x + b.w + ATLAS_MARGIN <= a.x || a.y + a.h + ATLAS_MARGIN <= b.y || b.y + b.h + ATLAS_MARGIN <= a.y;
        expect(apart).toBe(true);
      }
    }
    const f = frames.get('k2')!;
    expect(atlas.get(f.x + 1, f.y + 1).a).toBe(255);
  });

  test('une image plus large que l\'atlas : refusée', () => {
    expect(() => packImages([{ key: 'big', image: solid(300, 10) }], 256)).toThrow(/ne tient pas/);
  });
});

// Ce que les images du pack sont devenues dans l'appli : le dépôt garde les fichiers produits (le pack lui-même n'y est pas), on vérifie qu'ils
// sont complets et cohérents avec les listes générées.
describe('les assets rangés dans l\'appli', () => {
  test('un atlas par catégorie, et chaque élément est dans le sien', () => {
    expect(DECOR_CATEGORIES.length).toBeLessThanOrEqual(10);
    for (const { id } of DECOR_CATEGORIES) {
      const path = join(ASSETS_DIR, 'decor', `${id}.png`);
      expect(existsSync(path), id).toBe(true);
      const atlas = readImage(path);
      for (const item of DECOR_ITEMS.filter((i) => i.cat === id)) {
        expect(item.fx + item.w * 32, item.id).toBeLessThanOrEqual(atlas.width);
        expect(item.fy + item.h * 32, item.id).toBeLessThanOrEqual(atlas.height);
        expect(atlas.crop(item.fx, item.fy, item.w * 32, item.h * 32).isEmpty(), item.id).toBe(false);
      }
    }
  });

  test('le jeu de tuiles contient tous les sols, les murs et la piscine cités', () => {
    const tiles = readImage(join(ASSETS_DIR, 'tiles/office.png'));
    expect(tiles.width).toBe(TILESET.columns * 32);
    expect(tiles.height).toBe(Math.ceil(TILESET.tileCount / TILESET.columns) * 32);
    const gids = [
      ...FLOOR_THEMES.map((f) => f.gid),
      ...WALL_THEMES.flatMap((w) => [w.top, w.bottom, w.stem]),
      ...Object.values(POOL_TILES),
    ];
    for (const gid of gids) {
      expect(gid).toBeGreaterThanOrEqual(1);
      expect(gid).toBeLessThanOrEqual(TILESET.tileCount);
      const index = gid - 1;
      expect(tiles.crop((index % TILESET.columns) * 32, Math.floor(index / TILESET.columns) * 32, 32, 32).isEmpty(), `tuile ${gid}`).toBe(false);
    }
  });

  test('chaque pièce du personnage a son fichier, à la bonne hauteur (128 px par variante), et ses imagettes', () => {
    const dir = join(ASSETS_DIR, 'characters');
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(readImage(join(dir, 'bodies.png')).height).toBe(128 * CHARACTER_PARTS.bodies);
    expect(readImage(join(dir, 'eyes.png')).height).toBe(128 * CHARACTER_PARTS.eyes);
    expect(readImage(join(dir, 'premade.png')).height).toBe(128 * CHARACTER_PARTS.premade);
    const thumbs = readImage(join(dir, 'thumbs.png'));
    const thumbOk = (index: number) => {
      const { columns } = CHARACTER_PARTS.thumbs;
      return !thumbs.crop((index % columns) * 32, Math.floor(index / columns) * 64, 32, 64).isEmpty();
    };
    expect(thumbOk(CHARACTER_PARTS.thumbs.bodies)).toBe(true);
    expect(thumbOk(CHARACTER_PARTS.thumbs.premade + CHARACTER_PARTS.premade - 1)).toBe(true);
    for (const [folder, families] of [['outfits', CHARACTER_PARTS.outfits], ['hair', CHARACTER_PARTS.hair], ['accessories', CHARACTER_PARTS.accessories]] as const) {
      for (const family of families) {
        expect(readImage(join(dir, folder, `${pad(family.number)}.png`)).height, `${folder} ${family.number}`).toBe(128 * family.variants);
        expect(thumbOk(family.thumb + family.variants - 1), `${folder} ${family.number}`).toBe(true);
      }
    }
  });

  test('les cartes écrites sont celles que la définition partagée produit (relancer gen:map ne change rien)', () => {
    for (const { path, content } of mapFiles()) {
      expect(readFileSync(join(MAPS_DIR, path), 'utf8'), path).toBe(content);
    }
  });
});

describe('qui arrête l\'avatar : les gros éléments seuls', () => {
  const entry = (cat: ResolvedEntry['cat'], rect: ResolvedEntry['rect'], more: Partial<ResolvedEntry> = {}): ResolvedEntry => ({ sheet: 'of', name: 'x', cat, rect, ...more });

  test('un petit meuble se traverse, un gros l\'arrête', () => {
    expect([BIG_ITEM_TILES, BIG_FOOTPRINT_CELLS]).toEqual([3, 2]);
    // Une plante d'une seule case, petite ou haute : traversable ; un palmier (2 cases au sol) : non.
    expect(defaultsOf(entry('plantes', [6, 10, 1, 2])).solid).toBe(false);
    expect(defaultsOf(entry('plantes', [6, 7, 1, 3])).solid).toBe(false);
    expect(defaultsOf(entry('plantes', [13, 0, 2, 2])).solid).toBe(true);
    // Un bureau, une bibliothèque, un frigo (1 case au sol mais 3 d'image) : gros.
    expect(defaultsOf(entry('bureaux', [7, 28, 3, 2])).solid).toBe(true);
    expect(defaultsOf(entry('rangement', [3, 13, 2, 2])).solid).toBe(true);
    expect(defaultsOf(entry('cafe', [9, 23, 1, 3])).solid).toBe(true);
    // Une petite table (1 × 2 cases d'image, 1 au sol) et une imprimante d'une case : traversables.
    expect(defaultsOf(entry('rangement', [0, 0, 1, 2], { claim: 1 })).solid).toBe(false);
  });

  test('les sièges, les objets posés sur un meuble et les tapis ne bloquent jamais, même grands', () => {
    expect(defaultsOf(entry('sieges', [1, 28, 3, 2])).solid).toBe(false);
    expect(defaultsOf(entry('ecrans', [14, 12, 3, 3])).solid).toBe(false);
    expect(defaultsOf(entry('deco', [0, 0, 4, 3], { kind: 'floor' })).solid).toBe(false);
  });

  test('la curation peut dire solid elle-même, dans un sens comme dans l\'autre', () => {
    expect(defaultsOf(entry('plantes', [6, 10, 1, 2], { solid: true })).solid).toBe(true);
    expect(defaultsOf(entry('bureaux', [7, 28, 3, 2], { solid: false })).solid).toBe(false);
  });

  test('dans la banque : aucune plante d\'une case ne bloque, et les gros meubles bloquent tous', () => {
    const plants = DECOR_ITEMS.filter((item) => item.cat === 'plantes' && item.kind === 'object');
    expect(plants.length).toBeGreaterThan(5);
    for (const plant of plants) expect(plant.solid, plant.name).toBe(plant.w * plant.claim >= BIG_FOOTPRINT_CELLS);
    const bigDesks = DECOR_ITEMS.filter((item) => item.cat === 'bureaux' && item.kind === 'object' && item.w * item.h >= 6);
    expect(bigDesks.length).toBeGreaterThan(10);
    for (const desk of bigDesks) expect(desk.solid, desk.name).toBe(true);
  });
});
