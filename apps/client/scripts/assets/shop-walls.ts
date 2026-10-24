// Les murs de la boutique : des thèmes de murs qu'on achète une fois (en kuartzons) pour sa pièce, comme les éléments de la collection à part. Six sont
// des murs du Room Builder de LimeZu que les murs libres (WALL_PICKS, tileset.ts) n'utilisent pas ; six sont dessinés ici, au pixel, dans la grille du
// pack (des pixels de 2 × 2 : le pack est dessiné en 16 px et agrandi deux fois) et avec sa construction : le liseré blanc du haut, la surface, la plinthe,
// et le pan vertical (les côtés de la pièce). Leurs tuiles s'ajoutent au jeu de tuiles après toutes les autres : les numéros des tuiles déjà posées sur la
// carte ne bougent pas.
// Les six murs dessinés bougent (leurs images d'animation, tile-motion.ts) : le néon pulse, la galaxie scintille et une étoile filante la traverse, la lumière
// passe dans les cristaux du kuartz, le vent court dans la jungle, l'or de l'art déco et du marbre accroche un reflet. Une image k du mouvement se dessine en
// rappelant le dessin avec `frame` = k (0 : le dessin de base) ; les murs du pack ont le leur dans theme-motions.ts.
import { Img, type Rgba } from './image';
import { BAYER, mix, rgb, seeded, stack, type Art } from './pixel-art';
import { near, passingSweep, sparkle, type Motion, type MotionFrame, type Sweep } from './tile-motion';

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
// du bord) et les couleurs de sa plinthe, du clair (le filet du haut) au sombre. `frame` : l'image du mouvement à dessiner (0 : le dessin de base).
// `motion` : le mouvement de sa face et de son pan.
interface DrawnWall extends ShopWallBase {
  paper(canvas: Canvas, frame: number): void;
  stem(canvas: Canvas, frame: number): void;
  baseboard: readonly [Rgba, Rgba, Rgba, Rgba];
  motion?: (wall: DrawnWall) => WallMotion;
}

export type ShopWallPick = PackWall | DrawnWall;

export interface ShopWallTiles {
  top: Img;
  bottom: Img;
  stem: Img;
}

// Le mouvement d'un mur : celui de sa face (le haut et le bas ensemble), celui de son pan vertical ; l'un ou l'autre peut manquer (il ne bouge pas).
export interface WallMotion {
  face?: Motion;
  stem?: Motion;
}

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

  // Un pixel qui ne se répète pas d'une case à l'autre (ce qui traverse le mur : une étoile filante) : hors de la surface, il n'est pas peint.
  plot(x: number, y: number, color: Rgba): void {
    if (x >= 0 && x < this.width) this.set(x, y, color);
  }

  // Une image tirée d'un dessin en lettres : une rangée par chaîne, une lettre par pixel ; une lettre absente de la légende (« . ») ne peint rien.
  draw(x0: number, y0: number, rows: readonly string[], legend: Readonly<Record<string, Rgba>>): void {
    rows.forEach((row, dy) => [...row].forEach((ch, dx) => legend[ch] && this.set(x0 + dx, y0 + dy, legend[ch]!)));
  }
}

// Un dégradé en tramé ordonné (Bayer 4 × 4) : passe d'une couleur à la suivante sans bande nette, comme le ferait un graphiste du pixel.
function gradient(canvas: Canvas, colors: readonly Rgba[]): void {
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const t = (y / (canvas.height - 1)) * (colors.length - 1);
      const i = Math.min(colors.length - 2, Math.floor(t));
      canvas.set(x, y, t - i > BAYER[(y % 4) * 4 + (x % 4)]! ? colors[i + 1]! : colors[i]!);
    }
  }
}

// Les images d'un mouvement redessiné : pour chacune, sa durée et l'image du dessin (`frame`) qu'elle montre, à la place de la base.
function redrawn(images: (frame: number) => Img, frames: ReadonlyArray<readonly [number, number]>, phase: Motion['phase'], step: number): Motion {
  return { frames: frames.map(([ms, frame]): MotionFrame => ({ ms, draw: (art) => art.img.paste(images(frame), 0, 0, false) })), phase, step };
}

