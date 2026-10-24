// Les murs de la boutique : des thèmes de murs qu'on achète une fois (en kuartzons) pour sa pièce, comme les éléments de la collection à part. Six sont
// des murs du Room Builder de LimeZu que les murs libres (WALL_PICKS, tileset.ts) n'utilisent pas ; six sont dessinés ici, au pixel, dans la grille du
// pack (des pixels de 2 × 2 : le pack est dessiné en 16 px et agrandi deux fois) et avec sa construction : le liseré blanc du haut, la surface, la plinthe,
// et le pan vertical (les côtés de la pièce). Leurs tuiles s'ajoutent au jeu de tuiles après toutes les autres : les numéros des tuiles déjà posées sur la
// carte ne bougent pas.
import { Img, type Rgba } from './image';

// Un mur de la boutique : son identifiant (« mur-… » : il ne se confond jamais avec un élément de décor dans les achats), son nom et son prix en kuartzons,
// dans les bandes de rareté de la boutique (curation/boutique.ts : Rare de 300 à 900, Épique de 1 200 à 3 500, Légendaire de 5 000 à 15 000).
interface ShopWallBase {
  id: string;
  label: string;
  price: number;
}

// Un mur du pack : colonne (0 à 2) et rangée (0 à 19) de son bloc, comme WALL_PICKS.
interface PackWall extends ShopWallBase {
  column: number;
  row: number;
}

// Un mur dessiné ici : sa surface (`paper`, 16 × 20 pixels du pack, répétée de case en case), son pan vertical (`stem`, 14 × 16, entre les deux traits
// du bord) et les couleurs de sa plinthe, du clair (le filet du haut) au sombre.
interface DrawnWall extends ShopWallBase {
  paper(canvas: Canvas): void;
  stem(canvas: Canvas): void;
  baseboard: readonly [Rgba, Rgba, Rgba, Rgba];
}

export type ShopWallPick = PackWall | DrawnWall;

export interface ShopWallTiles {
  top: Img;
  bottom: Img;
  stem: Img;
}

const rgb = (r: number, g: number, b: number): Rgba => ({ r, g, b, a: 255 });

// Les couleurs de construction du pack : le trait sombre des bords et le liseré blanc du haut du mur (mesurées sur ses murs).
const OUTLINE = rgb(58, 58, 80);
const CAP = rgb(248, 248, 248);

// Une surface à peindre, en pixels du pack. En x, elle se répète : ce qui dépasse à droite revient à gauche (le motif continue d'une case à l'autre).
export class Canvas {
  private readonly cells: Rgba[];

  constructor(
    readonly width: number,
    readonly height: number,
    fill: Rgba,
  ) {
    this.cells = Array.from({ length: width * height }, () => fill);
  }

  set(x: number, y: number, color: Rgba): void {
    if (y < 0 || y >= this.height) return;
    const xx = ((Math.round(x) % this.width) + this.width) % this.width;
    this.cells[Math.round(y) * this.width + xx] = color;
  }

  get(x: number, y: number): Rgba {
    const xx = ((Math.round(x) % this.width) + this.width) % this.width;
    return this.cells[Math.max(0, Math.min(this.height - 1, Math.round(y))) * this.width + xx]!;
  }

  // Une image tirée d'un dessin en lettres : une rangée par chaîne, une lettre par pixel ; une lettre absente de la légende (« . ») ne peint rien.
  draw(x0: number, y0: number, rows: readonly string[], legend: Readonly<Record<string, Rgba>>): void {
    rows.forEach((row, dy) => [...row].forEach((ch, dx) => legend[ch] && this.set(x0 + dx, y0 + dy, legend[ch]!)));
  }
}

// Un hasard figé (le même à chaque génération) : de quoi semer des étoiles ou des marbrures sans que les images changent d'un `gen:assets` à l'autre.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return ((s ^ (s >>> 13)) >>> 0) / 0x1_0000_0000;
  };
}

