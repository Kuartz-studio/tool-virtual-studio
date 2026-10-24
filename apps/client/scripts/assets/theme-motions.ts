// Les murs de la boutique qui viennent du pack, et comment ils bougent (les effets : tile-motion.ts) : le velours ondule, un reflet court sur la cimaise du
// lambris, les rayures seventies s'allument l'une après l'autre, les losanges scintillent, les bougies des citrouilles vacillent, les dorures de la
// bibliothèque brillent. Les six murs dessinés ont leur mouvement avec leur dessin (shop-walls.ts). Les murs libres et les sols, ceux que tout le monde a,
// ne bougent pas : l'animation est ce qu'on s'offre à la boutique.
// Une face de mur se compte en pixels du dessin, son haut et son bas l'un sous l'autre : 16 × 32, le liseré (rangées 0 à 5), la surface (6 à 25), la plinthe
// (26 à 30), le trait du bas (31).
import type { Rgba } from './image';
import { mix, rgb, type Art } from './pixel-art';
import { near, passingSweep, recolor, sparkle, type Motion, type MotionFrame } from './tile-motion';

const onPaper = (y: number) => y >= 6 && y <= 25;
const onBaseboard = (y: number) => y >= 26 && y <= 30;

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

// Les murs de la boutique venus du pack, par identifiant : leur face (le haut et le bas ensemble).
export const WALL_MOTIONS: Readonly<Record<string, Motion>> = {
  'mur-velours': velvet,
  'mur-lambris': lambris,
  'mur-seventies': seventies,
  'mur-losanges': losanges(),
  'mur-citrouilles': citrouilles(),
  'mur-bibliotheque': bibliotheque,
};
