// Le dehors du bureau, dessiné en pixel art (le pack n'a rien d'extérieur) : l'herbe et les dalles du chemin (des tuiles du jeu de tuiles), et les
// éléments du jardin de la carte (plan-decor.ts) : buissons, arbres, haie, massifs de fleurs, bassin, paillasson, tapis. Chaque dessin se fait sur
// une grille de 16 pixels par case, agrandie ×2 comme les tuiles LimeZu de 32 px : le trait reste celui du pack. Tout est tiré d'une graine : la même
// graine redonne la même image, et la génération reste déterministe.
import { Img, type Rgba } from './image';

const rgb = (r: number, g: number, b: number, a = 255): Rgba => ({ r, g, b, a });

// Un tirage pseudo-aléatoire (xorshift 32 bits) : des nombres de [0, 1), toujours les mêmes pour une graine.
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// Une image dessinée sur une grille de w × h pixels d'art, rendue à ×2.
class Art {
  readonly px: Array<Rgba | null>;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Array<Rgba | null>(w * h).fill(null);
  }

  set(x: number, y: number, c: Rgba | null): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }

  get(x: number, y: number): Rgba | null {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x]! : null;
  }

  fill(x: number, y: number, w: number, h: number, c: Rgba): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }

  toImg(): Img {
    const out = new Img(this.w * 2, this.h * 2);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.px[y * this.w + x];
        if (c) out.fillRect(x * 2, y * 2, 2, 2, c);
      }
    }
    return out;
  }
}

// ---- Le sol : l'herbe et les dalles (une case chacune) -------------------------------------------------------------------------------
const GRASS = { base: rgb(134, 186, 98), dark: rgb(112, 164, 84), light: rgb(158, 206, 114), deep: rgb(94, 146, 74) };
export const FLOWER_COLORS = { white: rgb(250, 248, 236), yellow: rgb(248, 214, 92), pink: rgb(240, 150, 170), lilac: rgb(196, 170, 236), red: rgb(226, 84, 96) };
const MEADOW = [FLOWER_COLORS.white, FLOWER_COLORS.yellow, FLOWER_COLORS.pink, FLOWER_COLORS.lilac];

// Une case d'herbe : un fond moucheté, trois touffes (un petit « v » sombre à pointes claires) et `flowers` fleurs des prés.
export function grass(seed: number, flowers = 0): Img {
  const r = seeded(seed * 7919 + 13);
  const a = new Art(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const n = r();
      a.set(x, y, n < 0.1 ? GRASS.dark : n > 0.94 ? GRASS.light : GRASS.base);
    }
  }
  for (let k = 0; k < 3; k++) {
    const x = 1 + Math.floor(r() * 13);
    const y = 2 + Math.floor(r() * 12);
    a.set(x, y, GRASS.deep);
    a.set(x + 2, y, GRASS.deep);
    a.set(x + 1, y + 1, GRASS.deep);
    a.set(x, y - 1, GRASS.light);
    a.set(x + 2, y - 1, GRASS.light);
  }
  for (let k = 0; k < flowers; k++) {
    const x = 1 + Math.floor(r() * 14);
    const y = 1 + Math.floor(r() * 14);
    a.set(x, y, MEADOW[Math.floor(r() * MEADOW.length)]!);
    a.set(x, y + 1, GRASS.deep);
  }
  return a.toImg();
}

const SLAB = { face: rgb(224, 216, 200), hi: rgb(238, 232, 220), lo: rgb(192, 182, 166), dot: rgb(208, 200, 184), joint: rgb(104, 152, 80) };

// Une dalle du chemin : la pierre claire en relief (le haut et la gauche éclairés), un joint d'herbe tout autour, où l'herbe déborde un peu.
export function slab(seed: number): Img {
  const r = seeded(seed * 104729 + 7);
  const a = new Art(16, 16);
  a.fill(0, 0, 16, 16, SLAB.joint);
  for (let y = 1; y < 15; y++) {
    for (let x = 1; x < 15; x++) {
      if ((x === 1 || x === 14) && (y === 1 || y === 14)) continue;
      let c = SLAB.face;
      if (y === 1 || x === 1) c = SLAB.hi;
      if (y === 14 || x === 14) c = SLAB.lo;
      if (c === SLAB.face && r() < 0.06) c = SLAB.dot;
      a.set(x, y, c);
    }
  }
  for (let k = 0; k < 3; k++) a.set(Math.floor(r() * 16), r() < 0.5 ? 0 : 15, GRASS.base);
  return a.toImg();
}

