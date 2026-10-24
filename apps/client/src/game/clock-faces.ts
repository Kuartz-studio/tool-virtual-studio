// Les horloges murales (packages/shared/src/decor/clocks.ts), pixel à pixel : où sont leurs cadrans dans leur image, et ce qui bouge dessus (aiguilles,
// chiffres, balancier), en fonctions pures qui rendent des pixels. Le jeu les peint sur le cadran nu à chaque seconde (wall-clocks.ts) ; le script
// des images (scripts/clocks) peint avec elles les aiguilles sur 10 h 10 de l'image de la banque, et dessine les cadrans nus d'après la même
// géométrie : l'aiguille tourne toujours autour du bon pixel.
//
// Tout se compte en pixels de l'image de l'élément (32 px par case), sans lissage : une aiguille est une ligne de pixels (Bresenham), épaissie d'un
// pixel à côté, comme on la dessinerait à la main. Les couleurs sont celles du pack LimeZu (l'encre #3a3a50 de ses contours, ses gris, son bois).

// Un pixel à peindre, en coordonnées de l'image.
export type Plot = (x: number, y: number, color: string) => void;

// L'heure à afficher (celle du fuseau de l'occupant : lib/zoned-time.ts).
export interface ClockTime {
  hours: number;
  minutes: number;
  seconds: number;
  ms: number;
}

// La palette : l'encre des contours et des aiguilles, ses gris, le rouge des trotteuses et des chiffres, le laiton et le bois.
export const CLOCK_COLORS = {
  ink: '#3a3a50',
  inkSoft: '#46465e',
  steel: '#565972',
  steelMid: '#6c6e85',
  steelLight: '#8f91a8',
  pale: '#b2aecb',
  mist: '#c6bdd5',
  shade: '#d8d0e0',
  paper: '#ebe4f2',
  white: '#f8f8f8',
  red: '#d93232',
  redLight: '#e95b4f',
  redDark: '#a13a30',
  brass: '#f2b22b',
  brassLight: '#f8d239',
  brassGlint: '#fff59a',
  brassDark: '#ed931e',
  brassDeep: '#c27417',
  wood: '#b35e3f',
  woodLight: '#ca8854',
  woodPale: '#d9a16a',
  woodDark: '#ab4a36',
  woodDeep: '#7d3326',
  woodInside: '#4a2a26',
  ledOff: '#3b1d24',
  ledOn: '#ff4a3d',
  ledGlow: '#ff8a70',
  screen: '#1d1820',
  screenEdge: '#2b2431',
} as const;

const C = CLOCK_COLORS;

// Une aiguille : sa longueur (du centre à la pointe), son épaisseur (1 à 3 pixels), sa queue (ce qui dépasse derrière le centre), sa couleur, et
// pour la trotteuse de gare, la palette ronde (son rayon, et sa distance au centre).
export interface Hand {
  length: number;
  width: 1 | 2 | 3;
  tail?: number;
  color: string;
  disc?: { at: number; radius: number };
}

export interface AnalogFace {
  kind: 'analog';
  // Le pixel autour duquel tournent les aiguilles.
  center: { x: number; y: number };
  hour: Hand;
  minute: Hand;
  second?: Hand;
  // Le moyeu : un carré de pixels au centre (1 ou 3 de côté), et la couleur de son pixel du milieu.
  hub: { size: 1 | 3; color: string; core?: string };
  // Le balancier, pour la pendule : son point d'attache, sa longueur jusqu'au centre du disque, le rayon du disque et l'angle de sa course (radians).
  pendulum?: { pivot: { x: number; y: number }; length: number; bobRadius: number; amplitude: number };
}

export interface DigitalFace {
  kind: 'digital';
  // Le coin haut-gauche de chacun des quatre chiffres (HH MM), et des deux points.
  digits: readonly [number, number, number, number];
  top: number;
  colon: { x: number; dots: readonly [number, number] };
}

export type ClockFace = AnalogFace | DigitalFace;

