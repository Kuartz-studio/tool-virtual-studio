import type { GameDefinition } from '../types';
import type { LudoEvent, LudoMove, LudoState } from './model';
import { ludoMoveSchema } from './model';
import { ludoInvariants } from './invariants';
import { applyLudo, createLudo, forfeitLudo, legalLudoMoves } from './rules';

export * from './board';
export { fabricateLudo, type LudoFabrication } from './fabricate';
export { ludoInvariants } from './invariants';
export { ludoMoveSchema, type LudoEvent, type LudoLast, type LudoMove, type LudoPhase, type LudoState } from './model';
export { isInPlay, landingOf, playableHorses, rollLudoDie, type LudoLanding } from './rules';

// Les petits chevaux, variante « bureau » proche du Ludo : 4 chevaux, sortie sur un 6 (qui sort deux fois sur six sans cheval en jeu), un 6 fait rejouer, prise en tombant
// juste, arrivée au compte exact, fin au premier joueur arrivé (document des jeux § 16). Les fonctions sont des méthodes : c'est ce qui permet de ranger ce jeu dans le registre, typé GameDefinition<unknown, unknown>.
export const ludo: GameDefinition<LudoState, LudoMove, LudoEvent> = {
  id: 'ludo',
  label: 'Petits chevaux',
  minPlayers: 2,
  maxPlayers: 4,
  drawOffers: false,
  moveSchema: ludoMoveSchema,

  create(setup) {
    return createLudo(setup);
  },

  turn(state) {
    return state.result === null ? state.turn : null;
  },

  legalMoves(state, seat) {
    return legalLudoMoves(state, seat);
  },

  apply(state, seat, move, rng) {
    return applyLudo(state, seat, move, rng);
  },

  forfeit(state, seat, reason) {
    return forfeitLudo(state, seat, reason);
  },

  result(state) {
    return state.result;
  },

  countedMoves(state) {
    return state.moves;
  },

  invariants(state) {
    return ludoInvariants(state);
  },
};
