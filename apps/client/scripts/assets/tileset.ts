// Le jeu de tuiles de la carte (public/assets/tiles/office.png) : les sols et les murs choisis dans le Room Builder de LimeZu, et les tuiles
// de la piscine, dessinées ici (le pack n'a pas d'eau). Les sols et les murs sont aussi les thèmes qu'une personne choisit pour son bureau :
// la liste (id, nom, numéro de tuile) est écrite dans packages/shared/src/decor/generated-themes.ts. Après eux, les images d'animation des murs de la
// boutique, qui bougent (tile-motion.ts, theme-motions.ts, shop-walls.ts) : une image identique à une autre de la même tuile n'est pas ajoutée deux fois. Les
// murs libres et les sols ne bougent pas.
import { join } from 'node:path';
import type { TilePhase } from '@bureau/shared';
import { Img, readImage, type Rgba } from './image';
import { sameImage } from './pixel-art';
import { SHOP_WALL_PICKS, drawShopWall, drawnWallMotion, isPackWall, type ShopWallTiles } from './shop-walls';
import { WALL_MOTIONS } from './theme-motions';
import { renderMotion, type Motion } from './tile-motion';

const ROOM_BUILDER = 'moderninteriors-win/1_Interiors/32x32/Room_Bulder_subfiles_32x32';

// Un sol du Room Builder : colonne (0 à 3) et rangée (0 à 17) du bloc de 3 × 2 cases ; la case du milieu en bas se répète sans raccord.
interface FloorPick {
  id: string;
  label: string;
  column: number;
  row: number;
}

export const FLOOR_PICKS: FloorPick[] = [
  { id: 'sable', label: 'Sable', column: 0, row: 10 },
  { id: 'creme', label: 'Crème', column: 1, row: 0 },
  { id: 'blanc', label: 'Carrelage blanc', column: 0, row: 1 },
  { id: 'marbre', label: 'Marbre clair', column: 1, row: 14 },
  { id: 'gris', label: 'Dalles grises', column: 2, row: 15 },
  { id: 'graphite', label: 'Graphite', column: 2, row: 13 },
  { id: 'beton', label: 'Béton', column: 1, row: 15 },
  { id: 'parquet-clair', label: 'Parquet clair', column: 0, row: 11 },
  { id: 'parquet-brun', label: 'Parquet brun', column: 1, row: 5 },
  { id: 'noyer', label: 'Noyer', column: 3, row: 12 },
  { id: 'parquet-rouge', label: 'Parquet rouge', column: 2, row: 5 },
  { id: 'chevrons', label: 'Chevrons', column: 2, row: 4 },
  { id: 'sauge', label: 'Sauge', column: 3, row: 0 },
  { id: 'menthe', label: 'Menthe', column: 3, row: 15 },
  { id: 'bleu', label: 'Bleu', column: 2, row: 14 },
  { id: 'bleu-clair', label: 'Bleu clair', column: 3, row: 14 },
  { id: 'lilas', label: 'Moquette lilas', column: 2, row: 8 },
  { id: 'rose', label: 'Rose poudré', column: 2, row: 2 },
  { id: 'damier', label: 'Damier brun', column: 1, row: 9 },
  { id: 'turquoise', label: 'Turquoise', column: 2, row: 11 },
  { id: 'pierre', label: 'Pierre claire', column: 2, row: 17 },
  { id: 'losanges', label: 'Losanges bleus', column: 3, row: 13 },
];

// Un mur du Room Builder : colonne (0 à 2) et rangée (0 à 19) de son bloc de 10 × 2 cases. On en prend la face (deux cases de haut : le haut
// avec son liseré, puis le bas avec sa plinthe) et le pan vertical.
interface WallPick {
  id: string;
  label: string;
  column: number;
  row: number;
}