// Un dégradé en tramé ordonné (Bayer 4 × 4) : passe d'une couleur à la suivante sans bande nette, comme le ferait un graphiste du pixel.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((n) => (n + 0.5) / 16);
function gradient(canvas: Canvas, colors: readonly Rgba[]): void {
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const t = (y / (canvas.height - 1)) * (colors.length - 1);
      const i = Math.min(colors.length - 2, Math.floor(t));
      canvas.set(x, y, t - i > BAYER[(y % 4) * 4 + (x % 4)]! ? colors[i + 1]! : colors[i]!);
    }
  }
}

// ---- Néon : un mur de briques sombres, un tube rose en vague et un tube cyan, chacun avec son halo ; la plinthe s'allume en cyan. -----------------
const NEON = {
  shade: rgb(18, 16, 40),
  brick: rgb(30, 27, 58),
  mortar: rgb(23, 21, 46),
  pink: rgb(255, 96, 208),
  pinkGlow: rgb(124, 46, 122),
  cyan: rgb(92, 236, 255),
  cyanGlow: rgb(34, 98, 134),
};

function neonBricks(canvas: Canvas, rows: number): void {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const course = Math.floor(y / 4);
      const joint = y % 4 === 3 || (x + (course % 2) * 4) % 8 === 0;
      canvas.set(x, y, joint ? NEON.mortar : NEON.brick);
    }
  }
}

// Un tube : son cœur sur ces pixels, et son halo sur leurs voisins du dessus et du dessous qui ne sont pas du tube.
function tube(canvas: Canvas, points: ReadonlyArray<readonly [number, number]>, core: Rgba, glow: Rgba, vertical = false): void {
  const key = (x: number, y: number) => `${((x % canvas.width) + canvas.width) % canvas.width},${y}`;
  const lit = new Set(points.map(([x, y]) => key(x, y)));
  for (const [x, y] of points) {
    const around: Array<[number, number]> = vertical ? [[x - 1, y], [x + 1, y]] : [[x, y - 1], [x, y + 1]];
    for (const [ax, ay] of around) if (!lit.has(key(ax, ay))) canvas.set(ax, ay, glow);
  }
  for (const [x, y] of points) canvas.set(x, y, core);
}

const neon: DrawnWall = {
  id: 'mur-neon',
  label: 'Néon',
  price: 2400,
  paper(canvas) {
    neonBricks(canvas, canvas.height);
    for (let x = 0; x < canvas.width; x++) canvas.set(x, 0, NEON.shade);
    // La vague rose : un aller-retour de trois pixels sur huit de large, deux fois par case.
    const wave = [0, 1, 2, 3, 3, 2, 1, 0];
    tube(canvas, Array.from({ length: canvas.width }, (_, x) => [x, 5 + wave[x % 8]!] as const), NEON.pink, NEON.pinkGlow);
    tube(canvas, Array.from({ length: canvas.width }, (_, x) => [x, 14] as const), NEON.cyan, NEON.cyanGlow);
  },
  stem(canvas) {
    neonBricks(canvas, canvas.height);
    tube(canvas, Array.from({ length: canvas.height }, (_, y) => [6, y] as const), NEON.pink, NEON.pinkGlow, true);
  },
  baseboard: [NEON.cyan, rgb(42, 40, 76), rgb(32, 30, 60), rgb(22, 20, 44)],
};

// ---- Galaxie : la nuit qui s'éclaircit vers une nébuleuse violette, des étoiles semées, deux qui scintillent. --------------------------------------
const SPACE = [rgb(12, 9, 30), rgb(22, 15, 52), rgb(38, 22, 80), rgb(64, 32, 106)];
const NEBULA = rgb(104, 48, 136);
const STAR = rgb(255, 255, 255);
const STAR_BLUE = rgb(172, 192, 255);
const STAR_GOLD = rgb(255, 224, 138);

