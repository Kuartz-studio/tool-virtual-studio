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