// La géométrie des quatre horloges, par clé de la banque. Les chiffres de chaque cadran (rayons, cases de l'écran) sont repris par le script qui
// les dessine (scripts/clocks/faces.ts).
export const CLOCK_FACES: Readonly<Record<string, ClockFace>> = {
  // L'horloge ronde, 32 × 32 : un cadran crème de 9 px de rayon dans une couronne rouge, centré sur le pixel (16, 15).
  'horloge-ronde': {
    kind: 'analog',
    center: { x: 16, y: 15 },
    hour: { length: 5, width: 2, color: C.ink },
    minute: { length: 8, width: 1, color: C.ink },
    second: { length: 8, width: 1, tail: 2, color: C.red },
    hub: { size: 1, color: C.ink },
  },
  // L'horloge LED, 64 × 32 : quatre chiffres de 8 × 14 px sur l'écran noir, les deux points entre les heures et les minutes.
  'horloge-led': {
    kind: 'digital',
    digits: [11, 21, 35, 45],
    top: 9,
    colon: { x: 31, dots: [12, 18] },
  },
  // L'horloge de gare, 64 × 64 : le grand cadran blanc (23 px de rayon) dans sa lunette d'acier, centré sur le pixel (31, 31) ; la trotteuse
  // rouge à palette ronde.
  'horloge-gare': {
    kind: 'analog',
    center: { x: 31, y: 31 },
    hour: { length: 12, width: 3, tail: 3, color: C.ink },
    minute: { length: 19, width: 2, tail: 4, color: C.ink },
    second: { length: 17, width: 1, tail: 5, color: C.red, disc: { at: 15, radius: 2 } },
    hub: { size: 3, color: C.ink, core: C.red },
  },
  // La pendule, 32 × 64 : un petit cadran (7 px de rayon) en haut de la caisse de bois, centré sur (16, 15), et le balancier de laiton dans la vitrine.
  'horloge-balancier': {
    kind: 'analog',
    center: { x: 16, y: 15 },
    hour: { length: 4, width: 1, color: C.ink },
    minute: { length: 6, width: 1, color: C.ink },
    hub: { size: 1, color: C.brassDark },
    pendulum: { pivot: { x: 16, y: 31 }, length: 18, bobRadius: 3, amplitude: 0.15 },
  },
};

// ---- Le temps → les angles, les chiffres, le balancier ------------------------------------------------------------------------------------------

// Les angles des aiguilles, en radians, depuis midi, dans le sens des aiguilles d'une montre. L'aiguille des heures avance avec les minutes, celle des
// minutes avec les secondes ; la trotteuse saute d'une seconde à la suivante.
export function handAngles({ hours, minutes, seconds }: ClockTime): { hour: number; minute: number; second: number } {
  const turn = Math.PI * 2;
  return {
    hour: (((hours % 12) + minutes / 60) / 12) * turn,
    minute: ((minutes + seconds / 60) / 60) * turn,
    second: (seconds / 60) * turn,
  };
}

// Les quatre chiffres à allumer, HH MM sur 24 h ; le premier est éteint (null) avant 10 h, comme sur un vrai réveil.
export function ledDigits({ hours, minutes }: ClockTime): [number | null, number, number, number] {
  return [hours >= 10 ? Math.floor(hours / 10) : null, hours % 10, Math.floor(minutes / 10), minutes % 10];
}

// Les deux points clignotent : allumés la première moitié de chaque seconde.
export function colonLit({ ms }: ClockTime): boolean {
  return ms < 500;
}

// L'angle du balancier : il bat la seconde (une aller simple par seconde, aux extrémités aux secondes rondes), au rythme de l'heure de l'horloge.
// Toutes les pendules du bureau battent donc ensemble.
export function pendulumAngle({ seconds, ms }: ClockTime, amplitude: number): number {
  return amplitude * Math.cos(Math.PI * (seconds + ms / 1000));
}

// Les segments d'un chiffre (a en haut, puis b, c, d, e, f dans le sens des aiguilles d'une montre, g au milieu).
const SEGMENTS: Readonly<Record<number, string>> = {
  0: 'abcdef',
  1: 'bc',
  2: 'abdeg',
  3: 'abcdg',
  4: 'bcfg',
  5: 'acdfg',
  6: 'acdefg',
  7: 'abc',
  8: 'abcdefg',
  9: 'abcdfg',
};

export function segmentsOf(digit: number): string {
  return SEGMENTS[digit] ?? '';
}

// Les rectangles de chaque segment dans un chiffre de 8 × 14 px (deux pixels d'épaisseur, coins laissés vides : le biseau des afficheurs).
export const SEGMENT_RECTS: Readonly<Record<string, readonly [x: number, y: number, w: number, h: number]>> = {
  a: [2, 0, 4, 2],
  b: [6, 2, 2, 4],
  c: [6, 8, 2, 4],
  d: [2, 12, 4, 2],
  e: [0, 8, 2, 4],
  f: [0, 2, 2, 4],
  g: [2, 6, 4, 2],
};

// ---- Des pixels ---------------------------------------------------------------------------------------------------------------------------------

// Les pixels d'une ligne de (x0, y0) à (x1, y1), bouts compris (Bresenham) : la même ligne qu'on tracerait à la main.
export function linePixels(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const [dx, dy] = [Math.abs(x1 - x0), -Math.abs(y1 - y0)];
  const [sx, sy] = [x0 < x1 ? 1 : -1, y0 < y1 ? 1 : -1];
  let [x, y, error] = [x0, y0, dx + dy];
  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) return points;
    const e2 = 2 * error;
    if (e2 >= dy) {
      error += dy;
      x += sx;
    }
    if (e2 <= dx) {
      error += dx;
      y += sy;
    }
  }
}

// Les pixels d'un disque de rayon r autour du pixel (cx, cy).
export function discPixels(cx: number, cy: number, radius: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const reach = Math.ceil(radius);
  for (let y = -reach; y <= reach; y++) for (let x = -reach; x <= reach; x++) if (Math.hypot(x, y) <= radius + 0.01) points.push([cx + x, cy + y]);
  return points;
}

