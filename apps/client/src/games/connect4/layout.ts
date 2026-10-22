import { CONNECT4_COLUMNS, CONNECT4_ROWS } from '@bureau/shared/games/connect4';
import { SPRITE_SIZE } from './sprites';

// Les mesures du plateau : la taille d'une case d'après la largeur du conteneur, l'échelle entière des jetons, le passage de la rangée de l'état à celle de l'écran, et les touches qui
// choisissent une colonne. Rien ici ne lit la fenêtre : le plateau se mesure sur ce qu'on lui donne (§ 9.5.1 du document des jeux).

// La plus petite case : une colonne est une cible, de 24 px au moins [WCAG 2.5.8].
export const MIN_CELL = 24;
// La plus grande : celle que le panneau d'un ordinateur donne (408 px de contenu pour sept colonnes). Un conteneur plus large (la feuille du bas d'une tablette) ne grossit pas la grille : elle
// reste d'une hauteur que le panneau sait porter.
export const MAX_CELL = 58;
// La largeur qu'on suppose au conteneur avant de l'avoir mesuré (et là où on ne peut pas le mesurer) : celle du panneau d'un ordinateur.
export const DEFAULT_WIDTH = 408;
// Ce qu'on laisse de plateau de chaque côté d'un jeton, dans sa case.
export const SPRITE_MARGIN = 2;
// La colonne où le focus entre au clavier la première fois : celle du milieu.
export const START_COLUMN = 3;
// La rangée du fantôme, au-dessus de la première rangée de la grille : un jeton qui tombe en part, il parcourt donc une rangée de plus que celles qui le séparent du haut.
export const LANE_ROWS = 1;

// La case que ce conteneur permet : sept colonnes tiennent dans sa largeur, entre 24 et 58 px. Une largeur qui n'en est pas une (zéro, négative, NaN) donne la plus petite.
export function cellSize(width: number): number {
  if (!(width > 0)) return MIN_CELL;
  return Math.min(MAX_CELL, Math.max(MIN_CELL, Math.floor(width / CONNECT4_COLUMNS)));
}

// Le plus gros jeton entier qui tient dans cette case avec sa marge : le pixel art se dessine à l'échelle entière (×4 dans une case de 58 px, ×3 dans une de 44), jamais à demi.
export function spriteScale(cell: number): number {
  return Math.max(1, Math.floor((cell - 2 * SPRITE_MARGIN) / SPRITE_SIZE));
}

// La seule fonction de passage entre la rangée de l'état (la rangée 0 est en bas) et celle de l'écran (la rangée 0 est en haut). Elle est sa propre réciproque.
export function screenRow(row: number): number {
  return CONNECT4_ROWS - 1 - row;
}

// La colonne où mène cette touche de navigation (flèches, Début, Fin), sans passer de l'autre côté du bord ; null pour toute autre touche, que le plateau laisse passer.
export function nextColumn(col: number, key: string): number | null {
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, col - 1);
    case 'ArrowRight':
      return Math.min(CONNECT4_COLUMNS - 1, col + 1);
    case 'Home':
      return 0;
    case 'End':
      return CONNECT4_COLUMNS - 1;
    default:
      return null;
  }
}

// La colonne que désigne une touche chiffre (1 à 7 : les colonnes 0 à 6), lue à la position de la touche (`code`) et non à ce qu'elle écrit : sur un clavier AZERTY, le 4 sans Maj écrit une
// apostrophe. Sur le pavé numérique, seul le chiffre compte (verrouillage éteint, la touche 2 est une flèche : ce n'est pas la colonne 2). Sans position (un événement fabriqué), le
// caractère. 0, 8 et 9 ne sont pas des colonnes : 0 reste au zoom.
export function digitColumn({ key, code }: { key: string; code: string }): number | null {
  const place = /^(Digit|Numpad)(\d)$/.exec(code);
  let digit: string | null = null;
  if (place) digit = place[1] === 'Numpad' && key !== place[2] ? null : place[2]!;
  else if (code === '' && /^\d$/.test(key)) digit = key;
  if (digit === null) return null;
  const col = Number(digit) - 1;
  return col >= 0 && col < CONNECT4_COLUMNS ? col : null;
}
