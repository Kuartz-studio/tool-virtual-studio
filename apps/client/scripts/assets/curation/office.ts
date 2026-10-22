import type { DecorCategoryId } from '@bureau/shared';
import type { Entry, EntryOptions } from './types';

// La planche Modern Office (512 × 1696 px, 16 colonnes de cases de 32 px), découpée à la main : les « singles » du pack ne sont que des
// morceaux de meubles modulaires, alors qu'ici chaque entrée est un objet entier. Les rectangles sont en cases (x, y, largeur, hauteur).
const of =
  (cat: DecorCategoryId) =>
  (name: string, rect: NonNullable<Entry['rect']>, options: EntryOptions = {}): Entry => ({ sheet: 'of', cat, name, rect, ...options });

const desk = of('bureaux');
const seat = of('sieges');
const screen = of('ecrans');
const shelf = of('rangement');
const stuff = of('papeterie');
const plant = of('plantes');
const deco = of('deco');
const cafe = of('cafe');

// Les bois des bureaux, dans l'ordre des planches : tressé, clair, rayé, lilas (laqué), anthracite.
const WOODS = ['tressé', 'clair', 'rayé', 'lilas', 'anthracite'] as const;
type Wood = (typeof WOODS)[number];

// Un bureau d'angle : trois modules par couleur (un long, un en L, un étroit), deux familles (tournées dans un sens, puis dans l'autre).
function cornerDesks(wood: Wood, origin: readonly [number, number], second: readonly [number, number]): Entry[] {
  const [x, y] = origin;
  const [sx, sy] = second;
  return [
    desk(`Bureau long ${wood} (A)`, [x, y, 2, 2]),
    desk(`Bureau en L ${wood} (A)`, [x + 1, y + 1, 2, 2]),
    desk(`Bureau étroit ${wood} (A)`, [x + 3, y, 1, 3]),
    desk(`Bureau long ${wood} (B)`, [sx + 2, sy, 2, 2]),
    desk(`Bureau en L ${wood} (B)`, [sx + 1, sy + 1, 2, 2]),
    desk(`Bureau étroit ${wood} (B)`, [sx, sy, 1, 3]),
  ];
}

