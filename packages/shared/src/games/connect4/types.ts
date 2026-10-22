import { z } from 'zod';
import type { ForfeitReason, GameResult } from '../types';
import { CONNECT4_COLUMNS } from './board';

// Les deux joueurs : le siège 0 joue les jetons rouges, le siège 1 les jaunes (la couleur est un choix d'affichage, les règles ne connaissent que des sièges).
export type Connect4Seat = 0 | 1;

export interface Connect4State {
  // Les 42 cases, index = colonne × 6 + rangée (la rangée 0 est en bas) ; 0 : vide, 1 : un jeton du siège 0, 2 : un jeton du siège 1.
  cells: number[];
  // Le siège qui a joué le premier jeton. Le trait se déduit de lui et de `moves` : le stocker à part le laisserait diverger.
  first: Connect4Seat;
  // Les colonnes jouées, dans l'ordre : de quoi rejouer la partie, et retrouver le dernier jeton.
  moves: number[];
  // Les cases (index, triés) de toutes les lignes de quatre jetons ou plus que le dernier jeton a faites ; vide tant que personne n'a gagné.
  winLine: number[];
  // Le résultat, tant qu'il y en a un : il vit ici, à un seul endroit.
  result: GameResult | null;
}

export interface Connect4Move {
  col: number;
}

// Ce qu'un coup a provoqué. `drop` à chaque jeton (la chute à animer, le son) ; `end` quand ce jeton finit la partie, par un alignement (`winner`, `cells` : la
// ligne gagnante) ou par la grille pleine (`winner` nul, `cells` vide). Un abandon, un délai ou un départ ne donne que `forfeit` : la plateforme écrit sa raison.
export type Connect4Event =
  | { type: 'drop'; seat: Connect4Seat; col: number; row: number }
  | { type: 'end'; winner: Connect4Seat | null; cells: number[] }
  | { type: 'forfeit'; seat: Connect4Seat; reason: ForfeitReason };

// La forme d'un coup : une colonne, de 0 à 6. Sa légalité (colonne pleine, bon siège) se juge dans `apply`.
export const connect4MoveSchema = z.object({ col: z.number().int().min(0).max(CONNECT4_COLUMNS - 1) });
