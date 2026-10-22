import type { Entry } from './types';
import { named, on } from './helpers';

// La planche « Gym » (8_Gym) : de quoi équiper une salle de sport. Les tapis se posent à même le sol, les miroirs au mur ; les appareils sont
// des meubles qu'on contourne, les petits haltères et les ballons se traversent. Les cases sont celles de la planche annotée par
// scripts/assets (découpe automatique : `at` quand elle isole bien l'objet).
const gySport = on('gy', 'sport');
const gySeat = on('gy', 'sieges');

export const GYM_ENTRIES: Entry[] = [
  // ---- Tapis de sol (à même le sol)
  gySport('Tapis de yoga gris', [3, 1], { kind: 'floor' }),
  gySport('Tapis de yoga rouge', [3, 4], { kind: 'floor' }),
  gySport('Tapis de yoga bleu', [3, 7], { kind: 'floor' }),
  gySport('Tapis de yoga quadrillé gris', [0, 1], { kind: 'floor' }),
  gySport('Tapis de yoga quadrillé rouge', [0, 4], { kind: 'floor' }),
  gySport('Tapis de yoga quadrillé bleu', [0, 7], { kind: 'floor' }),
  gySport('Tapis de sol blanc', [3, 12], { kind: 'floor' }),

  // ---- Ballons et poufs
  ...named('Ballon de gym', [[7, 0], [7, 2], [7, 4], [7, 6], [7, 8], [7, 10]], gySport, { kind: 'object', claim: 1, solid: false }),
  gySeat('Pouf bleu', [7, 12]),
  gySeat('Pouf rouge', [7, 14]),
  gySeat('Pouf rose', [7, 16]),

  // ---- Haltères, kettlebells, disques
  gySport("Râtelier d'haltères, large", [0, 14], { kind: 'object', claim: 1 }),
  gySport("Râtelier d'haltères", [3, 14], { kind: 'object', claim: 1 }),
  gySport("Support à haltères (A)", [8, 25], { kind: 'object', claim: 1 }),
  gySport("Support à haltères (B)", [10, 25], { kind: 'object', claim: 1 }),
  gySport('Support de barres (A)', [2, 25], { kind: 'object', claim: 1 }),
  gySport('Support de barres (B)', [6, 25], { kind: 'object', claim: 1 }),
  ...named('Kettlebell', [[15, 0], [15, 3]], gySport, { kind: 'object', claim: 1, solid: false }),
  gySport('Disques de musculation', [8, 23], { kind: 'object', claim: 1, solid: false }),
  gySport('Piles de disques', [9, 23], { kind: 'object', claim: 1, solid: false }),
  ...named('Haltères', [[12, 28], [13, 28], [12, 29], [13, 29], [12, 30], [13, 30]], gySport, { kind: 'object', claim: 1, solid: false }),

  // ---- Bancs et appareils (des meubles qu'on contourne)
  gySport('Banc de musculation (A)', [11, 1], { kind: 'object', claim: 2 }),
  gySport('Banc de musculation (B)', [13, 1], { kind: 'object', claim: 2 }),
  gySport('Banc de musculation (C)', [4, 30], { kind: 'object', claim: 2 }),
  gySport('Banc de musculation bleu', [9, 16], { kind: 'object', claim: 2 }),
  gySport('Machine de musculation', [9, 12], { kind: 'object', claim: 2 }),
  gySport('Appareil de cardio (A)', [14, 8], { kind: 'object', claim: 2 }),
  gySport('Appareil de cardio (B)', [13, 14], { kind: 'object', claim: 2 }),
  gySport('Appareil de cardio (C)', [6, 30], { kind: 'object', claim: 2 }),
  gySport('Appareil de cardio (D)', [8, 30], { kind: 'object', claim: 2 }),
  gySport('Tapis de course', [10, 30], { kind: 'object', claim: 2 }),
  gySport('Tapis de course, vue de dessus', [11, 8], { kind: 'object', claim: 3 }),

  // ---- Miroirs (au mur)
  gySport('Miroir de salle de sport, large', [4, 21], { kind: 'wall' }),
  gySport('Miroir de salle de sport', [4, 23], { kind: 'wall' }),
  gySport('Miroir de salle de sport, étroit', [6, 23], { kind: 'wall' }),
];
