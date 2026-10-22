import type { Entry } from './types';
import { on } from './helpers';

// La planche « Museum » (22_Museum) : les panneaux de sortie. Un homme qui court vers une flèche, vert vif ou citron ; la planche les dessine avec la
// flèche à droite, et leur image retournée l'a à gauche (on pose le panneau du côté où est la sortie). Ils sont faits pour le mur : un seul carreau, que la
// carte pose en haut de la bande de mur, et que la nuit éclaire en vert (voir LIGHT_EMITTERS dans le client).
const muDeco = on('mu', 'deco');

export const MUSEUM_ENTRIES: Entry[] = [
  muDeco('Panneau de sortie vert (vers la droite)', [14, 111, 1, 1], { kind: 'wall' }),
  muDeco('Panneau de sortie vert (vers la gauche)', [14, 111, 1, 1], { kind: 'wall', flip: true }),
  muDeco('Panneau de sortie citron (vers la droite)', [15, 111, 1, 1], { kind: 'wall' }),
  muDeco('Panneau de sortie citron (vers la gauche)', [15, 111, 1, 1], { kind: 'wall', flip: true }),
];