// ---- Les feuillages et leur ombre ------------------------------------------------------------------------------------------------------
const LEAF = { line: rgb(46, 92, 58), dark: rgb(70, 126, 68), mid: rgb(96, 158, 80), light: rgb(132, 190, 96), hi: rgb(176, 220, 124) };
const SHADOW = rgb(40, 70, 40, 70);

// Un feuillage fait de disques : contour sombre, plus clair en haut qu'en bas, moucheté, et quelques fleurs si on en donne les couleurs.
function blob(a: Art, circles: ReadonlyArray<readonly [number, number, number]>, opts: { flowers?: readonly Rgba[]; seed: number }): void {
  const r = seeded(opts.seed);
  const inside = (x: number, y: number) => circles.some(([cx, cy, rad]) => (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad);
  const minY = Math.min(...circles.map(([, cy, rad]) => cy - rad));
  const maxY = Math.max(...circles.map(([, cy, rad]) => cy + rad));
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      if (!inside(x + 0.5, y + 0.5)) continue;
      const edge = !inside(x - 0.5, y + 0.5) || !inside(x + 1.5, y + 0.5) || !inside(x + 0.5, y - 0.5) || !inside(x + 0.5, y + 1.5);
      if (edge) {
        a.set(x, y, LEAF.line);
        continue;
      }
      const t = (y - minY) / Math.max(1, maxY - minY);
      let c = t < 0.35 ? LEAF.light : t < 0.75 ? LEAF.mid : LEAF.dark;
      const n = r();
      if (n < 0.12) c = c === LEAF.light ? LEAF.mid : c === LEAF.mid ? LEAF.dark : LEAF.line;
      else if (n > 0.9 && t < 0.6) c = LEAF.hi;
      a.set(x, y, c);
    }
  }
  if (opts.flowers) {
    for (let k = 0; k < 7; k++) {
      const [cx, cy, rad] = circles[Math.floor(r() * circles.length)]!;
      const x = Math.round(cx + (r() - 0.5) * rad * 1.3);
      const y = Math.round(cy + (r() - 0.5) * rad * 1.3);
      if (a.get(x, y) && a.get(x, y) !== LEAF.line) a.set(x, y, opts.flowers[Math.floor(r() * opts.flowers.length)]!);
    }
  }
}

function shadow(a: Art, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) a.set(x, y, SHADOW);
}

// Un buisson rond d'une case (32 × 32 px), posé sur sa case.
export function bush(seed: number, flowers?: readonly Rgba[]): Img {
  const a = new Art(16, 16);
  shadow(a, 8.5, 13, 7, 2.5);
  blob(a, [[8, 8.5, 6.2], [5, 10, 4], [11.5, 10, 4]], { seed, flowers });
  return a.toImg();
}

// Un gros buisson de deux cases sur deux.
export function bigBush(seed: number, flowers?: readonly Rgba[]): Img {
  const a = new Art(32, 32);
  shadow(a, 16.5, 27, 14, 4);
  blob(a, [[16, 15, 11], [8, 19, 7.5], [24, 19, 7.5], [16, 21, 8]], { seed, flowers });
  return a.toImg();
}

// Un arbre : le tronc sur la case du milieu, une couronne de trois cases de large (96 × 128 px).
export function tree(seed: number): Img {
  const a = new Art(48, 64);
  shadow(a, 24, 59, 16, 4.5);
  const trunk = rgb(122, 86, 58);
  const trunkDark = rgb(88, 60, 42);
  for (let y = 40; y < 60; y++) {
    a.set(22, y, trunkDark);
    a.set(23, y, trunk);
    a.set(24, y, trunk);
    a.set(25, y, trunkDark);
  }
  blob(a, [[24, 24, 17], [12, 30, 10], [36, 30, 10], [24, 36, 11], [16, 14, 9], [32, 14, 9]], { seed });
  return a.toImg();
}

// Une case de haie taillée, vue du sud (32 × 44 px : le dessus dépasse de 12 px au-dessus de sa case).
export function hedge(seed: number): Img {
  const r = seeded(seed * 31 + 5);
  const a = new Art(16, 22);
  for (let y = 0; y < 22; y++) {
    for (let x = 0; x < 16; x++) {
      const top = y < 13;
      let c = top ? (y === 0 ? LEAF.line : y < 4 ? LEAF.light : LEAF.mid) : y === 21 || y === 13 ? LEAF.line : LEAF.dark;
      const n = r();
      if (y > 0 && y < 21 && y !== 13) {
        if (n < 0.14) c = top ? LEAF.dark : LEAF.line;
        else if (n > 0.9) c = top ? LEAF.hi : LEAF.mid;
      }
      a.set(x, y, c);
    }
  }
  return a.toImg();
}