function stars(canvas: Canvas, seed: number, count: number): void {
  const random = seeded(seed);
  const colors = [STAR, STAR, STAR_BLUE, STAR_GOLD];
  for (let i = 0; i < count; i++) canvas.set(Math.floor(random() * canvas.width), Math.floor(random() * (canvas.height - 3)), colors[Math.floor(random() * colors.length)]!);
}

function twinkle(canvas: Canvas, x: number, y: number): void {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) canvas.set(x + dx, y + dy, STAR_BLUE);
  canvas.set(x, y, STAR);
}

const galaxy: DrawnWall = {
  id: 'mur-galaxie',
  label: 'Galaxie',
  price: 3200,
  paper(canvas) {
    gradient(canvas, SPACE);
    // Une nébuleuse : deux nuages ovales, tramés, en bas de la surface.
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const cloud = Math.max(1 - ((x - 4) / 6) ** 2 - ((y - 16) / 3.5) ** 2, 1 - ((x - 12) / 5) ** 2 - ((y - 18) / 2.5) ** 2);
        if (cloud > BAYER[(y % 4) * 4 + (x % 4)]! * 0.9) canvas.set(x, y, NEBULA);
      }
    }
    stars(canvas, 7, 11);
    twinkle(canvas, 11, 4);
    twinkle(canvas, 3, 9);
  },
  // Le pan vertical se répète de haut en bas : pas de dégradé, un fond tramé égal et ses étoiles.
  stem(canvas) {
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) canvas.set(x, y, BAYER[(y % 4) * 4 + (x % 4)]! < 0.25 ? SPACE[2]! : SPACE[1]!);
    stars(canvas, 21, 5);
  },
  baseboard: [rgb(132, 98, 210), rgb(50, 30, 84), rgb(38, 22, 64), rgb(24, 14, 42)],
};

// ---- Marbre noir et or : un marbre presque noir, marbré de gris, deux veines d'or, et une frise dorée sous le liseré ; la plinthe est en or. -----------
const MARBLE = { base: rgb(29, 29, 34), cloud: rgb(38, 38, 45), vein: rgb(80, 80, 92), gold: rgb(214, 174, 68), goldLight: rgb(248, 216, 124), goldDark: rgb(140, 104, 34) };

function marble(canvas: Canvas, seed: number): void {
  const random = seeded(seed);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) canvas.set(x, y, random() < 0.22 ? MARBLE.cloud : MARBLE.base);
}

const marbleBlackGold: DrawnWall = {
  id: 'mur-marbre-or',
  label: 'Marbre noir et or',
  price: 2800,
  paper(canvas) {
    marble(canvas, 3);
    // La frise : un filet d'or et son ombre, sous le liseré.
    for (let x = 0; x < canvas.width; x++) {
      canvas.set(x, 1, MARBLE.gold);
      canvas.set(x, 2, MARBLE.goldDark);
    }
    // Une veine d'or qui serpente d'un bord à l'autre de la case (elle repart à la hauteur où elle est entrée : elle continue sur tout le mur), une branche
    // qui monte, et des veines grises, courtes, dans d'autres sens.
    const vein = [14, 14, 13, 13, 12, 11, 11, 12, 13, 14, 15, 15, 16, 16, 15, 14];
    vein.forEach((y, x) => canvas.set(x, y, MARBLE.gold));
    for (const [x, y] of [[5, 10], [6, 9], [6, 8], [7, 7]] as const) canvas.set(x, y, MARBLE.gold);
    for (const [x, y] of [[4, 12], [12, 16]] as const) canvas.set(x, y, MARBLE.goldLight);
    for (const [x, y] of [[9, 4], [10, 5], [11, 5], [12, 6], [13, 6], [2, 6], [2, 7], [3, 8], [13, 18], [14, 19]] as const) canvas.set(x, y, MARBLE.vein);
  },
  stem(canvas) {
    marble(canvas, 11);
    for (let y = 0; y < canvas.height; y++) canvas.set(y % 8 < 4 ? 7 : 8, y, MARBLE.gold);
  },
  baseboard: [MARBLE.goldLight, rgb(196, 156, 58), rgb(138, 102, 34), rgb(72, 54, 20)],
};

