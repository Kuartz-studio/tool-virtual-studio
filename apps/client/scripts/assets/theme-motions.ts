// Quels sols et quels murs bougent, et comment (les effets : tile-motion.ts). Chacun selon sa matière : ce qui brille (carrelage, marbre, parquet vitrifié)
// voit passer un reflet ; une peinture, un satiné doux qui glisse ; le sable et le granit pailletent ; l'eau de la mosaïque turquoise ondule. Les murs de la
// boutique sont plus vivants : le velours ondule, les rayures seventies s'allument l'une après l'autre, les losanges scintillent, les bougies des citrouilles
// vacillent, les dorures de la bibliothèque brillent (les six murs dessinés ont leur mouvement avec leur dessin : shop-walls.ts). Le béton, la brique, la
// moquette et la pierre ne bougent pas.
// Une face de mur se compte en pixels du dessin, son haut et son bas l'un sous l'autre : 16 × 32, le liseré (rangées 0 à 5), la surface (6 à 25), la plinthe
// (26 à 30), le trait du bas (31). Un sol : 16 × 16.
import type { Rgba } from './image';
import { mix, rgb, seeded, type Art } from './pixel-art';
import { near, passingSweep, recolor, sparkle, type Motion, type MotionFrame, type Sweep } from './tile-motion';

const onPaper = (y: number) => y >= 6 && y <= 25;
const onBaseboard = (y: number) => y >= 26 && y <= 30;

// ---- Les murs -----------------------------------------------------------------------------------------------------------------------------------

// Le satiné d'une peinture : une bande large, au bord tramé, qui glisse en travers du mur, un peu plus franche sur la plinthe.
function satin(every: number, strength = 1): Motion {
  const sweep: Sweep = {
    lines: [
      { at: 0, width: 2, strength: 0.07 * strength, dither: true },
      { at: 2, width: 4, strength: 0.14 * strength },
      { at: 6, width: 2, strength: 0.07 * strength, dither: true },
    ],
    slope: 0.5,
    speed: 4,
    ms: 70,
    weight: (_x, y) => (onPaper(y) ? 1 : onBaseboard(y) ? 1.6 : 0),
  };
  return passingSweep(16, 32, sweep, every, 'x');
}

// Le reflet vif d'une surface qui brille (des carreaux, un bois verni) : un trait franc suivi d'un trait fin.
function gloss(every: number, strength = 1): Motion {
  const sweep: Sweep = {
    lines: [
      { at: 0, width: 3, strength: 0.42 * strength },
      { at: 4, width: 1, strength: 0.3 * strength },
    ],
    slope: 0.5,
    speed: 4,
    ms: 50,
    weight: (_x, y) => (onPaper(y) || onBaseboard(y) ? 1 : 0),
  };
  return passingSweep(16, 32, sweep, every, 'x');
}

// Le velours : la lumière glisse sur les plis, presque droite comme le tissu qui tombe ; les creux sombres des plis restent dans l'ombre.
const VELVET_FOLD = rgb(103, 52, 46);
const velvet: Motion = passingSweep(
  16,
  32,
  {
    lines: [
      { at: 0, width: 2, strength: 0.16, dither: true },
      { at: 2, width: 3, strength: 0.34 },
      { at: 5, width: 2, strength: 0.16, dither: true },
    ],
    slope: 0.25,
    speed: 4,
    ms: 80,
    color: rgb(255, 196, 182),
    weight: (_x, y, color) => (!onPaper(y) ? 0 : near(color, VELVET_FOLD) ? 0.25 : 1),
  },
  4200,
  'x',
);

// Le lambris : un reflet court le long de la cimaise (le filet clair au-dessus du bois), plus doux sur le panneau vert, à peine sur la peinture.
const LAMBRIS = { rail: rgb(193, 198, 165), panel: rgb(104, 145, 131), paint: rgb(238, 225, 183) };
const lambris: Motion = passingSweep(
  16,
  32,
  {
    lines: [
      { at: 0, width: 2, strength: 0.5 },
      { at: 3, width: 1, strength: 0.3 },
    ],
    slope: 0.5,
    speed: 4,
    ms: 55,
    weight: (_x, y, color) => (!onPaper(y) && !onBaseboard(y) ? 0 : near(color, LAMBRIS.rail) ? 1.4 : near(color, LAMBRIS.panel) ? 0.55 : near(color, LAMBRIS.paint) ? 0.25 : 0.4),
  },
  5600,
  'x',
);

