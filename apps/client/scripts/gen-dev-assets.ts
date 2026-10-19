// Génère les assets de la carte de développement, à commiter : `pnpm --filter @bureau/client gen:dev-assets`.
//   public/assets/dev/tiles.png              les 5 tuiles de 32 × 32 px de DEV_TILE, sur une ligne (160 × 32 px)
//   public/assets/dev/avatars/dev-*.png      un personnage par couleur de DEV_AVATAR_KEYS (96 × 128 px, cases de 32 × 32 px)
//   public/assets/maps/dev-office.json       buildTiledMap(DEV_OFFICE) : la carte ne peut pas s'écarter de la définition partagée
// Tout est déterministe (pas de hasard, pas d'horloge) : relancer le script sans rien changer ne modifie aucun fichier.
// Une planche d'avatar a 3 colonnes (immobile, pas 1, pas 2) et 4 lignes (bas, gauche, droite, haut).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { DEV_AVATAR_KEYS, DEV_OFFICE, DEV_TILE, TILE_SIZE, buildTiledMap } from '@bureau/shared';
import { PNG } from 'pngjs';

export const ASSETS_DIR = resolve(import.meta.dirname, '../public/assets');

// L'image du tileset, vue depuis le fichier de la carte (maps/dev-office.json) : c'est ainsi que Tiled écrit un chemin.
export const DEV_TILESET = { name: 'dev', image: '../dev/tiles.png' };

type Rgb = readonly [number, number, number];

// Une image RGBA, d'abord entièrement transparente.
class Canvas {
  readonly png: PNG;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.png = new PNG({ width, height });
  }

  private offset(x: number, y: number): number {
    return (y * this.width + x) * 4;
  }

  set(x: number, y: number, [r, g, b]: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = this.offset(x, y);
    this.png.data[o] = r;
    this.png.data[o + 1] = g;
    this.png.data[o + 2] = b;
    this.png.data[o + 3] = 255;
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, color);
  }

  isOpaque(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.png.data[this.offset(x, y) + 3] === 255;
  }

  // Cette image recopiée à (ox, oy) dans `target`, éventuellement retournée de gauche à droite.
  drawInto(target: Canvas, ox: number, oy: number, mirrored = false): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.isOpaque(x, y)) continue;
        const o = this.offset(x, y);
        const d = this.png.data;
        target.set(ox + (mirrored ? this.width - 1 - x : x), oy + y, [d[o]!, d[o + 1]!, d[o + 2]!]);
      }
    }
  }

  // Un trait de 1 px autour de la silhouette, sur les pixels transparents voisins d'un pixel opaque.
  outline(color: Rgb): void {
    const edge: Array<[number, number]> = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.isOpaque(x, y)) continue;
        if (this.isOpaque(x - 1, y) || this.isOpaque(x + 1, y) || this.isOpaque(x, y - 1) || this.isOpaque(x, y + 1)) edge.push([x, y]);
      }
    }
    for (const [x, y] of edge) this.set(x, y, color);
  }
}

const shade = ([r, g, b]: Rgb, factor = 0.78): Rgb => [Math.round(r * factor), Math.round(g * factor), Math.round(b * factor)];

// ---- Tuiles -----------------------------------------------------------------------------------------------------------------

// Chaque fonction dessine la tuile dont le bord gauche est à `ox`. Toutes sont opaques et se raccordent sans raccord visible
// côté à côté ; les joints d'un pixel à droite et en bas laissent voir la grille de 32 px.
function paintFloor(c: Canvas, ox: number): void {
  c.rect(ox, 0, 32, 32, [222, 216, 202]);
  c.rect(ox + 31, 0, 1, 32, [206, 199, 183]);
  c.rect(ox, 31, 32, 1, [206, 199, 183]);
}

// Un mur de briques de 16 × 8 px, décalées d'une rangée à l'autre, avec un liseré clair en haut.
function paintWall(c: Canvas, ox: number): void {
  const mortar: Rgb = [52, 59, 80];
  c.rect(ox, 0, 32, 32, [74, 84, 110]);
  for (let row = 0; row < 4; row++) {
    const y = row * 8;
    c.rect(ox, y + 7, 32, 1, mortar);
    for (const x of row % 2 === 0 ? [15, 31] : [7, 23]) c.rect(ox + x, y, 1, 7, mortar);
  }
  c.rect(ox, 0, 32, 2, [112, 124, 154]);
}

// Un bureau vu de dessus, avec un écran et un clavier.
function paintDesk(c: Canvas, ox: number): void {
  c.rect(ox, 0, 32, 32, [120, 84, 52]);
  c.rect(ox + 1, 1, 30, 30, [170, 128, 84]);
  c.rect(ox + 2, 2, 28, 1, [196, 156, 108]);
  c.rect(ox + 9, 6, 14, 10, [40, 44, 56]);
  c.rect(ox + 10, 7, 12, 8, [96, 168, 224]);
  c.rect(ox + 14, 16, 4, 2, [70, 70, 80]);
  c.rect(ox + 9, 21, 14, 5, [214, 214, 220]);
  c.rect(ox + 10, 23, 12, 1, [176, 176, 188]);
}

