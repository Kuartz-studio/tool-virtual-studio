import type { Entry } from './types';
import { named, on } from './helpers';

// La planche « Basement » (14_Basement) : la salle de jeu et le salon. Canapés et fauteuils, tabourets, tables rondes, ping-pong, billard,
// bornes d'arcade, meuble télé. Les tables de jeu bloquent le passage sur toute leur surface (leur empreinte au sol est leur hauteur entière) ;
// les sièges ne bloquent jamais. Les cases sont celles de la planche annotée par scripts/assets.
const baSeat = on('ba', 'sieges');
const baDesk = on('ba', 'bureaux');
const baPlay = on('ba', 'detente');
const baDeco = on('ba', 'deco');

export const BASEMENT_ENTRIES: Entry[] = [
  // ---- Canapés (trois places) : la découpe en a fusionné plusieurs, d'où les rectangles
  baSeat('Canapé bleu-gris', [3, 0, 3, 2], { claim: 2 }),
  baSeat('Canapé perle', [6, 0, 3, 2], { claim: 2 }),
  baSeat('Canapé orange', [9, 0, 3, 2], { claim: 2 }),
  baSeat('Canapé lilas clair', [9, 2, 3, 2], { claim: 2 }),

  // ---- Fauteuils, de face puis de profil
  baSeat('Fauteuil bleu clair', [6, 33]),
  baSeat('Fauteuil jaune', [8, 33]),
  baSeat('Fauteuil rouge', [6, 35]),
  baSeat('Fauteuil blanc', [8, 35]),
  baSeat('Fauteuil blanc, de profil', [2, 33]),
  baSeat('Fauteuil bleu clair, de profil', [4, 33]),
  baSeat('Fauteuil jaune, de profil', [2, 35]),
  baSeat('Fauteuil rouge, de profil', [4, 35]),

  // ---- Tabourets
  baSeat('Tabouret rembourré bleu', [14, 13]),
  baSeat('Tabouret rembourré jaune', [14, 15]),
  baSeat('Tabouret rembourré rouge', [14, 17]),
  baSeat('Tabouret de bar brun', [10, 19]),
  baSeat('Tabouret de bar beige', [12, 19]),
  baSeat('Tabouret de bar doré', [14, 19]),
  baSeat('Tabouret de bar jaune', [10, 25]),
  baSeat('Tabouret de bar rouge', [11, 25]),

  // ---- Tables rondes
  baDesk('Table ronde crème', [0, 0], { claim: 2 }),
  baDesk('Table ronde orange', [0, 3], { claim: 2 }),
  baDesk('Table ronde miel', [0, 6], { claim: 2 }),

  // ---- Jeux : ping-pong, billard, bornes d'arcade
  baPlay('Table de ping-pong bleue', [0, 12], { kind: 'object', claim: 4 }),
  baPlay('Table de ping-pong verte', [3, 12], { kind: 'object', claim: 3 }),
  baPlay('Table de ping-pong turquoise', [3, 15], { kind: 'object', claim: 3 }),
  baPlay('Billard vert', [4, 25], { kind: 'object', claim: 3 }),
  baPlay('Billard bleu', [4, 28], { kind: 'object', claim: 3 }),
  baPlay('Billard turquoise', [0, 27], { kind: 'object', claim: 3 }),
  baPlay('Râtelier de queues de billard', [3, 23], { kind: 'object', claim: 1, solid: false }),
  baPlay("Borne d'arcade (A)", [4, 41], { kind: 'object', claim: 1 }),
  baPlay("Borne d'arcade (B)", [6, 41], { kind: 'object', claim: 1 }),
  baPlay("Borne d'arcade (C)", [8, 41], { kind: 'object', claim: 1 }),
  baPlay("Trois bornes d'arcade", [0, 41], { kind: 'object', claim: 2 }),

  // ---- Le salon : télé, coussins, tapis, fleurs
  baPlay('Meuble télé avec console', [6, 47], { kind: 'object', claim: 2 }),
  baPlay('Coussin jaune', [12, 0], { kind: 'onTop' }),
  baPlay('Coussin bleu', [13, 0], { kind: 'onTop' }),
  baPlay('Coussin gris', [14, 0], { kind: 'onTop' }),
  baPlay('Coussin perle', [12, 2], { kind: 'onTop' }),
  baPlay('Coussins en tas', [13, 2], { kind: 'onTop' }),
  baDeco('Grand tapis rose pâle', [0, 16], { kind: 'floor' }),
  ...named('Vase de fleurs', [[15, 2], [15, 4], [15, 6]], baDeco, { kind: 'onTop' }),
];