// ---- Jungle : de grandes feuilles découpées sur un vert profond, leurs nervures, et la lumière sur leurs bords ; la plinthe est en bois. -------------
const JUNGLE = { dark: rgb(20, 52, 37), leaf: rgb(42, 112, 68), light: rgb(86, 160, 88), shine: rgb(150, 206, 112), rib: rgb(24, 66, 44) };
const JUNGLE_LEGEND = { d: JUNGLE.dark, l: JUNGLE.leaf, L: JUNGLE.light, s: JUNGLE.shine, r: JUNGLE.rib };
// Deux feuilles par case, la seconde en partie dans la case voisine (le dessin se répète : 16 colonnes).
const JUNGLE_PAPER = [
  'lllldddddddlLLLl',
  'Llrllddddddllrll',
  'LllrlldddddlrLll',
  'sLllrlldddlrlLls',
  'dsLllrlldllrlLsd',
  'ddsLllrlllrllLdd',
  'dddslllrlrlllsdd',
  'ddddsLllrllLsddd',
  'dddddslllllsdddd',
  'llddddsllsddddll',
  'lLlddddssddddlLl',
  'llrldddddddddlrl',
  'lllrlldddddllrll',
  'dlllrllsdsllrlld',
  'dsLllrllslllrLsd',
  'ddsLllrlllllrLsd',
  'dddsLllrlllrLsdd',
  'ddddsLllrlrLsddd',
  'dddddsLlllLsdddd',
  'ddddddsllllsdddd',
];

const jungle: DrawnWall = {
  id: 'mur-jungle',
  label: 'Jungle',
  price: 1800,
  paper(canvas) {
    canvas.draw(0, 0, JUNGLE_PAPER, JUNGLE_LEGEND);
  },
  stem(canvas) {
    canvas.draw(0, 0, JUNGLE_PAPER.slice(2, 18).map((row) => row.slice(1, 15)), JUNGLE_LEGEND);
  },
  baseboard: [rgb(170, 118, 66), rgb(118, 76, 42), rgb(92, 58, 32), rgb(60, 38, 22)],
};

// ---- Art déco : un soleil levant d'or par case (un arc, ses rayons, son cœur), une frise en gradins sous le liseré, un losange entre deux soleils, sur un
// bleu canard ; la plinthe garde un filet d'or. ------------------------------------------------------------------------------------------------
const DECO = { base: rgb(14, 66, 72), deep: rgb(9, 46, 52), gold: rgb(214, 172, 66), goldLight: rgb(246, 212, 122) };

function sunburst(canvas: Canvas, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius - 1; y <= cy; y++) {
    for (let x = cx - radius - 1; x <= cx + radius + 1; x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r > radius + 0.5) continue;
      const angle = (Math.atan2(cy - y, x - cx) * 180) / Math.PI;
      // Un rayon tous les 30 degrés, de l'arc au cœur.
      const ray = Math.abs(((angle + 15) % 30) - 15) < 6;
      canvas.set(x, y, r > radius - 0.7 ? DECO.gold : r < 2 ? DECO.goldLight : ray && r > 2.5 ? DECO.gold : DECO.deep);
    }
  }
}

function deco(canvas: Canvas, frieze: boolean): void {
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) canvas.set(x, y, DECO.base);
  if (frieze) {
    for (let x = 0; x < canvas.width; x++) canvas.set(x, 1, DECO.gold);
    // Les gradins : une marche d'or tous les quatre pixels, en escalier montant puis descendant.
    const steps = [3, 3, 4, 4, 5, 5, 4, 4];
    for (let x = 0; x < canvas.width; x++) canvas.set(x, steps[x % 8]!, DECO.gold);
  }
  sunburst(canvas, canvas.width / 2, canvas.height - 1, 6.5);
  canvas.draw(-2, 9, ['..g..', '.gGg.', 'gGdGg', '.gGg.', '..g..'], { g: DECO.gold, G: DECO.goldLight, d: DECO.deep });
}

