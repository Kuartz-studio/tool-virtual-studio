// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEV_AVATAR_KEYS, DEV_OFFICE, OFFICE, TILE_SIZE, buildTiledMap, parseOfficeMap, type TiledMapJson } from '@bureau/shared';
import { PNG } from 'pngjs';
import { describe, expect, test } from 'vitest';
import { ASSETS_DIR, DEV_TILESET, devAssetFiles, renderAvatarSheet, renderTiles } from './gen-dev-assets';

const REGENERATE = 'relancer : pnpm --filter @bureau/client gen:dev-assets, puis commiter les fichiers';
const readAsset = (path: string) => readFileSync(resolve(ASSETS_DIR, path));
const readMap = (): TiledMapJson => JSON.parse(readAsset('maps/dev-office.json').toString('utf8')) as TiledMapJson;

// Les pixels (RGBA) de la case de 32 × 32 px de la ligne `row` et de la colonne `col` d'une planche.
function cell(sheet: PNG, col: number, row: number): number[] {
  const pixels: number[] = [];
  for (let y = row * TILE_SIZE; y < (row + 1) * TILE_SIZE; y++) {
    for (let x = col * TILE_SIZE; x < (col + 1) * TILE_SIZE; x++) {
      const o = (y * sheet.width + x) * 4;
      pixels.push(sheet.data[o]!, sheet.data[o + 1]!, sheet.data[o + 2]!, sheet.data[o + 3]!);
    }
  }
  return pixels;
}
const mirrorRow = (pixels: number[]): number[] => {
  const out: number[] = [];
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = TILE_SIZE - 1; x >= 0; x--) out.push(...pixels.slice((y * TILE_SIZE + x) * 4, (y * TILE_SIZE + x) * 4 + 4));
  }
  return out;
};
const opaquePixels = (pixels: number[]) => pixels.filter((_, i) => i % 4 === 3 && pixels[i] === 255).length;

describe('dev-office.json', () => {
  test('le fichier commité est ce que produit buildTiledMap(DEV_OFFICE) : la carte ne peut pas s\'écarter de la définition partagée', () => {
    expect(readMap(), REGENERATE).toEqual(buildTiledMap({ ...DEV_OFFICE, tileset: DEV_TILESET }));
  });

  test('le serveur la lit : apparition au centre de la case (2, 7), 109 cases bloquantes', () => {
    const map = parseOfficeMap(readMap());
    expect(map.spawn).toEqual({ x: 80, y: 240 });
    expect(map.blocked.reduce((sum, blocked) => sum + blocked, 0)).toBe(109);
  });

  test('l\'image de son tileset, relative au fichier de la carte, existe et a la taille annoncée', () => {
    const [tileset] = readMap().tilesets;
    expect(tileset && 'image' in tileset).toBe(true);
    const { image, imagewidth, imageheight } = tileset as { image: string; imagewidth: number; imageheight: number };
    const file = resolve(ASSETS_DIR, 'maps', image);
    expect(existsSync(file), `${file} introuvable`).toBe(true);
    const png = PNG.sync.read(readFileSync(file));
    expect([png.width, png.height]).toEqual([imagewidth, imageheight]);
  });
});

describe('office.json', () => {
  const readOffice = (): TiledMapJson => JSON.parse(readAsset('maps/office.json').toString('utf8')) as TiledMapJson;

  test('le fichier commité est ce que produit buildTiledMap(OFFICE)', () => {
    expect(readOffice(), REGENERATE).toEqual(buildTiledMap({ ...OFFICE, tileset: DEV_TILESET }));
  });

  test('le serveur la lit : 20 bureaux et leurs 20 portes, apparition dans l\'accueil', () => {
    const map = parseOfficeMap(readOffice());
    expect(map.zones.filter((zone) => zone.type === 'desk')).toHaveLength(20);
    expect(map.zones.filter((zone) => zone.type === 'door')).toHaveLength(20);
    expect(map.spawn).toEqual({ x: 48 * 32 + 16, y: 36 * 32 + 16 });
  });
});

