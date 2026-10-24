// Les tuiles qui bougent : les images d'animation des sols et des murs des bureaux, tirées de leurs tuiles de base. Chaque effet travaille dans la grille du
// pack (pixel-art.ts) : un reflet qui traverse la surface (sweepFrames), une étincelle qui s'allume et s'éteint (sparkle), des couleurs qui changent d'une image
// à l'autre (une bougie, un néon). Le jeu de tuiles (tileset.ts) ajoute ces images après toutes les autres, et generated-themes.ts dit, pour chaque tuile de
// base, ses images, la durée de chacune et comment le mouvement se décale d'une case à l'autre (TILE_ANIMATIONS, que le jeu joue : game/tile-animator.ts).
// Quels sols et quels murs bougent, et comment : theme-motions.ts (et shop-walls.ts pour les murs dessinés de la boutique).
import type { TilePhase } from '@bureau/shared';
import type { Img, Rgba } from './image';
import { Art, WHITE, bayer, copyOf, mix, stack, unstack } from './pixel-art';

// Une image d'animation : sa durée, et ce qu'elle change sur la surface (une copie de la base, vue en pixels du dessin). Sans `draw`, c'est la base.
export interface MotionFrame {
  ms: number;
  draw?: (art: Art) => void;
}

// Le mouvement d'une surface (un sol, un pan de mur, la face d'un mur : son haut et son bas l'un sous l'autre, qui bougent ensemble) : ses images, et son
// décalage d'une case à l'autre (TilePhase, `step` ms par case).
export interface Motion {
  frames: readonly MotionFrame[];
  phase: TilePhase;
  step: number;
}

// Un mouvement rendu : pour chaque partie de la surface (une tuile), ses images, dans l'ordre ; la durée de chacune ; le décalage.
export interface RenderedMotion {
  images: Img[][];
  durations: number[];
  phase: TilePhase;
  step: number;
}

// Rend un mouvement sur ces tuiles (une seule, ou le haut et le bas d'une face, l'un sous l'autre) : chaque image part d'une copie de la base.
export function renderMotion(parts: readonly Img[], motion: Motion): RenderedMotion {
  const surface = parts.length === 1 ? parts[0]! : parts.slice(1).reduce((all, part) => stack(all, part), parts[0]!);
  const rows = parts[0]!.height;
  const images = parts.map((): Img[] => []);
  for (const frame of motion.frames) {
    const img = copyOf(surface);
    frame.draw?.(new Art(img));
    unstack(img, rows).forEach((part, index) => images[index]!.push(part));
  }
  return { images, durations: motion.frames.map((frame) => frame.ms), phase: motion.phase, step: motion.step };
}

// ---- Le reflet qui passe -------------------------------------------------------------------------------------------------------------------------

// Une ligne de lumière d'un reflet : où elle commence dans la bande (en pixels du dessin, dans le sens de la marche), sa largeur, et sa force (0 à 1 : la part
// du chemin vers la couleur du reflet). Tramée (`dither`), elle n'éclaire que la moitié de ses pixels : un bord doux.
export interface BandLine {
  at: number;
  width: number;
  strength: number;
  dither?: boolean;
}

export interface Sweep {
  lines: readonly BandLine[];
  // La pente de la bande : un pixel (x, y) est à u = x + slope · y. 1 : à 45° ; 0,5 : plus droite. La bande avance vers les u croissants.
  slope: number;
  // Le sens de la marche : vers la droite (x, par défaut), ou vers le bas (y : u = y + slope · x, le long d'un pan vertical).
  axis?: 'x' | 'y';
  // Ce qu'elle avance par image, en pixels du dessin : un diviseur de 16 (une case), pour que d'une case à la suivante la bande se raccorde.
  speed: number;
  // La durée de chacune de ses images (ms).
  ms: number;
  // La couleur vers laquelle elle éclaire (le blanc).
  color?: Rgba;
  // La force selon le pixel, de 0 (il ne s'éclaire pas : le liseré d'un mur, un joint) à 1 ; par défaut, tous les pixels pleinement.
  weight?: (x: number, y: number, color: Rgba) => number;
  // Comment un pixel s'éclaire, s'il ne suffit pas d'aller vers `color` (l'or qui passe au clair, puis au blanc).
  light?: (color: Rgba, strength: number) => Rgba;
  // Ce que la bande fait encore en passant, une fois la surface éclairée (une étincelle à la pointe d'un cristal qu'elle touche) : `p`, sa position.
  after?: (art: Art, p: number) => void;
}