// La moquette bleutée de la salle de réunion, tissée en diagonale.
function paintRoomFloor(c: Canvas, ox: number): void {
  c.rect(ox, 0, 32, 32, [172, 192, 218]);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if ((x + y) % 8 === 0) c.set(ox + x, y, [186, 205, 228]);
  c.rect(ox + 31, 0, 1, 32, [152, 174, 204]);
  c.rect(ox, 31, 32, 1, [152, 174, 204]);
}

// Le sol vert pâle de l'espace d'un bureau, piqué de points.
function paintDeskFloor(c: Canvas, ox: number): void {
  c.rect(ox, 0, 32, 32, [208, 226, 202]);
  for (let y = 4; y < 32; y += 8) for (let x = 4; x < 32; x += 8) c.set(ox + x, y, [190, 212, 184]);
  c.rect(ox + 31, 0, 1, 32, [188, 208, 182]);
  c.rect(ox, 31, 32, 1, [188, 208, 182]);
}

const TILE_PAINTERS: Record<(typeof DEV_TILE)[keyof typeof DEV_TILE], (c: Canvas, ox: number) => void> = {
  [DEV_TILE.floor]: paintFloor,
  [DEV_TILE.wall]: paintWall,
  [DEV_TILE.desk]: paintDesk,
  [DEV_TILE.roomFloor]: paintRoomFloor,
  [DEV_TILE.deskFloor]: paintDeskFloor,
};

// Les tuiles sur une ligne : la tuile de numéro n (n = 1 pour la première) occupe la colonne n - 1.
export function renderTiles(): PNG {
  const gids = Object.values(DEV_TILE);
  const sheet = new Canvas(gids.length * TILE_SIZE, TILE_SIZE);
  for (const gid of gids) TILE_PAINTERS[gid](sheet, (gid - 1) * TILE_SIZE);
  return sheet.png;
}

// ---- Avatars ----------------------------------------------------------------------------------------------------------------

type AvatarKey = (typeof DEV_AVATAR_KEYS)[number];
type Facing = 'down' | 'left' | 'right' | 'up';
type Step = 0 | 1 | 2;   // 0 immobile, 1 et 2 les deux pas

const SHIRTS: Record<AvatarKey, Rgb> = {
  'dev-red': [214, 64, 64],
  'dev-blue': [64, 112, 214],
  'dev-green': [64, 168, 92],
  'dev-yellow': [232, 190, 48],
};

const SKIN: Rgb = [242, 201, 160];
const SKIN_SHADE: Rgb = [214, 164, 124];
const HAIR: Rgb = [74, 52, 40];
const PANTS: Rgb = [58, 66, 96];
const PANTS_FAR: Rgb = [44, 50, 74];
const SHOES: Rgb = [36, 36, 46];
const EYE: Rgb = [30, 30, 42];
const OUTLINE: Rgb = [24, 24, 34];

