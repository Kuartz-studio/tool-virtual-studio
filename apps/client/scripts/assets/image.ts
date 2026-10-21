// Les images RGBA que lit et écrit le pipeline d'assets (pngjs), et les quelques opérations dont il a besoin. Rien de graphique ici :
// des tableaux d'octets, découpés, recopiés et collés, pour que chaque étape du pipeline reste déterministe et testable sans navigateur.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

// Une image RGBA : quatre octets par pixel, ligne après ligne.
export class Img {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    data?: Uint8Array,
  ) {
    this.data = data ?? new Uint8Array(width * height * 4);
  }

  private offset(x: number, y: number): number {
    return (y * this.width + x) * 4;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Rgba {
    if (!this.inside(x, y)) return { r: 0, g: 0, b: 0, a: 0 };
    const o = this.offset(x, y);
    return { r: this.data[o]!, g: this.data[o + 1]!, b: this.data[o + 2]!, a: this.data[o + 3]! };
  }

  alphaAt(x: number, y: number): number {
    return this.inside(x, y) ? this.data[this.offset(x, y) + 3]! : 0;
  }

  set(x: number, y: number, { r, g, b, a }: Rgba): void {
    if (!this.inside(x, y)) return;
    const o = this.offset(x, y);
    this.data[o] = r;
    this.data[o + 1] = g;
    this.data[o + 2] = b;
    this.data[o + 3] = a;
  }

  fillRect(x: number, y: number, w: number, h: number, color: Rgba): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, color);
  }

  // Une partie de l'image, recopiée telle quelle ; hors de l'image, des pixels transparents.
  crop(x: number, y: number, w: number, h: number): Img {
    const out = new Img(w, h);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        if (this.inside(x + xx, y + yy)) out.set(xx, yy, this.get(x + xx, y + yy));
      }
    }
    return out;
  }

  // Colle `src` à (dx, dy) : « source par-dessus » quand `over` (l'ordre de superposition des calques d'un personnage), sinon un simple
  // remplacement des pixels.
  paste(src: Img, dx: number, dy: number, over = true): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const s = src.get(x, y);
        if (s.a === 0 && over) continue;
        if (!over || s.a === 255) {
          this.set(dx + x, dy + y, s);
          continue;
        }
        const d = this.get(dx + x, dy + y);
        const a = s.a / 255;
        const outA = a + (d.a / 255) * (1 - a);
        if (outA === 0) continue;
        const mix = (sc: number, dc: number) => Math.round((sc * a + dc * (d.a / 255) * (1 - a)) / outA);
        this.set(dx + x, dy + y, { r: mix(s.r, d.r), g: mix(s.g, d.g), b: mix(s.b, d.b), a: Math.round(outA * 255) });
      }
    }
  }

  // Une case entièrement transparente ?
  isEmpty(): boolean {
    for (let i = 3; i < this.data.length; i += 4) if (this.data[i] !== 0) return false;
    return true;
  }
}

export function readImage(path: string): Img {
  const png = PNG.sync.read(readFileSync(path));
  return new Img(png.width, png.height, new Uint8Array(png.data));
}

export function encodePng(img: Img): Buffer {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data);
  return PNG.sync.write(png, { colorType: 6, deflateLevel: 9 });
}

export function writeImage(path: string, img: Img): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(img));
}
