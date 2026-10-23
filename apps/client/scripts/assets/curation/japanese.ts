import type { Entry } from './types';
import { named, on } from './helpers';

// La planche « Japanese interiors » (20) : de quoi faire un coin zen. Des tatamis et des nattes (à même le sol), des rouleaux suspendus (au mur), un
// bonsaï et une table basse.
const jpDeco = on('jp', 'deco');
const jpPlant = on('jp', 'plantes');
const jpDesk = on('jp', 'bureaux');

export const JAPANESE_ENTRIES: Entry[] = [
  jpDeco('Tatami bordé de rouge', [5, 0, 2, 2], { kind: 'floor' }),
  jpDeco('Tatami de jonc', [8, 0, 2, 2], { kind: 'floor' }),
  jpDeco('Tatami bordé de vert', [11, 0, 2, 2], { kind: 'floor' }),
  jpDeco('Natte bordée de rouge', [5, 2, 2, 1], { kind: 'floor' }),
  jpDeco('Natte de jonc', [8, 2, 2, 1], { kind: 'floor' }),
  jpDeco('Natte bordée de vert', [11, 2, 2, 1], { kind: 'floor' }),
  ...named('Rouleau calligraphié', [[14, 0, 1, 2], [15, 0, 1, 2]], jpDeco, { kind: 'wall' }),
  ...named('Rouleau aux fleurs de cerisier', [[8, 16, 1, 2], [8, 18, 1, 2]], jpDeco, { kind: 'wall' }),
  jpPlant('Bonsaï', [7, 8, 1, 3]),
  // Le plateau n'a qu'une case de profondeur : le dessin descend sur sa rangée (fitOnFootprint), et ses deux cases arrêtent l'avatar.
  jpDesk('Table basse japonaise', [5, 3, 2, 2], { claim: 1 }),
];
