// Les cadrans nus des quatre horloges murales, dessinés pixel par pixel : boîtier, lunette, cadran, graduations, écran éteint, caisse de bois et
// vitrine. Ni aiguilles, ni chiffres allumés, ni balancier : le jeu les peint par-dessus à chaque seconde (src/game/clock-faces.ts, dont ce dessin
// reprend la géométrie : centres, rayons, cases de l'écran). Les couleurs sont celles du pack LimeZu (CLOCK_COLORS).
import { CLOCK_COLORS as C, CLOCK_FACES, SEGMENT_RECTS, discPixels, handPixels, tipOf, type AnalogFace, type DigitalFace } from '../../src/game/clock-faces';
import { Img, type Rgba } from '../assets/image';

export function rgba(hex: string, a = 255): Rgba {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a };
}

const plotOn = (img: Img) => (x: number, y: number, color: string) => img.set(x, y, rgba(color));

// L'éclairage du pack : la lumière vient d'en haut à gauche. -1 pour la face éclairée, 1 pour celle à l'ombre, 0 entre les deux.
function lightOf(dx: number, dy: number, distance: number): -1 | 0 | 1 {
  const side = (dx + dy) / Math.max(distance, 1);
  return side < -0.55 ? -1 : side > 0.55 ? 1 : 0;
}

const analog = (id: string): AnalogFace => CLOCK_FACES[id] as AnalogFace;

// L'horloge ronde (32 × 32) : un contour d'encre, une couronne rouge éclairée en haut à gauche, un cadran crème légèrement ombré en bas à droite,
// douze graduations (doubles à 12, 3, 6 et 9).
function roundClock(): Img {
  const img = new Img(32, 32);
  const { center } = analog('horloge-ronde');
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const [dx, dy] = [x - center.x, y - center.y];
      const d = Math.hypot(dx, dy);
      if (d > 12.5) continue;
      const light = lightOf(dx, dy, d);
      if (d > 11.5) img.set(x, y, rgba(C.ink));
      else if (d > 9.5) img.set(x, y, rgba(light < 0 ? C.redLight : light > 0 ? C.redDark : C.red));
      else img.set(x, y, rgba(d > 8 && light > 0 ? C.paper : C.white));
    }
  }
  for (let hour = 0; hour < 12; hour++) {
    const angle = (hour / 12) * Math.PI * 2;
    const outer = tipOf(center, angle, 8);
    if (hour % 3 === 0) {
      const inner = tipOf(center, angle, 7);
      img.set(outer.x, outer.y, rgba(C.ink));
      img.set(inner.x, inner.y, rgba(C.ink));
    } else {
      img.set(outer.x, outer.y, rgba(C.steelMid));
    }
  }
  return img;
}

// L'horloge LED (64 × 32) : un boîtier d'acier aux coins arrondis, éclairé en haut et à gauche, un écran noir, les segments éteints des quatre
// chiffres et des deux points (on devine « 88:88 », comme sur un vrai afficheur), et le petit voyant vert de l'alimentation.
function ledClock(): Img {
  const img = new Img(64, 32);
  const face = CLOCK_FACES['horloge-led'] as DigitalFace;
  const [left, right, top, bottom] = [2, 61, 5, 26];
  const corner = (x: number, y: number) => (x === left || x === right) && (y === top || y === bottom);
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (corner(x, y)) continue;
      const edge = x === left || x === right || y === top || y === bottom || ((x === left + 1 || x === right - 1) && (y === top + 1 || y === bottom - 1));
      if (edge) img.set(x, y, rgba(C.ink));
      else if (y === top + 1 || x === left + 1) img.set(x, y, rgba(C.steelLight));
      else if (y === bottom - 1 || x === right - 1) img.set(x, y, rgba(C.inkSoft));
      else img.set(x, y, rgba(C.steel));
    }
  }
  // L'écran : un liseré, puis le noir.
  for (let y = 8; y <= 23; y++) for (let x = 6; x <= 57; x++) img.set(x, y, rgba(x === 6 || x === 57 || y === 8 || y === 23 ? C.screenEdge : C.screen));
  for (const digitLeft of face.digits) {
    for (const [sx, sy, w, h] of Object.values(SEGMENT_RECTS)) {
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) img.set(digitLeft + sx + xx, face.top + sy + yy, rgba(C.ledOff));
    }
  }
  for (const dotTop of face.colon.dots) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) img.set(face.colon.x + dx, dotTop + dy, rgba(C.ledOff));
  img.set(58, 24, rgba('#5cf29a'));
  return img;
}