// Les rayures seventies : une à une, de gauche à droite, les bandes orange s'embrasent (et les grises rosissent un peu), comme une enseigne de discothèque.
const SEVENTIES = { orange: [rgb(182, 115, 74), rgb(178, 106, 71), rgb(171, 89, 66)], grey: [rgb(114, 101, 103), rgb(110, 96, 99), rgb(103, 88, 93)] };
const seventies: Motion = passingSweep(
  16,
  32,
  {
    lines: [
      { at: 0, width: 4, strength: 0.6 },
      { at: 4, width: 4, strength: 0.25 },
    ],
    slope: 0,
    speed: 4,
    ms: 90,
    light: (color, strength) => {
      if (SEVENTIES.orange.some((c) => near(color, c))) return mix(color, rgb(255, 202, 96), strength);
      if (SEVENTIES.grey.some((c) => near(color, c))) return mix(color, rgb(170, 118, 150), strength * 0.6);
      return color;
    },
    weight: (_x, y) => (onPaper(y) ? 1 : 0),
  },
  5200,
  'x',
);

// Les losanges : l'un après l'autre, un losange s'éclaire et une étincelle naît à sa pointe ; d'une colonne à l'autre, au hasard.
const DIAMONDS = [rgb(197, 192, 159), rgb(159, 197, 188)];
function losanges(): Motion {
  // Les pointes du haut des quatre losanges de la face (mesurées sur le mur du pack) ; un losange fait 7 pixels de large et de haut.
  const frames: MotionFrame[] = [];
  const order = [0, 3, 1, 2];
  const tops = [
    [3, 9],
    [11, 9],
    [3, 21],
    [11, 21],
  ] as const;
  for (const index of order) {
    const [tx, ty] = tops[index]!;
    frames.push({ ms: 1100 });
    for (const [size, glow] of [[0, 0.15], [1, 0.3], [2, 0.42], [1, 0.3], [0, 0.15]] as const) {
      frames.push({
        ms: 85,
        draw: (art) => {
          recolor(art, (color, x, y) => (DIAMONDS.some((c) => near(color, c)) && Math.abs(x - tx) <= 3 && y >= ty && y <= ty + 6 ? mix(color, rgb(255, 255, 255), glow) : null));
          sparkle(art, tx, ty, size);
        },
      });
    }
  }
  return { frames, phase: 'scatter', step: 0 };
}

// Les citrouilles : la bougie de chacune vacille (les yeux et la bouche s'avivent, faiblissent), en irrégulier, et pas toutes ensemble.
const PUMPKIN_FACE = rgb(178, 106, 71);
function citrouilles(): Motion {
  const steps: ReadonlyArray<readonly [number, number]> = [
    [190, 0.3],
    [90, 0.55],
    [150, -0.2],
    [70, 0.7],
    [210, 0.15],
    [110, -0.35],
    [130, 0.45],
  ];
  const frames: MotionFrame[] = steps.map(([ms, level]) => ({
    ms,
    draw: (art) =>
      recolor(art, (color) => (near(color, PUMPKIN_FACE, 2) ? (level >= 0 ? mix(color, rgb(255, 204, 92), level) : mix(color, rgb(96, 52, 38), -level)) : null)),
  }));
  return { frames: [{ ms: 260 }, ...frames], phase: 'scatter', step: 0 };
}

// La bibliothèque : de loin en loin, la dorure d'un dos de livre accroche la lumière (une étincelle chaude, à trois endroits de la face).
const bibliotheque: Motion = {
  frames: [
    { ms: 1500 },
    ...glints([[5, 9], [9, 21], [7, 15]], rgb(255, 236, 168)),
  ],
  phase: 'scatter',
  step: 0,
};

// Des étincelles l'une après l'autre (point, croix, point), avec un temps de repos entre deux.
function glints(points: ReadonlyArray<readonly [number, number]>, color: Rgba, rest = 1300): MotionFrame[] {
  return points.flatMap(([x, y], index) => [
    ...(index > 0 ? [{ ms: rest }] : []),
    ...[0, 1, 2, 1, 0].map((size) => ({ ms: 90, draw: (art: Art) => sparkle(art, x, y, size, color) })),
  ]);
}