// ---- Néon : un mur de briques sombres, un tube rose en vague et un tube cyan, chacun avec son halo ; la plinthe s'allume en cyan. -----------------
// Il vit : une impulsion blanche court le long du tube rose, de gauche à droite (une toutes les deux cases), et les halos s'avivent autour d'elle comme une
// vague, le rose et le cyan à contretemps. Le pan vertical a la sienne, qui descend.
const NEON = {
  shade: rgb(18, 16, 40),
  brick: rgb(30, 27, 58),
  mortar: rgb(23, 21, 46),
  pink: rgb(255, 96, 208),
  pinkGlow: rgb(124, 46, 122),
  cyan: rgb(92, 236, 255),
  cyanGlow: rgb(34, 98, 134),
  hot: rgb(255, 230, 250),
  warm: rgb(255, 168, 232),
  pinkGlowHot: rgb(178, 66, 166),
  cyanGlowHot: rgb(50, 142, 182),
};
// Seize images de 70 ms : l'impulsion avance de deux pixels par image, d'une case en huit images.
const NEON_FRAMES = 16;
const NEON_MS = 70;

function neonBricks(canvas: Canvas, rows: number): void {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const course = Math.floor(y / 4);
      const joint = y % 4 === 3 || (x + (course % 2) * 4) % 8 === 0;
      canvas.set(x, y, joint ? NEON.mortar : NEON.brick);
    }
  }
}

// Un tube : son cœur sur ces pixels, et son halo sur leurs voisins du dessus et du dessous qui ne sont pas du tube (à gauche et à droite pour un tube
// vertical). Les couleurs peuvent dépendre du pixel (l'impulsion, la vague du halo).
function tube(
  canvas: Canvas,
  points: ReadonlyArray<readonly [number, number]>,
  core: Rgba | ((x: number, y: number) => Rgba),
  glow: Rgba | ((x: number, y: number) => Rgba),
  vertical = false,
): void {
  const key = (x: number, y: number) => `${((x % canvas.width) + canvas.width) % canvas.width},${y}`;
  const lit = new Set(points.map(([x, y]) => key(x, y)));
  const at = (color: Rgba | ((x: number, y: number) => Rgba), x: number, y: number) => (typeof color === 'function' ? color(x, y) : color);
  for (const [x, y] of points) {
    const around: Array<[number, number]> = vertical ? [[x - 1, y], [x + 1, y]] : [[x, y - 1], [x, y + 1]];
    for (const [ax, ay] of around) if (!lit.has(key(ax, ay))) canvas.set(ax, ay, at(glow, x, y));
  }
  for (const [x, y] of points) canvas.set(x, y, at(core, x, y));
}

// À l'image k (1 à 16), au pixel `along` du tube (en pixels de la case, dans le sens de la marche) : la distance à l'impulsion la plus proche (elles sont
// espacées de 32 pixels, deux cases), et la vague du halo, de 0 à 1, qui culmine sur l'impulsion. D'une case à la suivante, en retard de huit images, l'une
// et l'autre se raccordent.
function neonPulse(along: number, frame: number): { distance: number; surge: number } {
  const at = (2 * (frame - 1)) % 32;
  const distance = Math.min(...[at - 32, at, at + 32].map((p) => Math.abs(along - p)));
  return { distance, surge: 0.5 + 0.5 * Math.cos((2 * Math.PI * (along - at)) / 32) };
}

const neonCore = (along: number, frame: number): Rgba => {
  if (frame === 0) return NEON.pink;
  const { distance } = neonPulse(along, frame);
  return distance <= 1 ? NEON.hot : distance === 2 ? NEON.warm : NEON.pink;
};

// Le halo, en trois teintes : la vague l'avive, `against` la prend à contretemps (le cyan quand le rose s'avive).
const neonGlow = (base: Rgba, hot: Rgba, along: number, frame: number, against = false): Rgba => {
  if (frame === 0) return base;
  const surge = neonPulse(along, frame).surge;
  const level = against ? 1 - surge : surge;
  return level > 0.8 ? hot : level > 0.45 ? mix(base, hot, 0.5) : base;
};