const artDeco: DrawnWall = {
  id: 'mur-art-deco',
  label: 'Art déco',
  price: 3000,
  paper(canvas) {
    deco(canvas, true);
  },
  // Le pan : le bleu canard, deux filets d'or et un losange toutes les huit rangées.
  stem(canvas) {
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) canvas.set(x, y, x === 2 || x === 11 ? DECO.gold : DECO.base);
    }
    for (const y of [2, 10]) canvas.draw(5, y, ['..g..', '.gGg.', 'gGdGg', '.gGg.', '..g..'], { g: DECO.gold, G: DECO.goldLight, d: DECO.deep });
  },
  baseboard: [DECO.goldLight, rgb(12, 58, 64), rgb(9, 46, 52), rgb(6, 32, 36)],
};

// ---- Kuartz : une géode, des cristaux de quartz rose et lilas qui montent de la plinthe devant un fond qui s'assombrit vers le bas, des éclats de lumière
// à leurs pointes ; le mur du kuartzon. ---------------------------------------------------------------------------------------------------------
const QUARTZ = {
  sky: [rgb(240, 228, 250), rgb(222, 200, 242), rgb(184, 146, 220), rgb(122, 84, 172)],
  light: rgb(255, 248, 255),
  face: rgb(242, 192, 240),
  side: rgb(204, 132, 222),
  edge: rgb(104, 62, 156),
  glint: rgb(255, 255, 255),
};

// Un cristal : sa colonne de gauche, sa largeur (3 à 5), sa hauteur depuis le bas. Il pousse droit, la pointe au milieu : la face de gauche est claire (un
// filet de lumière), celle de droite plus sombre, l'arête du milieu marquée, le bord dessiné.
function crystal(canvas: Canvas, left: number, width: number, height: number): void {
  const bottom = canvas.height - 1;
  const half = Math.floor(width / 2);
  for (let y = bottom; y > bottom - height; y--) {
    const fromTop = y - (bottom - height + 1);
    // La pointe : chaque rangée du haut gagne un pixel de chaque côté, jusqu'à la largeur du cristal.
    const inset = Math.max(0, half - fromTop);
    for (let x = left + inset; x < left + width - inset; x++) {
      const col = x - left;
      const edge = x === left + inset || x === left + width - inset - 1 || fromTop === 0;
      const color = edge ? QUARTZ.edge : col === 1 ? QUARTZ.light : col < half ? QUARTZ.face : col === half ? (width % 2 === 1 ? QUARTZ.face : QUARTZ.side) : QUARTZ.side;
      canvas.set(x, y, color);
    }
  }
}

function glint(canvas: Canvas, x: number, y: number): void {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) canvas.set(x + dx, y + dy, QUARTZ.face);
  canvas.set(x, y, QUARTZ.glint);
}

const quartz: DrawnWall = {
  id: 'mur-kuartz',
  label: 'Kuartz',
  price: 7500,
  paper(canvas) {
    gradient(canvas, QUARTZ.sky);
    // Du fond vers l'avant : les grands cristaux, puis les petits devant leur pied.
    crystal(canvas, 3, 5, 16);
    crystal(canvas, 10, 5, 13);
    crystal(canvas, 0, 4, 10);
    crystal(canvas, 8, 3, 8);
    crystal(canvas, 14, 3, 7);
    crystal(canvas, 6, 3, 4);
    crystal(canvas, 12, 3, 3);
    glint(canvas, 5, 2);
    glint(canvas, 13, 6);
    canvas.set(1, 3, QUARTZ.glint);
    canvas.set(9, 1, QUARTZ.glint);
  },
  // Le pan vertical : vu d'en haut, un pilier de quartz, sa face claire, son arête et sa face sombre, avec un éclat toutes les huit rangées.
  stem(canvas) {
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const color = x < 2 || x > 11 ? QUARTZ.sky[1]! : x === 2 || x === 11 ? QUARTZ.edge : x < 7 ? (x === 3 ? QUARTZ.light : QUARTZ.face) : x === 7 ? QUARTZ.edge : QUARTZ.side;
        canvas.set(x, y, color);
      }
    }
    for (const y of [2, 10]) canvas.set(4, y, QUARTZ.glint);
  },
  baseboard: [rgb(244, 232, 252), rgb(150, 112, 196), rgb(122, 86, 170), rgb(84, 56, 126)],
};