describe('tiles.png', () => {
  test('le fichier commité est ce que dessine le script : 5 tuiles de 32 px sur une ligne', () => {
    const committed = PNG.sync.read(readAsset('dev/tiles.png'));
    const fresh = renderTiles();
    expect([committed.width, committed.height]).toEqual([5 * 32, 32]);
    expect(committed.data.equals(fresh.data), REGENERATE).toBe(true);
  });

  test('chaque tuile est opaque et se distingue des autres', () => {
    const sheet = renderTiles();
    const tiles = [0, 1, 2, 3, 4].map((col) => cell(sheet, col, 0));
    for (const tile of tiles) expect(opaquePixels(tile)).toBe(32 * 32);
    expect(new Set(tiles.map((tile) => tile.join(','))).size).toBe(5);
  });
});

describe('avatars', () => {
  test.each(DEV_AVATAR_KEYS)('%s : le fichier commité est ce que dessine le script, en 96 × 128 px', (key) => {
    const committed = PNG.sync.read(readAsset(`dev/avatars/${key}.png`));
    expect([committed.width, committed.height]).toEqual([3 * 32, 4 * 32]);
    expect(committed.data.equals(renderAvatarSheet(key).data), REGENERATE).toBe(true);
  });

  test('les 12 images d\'une planche sont des personnages aux pieds en bas, transparents autour', () => {
    const sheet = renderAvatarSheet('dev-red');
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 3; col++) {
        const pixels = cell(sheet, col, row);
        const alpha = (x: number, y: number) => pixels[(y * TILE_SIZE + x) * 4 + 3];
        expect(opaquePixels(pixels), `ligne ${row}, colonne ${col}`).toBeGreaterThan(250);
        expect(alpha(0, 0)).toBe(0);
        expect(alpha(31, 0)).toBe(0);
        expect(alpha(0, 31)).toBe(0);
        expect(alpha(31, 31)).toBe(0);
        // l'origine du sprite est aux pieds : la dernière rangée d'une case touche le personnage
        expect(Array.from({ length: TILE_SIZE }, (_, x) => alpha(x, TILE_SIZE - 1)).some((a) => a === 255), `pieds, ligne ${row}, colonne ${col}`).toBe(true);
      }
    }
  });

  test('colonnes immobile, pas 1, pas 2 : trois images différentes par direction ; quatre directions différentes', () => {
    const sheet = renderAvatarSheet('dev-blue');
    for (let row = 0; row < 4; row++) {
      const frames = [0, 1, 2].map((col) => cell(sheet, col, row).join(','));
      expect(new Set(frames).size, `ligne ${row}`).toBe(3);
    }
    const idle = [0, 1, 2, 3].map((row) => cell(sheet, 0, row).join(','));
    expect(new Set(idle).size).toBe(4);
  });

  test('la ligne « droite » est la ligne « gauche » retournée', () => {
    const sheet = renderAvatarSheet('dev-green');
    for (const col of [0, 1, 2]) expect(cell(sheet, col, 2)).toEqual(mirrorRow(cell(sheet, col, 1)));
  });

  test('chaque couleur a sa planche', () => {
    const sheets = DEV_AVATAR_KEYS.map((key) => renderAvatarSheet(key).data.toString('base64'));
    expect(new Set(sheets).size).toBe(DEV_AVATAR_KEYS.length);
  });
});

test('le script écrit exactement les fichiers attendus', () => {
  expect(devAssetFiles().map((file) => file.path)).toEqual([
    'dev/tiles.png',
    'dev/avatars/dev-red.png',
    'dev/avatars/dev-blue.png',
    'dev/avatars/dev-green.png',
    'dev/avatars/dev-yellow.png',
    'maps/dev-office.json',
    'maps/office.json',
  ]);
  for (const { path } of devAssetFiles()) expect(existsSync(resolve(ASSETS_DIR, path)), path).toBe(true);
});
