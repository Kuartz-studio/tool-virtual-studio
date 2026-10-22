import type { GameDefinition } from '../types';
import { applyMove, createGame, forfeitSeat, invariantsOf, legalMovesOf, turnOf } from './engine';
import { backgammonMoveSchema, type BackgammonEvent, type BackgammonMove, type BackgammonState } from './types';

// Le backgammon standard, sans videau (§ 14 du document des jeux). Les règles vivent dans `engine.ts` (créer, lancer, jouer, abandonner, vérifier un état) et dans
// `search.ts` (les coups d'un tour : le maximum de dés à jouer). Ce fichier assemble le contrat et expose ce dont l'interface a besoin : les types, les aides
// (`nextSteps`, `previewSteps`, `pipCount`, la conversion des numérotations) et de quoi fabriquer une position.
export * from './types';
export * from './constants';
export { checkersAt, mirrorPoint, pipCount, pointIndex, pointNumber, startingPoints } from './board';
export { backgammonStateFrom, type BackgammonLayout } from './layout';
export { diceToPlay, maxPlayableSteps, nextSteps, previewSteps } from './search';

export const backgammon: GameDefinition<BackgammonState, BackgammonMove, BackgammonEvent> = {
  id: 'backgammon',
  label: 'Backgammon',
  minPlayers: 2,
  maxPlayers: 2,
  // Pas de nulle au backgammon : on ne s'arrête qu'en sortant tous ses pions, ou en abandonnant.
  drawOffers: false,
  moveSchema: backgammonMoveSchema,

  create(setup, rng) {
    return createGame(setup, rng);
  },

  turn(state) {
    return turnOf(state);
  },

  legalMoves(state, seat) {
    return legalMovesOf(state, seat);
  },

  apply(state, seat, move, rng) {
    return applyMove(state, seat, move, rng);
  },

  forfeit(state, seat, reason) {
    return forfeitSeat(state, seat, reason);
  },

  result(state) {
    return state.result;
  },

  // Les tours joués : un lancer n'est pas un coup, un tour passé non plus.
  countedMoves(state) {
    return state.turns;
  },

  invariants(state) {
    return invariantsOf(state);
  },
};