export const OFFICE_ENTRIES: Entry[] = [
  // ---- Bureaux & tables --------------------------------------------------------------------------------------------------
  desk('Grande table tressée', [1, 0, 3, 3]),
  desk('Grande table bois clair', [6, 0, 3, 3]),
  desk('Grande table anthracite', [11, 0, 3, 3]),
  desk('Grande table rayée', [1, 4, 3, 3]),
  desk('Grande table lilas', [6, 4, 3, 3]),
  desk('Plan étroit tressé (A)', [0, 0, 1, 4]),
  desk('Plan étroit tressé (B)', [4, 0, 1, 4]),
  desk('Plan étroit bois clair (A)', [5, 0, 1, 4]),
  desk('Plan étroit bois clair (B)', [9, 0, 1, 4]),
  desk('Plan étroit anthracite (A)', [10, 0, 1, 4]),
  desk('Plan étroit anthracite (B)', [14, 0, 1, 4]),
  desk('Plan étroit rayé (A)', [0, 4, 1, 4]),
  desk('Plan étroit rayé (B)', [4, 4, 1, 4]),
  desk('Plan étroit lilas (A)', [5, 4, 1, 4]),
  desk('Plan étroit lilas (B)', [9, 4, 1, 4]),
  desk('Bureau bois clair', [7, 28, 3, 2]),
  desk('Bureau anthracite', [10, 28, 3, 2]),
  desk('Bureau lilas', [1, 30, 3, 2]),
  desk('Bureau tressé', [4, 30, 3, 2]),
  desk('Bureau rayé', [7, 30, 3, 2]),
  ...cornerDesks('clair', [0, 34], [4, 43]),
  ...cornerDesks('tressé', [4, 34], [0, 43]),
  ...cornerDesks('rayé', [0, 37], [4, 46]),
  ...cornerDesks('lilas', [4, 37], [0, 46]),
  ...cornerDesks('anthracite', [0, 40], [0, 49]),
  desk('Petite table beige', [5, 18, 1, 2]),
  desk('Table basse beige', [6, 18, 2, 2]),
  desk('Petite table jaune', [5, 20, 1, 2]),
  desk('Table basse jaune', [6, 20, 2, 2]),
  desk('Petite table orange', [5, 22, 1, 2]),
  desk('Table basse orange', [6, 22, 2, 2]),
  desk('Table tressée', [12, 19, 2, 3]),
  desk('Table ambre', [14, 19, 2, 3]),
  desk('Grande table jaune', [12, 22, 2, 3]),
  desk('Table jaune', [14, 22, 2, 2]),

  // ---- Sièges & canapés --------------------------------------------------------------------------------------------------
  // L'orientation est dans le nom : « de face » (le siège nous regarde, on voit son avant), « de dos » (il tourne le dos à l'écran), « vers la gauche »
  // ou « vers la droite » (de profil, vers ce côté de l'image). Une chaise se pose côté nord d'une table « de face », côté sud « de dos ».
  // Les fauteuils de bureau à roulettes, quatre vues par couleur : deux de dos (le dossier, avec ou sans résille), deux de face (les accoudoirs).
  seat('Fauteuil gris maillé (de dos)', [0, 8, 1, 2], { claim: 1, solid: false }),
  seat('Fauteuil gris uni (de dos)', [1, 8, 1, 2], { claim: 1, solid: false }),
  seat('Fauteuil gris uni (de face)', [2, 8, 1, 2], { claim: 1, solid: false }),
  seat('Fauteuil gris maillé (de face)', [3, 8, 1, 2], { claim: 1, solid: false }),
  seat('Chaise grise (vers la gauche)', [4, 8, 1, 2], { solid: false }),
  seat('Chaise grise (vers la droite)', [5, 8, 1, 2], { solid: false }),
  seat('Fauteuil orange maillé (de dos)', [0, 10, 1, 2], { solid: false }),
  seat('Fauteuil orange uni (de dos)', [1, 10, 1, 2], { solid: false }),
  seat('Fauteuil orange uni (de face)', [2, 10, 1, 2], { solid: false }),
  seat('Fauteuil orange maillé (de face)', [3, 10, 1, 2], { solid: false }),
  seat('Chaise orange (vers la gauche)', [4, 10, 1, 2], { solid: false }),
  seat('Chaise orange (vers la droite)', [5, 10, 1, 2], { solid: false }),
  seat('Chaise de bureau grise (vers la droite)', [8, 34, 1, 2], { solid: false }),
  seat('Chaise de bureau orange (vers la droite)', [9, 34, 1, 2], { solid: false }),
  seat('Chaise de bureau grise (vers la gauche)', [12, 43, 1, 2], { solid: false }),
  seat('Chaise de bureau orange (vers la gauche)', [13, 43, 1, 2], { solid: false }),
  seat('Fauteuil coque bleu (de face)', [3, 15, 1, 2], { solid: false }),
  seat('Fauteuil coque gris (de face)', [4, 15, 1, 2], { solid: false }),
  seat('Fauteuil coque lilas (de face)', [5, 15, 1, 2], { solid: false }),
  seat('Fauteuil coque ocre (de face)', [6, 15, 1, 2], { solid: false }),
  seat('Canapé deux places (de face)', [0, 17, 2, 2], { claim: 2 }),
  seat('Canapé deux places (de dos)', [0, 19, 2, 2], { claim: 2 }),
  seat('Fauteuil de salon (de face)', [0, 21, 1, 2], { claim: 2 }),
  seat("Canapé d'angle (gauche, de face)", [2, 17, 3, 3], { claim: 3 }),
  seat("Canapé d'angle (droite, de face)", [2, 20, 3, 3], { claim: 3 }),

  // ---- Écrans & informatique ---------------------------------------------------------------------------------------------
  screen('Écran bleu (droit)', [13, 12, 1, 1]),
  screen('Écran bleu (face)', [14, 12, 1, 1]),
  screen('Écran bleu (gauche)', [15, 12, 1, 1]),
  screen('Écran bleu large (droit)', [13, 13, 1, 1]),
  screen('Écran bleu large (face)', [14, 13, 1, 1]),
  screen('Écran bleu large (gauche)', [15, 13, 1, 1]),
  screen('Écran noir (profil)', [14, 8, 1, 2]),
  screen('Écran noir (trois quarts)', [15, 8, 1, 2]),
  screen('Écran blanc (profil)', [14, 10, 1, 2]),
  screen('Écran blanc (trois quarts)', [15, 10, 1, 2]),
  screen('Double écran sur bras noir', [10, 35, 1, 3]),
  screen('Double écran sur bras blanc', [11, 35, 1, 3]),
  screen('Double écran noir', [10, 44, 1, 3]),
  screen('Double écran blanc', [11, 44, 1, 3]),
  screen('Écran sur pied (A)', [12, 35, 1, 1]),
  screen('Écran sur pied (B)', [12, 36, 1, 1]),
  screen('Moniteur compact (A)', [8, 44, 1, 1]),
  screen('Moniteur compact (B)', [9, 44, 1, 1]),
  screen('Ordinateur portable ouvert (droit)', [13, 15, 1, 2]),
  screen('Ordinateur portable (face)', [14, 15, 1, 2]),
  screen('Ordinateur portable ouvert (gauche)', [15, 15, 1, 2]),
  screen('Ordinateur portable fermé (droit)', [13, 17, 1, 2]),
  screen('Ordinateur portable fermé (face)', [14, 17, 1, 2]),
  screen('Ordinateur portable fermé (gauche)', [15, 17, 1, 2]),
  screen('Clavier et souris', [12, 8, 2, 1]),
  screen('Clavier et souris blancs', [12, 10, 2, 1]),
  screen('Clavier fin', [14, 14, 1, 1]),
  screen('Boîtier noir', [10, 7, 1, 2]),
  screen('Boîtier blanc', [11, 7, 1, 2]),
  screen('Tour grise', [13, 36, 1, 2]),
  screen('Tour blanche', [8, 45, 1, 2]),
  screen('Tour sombre', [9, 45, 1, 2]),
  screen('Lecteur blanc', [11, 11, 2, 1]),
  screen('Lecteur gris', [11, 12, 2, 1]),
  screen('Téléphone gris', [10, 9, 1, 1]),
  screen('Téléphone blanc', [11, 9, 1, 1]),
  screen('Téléphone de bureau', [7, 26, 1, 2]),
  screen('Poste complet (roux)', [10, 30, 3, 2]),
  screen('Poste complet (blond)', [10, 32, 3, 2]),
  screen('Poste portable avec lampe', [8, 26, 2, 2]),
  screen('Poste portable avec lampe (2)', [14, 26, 2, 2]),
  screen('Écrans doubles et boîtier', [10, 26, 1, 2]),
  screen('Écran large et clavier', [11, 26, 2, 2]),
  screen('Écran et tour', [13, 28, 1, 2]),
  screen('Écran, clavier et photo', [14, 28, 2, 2]),
  screen('Imprimante multifonction', [0, 14, 1, 3], { kind: 'object', solid: true }),
  screen('Imprimante grise', [8, 22, 1, 2], { kind: 'object', solid: true }),
  screen('Imprimante grise (2)', [9, 22, 1, 2], { kind: 'object', solid: true }),
  screen('Imprimante grise (3)', [10, 22, 1, 2], { kind: 'object', solid: true }),
  screen('Imprimante blanche', [8, 24, 1, 2], { kind: 'object', solid: true }),
  screen('Imprimante blanche (2)', [9, 24, 1, 2], { kind: 'object', solid: true }),
  screen('Imprimante blanche (3)', [10, 24, 1, 2], { kind: 'object', solid: true }),
  screen('Imprimante sur meuble', [8, 18, 2, 2], { kind: 'object', solid: true }),
  screen('Imprimante sur meuble (2)', [8, 20, 2, 2], { kind: 'object', solid: true }),
  screen('Imprimante sur meuble rouge', [14, 38, 2, 2], { kind: 'object', solid: true }),
  screen('Imprimante sur meuble rouge (2)', [14, 40, 2, 2], { kind: 'object', solid: true }),
  screen('Imprimante sur meuble blanc', [8, 41, 2, 2], { kind: 'object', solid: true }),
  screen('Imprimante sur meuble blanc (2)', [10, 41, 2, 2], { kind: 'object', solid: true }),
  screen('Imprimante sur meuble blanc (3)', [12, 41, 2, 2], { kind: 'object', solid: true }),
  screen('Imprimante sur meuble blanc (4)', [14, 42, 2, 2], { kind: 'object', solid: true }),
  screen('Scanner (A)', [13, 30, 1, 1]),
  screen('Scanner (B)', [13, 31, 1, 1]),
  screen('Scanner (C)', [13, 32, 1, 1]),

  // ---- Rangement ---------------------------------------------------------------------------------------------------------
  shelf('Étagère garnie', [7, 12, 2, 3], { claim: 1 }),
  shelf('Étagère blanche', [7, 15, 2, 3], { claim: 1 }),

  // ---- Objets de bureau --------------------------------------------------------------------------------------------------
  stuff('Piles de papiers', [1, 14, 2, 3]),
  stuff('Boîtier gris (A)', [14, 30, 1, 1]),
  stuff('Boîtier gris (B)', [14, 31, 1, 1]),
  stuff('Boîtier gris (C)', [14, 32, 1, 1]),
  stuff('Lampe articulée (A)', [11, 15, 1, 2]),
  stuff('Lampe articulée (B)', [10, 16, 1, 2]),
  stuff('Lampe articulée (C)', [11, 17, 1, 2]),
  stuff('Lampe articulée (D)', [11, 19, 1, 2]),
  stuff('Lampe articulée (E)', [11, 21, 1, 2]),
  stuff('Lampe articulée (F)', [11, 23, 1, 2]),
  stuff('Micro de bureau', [9, 36, 1, 1]),
  stuff('Boîtier de contrôle', [9, 37, 1, 1]),
  stuff('Cadre photo penché (A)', [3, 12, 1, 1]),
  stuff('Cadre photo penché (B)', [3, 13, 1, 1]),
  stuff('Cadre photo penché (C)', [4, 12, 1, 1]),
  stuff('Cadre photo penché (D)', [4, 13, 1, 1]),
  stuff('Cadre photo (A)', [5, 12, 1, 1]),
  stuff('Cadre photo (B)', [5, 13, 1, 1]),
  stuff('Sac à dos bleu', [8, 47, 1, 2], { kind: 'object', solid: false }),
  stuff('Sac à dos bleu (2)', [9, 47, 1, 2], { kind: 'object', solid: false }),
  stuff('Sac à dos orange', [10, 47, 1, 2], { kind: 'object', solid: false }),
  stuff('Sac à dos orange (2)', [11, 47, 1, 2], { kind: 'object', solid: false }),
  stuff('Sac à dos gris', [8, 49, 1, 2], { kind: 'object', solid: false }),
  stuff('Sac à dos gris (2)', [9, 49, 1, 2], { kind: 'object', solid: false }),
  stuff('Sac à dos kaki', [10, 49, 1, 2], { kind: 'object', solid: false }),
  stuff('Sac à dos kaki (2)', [11, 49, 1, 2], { kind: 'object', solid: false }),
  stuff('Liasse de billets', [12, 47, 1, 2]),
  stuff('Tas de billets', [13, 47, 1, 2]),
  stuff('Gros tas de billets', [12, 49, 2, 2], { kind: 'object', solid: false }),

  // ---- Plantes -----------------------------------------------------------------------------------------------------------
  plant('Grande plante verte', [6, 7, 1, 3]),
  plant('Plante en pot', [6, 10, 1, 2]),
  plant('Plante élancée', [6, 12, 1, 3]),

  // ---- Déco & murs -------------------------------------------------------------------------------------------------------
  deco('Tableau blanc à notes', [15, 0, 1, 2], { kind: 'wall' }),
  deco('Tableau en liège', [15, 2, 1, 2], { kind: 'wall' }),
  deco('Diplôme (A)', [7, 8, 1, 2], { kind: 'wall' }),
  deco('Diplôme (B)', [7, 10, 1, 2], { kind: 'wall' }),
  deco('Diplôme (C)', [8, 10, 1, 2], { kind: 'wall' }),
  deco('Plaque honorifique', [8, 8, 2, 2], { kind: 'wall' }),
  deco('Écran mural', [9, 10, 2, 2], { kind: 'wall' }),
  deco('Tableau blanc à graphiques', [9, 12, 2, 2], { kind: 'wall' }),
  deco('Écran de présentation', [9, 14, 2, 2], { kind: 'wall' }),
  deco('Affiche des équipes', [0, 12, 2, 2], { kind: 'wall' }),
  deco('Petit tableau', [2, 12, 1, 2], { kind: 'wall' }),
  deco('Paillasson olive', [10, 4, 1, 2], { kind: 'floor' }),
  deco('Paillasson bordeaux', [11, 4, 1, 2], { kind: 'floor' }),
  deco('Paillasson gris', [12, 4, 1, 2], { kind: 'floor' }),
  deco('Cloison vitrée (A)', [1, 26, 3, 3], { kind: 'object', claim: 1, solid: true }),
  deco('Cloison vitrée (B)', [4, 26, 3, 3], { kind: 'object', claim: 1, solid: true }),

  // ---- Pause & café ------------------------------------------------------------------------------------------------------
  cafe('Distributeur de boissons', [0, 23, 2, 3], { claim: 1 }),
  cafe('Distributeur de snacks', [2, 23, 2, 3], { claim: 1 }),
  cafe('Petit distributeur', [4, 24, 2, 2], { claim: 1 }),
  cafe("Fontaine à eau", [12, 15, 1, 3], { claim: 1 }),
  cafe('Comptoir café (A)', [8, 38, 2, 3], { kind: 'object', claim: 2, solid: true }),
  cafe('Comptoir café (B)', [10, 38, 2, 3], { kind: 'object', claim: 2, solid: true }),
  cafe('Comptoir café (C)', [12, 38, 2, 3], { kind: 'object', claim: 2, solid: true }),
  cafe('Machine à café', [14, 33, 2, 2], { kind: 'onTop' }),
  cafe('Cafetière', [13, 34, 1, 2], { kind: 'onTop' }),
  cafe('Tasse de café (A)', [14, 35, 1, 1], { kind: 'onTop' }),
  cafe('Tasse de café (B)', [15, 35, 1, 1], { kind: 'onTop' }),
];