export const WALL_PICKS: WallPick[] = [
  { id: 'gris-perle', label: 'Gris perle', column: 0, row: 2 },
  { id: 'creme', label: 'Crème', column: 0, row: 3 },
  { id: 'sauge-pale', label: 'Sauge pâle', column: 0, row: 6 },
  { id: 'brique-claire', label: 'Brique claire', column: 0, row: 8 },
  { id: 'sable', label: 'Sable', column: 0, row: 11 },
  { id: 'peche', label: 'Pêche', column: 0, row: 12 },
  { id: 'lin', label: 'Lin rayé', column: 0, row: 13 },
  { id: 'beton', label: 'Béton', column: 0, row: 15 },
  { id: 'anthracite', label: 'Anthracite', column: 0, row: 17 },
  { id: 'brun', label: 'Brun', column: 1, row: 7 },
  { id: 'bois-sombre', label: 'Bois sombre', column: 1, row: 9 },
  { id: 'rose-raye', label: 'Rose rayé', column: 1, row: 13 },
  { id: 'rouge', label: 'Rouge', column: 1, row: 16 },
  { id: 'bleu', label: 'Bleu', column: 1, row: 17 },
  { id: 'violet', label: 'Violet', column: 1, row: 18 },
  { id: 'bleu-ciel', label: 'Bleu ciel', column: 2, row: 4 },
  { id: 'turquoise', label: 'Turquoise', column: 2, row: 6 },
  { id: 'carreaux-bleus', label: 'Carreaux bleus', column: 2, row: 7 },
  { id: 'menthe', label: 'Menthe', column: 2, row: 9 },
  { id: 'vert-gris', label: 'Vert-gris', column: 2, row: 10 },
];

const WALL_COLUMN_X = [0, 352, 704];

export const TILESET_COLUMNS = 16;
export const TILE = 32;

// Les tuiles de la piscine : le fond d'eau, ses quatre bords et ses quatre coins.
export const POOL_NAMES = ['fill', 'n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'] as const;
export type PoolName = (typeof POOL_NAMES)[number];

export interface TilesetBuild {
  image: Img;
  floors: Array<{ id: string; label: string; gid: number }>;
  walls: Array<{ id: string; label: string; top: number; bottom: number; stem: number }>;
  pool: Record<PoolName, number>;
  // Les murs de la boutique (shop-walls.ts), avec leur prix en kuartzons.
  shopWalls: Array<{ id: string; label: string; price: number; top: number; bottom: number; stem: number }>;
  // Les tuiles qui bougent (celles des murs de la boutique) : pour une tuile de base, ses images (la base d'abord), leur durée, leur décalage
  // (decor/tile-animations.ts).
  animations: TileAnimationRow[];
  tileCount: number;
}

export interface TileAnimationRow {
  gid: number;
  frames: number[];
  durations: number[];
  phase: TilePhase;
  step: number;
}

// Les trois tuiles d'un mur du Room Builder : la face (deux cases) et le pan vertical.
function packWallTiles(sheet: Img, column: number, row: number): ShopWallTiles {
  const x0 = WALL_COLUMN_X[column]!;
  const y0 = row * 64;
  return { top: sheet.crop(x0 + 32, y0, TILE, TILE), bottom: sheet.crop(x0 + 32, y0 + 32, TILE, TILE), stem: sheet.crop(x0 + 160, y0 + 32, TILE, TILE) };
}

const COPING: Rgba = { r: 214, g: 222, b: 228, a: 255 };
const COPING_EDGE: Rgba = { r: 150, g: 166, b: 178, a: 255 };

// Une tuile de piscine : l'eau, avec un liseré de margelle sur les côtés demandés et une ombre qui donne de la profondeur.
function poolTile(water: Img, sides: { n?: boolean; s?: boolean; w?: boolean; e?: boolean }): Img {
  const tile = water.crop(0, 0, TILE, TILE);
  const shade = (x: number, y: number, depth: number) => {
    const p = tile.get(x, y);
    tile.set(x, y, { r: Math.round(p.r * (1 - depth) + 8 * depth), g: Math.round(p.g * (1 - depth) + 70 * depth), b: Math.round(p.b * (1 - depth) + 120 * depth), a: 255 });
  };
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      // La profondeur : l'ombre est forte contre le bord nord, moindre contre l'ouest et l'est.
      let depth = 0;
      if (sides.n && y < 10) depth = Math.max(depth, 0.5 * (1 - y / 10));
      if (sides.w && x < 6) depth = Math.max(depth, 0.35 * (1 - x / 6));
      if (sides.e && x >= TILE - 6) depth = Math.max(depth, 0.35 * ((x - (TILE - 6)) / 6));
      if (depth > 0) shade(x, y, depth);
    }
  }
  const coping = (x: number, y: number, w: number, h: number, edge: Rgba) => tile.fillRect(x, y, w, h, edge);
  if (sides.n) {
    coping(0, 0, TILE, 3, COPING);
    coping(0, 3, TILE, 1, COPING_EDGE);
  }
  if (sides.s) {
    coping(0, TILE - 4, TILE, 1, COPING_EDGE);
    coping(0, TILE - 3, TILE, 3, COPING);
  }
  if (sides.w) {
    coping(0, 0, 3, TILE, COPING);
    coping(3, sides.n ? 4 : 0, 1, TILE - (sides.n ? 4 : 0) - (sides.s ? 4 : 0), COPING_EDGE);
  }
  if (sides.e) {
    coping(TILE - 3, 0, 3, TILE, COPING);
    coping(TILE - 4, sides.n ? 4 : 0, 1, TILE - (sides.n ? 4 : 0) - (sides.s ? 4 : 0), COPING_EDGE);
  }
  return tile;
}

