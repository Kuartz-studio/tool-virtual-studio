import type { AnyGameDefinition } from '../types';
import { makeTicTacToe, type TicTacToeState } from './tictactoe';

// Des copies fausses exprès du morpion : chacune casse une règle du contrat (§ 2.2 du document des jeux), et le harnais de conformité (conformance.ts) doit
// attraper chacune. Elles prouvent que le harnais voit ce qu'il dit voir ; elles ne servent qu'à lui.

const base = makeTicTacToe('connect4');
type State = TicTacToeState;
const asAny = (def: unknown): AnyGameDefinition => def as AnyGameDefinition;

export const brokenGames = {
  // R1 : `apply` modifie l'état qu'on lui donne.
  mutatesState: asAny({
    ...base,
    apply(state: State, seat: number, move: { cell: number }, rng: () => number) {
      state.cells[move.cell] = seat as 0 | 1;
      return base.apply(state, seat, move, rng);
    },
  }),

  // R1 encore : `apply` ne modifie l'état qu'à partir du deuxième coup (le premier état, gelé dès `create`, ne suffit pas à le trahir).
  mutatesLaterStates: asAny({
    ...base,
    apply(state: State, seat: number, move: { cell: number }, rng: () => number) {
      if (state.moves > 0) state.cells[move.cell] = seat as 0 | 1;
      return base.apply(state, seat, move, rng);
    },
  }),

  // R2 : une clé à `undefined` dans l'état : le JSON la perd.
  undefinedInState: asAny({
    ...base,
    create(setup: { seats: number; first: number }, rng: () => number) {
      const made = base.create(setup, rng);
      return { ...made, state: { ...made.state, note: undefined } };
    },
  }),

  // R3 : un état qui dépend de Math.random au lieu du générateur donné.
  nondeterministic: asAny({
    ...base,
    apply(state: State, seat: number, move: { cell: number }, rng: () => number) {
      const result = base.apply(state, seat, move, rng);
      return result.ok ? { ...result, state: { ...result.state, stamp: Math.random() } } : result;
    },
  }),

  // R7 : le classement oublie le dernier.
  rankingMissesASeat: asAny({
    ...base,
    result(state: State) {
      const result = base.result(state);
      return result === null ? null : { ...result, ranking: result.ranking.slice(0, 1) };
    },
  }),

  // R6 : `turn` rend un siège même quand la partie est finie.
  turnAfterTheEnd: asAny({ ...base, turn: (state: State) => base.turn(state) ?? state.next }),

  // R4 : `legalMoves` propose une case déjà prise, qu'`apply` refuse.
  legalMoveRefused: asAny({
    ...base,
    legalMoves(state: State, seat: number) {
      const moves = base.legalMoves(state, seat);
      const taken = state.cells.findIndex((cell) => cell !== null);
      return taken === -1 || moves.length === 0 ? moves : [...moves, { cell: taken }];
    },
  }),

  // R8 : un état de 60 ko, trop gros pour partir à tout le bureau à chaque coup.
  oversizedState: asAny({
    ...base,
    create(setup: { seats: number; first: number }, rng: () => number) {
      const made = base.create(setup, rng);
      return { ...made, state: { ...made.state, padding: 'x'.repeat(60_000) } };
    },
  }),

  // Une partie qui ne finit jamais : toujours un coup légal, jamais de résultat.
  neverEnds: asAny({
    ...base,
    apply: (state: State) => ({ ok: true as const, state: { ...state, moves: state.moves }, events: [] }),
    turn: (state: State) => state.next,
    legalMoves: (state: State, seat: number) => (seat === state.next ? [{ cell: 0 }] : []),
    result: () => null,
    invariants: () => [],
  }),

  // R4 : `apply` accepte un coup illégal (il écrase une case prise).
  acceptsIllegalMove: asAny({
    ...base,
    apply(state: State, seat: number, move: { cell: number }, rng: () => number) {
      if (state.result !== null || seat !== state.next) return { ok: false as const, error: 'not_your_turn' };
      if (state.cells[move.cell] !== null && state.cells[move.cell] !== undefined) {
        const cells = state.cells.map((cell, index) => (index === move.cell ? (seat as 0 | 1) : cell));
        return { ok: true as const, state: { ...state, cells, next: 1 - seat }, events: [] };
      }
      return base.apply(state, seat, move, rng);
    },
  }),
} satisfies Record<string, AnyGameDefinition>;