// Les murs du pack qui bougent : la face (le haut et le bas ensemble). Les murs dessinés de la boutique ont leur mouvement dans shop-walls.ts. Sans entrée : le
// mur ne bouge pas (la brique, le béton).
export const WALL_MOTIONS: Readonly<Record<string, Motion>> = {
  'gris-perle': satin(7400, 1.3),
  creme: satin(8200, 1.5),
  'sauge-pale': satin(7800, 1.3),
  sable: satin(7000, 1.3),
  peche: satin(7600, 1.2),
  lin: satin(6600, 1.1),
  anthracite: satin(7200, 1.2),
  brun: satin(6800),
  'bois-sombre': gloss(6400, 0.6),
  'rose-raye': satin(7000, 1.1),
  rouge: satin(6600),
  bleu: satin(7000),
  violet: satin(7400),
  'bleu-ciel': satin(6800, 1.1),
  turquoise: satin(7200),
  'carreaux-bleus': gloss(5600),
  menthe: satin(7800, 1.2),
  'vert-gris': satin(7000, 1.1),
  'mur-velours': velvet,
  'mur-lambris': lambris,
  'mur-seventies': seventies,
  'mur-losanges': losanges(),
  'mur-citrouilles': citrouilles(),
  'mur-bibliotheque': bibliotheque,
};

// ---- Les sols -----------------------------------------------------------------------------------------------------------------------------------

// Le reflet d'un sol qui brille : un trait franc et un trait fin, en diagonale, qui traversent la pièce de coin en coin.
function shine(every: number, strength = 1): Motion {
  const sweep: Sweep = {
    lines: [
      { at: 0, width: 2, strength: 0.36 * strength },
      { at: 3, width: 1, strength: 0.24 * strength },
    ],
    slope: 1,
    speed: 4,
    ms: 50,
  };
  return passingSweep(16, 16, sweep, every, 'xy');
}

// Le vernis d'un parquet : un reflet plus large et plus doux, au bord tramé.
function varnish(every: number, strength = 1): Motion {
  const sweep: Sweep = {
    lines: [
      { at: 0, width: 1, strength: 0.12 * strength, dither: true },
      { at: 1, width: 2, strength: 0.22 * strength },
      { at: 3, width: 1, strength: 0.12 * strength, dither: true },
    ],
    slope: 1,
    speed: 4,
    ms: 60,
  };
  return passingSweep(16, 16, sweep, every, 'xy');
}

// Des paillettes : de petites étincelles, à des pixels tirés au hasard (figé), qui s'allument l'une après l'autre ; d'une case à l'autre, pas en même temps.
function glitter(seed: number, count: number, color: Rgba, rest: number): Motion {
  const random = seeded(seed);
  const points = Array.from({ length: count }, () => [1 + Math.floor(random() * 14), 1 + Math.floor(random() * 14)] as const);
  const frames: MotionFrame[] = points.flatMap(([x, y]) => [{ ms: rest }, ...[0, 1, 0].map((size) => ({ ms: 100, draw: (art: Art) => sparkle(art, x, y, size, color) }))]);
  return { frames, phase: 'scatter', step: 0 };
}

// L'eau sur la mosaïque turquoise : des reflets clairs qui ondulent, faits de vagues qui reviennent d'une case à l'autre et d'une image à l'autre (toutes
// les cases ensemble : le motif se raccorde).
function water(): Motion {
  const frames: MotionFrame[] = Array.from({ length: 8 }, (_, k) => ({
    ms: 190,
    draw: (art) =>
      art.each((x, y, color) => {
        const t = k / 8;
        const wave =
          Math.sin(2 * Math.PI * (x / 16 + t)) + Math.sin(2 * Math.PI * (y / 16 - t)) + Math.sin(2 * Math.PI * ((x + y) / 16 + 2 * t)) * 0.8;
        if (wave > 1.55) art.set(x, y, mix(color, rgb(236, 255, 250), wave > 2.1 ? 0.42 : 0.22));
      }),
  }));
  return { frames, phase: 'sync', step: 0 };
}

export const FLOOR_MOTIONS: Readonly<Record<string, Motion>> = {
  sable: glitter(5, 3, rgb(255, 250, 230), 1500),
  creme: shine(9200),
  blanc: shine(8400, 1.1),
  marbre: shine(8800),
  gris: shine(9600, 0.9),
  graphite: glitter(11, 4, rgb(235, 240, 255), 1100),
  'parquet-clair': varnish(9000),
  'parquet-brun': varnish(9400, 1.1),
  noyer: varnish(8600, 1.2),
  'parquet-rouge': varnish(9200, 1.1),
  chevrons: varnish(8800, 1.1),
  sauge: shine(9400, 0.8),
  menthe: shine(9000, 0.9),
  bleu: shine(8600, 0.9),
  'bleu-clair': shine(9800, 0.9),
  rose: shine(9200, 0.8),
  damier: shine(8400, 0.8),
  turquoise: water(),
  losanges: shine(8000, 0.9),
};
