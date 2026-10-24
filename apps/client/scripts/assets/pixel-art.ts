// De quoi dessiner dans la grille du pack : ses images sont dessinées en 16 px et agrandies deux fois, un pixel du dessin y est un carré de 2 × 2. Les murs de
// la boutique (shop-walls.ts) et les images d'animation des sols et des murs (tile-motion.ts) s'en servent pour rester au pixel du pack.
import { Img, type Rgba } from './image';

export const rgb = (r: number, g: number, b: number): Rgba => ({ r, g, b, a: 255 });

export const WHITE = rgb(255, 255, 255);

// Une couleur à `t` du chemin vers une autre (0 : elle-même, 1 : l'autre), son opacité gardée.
export function mix(from: Rgba, to: Rgba, t: number): Rgba {
  const k = Math.max(0, Math.min(1, t));
  const at = (a: number, b: number) => Math.round(a + (b - a) * k);
  return { r: at(from.r, to.r), g: at(from.g, to.g), b: at(from.b, to.b), a: from.a };
}

export function sameColor(a: Rgba, b: Rgba): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

// Un hasard figé (le même à chaque génération) : de quoi semer des étoiles ou des marbrures sans que les images changent d'un `gen:assets` à l'autre.
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return ((s ^ (s >>> 13)) >>> 0) / 0x1_0000_0000;
  };
}

// Le tramé ordonné (Bayer 4 × 4) : un seuil de 0 à 1 par pixel, pour passer d'une couleur à l'autre sans bande nette, comme le ferait un graphiste du pixel.
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((n) => (n + 0.5) / 16);
export const bayer = (x: number, y: number): number => BAYER[(((y % 4) + 4) % 4) * 4 + (((x % 4) + 4) % 4)]!;

export const SCALE = 2;

// Une image vue en pixels du dessin (des carrés de 2 × 2) : on lit le coin haut-gauche d'un carré, on écrit le carré entier. Hors de l'image : rien.
export class Art {
  readonly w: number;
  readonly h: number;

  constructor(readonly img: Img) {
    this.w = img.width / SCALE;
    this.h = img.height / SCALE;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): Rgba {
    return this.img.get(x * SCALE, y * SCALE);
  }

  set(x: number, y: number, color: Rgba): void {
    if (this.inside(x, y)) this.img.fillRect(x * SCALE, y * SCALE, SCALE, SCALE, color);
  }

  // Chaque pixel du dessin, avec sa couleur.
  each(fn: (x: number, y: number, color: Rgba) => void): void {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) fn(x, y, this.get(x, y));
  }
}

// Une copie de l'image.
export function copyOf(img: Img): Img {
  return new Img(img.width, img.height, new Uint8Array(img.data));
}

// Deux images de même largeur, l'une sous l'autre (le haut et le bas de la face d'un mur), et l'inverse.
export function stack(top: Img, bottom: Img): Img {
  const out = new Img(top.width, top.height + bottom.height);
  out.paste(top, 0, 0, false);
  out.paste(bottom, 0, top.height, false);
  return out;
}

export function unstack(img: Img, rows: number): Img[] {
  return Array.from({ length: img.height / rows }, (_, i) => img.crop(0, i * rows, img.width, rows));
}

export function sameImage(a: Img, b: Img): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}