export function buildTileset(source: string): TilesetBuild {
  const floorsSheet = readImage(join(source, ROOM_BUILDER, 'Room_Builder_Floors_32x32.png'));
  const wallsSheet = readImage(join(source, ROOM_BUILDER, 'Room_Builder_Walls_32x32.png'));

  const tiles: Img[] = [];
  const add = (tile: Img): number => tiles.push(tile);   // le numéro de tuile de Tiled : le premier est 1

  const floors = FLOOR_PICKS.map(({ id, label, column, row }) => ({
    id,
    label,
    gid: add(floorsSheet.crop(column * 128 + 32, 64 + row * 64 + 32, TILE, TILE)),
  }));

  const walls = WALL_PICKS.map(({ id, label, column, row }) => {
    const tiles = packWallTiles(wallsSheet, column, row);
    return { id, label, top: add(tiles.top), bottom: add(tiles.bottom), stem: add(tiles.stem) };
  });

  const water = tiles[floors.find((f) => f.id === 'turquoise')!.gid - 1]!;
  const sides: Record<PoolName, Parameters<typeof poolTile>[1]> = {
    fill: {},
    n: { n: true },
    s: { s: true },
    w: { w: true },
    e: { e: true },
    nw: { n: true, w: true },
    ne: { n: true, e: true },
    sw: { s: true, w: true },
    se: { s: true, e: true },
  };
  const pool = Object.fromEntries(POOL_NAMES.map((name) => [name, add(poolTile(water, sides[name]))])) as Record<PoolName, number>;

  // Les murs de la boutique, après tout le reste : les tuiles déjà posées sur la carte gardent leur numéro.
  const shopWalls = SHOP_WALL_PICKS.map((wall) => {
    const tiles = isPackWall(wall) ? packWallTiles(wallsSheet, wall.column, wall.row) : drawShopWall(wall);
    return { id: wall.id, label: wall.label, price: wall.price, top: add(tiles.top), bottom: add(tiles.bottom), stem: add(tiles.stem) };
  });

  // Les images d'animation des murs de la boutique, après toutes les tuiles de base : la face de chacun, puis son pan.
  const animations: TileAnimationRow[] = [];
  const animate = (gids: readonly number[], motion: Motion | undefined) => {
    if (motion) animations.push(...animationRows(gids, motion, tiles, add));
  };
  SHOP_WALL_PICKS.forEach((pick, index) => {
    const wall = shopWalls[index]!;
    const motion = isPackWall(pick) ? { face: WALL_MOTIONS[pick.id] } : drawnWallMotion(pick);
    animate([wall.top, wall.bottom], motion.face);
    animate([wall.stem], motion.stem);
  });

  const rows = Math.ceil(tiles.length / TILESET_COLUMNS);
  const image = new Img(TILESET_COLUMNS * TILE, rows * TILE);
  tiles.forEach((tile, index) => image.paste(tile, (index % TILESET_COLUMNS) * TILE, Math.floor(index / TILESET_COLUMNS) * TILE, false));
  return { image, floors, walls, pool, shopWalls, animations, tileCount: tiles.length };
}