// Une case de haie vue de dessus, pour les côtés ouest et est : le dessus seul, bordé de sombre des deux côtés.
export function hedgeSide(seed: number): Img {
  const r = seeded(seed * 37 + 11);
  const a = new Art(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = x === 0 || x === 15 ? LEAF.line : x < 4 ? LEAF.light : x > 12 ? LEAF.dark : LEAF.mid;
      const n = r();
      if (x > 0 && x < 15) {
        if (n < 0.14) c = LEAF.dark;
        else if (n > 0.9) c = LEAF.hi;
      }
      a.set(x, y, c);
    }
  }
  return a.toImg();
}

// ---- Ce qui se pose à même le sol ------------------------------------------------------------------------------------------------------
// Le paillasson de l'entrée, quatre cases sur une.
export function doormat(): Img {
  const a = new Art(64, 16);
  const edge = rgb(70, 66, 64);
  const mat = rgb(108, 100, 94);
  const stripe = rgb(128, 120, 112);
  a.fill(1, 2, 62, 12, edge);
  a.fill(2, 3, 60, 10, mat);
  for (let y = 4; y < 12; y += 2) a.fill(3, y, 58, 1, stripe);
  return a.toImg();
}

// Un tapis tissé (w × h cases), rond (une ellipse) ou rectangulaire : une bordure, un liseré, la trame en damier très léger.
export function rug(w: number, h: number, round: boolean, palette: 'beige' | 'greige' = 'beige'): Img {
  const P =
    palette === 'beige'
      ? { edge: rgb(176, 150, 118), border: rgb(204, 182, 150), field: rgb(226, 210, 184), weave: rgb(218, 200, 172), line: rgb(190, 166, 134) }
      : { edge: rgb(150, 146, 140), border: rgb(186, 182, 174), field: rgb(214, 210, 202), weave: rgb(204, 200, 192), line: rgb(170, 166, 158) };
  const a = new Art(w * 16, h * 16);
  const cx = a.w / 2;
  const cy = a.h / 2;
  // La distance au bord, de 0 (le centre) à 1 (le bord), d'une ellipse ou d'un rectangle ; `px` : k pixels d'art, dans cette distance.
  const d = (x: number, y: number) => {
    const nx = (x + 0.5 - cx) / cx;
    const ny = (y + 0.5 - cy) / cy;
    return round ? Math.sqrt(nx * nx + ny * ny) : Math.max(Math.abs(nx), Math.abs(ny));
  };
  const px = (k: number) => k / Math.min(cx, cy);
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const t = d(x, y);
      if (t > 1) continue;
      let c = P.field;
      if (t > 1 - px(1.2)) c = P.edge;
      else if (t > 1 - px(4)) c = P.border;
      else if (t > 1 - px(5.2) && t < 1 - px(4.2)) c = P.line;
      else if ((x + y) % 2 === 0) c = P.weave;
      a.set(x, y, c);
    }
  }
  return a.toImg();
}