// Un personnage de 32 × 32 px, les pieds en bas de l'image (l'origine du sprite est aux pieds). Vu de face, de dos ou de profil
// vers la gauche ; vers la droite, c'est le profil gauche retourné. La silhouette est symétrique autour de x = 15,5.
function paintAvatar(shirt: Rgb, facing: 'down' | 'left' | 'up', step: Step): Canvas {
  const c = new Canvas(TILE_SIZE, TILE_SIZE);
  const sleeve = shade(shirt, 0.85);
  const flank = shade(shirt, 0.8);

  // Les jambes puis le tronc, la tête par-dessus.
  if (facing === 'left') {
    // Profil : la jambe du fond (plus sombre) et celle du premier plan se croisent d'un pas à l'autre.
    const [nearX, farX] = step === 1 ? [10, 18] : step === 2 ? [16, 12] : [13, 15];
    c.rect(farX, 25, 4, 5, PANTS_FAR);
    c.rect(farX - 1, 30, 5, 1, SHOES);
    c.rect(nearX, 25, 4, 5, PANTS);
    c.rect(nearX - 1, 30, 5, 1, SHOES);
    c.rect(11, 15, 10, 9, shirt);
    c.rect(20, 15, 1, 9, flank);
    c.rect(11, 24, 10, 1, flank);
    const armX = step === 1 ? 15 : step === 2 ? 13 : 14;   // le bras de devant balance à contresens de la jambe
    c.rect(armX, 16, 3, 6, sleeve);
    c.rect(armX, 22, 3, 2, SKIN);
  } else {
    // Face ou dos : un pied levé à chaque pas, les bras qui balancent à contresens des jambes.
    for (const [x, isLeft] of [[11, true], [17, false]] as const) {
      const raised = (step === 1 && isLeft) || (step === 2 && !isLeft);
      const length = raised ? 4 : 6;
      c.rect(x, 25, 4, length - 1, PANTS);
      c.rect(x, 25 + length - 1, 4, 1, SHOES);
    }
    c.rect(10, 15, 12, 9, shirt);
    c.rect(10, 15, 1, 9, flank);
    c.rect(21, 15, 1, 9, flank);
    c.rect(10, 24, 12, 1, flank);
    const swing = step === 1 ? 1 : step === 2 ? -1 : 0;
    c.rect(8, 16 + swing, 2, 6, sleeve);
    c.rect(8, 22 + swing, 2, 2, SKIN);
    c.rect(22, 16 - swing, 2, 6, sleeve);
    c.rect(22, 22 - swing, 2, 2, SKIN);
    if (facing === 'down') c.rect(14, 15, 4, 1, SKIN);   // le col
  }

  // La tête : un rectangle aux coins arrondis.
  c.rect(11, 4, 10, 1, SKIN);
  c.rect(10, 5, 12, 9, SKIN);
  c.rect(11, 14, 10, 1, SKIN);
  if (facing === 'down') {
    c.rect(11, 4, 10, 1, HAIR);   // la frange
    c.rect(10, 5, 12, 2, HAIR);
    c.rect(10, 7, 1, 3, HAIR);
    c.rect(21, 7, 1, 3, HAIR);
    c.rect(13, 9, 1, 2, EYE);
    c.rect(18, 9, 1, 2, EYE);
    c.rect(15, 12, 2, 1, SKIN_SHADE);
  } else if (facing === 'up') {
    c.rect(11, 4, 10, 1, HAIR);   // les cheveux couvrent toute la nuque
    c.rect(10, 5, 12, 9, HAIR);
    c.rect(11, 14, 10, 1, HAIR);
    c.rect(14, 14, 4, 1, SKIN);
  } else {
    c.rect(11, 4, 10, 1, HAIR);
    c.rect(10, 5, 12, 2, HAIR);
    c.rect(16, 7, 6, 7, HAIR);    // l'arrière de la tête, côté droit
    c.rect(16, 14, 5, 1, HAIR);
    c.rect(12, 9, 1, 2, EYE);
    c.rect(11, 12, 2, 1, SKIN_SHADE);
    c.rect(9, 10, 1, 2, SKIN);    // le nez
  }

  c.outline(OUTLINE);
  return c;
}

// La planche d'un avatar : la ligne n'est pas l'ordre de Direction mais celui de la spec (bas, gauche, droite, haut).
export function renderAvatarSheet(key: AvatarKey): PNG {
  const sheet = new Canvas(3 * TILE_SIZE, 4 * TILE_SIZE);
  const rows: Facing[] = ['down', 'left', 'right', 'up'];
  rows.forEach((facing, row) => {
    for (const step of [0, 1, 2] as const) {
      const cell = paintAvatar(SHIRTS[key], facing === 'right' ? 'left' : facing, step);
      cell.drawInto(sheet, step * TILE_SIZE, row * TILE_SIZE, facing === 'right');
    }
  });
  return sheet.png;
}

// ---- Carte ------------------------------------------------------------------------------------------------------------------

// Le JSON de dev-office : celui de buildTiledMap, sauf qu'un calque de tuiles tient sur une ligne par rangée de cases (au lieu
// d'un nombre par ligne), pour qu'on le lise et que ses diffs restent courts.
export function renderDevOfficeJson(): string {
  const map = buildTiledMap({ ...DEV_OFFICE, tileset: DEV_TILESET });
  const text = JSON.stringify(map, null, 2).replace(/"data": \[([^\]]*)\]/g, (_match, body: string) => {
    const numbers = body.split(',').map((n) => n.trim());
    const rows: string[] = [];
    for (let i = 0; i < numbers.length; i += map.width) rows.push(`        ${numbers.slice(i, i + map.width).join(', ')}`);
    return `"data": [\n${rows.join(',\n')}\n      ]`;
  });
  return `${text}\n`;
}

// ---- Écriture ---------------------------------------------------------------------------------------------------------------

export function devAssetFiles(): Array<{ path: string; content: Buffer | string }> {
  return [
    { path: 'dev/tiles.png', content: PNG.sync.write(renderTiles()) },
    ...DEV_AVATAR_KEYS.map((key) => ({ path: `dev/avatars/${key}.png`, content: PNG.sync.write(renderAvatarSheet(key)) })),
    { path: 'maps/dev-office.json', content: renderDevOfficeJson() },
  ];
}

export function generateDevAssets(assetsDir = ASSETS_DIR): string[] {
  return devAssetFiles().map(({ path, content }) => {
    const target = join(assetsDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    return target;
  });
}

// `tsx scripts/gen-dev-assets.ts` s'exécute directement. On reconnaît ce cas au nom du script lancé : importé par un test, ce
// module n'écrit rien.
if (/[\\/]gen-dev-assets\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  for (const file of generateDevAssets()) console.log(`Écrit : ${relative(process.cwd(), file)}`);
}