// Les lignes d'animation de ces tuiles de base (une seule, ou le haut et le bas d'une face, qui bougent ensemble) : chaque image rendue devient une tuile,
// sauf si la même tuile a déjà la même image (la base, ou une image d'avant) ; deux images de suite identiques n'en font qu'une, de la somme de leurs durées.
// Une tuile que le mouvement ne change jamais (le haut d'un mur dont seul le bas bouge) n'a pas de ligne.
function animationRows(gids: readonly number[], motion: Motion, tiles: readonly Img[], add: (tile: Img) => number): TileAnimationRow[] {
  const rendered = renderMotion(gids.map((gid) => tiles[gid - 1]!), motion);
  return gids.flatMap((gid, part): TileAnimationRow[] => {
    const known: Array<{ image: Img; gid: number }> = [{ image: tiles[gid - 1]!, gid }];
    const frames: number[] = [];
    const durations: number[] = [];
    rendered.images[part]!.forEach((image, index) => {
      let frame = known.find((k) => sameImage(k.image, image))?.gid;
      if (frame === undefined) {
        frame = add(image);
        known.push({ image, gid: frame });
      }
      if (frames.length > 0 && frames[frames.length - 1] === frame) durations[durations.length - 1] = durations[durations.length - 1]! + rendered.durations[index]!;
      else {
        frames.push(frame);
        durations.push(rendered.durations[index]!);
      }
    });
    return frames.length > 1 ? [{ gid, frames, durations, phase: rendered.phase, step: rendered.step }] : [];
  });
}

export function renderThemesSource(build: TilesetBuild): string {
  const floors = build.floors.map((f) => `  { id: ${JSON.stringify(f.id)}, label: ${JSON.stringify(f.label)}, gid: ${f.gid} },`).join('\n');
  const walls = build.walls
    .map((w) => `  { id: ${JSON.stringify(w.id)}, label: ${JSON.stringify(w.label)}, top: ${w.top}, bottom: ${w.bottom}, stem: ${w.stem} },`)
    .join('\n');
  const pool = POOL_NAMES.map((name) => `${name}: ${build.pool[name]}`).join(', ');
  const shopWalls = build.shopWalls
    .map((w) => `  { id: ${JSON.stringify(w.id)}, label: ${JSON.stringify(w.label)}, top: ${w.top}, bottom: ${w.bottom}, stem: ${w.stem}, price: ${w.price} },`)
    .join('\n');
  const animations = build.animations
    .map((a) => `  { gid: ${a.gid}, frames: [${a.frames.join(', ')}], durations: [${a.durations.join(', ')}], phase: ${JSON.stringify(a.phase)}, step: ${a.step} },`)
    .join('\n');
  return `// Généré par \`pnpm --filter @bureau/client gen:assets\` (apps/client/scripts/assets/tileset.ts) : ne pas modifier à la main.

// Le jeu de tuiles de la carte : public/assets/tiles/office.png (${TILESET_COLUMNS} colonnes de cases de ${TILE} px), cité par la carte.
export const TILESET = { name: 'office', image: '../tiles/office.png', columns: ${TILESET_COLUMNS}, tileCount: ${build.tileCount} } as const;

// Les sols qu'on peut choisir pour une pièce (et ceux de la carte) : le numéro de leur tuile dans le jeu de tuiles.
export const FLOOR_THEMES = [
${floors}
] as const;

// Les murs : la face (deux cases de haut : \`top\` puis \`bottom\`) et le pan vertical (\`stem\`).
export const WALL_THEMES = [
${walls}
] as const;

// Les tuiles de la piscine : le fond d'eau, les bords et les coins.
export const POOL_TILES = { ${pool} } as const;

// Les murs de la boutique (apps/client/scripts/assets/shop-walls.ts) : comme les autres, avec leur prix en kuartzons. Il faut les avoir achetés pour les
// poser dans sa pièce.
export const SHOP_WALL_THEMES = [
${shopWalls}
] as const;

// Les tuiles qui bougent, celles des murs de la boutique (apps/client/scripts/assets/tile-motion.ts) : pour une tuile de base, ses images (la base d'abord),
// la durée de chacune (ms), et comment le mouvement se décale d'une case à l'autre (decor/tile-animations.ts).
export const TILE_ANIMATIONS: ReadonlyArray<{ gid: number; frames: readonly number[]; durations: readonly number[]; phase: 'x' | 'y' | 'xy' | 'scatter' | 'sync'; step: number }> = [
${animations}
];
`;
}
