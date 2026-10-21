// Les couleurs de la carte de développement et d'un personnage, lues dans les images mêmes de l'appli : les tests de pixels (world.spec.ts)
// reconnaissent à l'écran des couleurs exactes, que le jeu dessine sans lissage. Ce qu'elles valent vient des fichiers servis
// (apps/client/public/assets), et non de nombres recopiés : changer d'images ne casse pas ces tests.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DEV_TILE, TILESET } from '../packages/shared/src/index';

export type Rgb = readonly [number, number, number];

interface Decoded {
  width: number;
  height: number;
  data: Uint8Array;
}

// pngjs est une dépendance du client : on le lit où il est.
const { PNG } = createRequire(import.meta.url)('../apps/client/node_modules/pngjs') as { PNG: { sync: { read(buffer: Buffer): Decoded } } };
const assets = (path: string): string => fileURLToPath(new URL(`../apps/client/public/assets/${path}`, import.meta.url));
const decode = (path: string): Decoded => PNG.sync.read(readFileSync(assets(path)));

const tiles = decode('tiles/office.png');
const premade = decode('characters/premade.png');

function pixelOf(image: Decoded, x: number, y: number): { rgb: Rgb; alpha: number } {
  const i = (y * image.width + x) * 4;
  return { rgb: [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!], alpha: image.data[i + 3]! };
}

const TILE = 32;
const tileOrigin = (gid: number) => ({ x: ((gid - 1) % TILESET.columns) * TILE, y: Math.floor((gid - 1) / TILESET.columns) * TILE });

// La couleur du pixel (x, y) d'une tuile du jeu de tuiles.
export function tilePixel(gid: number, x: number, y: number): Rgb {
  const origin = tileOrigin(gid);
  return pixelOf(tiles, origin.x + x, origin.y + y).rgb;
}

// Les couleurs d'une tuile, de la plus fréquente à la moins fréquente.
function tileColors(gid: number): Rgb[] {
  const counts = new Map<string, number>();
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const key = tilePixel(gid, x, y).join(',');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key.split(',').map(Number) as unknown as Rgb);
}

const dominant = (gid: number): Rgb => tileColors(gid)[0]!;

// Les tuiles de la petite carte (DEV_TILE) : la couleur la plus fréquente de chacune, qu'on retrouve à l'écran par centaines.
export const MAP_COLORS: Record<string, Rgb> = {
  sol: dominant(DEV_TILE.floor),
  mur: dominant(DEV_TILE.wall),
  bureau: dominant(DEV_TILE.desk),
  'sol de la salle de réunion': dominant(DEV_TILE.roomFloor),
  'sol d\'un espace de bureau': dominant(DEV_TILE.deskFloor),
  // Le texte des étiquettes (map-layers.ts, #3b4256).
  'texte de l\'étiquette': [59, 66, 86],
};

// Toutes les couleurs de la carte de développement, pour savoir ce qui n'est pas elle.
const MAP_TILE_COLORS = new Set(Object.values(DEV_TILE).flatMap((gid) => tileColors(gid).map((color) => color.join(','))));

// Le personnage que les tests se donnent (PATCH /api/me) : un personnage prêt à l'emploi, le premier. `AVATAR_COLORS` : toutes les couleurs
// de son image de face, immobile ; `SHIRT` : la plus fréquente de celles qu'aucune tuile de la carte n'a (la chemise, hors des contours) ;
// `shirtAt` : où elle est dans l'image de 32 × 64 px (milieu des pixels, x depuis le bord gauche, y depuis le haut).
export const TEST_AVATAR_KEY = 'p.01';
const DOWN_FRAME_X = 18 * TILE;

const avatarCounts = new Map<string, { count: number; xs: number[]; ys: number[] }>();
for (let y = 0; y < 64; y++) {
  for (let x = 0; x < TILE; x++) {
    const { rgb, alpha } = pixelOf(premade, DOWN_FRAME_X + x, y);
    if (alpha !== 255) continue;
    const entry = avatarCounts.get(rgb.join(',')) ?? { count: 0, xs: [], ys: [] };
    entry.count++;
    entry.xs.push(x);
    entry.ys.push(y);
    avatarCounts.set(rgb.join(','), entry);
  }
}

export const AVATAR_COLORS: readonly Rgb[] = [...avatarCounts.keys()].map((key) => key.split(',').map(Number) as unknown as Rgb);

const shirtKey = [...avatarCounts.entries()]
  .filter(([key]) => !MAP_TILE_COLORS.has(key) && key !== MAP_COLORS['texte de l\'étiquette']!.join(','))
  .sort((a, b) => b[1].count - a[1].count)[0]![0];
export const SHIRT: Rgb = shirtKey.split(',').map(Number) as unknown as Rgb;

const shirt = avatarCounts.get(shirtKey)!;
export const shirtAt = {
  // Le centre de la chemise, dans l'image : son décalage au milieu de l'image (16, 32) dit où elle est par rapport à ce que la caméra suit.
  x: (Math.min(...shirt.xs) + Math.max(...shirt.xs)) / 2 + 0.5,
  y: (Math.min(...shirt.ys) + Math.max(...shirt.ys)) / 2 + 0.5,
  // Un de ses pixels, le plus près de son centre, pour sonder la couleur à un endroit précis.
  pixel: (() => {
    const cx = (Math.min(...shirt.xs) + Math.max(...shirt.xs)) / 2;
    const cy = (Math.min(...shirt.ys) + Math.max(...shirt.ys)) / 2;
    let best = 0;
    shirt.xs.forEach((x, i) => {
      if (Math.hypot(x - cx, shirt.ys[i]! - cy) < Math.hypot(shirt.xs[best]! - cx, shirt.ys[best]! - cy)) best = i;
    });
    return { x: shirt.xs[best]!, y: shirt.ys[best]! };
  })(),
};

export const AVATAR_FRAME = { width: TILE, height: 64 };
