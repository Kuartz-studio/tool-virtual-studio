import type { Entry } from './types';
import { named, on } from './helpers';

// Les planches « Christmas » (15) et « Birthday party » (10) : de quoi fêter Noël ou un anniversaire au bureau. Sapins, cheminée, cadeaux,
// chaussettes et cartes au mur, casse-noisette, rennes ; ballons, guirlandes de fanions et gâteau.

// ---- Noël --------------------------------------------------------------------------------------------------------------
const xmDeco = on('xm', 'deco');
const xmPlant = on('xm', 'plantes');
const xmSeat = on('xm', 'sieges');
const xmChill = on('xm', 'detente');
const xmStuff = on('xm', 'papeterie');

const CHRISTMAS: Entry[] = [
  ...named('Sapin', [[1, 0, 2, 3], [3, 0, 2, 3], [5, 0, 2, 3], [7, 0, 2, 3]], xmPlant),
  xmChill('Cheminée blanche avec feu', [14, 3, 2, 3], { kind: 'object', claim: 2, solid: true }),
  ...named('Cadeau', [[0, 3, 1, 1], [1, 3, 1, 1], [2, 3, 1, 1], [2, 4, 1, 1]], xmDeco),
  ...named('Chaussette de Noël', [[9, 0, 1, 2], [10, 0, 1, 2], [9, 2, 1, 2], [10, 2, 1, 2]], xmDeco, { kind: 'wall' }),
  ...named('Carte de vœux encadrée', [[7, 4, 1, 2], [8, 4, 1, 2]], xmDeco, { kind: 'wall' }),
  ...named('Figurine casse-noisette', [[10, 4, 1, 2], [12, 4, 1, 2]], xmStuff, { kind: 'onTop' }),
  ...named('Grand casse-noisette', [[10, 6, 1, 3], [12, 6, 1, 3]], xmDeco),
  xmStuff('Petit sapin décoré', [14, 6, 1, 2], { kind: 'onTop' }),
  xmStuff('Boule à neige', [14, 11, 1, 1], { kind: 'onTop' }),
  ...named('Renne en peluche', [[0, 11, 2, 2], [2, 11, 2, 2]], xmDeco),
  ...named('Hotte du père Noël', [[8, 12, 2, 2], [10, 12, 2, 2]], xmDeco),
  xmSeat('Trône du père Noël (de face)', [8, 9, 3, 3], { solid: false }),
];

// ---- Anniversaire ------------------------------------------------------------------------------------------------------
const bdDeco = on('bd', 'deco');
const bdCafe = on('bd', 'cafe');

const BIRTHDAY: Entry[] = [
  bdDeco('Ballon orange', [0, 5, 1, 2]),
  bdDeco('Ballon bleu', [1, 5, 1, 2]),
  bdDeco('Ballon rouge', [2, 5, 1, 2]),
  bdDeco('Ballon vert', [3, 5, 1, 2]),
  bdDeco('Ballon blanc', [6, 0, 1, 2]),
  bdDeco('Ballon rose', [7, 0, 1, 2]),
  ...named('Grand cadeau', [[1, 0, 1, 2], [10, 2, 1, 2], [11, 2, 1, 2]], bdDeco),
  bdDeco('Guirlande de fanions (courte)', [8, 1, 2, 1], { kind: 'wall' }),
  bdDeco('Guirlande de fanions', [0, 4, 2, 1], { kind: 'wall' }),
  bdDeco('Guirlande de fanions (longue)', [2, 4, 3, 1], { kind: 'wall' }),
  bdCafe('Gâteau d\'anniversaire', [0, 2, 2, 2], { kind: 'onTop' }),
];

export const FESTIVE_ENTRIES: Entry[] = [...CHRISTMAS, ...BIRTHDAY];