// Les murs de la boutique, du moins cher au plus cher. Les six premiers viennent du pack (des blocs que WALL_PICKS ne prend pas).
export const SHOP_WALL_PICKS: readonly ShopWallPick[] = [
  { id: 'mur-velours', label: 'Velours rouge', price: 350, column: 1, row: 12 },
  { id: 'mur-lambris', label: 'Lambris vert', price: 450, column: 2, row: 12 },
  { id: 'mur-seventies', label: 'Rayures seventies', price: 500, column: 1, row: 3 },
  { id: 'mur-losanges', label: 'Losanges menthe', price: 600, column: 0, row: 0 },
  { id: 'mur-citrouilles', label: 'Citrouilles', price: 666, column: 1, row: 5 },
  { id: 'mur-bibliotheque', label: 'Bibliothèque', price: 900, column: 1, row: 8 },
  jungle,
  neon,
  marbleBlackGold,
  artDeco,
  galaxy,
  quartz,
];

// Les dimensions, en pixels du pack : la face (deux cases : le liseré, la surface, la plinthe) et le pan vertical.
const SCALE = 2;
const PAPER_TOP = 6;
const PAPER_ROWS = 20;
const STEM_LINE = 4;

// Un pixel du pack, agrandi : un carré de 2 × 2 dans l'image.
function plot(img: Img, x: number, y: number, color: Rgba): void {
  img.fillRect(x * SCALE, y * SCALE, SCALE, SCALE, color);
}

// Les trois tuiles d'un mur dessiné : la face (le haut avec son liseré, le bas avec sa plinthe) et le pan vertical, construites comme celles du pack.
export function drawShopWall(wall: DrawnWall): ShopWallTiles {
  const paper = new Canvas(16, PAPER_ROWS, CAP);
  wall.paper(paper);
  const face = new Img(32, 64);
  for (let x = 0; x < 16; x++) {
    plot(face, x, 0, OUTLINE);
    for (let y = 1; y <= 4; y++) plot(face, x, y, CAP);
    plot(face, x, 5, OUTLINE);
    for (let y = 0; y < PAPER_ROWS; y++) plot(face, x, PAPER_TOP + y, paper.get(x, y));
    // La plinthe : un trait, le filet clair, deux tons, puis le trait du bas (les rangées du pack).
    const [light, mid, dark, deep] = wall.baseboard;
    plot(face, x, 26, mid);
    plot(face, x, 27, light);
    plot(face, x, 28, mid);
    plot(face, x, 29, dark);
    plot(face, x, 30, deep);
    plot(face, x, 31, OUTLINE);
  }
  const stemPaper = new Canvas(14, 16, CAP);
  wall.stem(stemPaper);
  const stem = new Img(32, 32);
  for (let y = 0; y < 16; y++) {
    plot(stem, 0, y, OUTLINE);
    plot(stem, 15, y, OUTLINE);
    for (let x = 0; x < 14; x++) plot(stem, x + 1, y, y === STEM_LINE ? wall.baseboard[1] : stemPaper.get(x, y));
  }
  return { top: face.crop(0, 0, 32, 32), bottom: face.crop(0, 32, 32, 32), stem };
}

export const isPackWall = (wall: ShopWallPick): wall is PackWall => 'column' in wall;