// L'horloge de gare (64 × 64) : une lunette d'acier entre deux cercles d'encre, un grand cadran blanc, soixante points pour les minutes et douze
// barres pour les heures.
function stationClock(): Img {
  const img = new Img(64, 64);
  const { center } = analog('horloge-gare');
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const [dx, dy] = [x - center.x, y - center.y];
      const d = Math.hypot(dx, dy);
      if (d > 28.5) continue;
      const light = lightOf(dx, dy, d);
      if (d > 27.5) img.set(x, y, rgba(C.ink));
      else if (d > 24.5) img.set(x, y, rgba(light < 0 ? C.pale : light > 0 ? C.steel : C.steelLight));
      else if (d > 23.5) img.set(x, y, rgba(C.inkSoft));
      else img.set(x, y, rgba(d > 21.5 && light > 0 ? C.paper : C.white));
    }
  }
  for (let minute = 0; minute < 60; minute++) {
    if (minute % 5 === 0) continue;
    const at = tipOf(center, (minute / 60) * Math.PI * 2, 22);
    img.set(at.x, at.y, rgba(C.steelMid));
  }
  for (let hour = 0; hour < 12; hour++) {
    const angle = (hour / 12) * Math.PI * 2;
    // Une barre de 18 à 22 px du centre : les pixels d'une aiguille de 22 px qui sont au-delà de 17,5.
    for (const [x, y] of handPixels(center, angle, { length: 22, width: 2 })) {
      if (Math.hypot(x - center.x, y - center.y) >= 17.5) img.set(x, y, rgba(C.ink));
    }
  }
  return img;
}

// La pendule (32 × 64) : une caisse de bois cintrée en haut, un petit cadran crème cerclé de laiton, une moulure, la vitrine sombre où bat le
// balancier (un reflet en haut à gauche, loin de sa course), et un socle terminé par un pied.
function pendulumClock(): Img {
  const img = new Img(32, 64);
  const face = analog('horloge-balancier');
  const crown = [0, 4, 7, 9, 10];
  const inside = (x: number, y: number): boolean => {
    if (y >= 1 && y <= 4) return Math.abs(x - 16) <= crown[y]!;
    if (y >= 5 && y <= 26) return x >= 5 && x <= 27;
    if (y >= 27 && y <= 29) return x >= 6 && x <= 26;
    if (y >= 30 && y <= 56) return x >= 7 && x <= 25;
    if (y >= 57 && y <= 59) return x >= 6 && x <= 26;
    if (y >= 60 && y <= 61) return x >= 11 && x <= 21;
    return false;
  };
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 32; x++) {
      if (!inside(x, y)) continue;
      const outline = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (outline) img.set(x, y, rgba(C.ink));
      else if (!inside(x - 2, y)) img.set(x, y, rgba(C.woodLight));
      else if (!inside(x + 2, y)) img.set(x, y, rgba(C.woodDark));
      else if (y === 27 || y === 57) img.set(x, y, rgba(C.woodPale));
      else if (y === 29 || y === 59) img.set(x, y, rgba(C.woodDeep));
      else img.set(x, y, rgba(C.wood));
    }
  }
  // Le cadran : un contour d'encre, un cercle de laiton éclairé en haut à gauche, le cadran crème, quatre graduations.
  const { center } = face;
  for (let y = center.y - 10; y <= center.y + 10; y++) {
    for (let x = center.x - 10; x <= center.x + 10; x++) {
      const [dx, dy] = [x - center.x, y - center.y];
      const d = Math.hypot(dx, dy);
      if (d > 9.5) continue;
      const light = lightOf(dx, dy, d);
      if (d > 8.5) img.set(x, y, rgba(C.ink));
      else if (d > 7.5) img.set(x, y, rgba(light < 0 ? C.brassLight : light > 0 ? C.brassDark : C.brass));
      else img.set(x, y, rgba(d > 6 && light > 0 ? C.paper : C.white));
    }
  }
  for (let hour = 0; hour < 12; hour += 3) {
    const at = tipOf(center, (hour / 12) * Math.PI * 2, 6);
    img.set(at.x, at.y, rgba(C.ink));
  }
  // La vitrine : un cadre d'encre, le fond sombre de la caisse, un reflet de trois pixels.
  for (let y = 30; y <= 55; y++) {
    for (let x = 9; x <= 23; x++) img.set(x, y, rgba(x === 9 || x === 23 || y === 30 || y === 55 ? C.ink : C.woodInside));
  }
  for (const [x, y] of [[11, 34], [12, 33], [13, 32], [11, 36]] as const) img.set(x, y, rgba('#7a4a40'));
  // Le crochet du balancier, en haut de la vitrine.
  for (const [x, y] of discPixels(face.pendulum!.pivot.x, face.pendulum!.pivot.y, 0.5)) img.set(x, y, rgba(C.brassDeep));
  // Un bouton de laiton au sommet de la caisse.
  img.set(16, 0, rgba(C.brassDark));
  img.set(15, 0, rgba(C.ink));
  img.set(17, 0, rgba(C.ink));
  return img;
}

// Les cadrans nus, par clé de la banque.
export const BARE_FACES: Readonly<Record<string, () => Img>> = {
  'horloge-ronde': roundClock,
  'horloge-led': ledClock,
  'horloge-gare': stationClock,
  'horloge-balancier': pendulumClock,
};

export { plotOn };
