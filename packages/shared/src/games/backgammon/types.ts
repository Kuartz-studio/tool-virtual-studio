import { z } from 'zod';
import type { ForfeitReason, GameResult } from '../types';
import { DIE_SIDES, DOUBLET_STEPS, POINT_COUNT } from './constants';

// Un point du plateau, de 1 à 24, dans la numérotation de celui dont on parle : chacun compte depuis sa maison (son point 1 est sa sortie, son point 24 est le
// point 1 de l'adversaire). Tous les coups et tous les événements parlent dans la numérotation de qui joue.
export type BgPoint = number;

// Un déplacement d'un pion avec un dé : depuis la barre ou un point, vers un point ou vers la sortie.
export interface BgStep {
  from: BgPoint | 'bar';
  to: BgPoint | 'off';
  die: number;
}

// Le plateau seul : ce qu'il faut pour compter la course, dessiner les pions ou montrer des étapes en aperçu.
export interface BgPosition {
  // 24 cases ; l'index i est le point i + 1 du siège 0 (Blancs). Positif : pions du siège 0 ; négatif : pions du siège 1 (Rouges).
  points: number[];
  // Les pions sur la barre, par siège.
  bar: [number, number];
  // Les pions sortis, par siège.
  off: [number, number];
}

export type BackgammonMove = { type: 'roll' } | { type: 'play'; steps: BgStep[] };

export type BackgammonEndKind = 'simple' | 'gammon' | 'backgammon';

export interface BackgammonState extends BgPosition {
  // Le siège qui a le trait (sans importance une fois la partie finie).
  turn: 0 | 1;
  phase: 'roll' | 'move' | 'over';
  // [] en phase `roll` ; [a, b] sinon (un doublé reste [d, d] et se joue quatre fois). Une partie finie garde les dés de son dernier tour.
  dice: number[];
  // Les lancers d'ouverture, égalités comprises : [dé du siège 0, dé du siège 1]. Le dernier est celui qui a décidé du premier tour.
  opening: Array<[number, number]>;
  // Les tours joués : les coups comptés (un `play` accepté ; ni un lancer, ni un tour passé).
  turns: number;
  // Le dernier tour : ses dés et ses étapes (aucune quand le tour a été passé), pour l'afficher.
  last: { seat: 0 | 1; dice: number[]; steps: BgStep[] } | null;
  result: GameResult | null;
}

// Ce qu'une action a provoqué, pour que le client l'anime : `opening` (le lancer d'ouverture, égalités comprises), `dice` (un lancer), `step` (un pion déplacé, avec
// `hit` s'il en a frappé un), `pass` (rien à jouer : le tour est perdu), `end` (les quinze pions sortis, avec le gammon ou le backgammon) et `forfeit` (un abandon, une
// inactivité ou un départ : défaite simple, sans événement `end`).
export type BackgammonEvent =
  | { type: 'opening'; rolls: Array<[number, number]>; first: 0 | 1 }
  | { type: 'dice'; seat: 0 | 1; values: [number, number] }
  | { type: 'step'; seat: 0 | 1; from: BgPoint | 'bar'; to: BgPoint | 'off'; die: number; hit: boolean }
  | { type: 'pass'; seat: 0 | 1 }
  | { type: 'end'; winner: 0 | 1; kind: BackgammonEndKind }
  | { type: 'forfeit'; seat: 0 | 1; reason: ForfeitReason };

// La forme d'un coup, pas sa légalité : un `play` a de une à quatre étapes (quatre pour un doublé).
const point = z.number().int().min(1).max(POINT_COUNT);
export const backgammonMoveSchema: z.ZodType<BackgammonMove> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('roll') }),
  z.object({
    type: z.literal('play'),
    steps: z
      .array(
        z.object({
          from: z.union([point, z.literal('bar')]),
          to: z.union([point, z.literal('off')]),
          die: z.number().int().min(1).max(DIE_SIDES),
        }),
      )
      .min(1)
      .max(DOUBLET_STEPS),
  }),
]);