const neon: DrawnWall = {
  id: 'mur-neon',
  label: 'Néon',
  price: 2400,
  paper(canvas, frame) {
    neonBricks(canvas, canvas.height);
    for (let x = 0; x < canvas.width; x++) canvas.set(x, 0, NEON.shade);
    // La vague rose : un aller-retour de trois pixels sur huit de large, deux fois par case.
    const wave = [0, 1, 2, 3, 3, 2, 1, 0];
    tube(
      canvas,
      Array.from({ length: canvas.width }, (_, x) => [x, 5 + wave[x % 8]!] as const),
      (x) => neonCore(x, frame),
      (x) => neonGlow(NEON.pinkGlow, NEON.pinkGlowHot, x, frame),
    );
    tube(
      canvas,
      Array.from({ length: canvas.width }, (_, x) => [x, 14] as const),
      NEON.cyan,
      (x) => neonGlow(NEON.cyanGlow, NEON.cyanGlowHot, x, frame, true),
    );
  },
  stem(canvas, frame) {
    neonBricks(canvas, canvas.height);
    tube(
      canvas,
      Array.from({ length: canvas.height }, (_, y) => [6, y] as const),
      (_x, y) => neonCore(y, frame),
      (_x, y) => neonGlow(NEON.pinkGlow, NEON.pinkGlowHot, y, frame),
      true,
    );
  },
  baseboard: [NEON.cyan, rgb(42, 40, 76), rgb(32, 30, 60), rgb(22, 20, 44)],
  motion: (wall) => {
    const frames = Array.from({ length: NEON_FRAMES }, (_, k) => [NEON_MS, k + 1] as const);
    const step = (NEON_FRAMES / 2) * NEON_MS;
    return { face: redrawn((k) => faceOf(wall, k), frames, 'x', step), stem: redrawn((k) => stemOf(wall, k), frames, 'y', step) };
  },
};

// ---- Galaxie : la nuit qui s'éclaircit vers une nébuleuse violette, des étoiles semées, deux qui scintillent. --------------------------------------
// Elle vit : les deux grandes étoiles grandissent et rapetissent, de petites étoiles s'éteignent et se rallument, et de temps en temps une étoile filante
// traverse le mur de gauche à droite (huit pixels par image : la case voisine la reprend deux images plus tard).
const SPACE = [rgb(12, 9, 30), rgb(22, 15, 52), rgb(38, 22, 80), rgb(64, 32, 106)];
const NEBULA = rgb(104, 48, 136);
const STAR = rgb(255, 255, 255);
const STAR_BLUE = rgb(172, 192, 255);
const STAR_GOLD = rgb(255, 224, 138);
const STAR_FAR = rgb(128, 112, 222);

// Les états du ciel : la taille des deux grandes étoiles (0 : un point, 1 : une croix, 2 : une grande croix), les petites étoiles éteintes (leur rang),
// et la tête de l'étoile filante (son pixel en x, ou null). L'état 0 est le dessin de base.
interface Sky {
  big: readonly [number, number];
  off: readonly number[];
  meteor: number | null;
}
const SKIES: readonly Sky[] = [
  { big: [1, 1], off: [], meteor: null },
  { big: [2, 0], off: [2], meteor: null },
  { big: [1, 1], off: [5, 9], meteor: null },
  { big: [0, 2], off: [0], meteor: null },
  { big: [1, 0], off: [3, 7], meteor: null },
  { big: [1, 1], off: [], meteor: 0 },
  { big: [1, 1], off: [], meteor: 8 },
  { big: [1, 1], off: [], meteor: 16 },
];
const METEOR_MS = 60;
const METEOR_ROW = 2;
// La traîne de l'étoile filante, de la tête vers l'arrière.
const METEOR_TRAIL = [STAR, STAR, STAR_BLUE, STAR_BLUE, rgb(124, 112, 214), rgb(84, 66, 160), rgb(56, 38, 112)];

function stars(canvas: Canvas, seed: number, count: number, off: readonly number[] = []): void {
  const random = seeded(seed);
  const colors = [STAR, STAR, STAR_BLUE, STAR_GOLD];
  for (let i = 0; i < count; i++) {
    const [x, y, color] = [Math.floor(random() * canvas.width), Math.floor(random() * (canvas.height - 3)), colors[Math.floor(random() * colors.length)]!];
    if (!off.includes(i)) canvas.set(x, y, color);
  }
}

function twinkle(canvas: Canvas, x: number, y: number, size = 1): void {
  if (size >= 1) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) canvas.set(x + dx, y + dy, STAR_BLUE);
  if (size >= 2) for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]] as const) canvas.set(x + dx, y + dy, STAR_FAR);
  canvas.set(x, y, STAR);
}