// Un bassin (w × h cases) : de l'eau en ellipse, plus sombre au fond et sous la rive nord, des reflets, une bordure de pierres rondes.
export function pond(w: number, h: number, seed: number): Img {
  const r = seeded(seed * 17 + 3);
  const a = new Art(w * 16, h * 16);
  const cx = a.w / 2;
  const cy = a.h / 2;
  const WATER = { deep: rgb(64, 122, 172), mid: rgb(88, 150, 198), light: rgb(122, 182, 220), shine: rgb(200, 230, 244), shadow: rgb(50, 96, 142) };
  const STONE = { line: rgb(92, 86, 80), base: rgb(172, 166, 154), hi: rgb(210, 204, 192), lo: rgb(140, 134, 124) };
  const ax = cx - 3.5;
  const ay = cy - 3.5;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const t = Math.sqrt(((x + 0.5 - cx) / ax) ** 2 + ((y + 0.5 - cy) / ay) ** 2);
      if (t > 1) continue;
      let c = t < 0.45 ? WATER.deep : t < 0.8 ? WATER.mid : WATER.light;
      if (y < cy && t > 0.7) c = WATER.shadow;
      a.set(x, y, c);
    }
  }
  for (let k = 0; k < Math.round(w * h * 1.5); k++) {
    const x = Math.round(cx + (r() - 0.5) * ax * 1.2);
    const y = Math.round(cy + (r() - 0.3) * ay * 1.1);
    if (a.get(x, y) && a.get(x + 2, y)) {
      a.set(x, y, WATER.shine);
      a.set(x + 1, y, WATER.shine);
      if (r() < 0.5) a.set(x + 2, y, WATER.light);
    }
  }
  // La bordure : des pierres posées sur l'ellipse, éclairées en haut à gauche.
  const n = Math.round((Math.PI * (ax + ay)) / 4.2);
  for (let k = 0; k < n; k++) {
    const angle = (k / n) * Math.PI * 2 + r() * 0.15;
    const sx = cx + Math.cos(angle) * (ax + 0.5);
    const sy = cy + Math.sin(angle) * (ay + 0.5);
    const rx = 2.4 + r() * 1.2;
    const ry = 2 + r() * 0.9;
    for (let y = Math.floor(sy - ry - 1); y <= sy + ry + 1; y++) {
      for (let x = Math.floor(sx - rx - 1); x <= sx + rx + 1; x++) {
        const dist = ((x + 0.5 - sx) / rx) ** 2 + ((y + 0.5 - sy) / ry) ** 2;
        if (dist > 1.25) continue;
        let c = dist > 0.8 ? STONE.line : STONE.base;
        if (c === STONE.base && x + 0.5 < sx - rx * 0.2 && y + 0.5 < sy) c = STONE.hi;
        else if (c === STONE.base && y + 0.5 > sy + ry * 0.35) c = STONE.lo;
        a.set(x, y, c);
      }
    }
  }
  return a.toImg();
}

// Un massif de fleurs (w × h cases), rond (une ellipse) ou en rectangle arrondi : la terre ne se voit qu'au bord, dedans un tapis de feuillage
// en relief, piqué de fleurs (une croix de pétales des couleurs données, un cœur jaune).
export function flowerBed(w: number, h: number, seed: number, round = false, colors: readonly Rgba[] = MEADOW): Img {
  const r = seeded(seed * 29 + 7);
  const a = new Art(w * 16, h * 16);
  const SOIL = { edge: rgb(78, 58, 42), base: rgb(118, 88, 62), dark: rgb(98, 72, 52) };
  const R = 5;
  const inside = (x: number, y: number) => {
    if (round) return ((x + 0.5 - a.w / 2) / (a.w / 2 - 0.5)) ** 2 + ((y + 0.5 - a.h / 2) / (a.h / 2 - 0.5)) ** 2 <= 1;
    const qx = Math.max(R - x, 0, x - (a.w - 1 - R));
    const qy = Math.max(R - y, 0, y - (a.h - 1 - R));
    return qx * qx + qy * qy <= R * R;
  };
  const near = (x: number, y: number, k: number) => !inside(x - k, y) || !inside(x + k, y) || !inside(x, y - k) || !inside(x, y + k);
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      if (!inside(x, y)) continue;
      if (near(x, y, 1)) {
        a.set(x, y, SOIL.edge);
        continue;
      }
      if (near(x, y, 2)) {
        a.set(x, y, (x + y) % 2 === 0 ? SOIL.dark : SOIL.base);
        continue;
      }
      const n = r();
      a.set(x, y, n < 0.22 ? LEAF.dark : n > 0.86 ? LEAF.light : y > a.h * 0.7 && n < 0.4 ? LEAF.dark : LEAF.mid);
    }
  }
  const roomy = (x: number, y: number) => inside(x - 2, y) && inside(x + 2, y) && inside(x, y - 2) && inside(x, y + 2);
  for (let k = 0; k < Math.round(w * h * 22); k++) {
    const x = 2 + Math.floor(r() * (a.w - 4));
    const y = 2 + Math.floor(r() * (a.h - 4));
    if (!roomy(x, y)) continue;
    a.set(x, y, LEAF.mid);
    a.set(x - 1, y, LEAF.dark);
    a.set(x + 1, y, LEAF.mid);
    a.set(x, y - 1, LEAF.light);
    a.set(x, y + 1, LEAF.dark);
  }
  for (let k = 0; k < Math.round(w * h * 7); k++) {
    const x = 2 + Math.floor(r() * (a.w - 4));
    const y = 2 + Math.floor(r() * (a.h - 4));
    if (!roomy(x, y)) continue;
    const c = colors[Math.floor(r() * colors.length)]!;
    a.set(x - 1, y, c);
    a.set(x + 1, y, c);
    a.set(x, y - 1, c);
    a.set(x, y + 1, c);
    a.set(x, y, FLOWER_COLORS.yellow);
  }
  return a.toImg();
}