// Éclaire la surface sous la bande, la bande étant en `p` : une ligne couvre les u de p + at à p + at + width.
export function paintBand(art: Art, sweep: Sweep, p: number): void {
  const color = sweep.color ?? WHITE;
  art.each((x, y, base) => {
    const u = sweep.axis === 'y' ? y + sweep.slope * x : x + sweep.slope * y;
    let strength = 0;
    for (const line of sweep.lines) {
      if (u < p + line.at || u >= p + line.at + line.width) continue;
      if (line.dither && bayer(x, y) >= 0.5) continue;
      strength = Math.max(strength, line.strength);
    }
    if (strength === 0) return;
    const weight = sweep.weight ? sweep.weight(x, y, base) : 1;
    if (weight <= 0) return;
    art.set(x, y, sweep.light ? sweep.light(base, strength * weight) : mix(base, color, strength * weight));
  });
  sweep.after?.(art, p);
}

// Les images d'un reflet qui traverse une surface de `width` × `height` pixels du dessin, de son entrée à sa sortie. Ses positions tombent sur une grille de
// pas `speed` partant de 0 : la case voisine, en retard de 16 / speed images, montre la même bande 16 pixels plus loin, et les deux se raccordent.
export function sweepFrames(width: number, height: number, sweep: Sweep): MotionFrame[] {
  const front = Math.max(...sweep.lines.map((line) => line.at + line.width));
  const back = Math.min(...sweep.lines.map((line) => line.at));
  const [along, across] = sweep.axis === 'y' ? [height, width] : [width, height];
  const last = along - 1 + sweep.slope * (across - 1);
  const first = sweep.speed * (Math.floor(-front / sweep.speed) + 1);
  const frames: MotionFrame[] = [];
  for (let p = first; p + back <= last; p += sweep.speed) frames.push({ ms: sweep.ms, draw: (art) => paintBand(art, sweep, p) });
  return frames;
}

// Un reflet qui revient tous les `every` ms environ : un temps de repos (la base), puis sa traversée. Le cycle est un multiple du décalage d'une case à
// l'autre (16 / speed images) : au bout d'un tour de cycle, les cases se raccordent encore.
export function passingSweep(width: number, height: number, sweep: Sweep, every: number, phase: 'x' | 'y' | 'xy'): Motion {
  const passing = sweepFrames(width, height, sweep);
  const step = (16 / sweep.speed) * sweep.ms;
  const busy = passing.length * sweep.ms;
  const cycle = Math.max(Math.ceil((busy + sweep.ms) / step), Math.round(every / step)) * step;
  return { frames: [{ ms: cycle - busy }, ...passing], phase, step };
}

// ---- Les étincelles ----------------------------------------------------------------------------------------------------------------------------

// Une étincelle de taille 0 (un point qui s'allume), 1 (une petite croix) ou 2 (une croix plus grande, le cœur blanc), sur ce pixel : vers `color`.
export function sparkle(art: Art, x: number, y: number, size: number, color: Rgba = WHITE): void {
  const light = (xx: number, yy: number, t: number) => {
    if (art.inside(xx, yy)) art.set(xx, yy, mix(art.get(xx, yy), color, t));
  };
  if (size <= 0) {
    light(x, y, 0.55);
    return;
  }
  light(x, y, 1);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    light(x + dx, y + dy, size === 1 ? 0.5 : 0.8);
    if (size >= 2) light(x + 2 * dx, y + 2 * dy, 0.35);
  }
}

// La vie d'une étincelle, image par image : elle s'allume, grandit, puis s'éteint.
export const SPARKLE_SIZES = [0, 1, 2, 1, 0] as const;

// Les images de quelques étincelles qui s'allument l'une après l'autre, chacune à son pixel, avec un repos entre deux (`rest` ms) et entre deux cycles.
export function sparkleFrames(points: ReadonlyArray<readonly [number, number]>, ms: number, rest: number, color: Rgba = WHITE, sizes: readonly number[] = SPARKLE_SIZES): MotionFrame[] {
  const frames: MotionFrame[] = [];
  for (const [x, y] of points) {
    frames.push({ ms: rest });
    for (const size of sizes) frames.push({ ms, draw: (art) => sparkle(art, x, y, size, color) });
  }
  return frames;
}

// ---- Les couleurs qui changent ----------------------------------------------------------------------------------------------------------------

// Change chaque pixel que `to` rend (null : le pixel reste).
export function recolor(art: Art, to: (color: Rgba, x: number, y: number) => Rgba | null): void {
  art.each((x, y, color) => {
    const next = to(color, x, y);
    if (next) art.set(x, y, next);
  });
}

// Le pixel a-t-il cette couleur, à quelques unités près (les couleurs du pack ne sont pas toujours rondes) ?
export function near(color: Rgba, target: Rgba, tolerance = 6): boolean {
  return Math.abs(color.r - target.r) <= tolerance && Math.abs(color.g - target.g) <= tolerance && Math.abs(color.b - target.b) <= tolerance;
}