const galaxy: DrawnWall = {
  id: 'mur-galaxie',
  label: 'Galaxie',
  price: 3200,
  paper(canvas, frame) {
    const sky = SKIES[frame]!;
    gradient(canvas, SPACE);
    // Une nébuleuse : deux nuages ovales, tramés, en bas de la surface.
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const cloud = Math.max(1 - ((x - 4) / 6) ** 2 - ((y - 16) / 3.5) ** 2, 1 - ((x - 12) / 5) ** 2 - ((y - 18) / 2.5) ** 2);
        if (cloud > BAYER[(y % 4) * 4 + (x % 4)]! * 0.9) canvas.set(x, y, NEBULA);
      }
    }
    stars(canvas, 7, 11, sky.off);
    twinkle(canvas, 11, 4, sky.big[0]);
    twinkle(canvas, 3, 9, sky.big[1]);
    if (sky.meteor !== null) METEOR_TRAIL.forEach((color, back) => canvas.plot(sky.meteor! - back, METEOR_ROW, color));
  },
  // Le pan vertical se répète de haut en bas : pas de dégradé, un fond tramé égal et ses étoiles.
  stem(canvas, frame) {
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) canvas.set(x, y, BAYER[(y % 4) * 4 + (x % 4)]! < 0.25 ? SPACE[2]! : SPACE[1]!);
    stars(canvas, 21, 5, SKIES[frame]!.off.map((i) => i % 5));
  },
  baseboard: [rgb(132, 98, 210), rgb(50, 30, 84), rgb(38, 22, 64), rgb(24, 14, 42)],
  motion: (wall) => {
    // Le ciel change d'état à des rythmes inégaux pendant huit secondes, puis l'étoile filante passe ; le cycle fait un nombre rond de décalages de case.
    const step = 2 * METEOR_MS;
    const sky: Array<readonly [number, number]> = [[700, 1], [520, 2], [830, 3], [610, 4], [760, 1], [540, 2], [680, 3], [590, 4], [720, 1], [650, 2], [560, 3]];
    const meteor: Array<readonly [number, number]> = [[METEOR_MS, 5], [METEOR_MS, 6], [METEOR_MS, 7]];
    const busy = [...sky, ...meteor].reduce((sum, [ms]) => sum + ms, 0);
    const rest = Math.ceil(busy / step) * step - busy;
    const face = redrawn((k) => faceOf(wall, k), [...sky.slice(0, -1), [sky[sky.length - 1]![0] + rest, sky[sky.length - 1]![1]], ...meteor], 'x', step);
    // Le pan : ses étoiles s'éteignent et se rallument, pas en même temps d'un pan à l'autre.
    const stem = redrawn((k) => stemOf(wall, k), [[900, 1], [700, 2], [1100, 3], [800, 4]], 'scatter', 0);
    return { face, stem };
  },
};

// ---- Marbre noir et or : un marbre presque noir, marbré de gris, deux veines d'or, et une frise dorée sous le liseré ; la plinthe est en or. -----------
// L'or accroche un reflet qui traverse le mur, et le marbre luit à peine sous lui.
const MARBLE = { base: rgb(29, 29, 34), cloud: rgb(38, 38, 45), vein: rgb(80, 80, 92), gold: rgb(214, 174, 68), goldLight: rgb(248, 216, 124), goldDark: rgb(140, 104, 34) };
const GOLD_SHINE = rgb(255, 246, 214);

function marble(canvas: Canvas, seed: number): void {
  const random = seeded(seed);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) canvas.set(x, y, random() < 0.22 ? MARBLE.cloud : MARBLE.base);
}

// Comment l'or s'éclaire sous un reflet : le sombre devient l'or, l'or le clair, le clair presque blanc ; ce qui n'est pas de l'or, selon `rest`.
function goldLight(gold: { gold: Rgba; goldLight: Rgba; goldDark: Rgba }, rest: (color: Rgba, strength: number) => Rgba = (color) => color) {
  return (color: Rgba, strength: number): Rgba => {
    if (near(color, gold.goldLight)) return mix(color, GOLD_SHINE, strength);
    if (near(color, gold.gold)) return mix(color, gold.goldLight, strength);
    if (near(color, gold.goldDark)) return mix(color, gold.gold, strength);
    return rest(color, strength);
  };
}