// Le bout d'un rayon de longueur `length` à l'angle `angle` (depuis midi, sens horaire), arrondi au pixel.
export function tipOf(center: { x: number; y: number }, angle: number, length: number): { x: number; y: number } {
  return { x: center.x + Math.round(length * Math.sin(angle)), y: center.y - Math.round(length * Math.cos(angle)) };
}

// Une aiguille : la ligne de la queue à la pointe, épaissie d'un pixel (largeur 2) ou de part et d'autre (largeur 3) dans l'axe où elle avance le moins.
export function handPixels(center: { x: number; y: number }, angle: number, hand: Pick<Hand, 'length' | 'width' | 'tail'>): Array<[number, number]> {
  const tip = tipOf(center, angle, hand.length);
  const tail = hand.tail ? tipOf(center, angle + Math.PI, hand.tail) : center;
  const line = linePixels(tail.x, tail.y, tip.x, tip.y);
  if (hand.width === 1) return line;
  const mostlyVertical = Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle));
  const [ox, oy] = mostlyVertical ? [1, 0] : [0, 1];
  const offsets = hand.width === 2 ? [1] : [-1, 1];
  const seen = new Set(line.map(([x, y]) => `${x},${y}`));
  const out = [...line];
  for (const k of offsets) {
    for (const [x, y] of line) {
      const key = `${x + ox * k},${y + oy * k}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([x + ox * k, y + oy * k]);
    }
  }
  return out;
}

// ---- Ce que le jeu peint sur le cadran nu -------------------------------------------------------------------------------------------------------

// Ce qui change sur le cadran à cet instant, en un mot : le jeu ne repeint une horloge que quand il change (une fois par seconde pour les aiguilles,
// deux pour les deux points de l'horloge LED, à chaque pixel de course du balancier).
export function clockStateKey(face: ClockFace, time: ClockTime): string {
  if (face.kind === 'digital') return `${ledDigits(time).join('')}${colonLit(time) ? ':' : ' '}`;
  const base = `${time.hours}:${time.minutes}:${face.second ? time.seconds : ''}`;
  if (!face.pendulum) return base;
  const { pivot, length, amplitude } = face.pendulum;
  const bob = tipOf(pivot, Math.PI + pendulumAngle(time, amplitude), length);
  return `${base}|${bob.x},${bob.y}`;
}

// Peint l'heure sur le cadran nu : les segments allumés et les deux points (horloge LED), ou le balancier, les aiguilles et leur moyeu.
export function paintClock(face: ClockFace, time: ClockTime, plot: Plot): void {
  if (face.kind === 'digital') {
    ledDigits(time).forEach((digit, index) => {
      if (digit === null) return;
      const left = face.digits[index]!;
      for (const segment of segmentsOf(digit)) {
        const [x, y, w, h] = SEGMENT_RECTS[segment]!;
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) plot(left + x + xx, face.top + y + yy, C.ledOn);
      }
    });
    if (colonLit(time)) {
      for (const top of face.colon.dots) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) plot(face.colon.x + dx, top + dy, C.ledOn);
    }
    return;
  }

  // Le balancier, derrière tout : sa tige de laiton, puis son disque (un contour sombre, un reflet en haut à gauche).
  if (face.pendulum) {
    const { pivot, length, bobRadius, amplitude } = face.pendulum;
    const bob = tipOf(pivot, Math.PI + pendulumAngle(time, amplitude), length);
    for (const [x, y] of linePixels(pivot.x, pivot.y, bob.x, bob.y)) plot(x, y, C.brassDeep);
    for (const [x, y] of discPixels(bob.x, bob.y, bobRadius)) {
      const edge = Math.hypot(x - bob.x, y - bob.y) > bobRadius - 1;
      plot(x, y, edge ? C.brassDark : C.brassLight);
    }
    plot(bob.x - 1, bob.y - 1, C.brassGlint);
  }

  const angles = handAngles(time);
  for (const [x, y] of handPixels(face.center, angles.hour, face.hour)) plot(x, y, face.hour.color);
  for (const [x, y] of handPixels(face.center, angles.minute, face.minute)) plot(x, y, face.minute.color);
  if (face.second) {
    for (const [x, y] of handPixels(face.center, angles.second, face.second)) plot(x, y, face.second.color);
    if (face.second.disc) {
      const at = tipOf(face.center, angles.second, face.second.disc.at);
      for (const [x, y] of discPixels(at.x, at.y, face.second.disc.radius)) plot(x, y, face.second.color);
    }
  }
  const half = (face.hub.size - 1) / 2;
  for (let y = -half; y <= half; y++) for (let x = -half; x <= half; x++) plot(face.center.x + x, face.center.y + y, face.hub.color);
  if (face.hub.core) plot(face.center.x, face.center.y, face.hub.core);
}

// L'heure de l'image de la banque (les vignettes, l'élément qu'on tient) : 10 h 10, l'heure des vitrines d'horloger, qui dégage le cadran.
export const SHOWCASE_TIME: ClockTime = { hours: 10, minutes: 10, seconds: 37, ms: 0 };
