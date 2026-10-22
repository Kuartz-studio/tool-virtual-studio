import { BOARD_CELLS } from './geometry';

// La taille du plateau (§ 9.5.1 du document des jeux) : il occupe toute la largeur qu'on lui donne, en cases entières (le pixel art reste net), et il se mesure sur son conteneur,
// jamais sur la fenêtre.

// La largeur d'un panneau de jeu quand on ne peut pas mesurer (avant la première mesure, un navigateur sans ResizeObserver) : 408 px de contenu, comme `.office-side[data-panel='game']`.
export const DEFAULT_WIDTH = 408;
// Le côté d'une case, en pixels : au plus 30 (un plateau de 450 px suffit, même dans une feuille large), au moins 12 (en dessous, rien ne se lit).
export const CELL_MIN = 12;
export const CELL_MAX = 30;
// Ce qui se clique fait 24 × 24 px au moins [WCAG 2.5.8] : la zone cliquable d'un cheval jouable, en pixels.
export const HIT_MIN_PX = 24;

// Le côté d'une case pour un conteneur de cette largeur : quinze cases entières qui n'en dépassent jamais, de 12 à 30 px (à 408 px : 27 ; à 311 px, sur téléphone : 20).
export function cellSizeFor(width: number): number {
  return Math.min(CELL_MAX, Math.max(CELL_MIN, Math.floor(width / BOARD_CELLS)));
}

// Le côté de la zone cliquable d'un cheval, en cases : une case, ou plus si 24 px en font davantage (cases de 20 px sur téléphone).
export function hitSizeFor(cell: number): number {
  return Math.max(1, HIT_MIN_PX / cell);
}

// La tête de cheval est dessinée en 12 × 12 pixels. Dès que la case fait 26 px, elle fait 24 px à l'écran : deux pixels d'écran par pixel du dessin, des bords parfaitement nets. En
// dessous (un téléphone, 20 px la case), elle fait 80 % de la case (16 px) : le dessin est un peu inégal, mais lisible.
export const HORSE_DOUBLE_FROM = 26;
export const HORSE_DOUBLE_PX = 24;
export const HORSE_RATIO = 0.8;

// Le côté d'une tête de cheval, en pixels entiers.
export function horseSizeFor(cell: number): number {
  return cell >= HORSE_DOUBLE_FROM ? HORSE_DOUBLE_PX : Math.round(cell * HORSE_RATIO);
}