// Le reflet de l'or : un trait franc et un trait fin, de biais.
const goldSweep = (light: Sweep['light'], axis: 'x' | 'y' = 'x'): Sweep => ({
  lines: [
    { at: 0, width: 2, strength: 1 },
    { at: 3, width: 1, strength: 0.6 },
  ],
  slope: 0.5,
  axis,
  speed: 4,
  ms: 55,
  light,
});

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
  motion: () => {
    // Le marbre luit à peine (vers un gris bleuté), l'or brille.
    const light = goldLight(MARBLE, (color, strength) => (color.r < 100 ? mix(color, rgb(92, 92, 108), strength * 0.35) : color));
    return { face: passingSweep(16, 32, goldSweep(light), 6000, 'x'), stem: passingSweep(16, 16, goldSweep(goldLight(MARBLE), 'y'), 5200, 'y') };
  },
};

// ---- Jungle : de grandes feuilles découpées sur un vert profond, leurs nervures, et la lumière sur leurs bords ; la plinthe est en bois. -------------
// De temps en temps, un coup de vent traverse le mur : sur son passage, les feuilles se soulèvent d'un pixel et la lumière y glisse.
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

// Le coup de vent, à la position `p` de sa bande (u = x + y / 4 : presque droite) : les pixels de la bande prennent la couleur de celui du dessous (la feuille
// se soulève), éclaircie d'un cran (la lumière y passe).
function gust(art: Art, p: number): void {
  const before = Array.from({ length: art.h }, (_, y) => Array.from({ length: art.w }, (_, x) => art.get(x, y)));
  const brighter = (color: Rgba): Rgba =>
    near(color, JUNGLE.leaf, 2) ? JUNGLE.light : near(color, JUNGLE.light, 2) ? JUNGLE.shine : near(color, JUNGLE.dark, 2) ? mix(JUNGLE.dark, JUNGLE.leaf, 0.35) : color;
  for (let y = 6; y <= 24; y++) {
    for (let x = 0; x < art.w; x++) {
      const u = x + y / 4;
      if (u < p || u >= p + 3) continue;
      art.set(x, y, u < p + 2 ? brighter(before[y + 1]![x]!) : before[y + 1]![x]!);
    }
  }
}

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
  motion: () => ({
    face: passingSweep(16, 32, { lines: [{ at: 0, width: 3, strength: 0 }], slope: 0.25, speed: 4, ms: 80, after: gust }, 4600, 'x'),
  }),
};

// ---- Art déco : un soleil levant d'or par case (un arc, ses rayons, son cœur), une frise en gradins sous le liseré, un losange entre deux soleils, sur un
// bleu canard ; la plinthe garde un filet d'or. Un reflet passe sur l'or, et le cœur des soleils étincelle à son passage. --------------------------
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
  motion: () => {
    const gold = { gold: DECO.gold, goldLight: DECO.goldLight, goldDark: DECO.deep };
    // Le cœur du soleil (au milieu du bas de la surface : la rangée 25 de la face) étincelle quand le reflet le touche.
    const heart = (art: Art, p: number) => {
      const u = 8 + 0.5 * 24;
      if (u >= p && u < p + 2) sparkle(art, 8, 24, 2, GOLD_SHINE);
      else if (u >= p + 2 && u < p + 4) sparkle(art, 8, 24, 1, GOLD_SHINE);
    };
    return {
      face: passingSweep(16, 32, { ...goldSweep(goldLight({ ...gold, goldDark: rgb(140, 104, 34) })), after: heart }, 5000, 'x'),
      stem: passingSweep(16, 16, goldSweep(goldLight({ ...gold, goldDark: rgb(140, 104, 34) }), 'y'), 4600, 'y'),
    };
  },
};

// ---- Kuartz : une géode, des cristaux de quartz rose et lilas qui montent de la plinthe devant un fond qui s'assombrit vers le bas, des éclats de lumière
// à leurs pointes ; le mur du kuartzon. Une lumière traverse les cristaux, et chaque pointe qu'elle touche étincelle. ----------------------------------
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

// Les cristaux de la face : colonne de gauche, largeur, hauteur (du fond vers l'avant : les grands, puis les petits devant leur pied).
const CRYSTALS = [
  [3, 5, 16],
  [10, 5, 13],
  [0, 4, 10],
  [8, 3, 8],
  [14, 3, 7],
  [6, 3, 4],
  [12, 3, 3],
] as const;

