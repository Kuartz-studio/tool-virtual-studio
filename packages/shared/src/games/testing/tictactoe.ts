import { z } from 'zod';
import type { ApplyResult, ForfeitReason, GameDefinition, GameId, GameResult, GameSetup, Rng } from '../types';

// Le morpion jetable : un jeu complet du contrat (GameDefinition), le plus petit possible, pour prouver la plateforme (tables, coups, délais, classement) avant que
// les vrais jeux n'existent, et pour servir de modèle. Jamais au registre : aucune interface ne le dessine. Le serveur peut l'importer
// (`@bureau/shared/games/testing`).

export interface TicTacToeState {
  // Le siège qui tient chaque case (0 ou 1), ou null.
  cells: Array<0 | 1 | null>;
  // Le siège qui joue ensuite (sans importance une fois la partie finie).
  next: number;
  // Les pions posés.
  moves: number;
  // Le résultat, tant qu'il y en a un : il vit ici, à un seul endroit.
  result: GameResult | null;
}
export interface TicTacToeMove {
  cell: number;
}
export type TicTacToeEvent =
  | { type: 'placed'; seat: number; cell: number }
  | { type: 'forfeited'; seat: number; reason: ForfeitReason }
  | { type: 'drawn' };

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const;

const moveSchema: z.ZodType<TicTacToeMove> = z.object({ cell: z.number().int().min(0).max(8) });

// La ligne que ce siège a faite, ou null.
function lineOf(cells: TicTacToeState['cells'], seat: number): number[] | null {
  const line = LINES.find((cellsOfLine) => cellsOfLine.every((cell) => cells[cell] === seat));
  return line ? [...line] : null;
}

export interface TicTacToeOptions {
  // La nulle par accord est offerte (pour essayer la plateforme : `draw`).
  drawOffers?: boolean;
}

// Le morpion, sous le nom d'un des jeux de la carte (la table où on le pose).
export function makeTicTacToe(id: GameId, options: TicTacToeOptions = {}): GameDefinition<TicTacToeState, TicTacToeMove, TicTacToeEvent> {
  const finished = (state: TicTacToeState, result: GameResult): TicTacToeState => ({ ...state, result });

  const definition: GameDefinition<TicTacToeState, TicTacToeMove, TicTacToeEvent> = {
    id,
    label: 'Morpion',
    minPlayers: 2,
    maxPlayers: 2,
    drawOffers: options.drawOffers === true,
    moveSchema,

    create(setup: GameSetup, _rng: Rng) {
      if (setup.seats !== 2) throw new Error('Le morpion se joue à deux.');
      return { state: { cells: Array.from({ length: 9 }, () => null), next: setup.first, moves: 0, result: null }, events: [] };
    },

    turn: (state) => (state.result === null ? state.next : null),

    legalMoves(state, seat) {
      if (state.result !== null || state.next !== seat) return [];
      return state.cells.flatMap((cell, index) => (cell === null ? [{ cell: index }] : []));
    },

    apply(state, seat, move, _rng): ApplyResult<TicTacToeState, TicTacToeEvent> {
      if (state.result !== null || seat !== state.next) return { ok: false, error: 'not_your_turn' };
      if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell > 8 || state.cells[move.cell] !== null) return { ok: false, error: 'illegal' };
      const cells = state.cells.map((cell, index) => (index === move.cell ? (seat as 0 | 1) : cell));
      const events: TicTacToeEvent[] = [{ type: 'placed', seat, cell: move.cell }];
      const placed: TicTacToeState = { cells, next: 1 - seat, moves: state.moves + 1, result: null };
      const line = lineOf(cells, seat);
      if (line) return { ok: true, state: finished(placed, { ranking: [[seat], [1 - seat]], reason: 'line', detail: { cells: line } }), events };
      if (placed.moves === 9) return { ok: true, state: finished(placed, { ranking: [[0, 1]], reason: 'full' }), events };
      return { ok: true, state: placed, events };
    },

    forfeit(state, seat, reason) {
      if (state.result !== null) return { state, events: [] };
      return { state: finished(state, { ranking: [[1 - seat], [seat]], reason }), events: [{ type: 'forfeited', seat, reason }] };
    },

    result: (state) => state.result,
    countedMoves: (state) => state.moves,

    invariants(state) {
      const problems: string[] = [];
      if (state.cells.length !== 9) problems.push(`la grille a ${state.cells.length} cases au lieu de 9`);
      for (const [index, cell] of state.cells.entries()) if (cell !== null && cell !== 0 && cell !== 1) problems.push(`la case ${index} vaut ${String(cell)}`);
      const filled = state.cells.filter((cell) => cell !== null).length;
      if (state.moves !== filled) problems.push(`${state.moves} pions comptés pour ${filled} cases prises`);
      if (state.next !== 0 && state.next !== 1) problems.push(`le siège qui joue ensuite vaut ${state.next}`);
      return problems;
    },
  };

  if (options.drawOffers === true) {
    definition.agreeDraw = (state) => {
      if (state.result !== null) return { state, events: [] };
      return { state: finished(state, { ranking: [[0, 1]], reason: 'agreement' }), events: [{ type: 'drawn' }] };
    };
  }
  return definition;
}

export type TicTacToe = ReturnType<typeof makeTicTacToe>;
