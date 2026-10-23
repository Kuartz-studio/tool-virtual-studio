import type { Entry } from './types';
import { named, on } from './helpers';

// La planche « Art » (7_Art) : un coin d'atelier. Des chevalets avec leur toile, des toiles encadrées pour le mur, des vases de céramique, des pots de
// peinture, des tabourets et la palette du peintre.
const arDeco = on('ar', 'deco');
const arSeat = on('ar', 'sieges');
const arStuff = on('ar', 'papeterie');

export const ART_ENTRIES: Entry[] = [
  // Les sept chevalets se touchent sur la planche (leurs ombres) : un rectangle chacun, d'une case de large.
  arDeco('Chevalet (toile vierge)', [9, 2, 1, 2]),
  arDeco('Chevalet (monstre violet)', [10, 2, 1, 2]),
  arDeco('Chevalet (monstre noir)', [11, 2, 1, 2]),
  arDeco('Chevalet (toile abstraite)', [12, 2, 1, 2]),
  arDeco('Chevalet (bouquet)', [13, 2, 1, 2]),
  arDeco('Chevalet (flammes)', [14, 2, 1, 2]),
  arDeco('Chevalet (paysage)', [15, 2, 1, 2]),
  ...named('Toile encadrée', [[12, 4, 1, 2], [14, 4, 1, 2], [15, 4, 1, 2]], arDeco, { kind: 'wall' }),
  ...named('Vase de céramique', [[0, 2, 1, 2], [1, 2, 1, 2], [2, 2, 1, 2], [3, 2, 1, 2], [4, 2, 1, 2], [5, 2, 1, 2]], arDeco),
  ...named('Pot de peinture', [[6, 0, 1, 2], [7, 0, 1, 2], [8, 0, 1, 2]], arDeco),
  ...named('Tabouret d\'atelier', [[6, 4, 1, 2], [7, 4, 1, 2], [8, 4, 1, 2]], arSeat, { solid: false }),
  arStuff('Palette de peintre', [8, 6, 1, 1]),
];