// Comment la lumière passe dans le quartz : chaque teinte gagne un cran vers le clair, le fond s'éclaire un peu.
function quartzLight(color: Rgba, strength: number): Rgba {
  if (near(color, QUARTZ.side)) return mix(color, QUARTZ.face, strength);
  if (near(color, QUARTZ.face)) return mix(color, QUARTZ.light, strength);
  if (near(color, QUARTZ.light)) return mix(color, QUARTZ.glint, strength);
  if (near(color, QUARTZ.edge)) return mix(color, QUARTZ.side, strength * 0.7);
  return mix(color, QUARTZ.glint, strength * 0.25);
}

const quartzSweep = (axis: 'x' | 'y'): Sweep => ({
  lines: [
    { at: 0, width: 1, strength: 0.5 },
    { at: 1, width: 2, strength: 1 },
    { at: 3, width: 1, strength: 0.5 },
  ],
  slope: 0.25,
  axis,
  speed: 4,
  ms: 60,
  light: quartzLight,
});

const quartz: DrawnWall = {
  id: 'mur-kuartz',
  label: 'Kuartz',
  price: 7500,
  paper(canvas) {
    gradient(canvas, QUARTZ.sky);
    for (const [left, width, height] of CRYSTALS) crystal(canvas, left, width, height);
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
  motion: () => {
    // Les pointes des cristaux, sur la face (la surface commence à la rangée 6) : la lumière qui en touche une la fait étinceler.
    const tips = CRYSTALS.map(([left, width, height]) => [left + Math.floor(width / 2), PAPER_TOP + PAPER_ROWS - height] as const);
    const sweep = quartzSweep('x');
    const sparkleTips = (art: Art, p: number) => {
      for (const [x, y] of tips) {
        const u = x + sweep.slope * y;
        if (u >= p + 1 && u < p + 3) sparkle(art, x, y - 1, 2);
        else if (u >= p + 3 && u < p + 5) sparkle(art, x, y - 1, 1);
      }
    };
    return { face: passingSweep(16, 32, { ...sweep, after: sparkleTips }, 5200, 'x'), stem: passingSweep(16, 16, quartzSweep('y'), 4400, 'y') };
  },
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

// La face d'un mur dessiné (32 × 64 : le haut avec son liseré, le bas avec sa plinthe), à l'image `frame` de son mouvement, construite comme celles du pack.
function faceOf(wall: DrawnWall, frame: number): Img {
  const paper = new Canvas(16, PAPER_ROWS, CAP);
  wall.paper(paper, frame);
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
  return face;
}

// Le pan vertical d'un mur dessiné (32 × 32), à l'image `frame` de son mouvement.
function stemOf(wall: DrawnWall, frame: number): Img {
  const stemPaper = new Canvas(14, 16, CAP);
  wall.stem(stemPaper, frame);
  const stem = new Img(32, 32);
  for (let y = 0; y < 16; y++) {
    plot(stem, 0, y, OUTLINE);
    plot(stem, 15, y, OUTLINE);
    for (let x = 0; x < 14; x++) plot(stem, x + 1, y, y === STEM_LINE ? wall.baseboard[1] : stemPaper.get(x, y));
  }
  return stem;
}

// Les trois tuiles d'un mur dessiné : la face (le haut avec son liseré, le bas avec sa plinthe) et le pan vertical, construites comme celles du pack.
export function drawShopWall(wall: DrawnWall): ShopWallTiles {
  const face = faceOf(wall, 0);
  return { top: face.crop(0, 0, 32, 32), bottom: face.crop(0, 32, 32, 32), stem: stemOf(wall, 0) };
}

// Le mouvement d'un mur dessiné (rien pour un mur du pack : le sien est dans theme-motions.ts).
export function drawnWallMotion(wall: DrawnWall): WallMotion {
  return wall.motion?.(wall) ?? {};
}

export const isPackWall = (wall: ShopWallPick): wall is PackWall => 'column' in wall;

// Pour les tests : la face entière (le haut et le bas l'un sous l'autre) d'un mur dessiné, telle que le jeu de tuiles la reçoit.
export function drawnFace(wall: DrawnWall): Img {
  const { top, bottom } = drawShopWall(wall);
  return stack(top, bottom);
}
