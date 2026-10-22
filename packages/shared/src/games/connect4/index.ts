import type { ApplyResult, GameDefinition, Rng } from '../types';
import { CONNECT4_CELLS, CONNECT4_COLUMNS, CONNECT4_ROWS, alignedCells, cellIndex, dropRow, isColumn } from './board';
import { connect4Invariants } from './invariants';
import { connect4MoveSchema, type Connect4Event, type Connect4Move, type Connect4Seat, type Connect4State } from './types';

// Ce que l'interface et les tests des autres paquets importent : `@bureau/shared/games/connect4`.
export * from './board';
export * from './types';

// Le siège qui joue le n-ième jeton (n = 0 pour le premier) : `first` aux coups pairs, l'autre aux impairs. C'est ainsi que se déduit le trait, jamais d'un champ de plus.
function seatOfMove(first: Connect4Seat, count: number): Connect4Seat {
  return (first + count) % 2 === 0 ? 0 : 1;
}

// Le siège qui doit agir, ou null si la partie est finie (un alignement, la grille pleine, un abandon : tout cela vit dans `result`).
function turnOf(state: Connect4State): Connect4Seat | null {
  return state.result === null ? seatOfMove(state.first, state.moves.length) : null;
}

// Le Puissance 4 (§ 15 du document des jeux) : sept colonnes, six rangées, quatre jetons alignés dans une direction quelconque gagnent, la grille pleine est nulle.
// Rien n'est tiré au hasard : le générateur reçu n'est jamais appelé.
export const connect4: GameDefinition<Connect4State, Connect4Move, Connect4Event> = {
  id: 'connect4',
  label: 'Puissance 4',
  minPlayers: 2,
  maxPlayers: 2,
  // Pas de nulle par accord (§ 15.1, R6) : seule la grille pleine est nulle.
  drawOffers: false,
  moveSchema: connect4MoveSchema,

  create(setup, _rng) {
    if (setup.seats !== 2) throw new Error('Le Puissance 4 se joue à deux.');
    if (setup.first !== 0 && setup.first !== 1) throw new Error(`Le siège qui commence est 0 ou 1 (reçu ${setup.first}).`);
    return {
      state: { cells: Array.from({ length: CONNECT4_CELLS }, () => 0), first: setup.first, moves: [], winLine: [], result: null },
      events: [],
    };
  },

  turn(state) {
    return turnOf(state);
  },

  // Les colonnes qui ne sont pas pleines, de la gauche vers la droite.
  legalMoves(state, seat) {
    if (turnOf(state) !== seat) return [];
    const moves: Connect4Move[] = [];
    for (let col = 0; col < CONNECT4_COLUMNS; col++) {
      if (dropRow(state.cells, col) !== -1) moves.push({ col });
    }
    return moves;
  },

  // Tout est revérifié ici (§ 2.2, R4), dans cet ordre : la partie n'est pas finie, c'est bien à ce siège, la colonne existe et n'est pas pleine. Puis le jeton
  // tombe, et la fin éventuelle est décidée dans cet appel (§ 2.2, R5) : l'alignement d'abord (le 42e jeton peut gagner), la grille pleine ensuite.
  apply(state, seat, move, _rng): ApplyResult<Connect4State, Connect4Event> {
    const mover = turnOf(state);
    if (mover === null) return { ok: false, error: 'wrong_phase' };
    if (seat !== mover) return { ok: false, error: 'not_your_turn' };
    // Le coup arrive du réseau : il peut être n'importe quoi (le schéma l'a déjà jugé, mais on ne s'y fie pas).
    const col = (move as { col?: unknown } | null | undefined)?.col;
    if (!isColumn(col)) return { ok: false, error: 'illegal' };
    const row = dropRow(state.cells, col);
    if (row === -1) return { ok: false, error: 'illegal' };

    const index = cellIndex(col, row);
    const cells = state.cells.slice();
    cells[index] = seat + 1;
    const moves = [...state.moves, col];
    const events: Connect4Event[] = [{ type: 'drop', seat, col, row }];

    const winLine = alignedCells(cells, index);
    if (winLine.length > 0) {
      events.push({ type: 'end', winner: seat, cells: [...winLine] });
      const result = { ranking: [[seat], [seat === 0 ? 1 : 0]], reason: 'four', detail: { cells: [...winLine] } };
      return { ok: true, state: { cells, first: state.first, moves, winLine, result }, events };
    }
    if (moves.length === CONNECT4_CELLS) {
      events.push({ type: 'end', winner: null, cells: [] });
      return { ok: true, state: { cells, first: state.first, moves, winLine: [], result: { ranking: [[0, 1]], reason: 'full' } }, events };
    }
    return { ok: true, state: { cells, first: state.first, moves, winLine: [], result: null }, events };
  },

  // Un siège qui sort (abandon, délai, départ) perd : l'autre est devant. Une partie déjà finie ne change pas, et un siège qui n'existe pas ne fait sortir personne.
  forfeit(state, seat, reason) {
    if (state.result !== null || (seat !== 0 && seat !== 1)) return { state, events: [] };
    return {
      state: { ...state, result: { ranking: [[seat === 0 ? 1 : 0], [seat]], reason } },
      events: [{ type: 'forfeit', seat, reason }],
    };
  },

  result(state) {
    return state.result;
  },

  // Chaque jeton posé est un coup qui compte pour le classement (§ 15.3).
  countedMoves(state) {
    return state.moves.length;
  },

  invariants(state) {
    return connect4Invariants(state);
  },
};

// Le dernier jeton posé : qui l'a joué, dans quelle colonne et à quelle rangée ; null avant le premier. L'interface le cercle sans rien avoir à retenir d'une image à
// l'autre (et le retrouve de même quand on revient dans une partie en cours).
export function lastDrop(state: Connect4State): { seat: Connect4Seat; col: number; row: number } | null {
  const col = state.moves[state.moves.length - 1];
  if (col === undefined) return null;
  // La première case libre de la colonne est juste au-dessus du dernier jeton ; si la colonne est pleine, il est tout en haut.
  const free = dropRow(state.cells, col);
  return { seat: seatOfMove(state.first, state.moves.length - 1), col, row: (free === -1 ? CONNECT4_ROWS : free) - 1 };
}

// Le Puissance 4 ne demande jamais de valeur au hasard : si une fonction du jeu en demandait une, ce serait un bogue, et on le verrait tout de suite.
const noDraw: Rng = () => {
  throw new Error('Le Puissance 4 ne tire rien au hasard.');
};

// L'état d'une partie où les colonnes données ont été jouées à la suite, à partir du siège `first` : chaque coup passe par `apply`, comme en vrai. Pour poser une
// position de test ou de débogage (`debug:game`) sans l'écrire à la main ; un coup refusé lève, en disant lequel.
export function playColumns(first: Connect4Seat, columns: readonly number[]): Connect4State {
  let state = connect4.create({ seats: 2, first }, noDraw).state;
  for (const [index, col] of columns.entries()) {
    const seat = connect4.turn(state);
    const out = seat === null ? ({ ok: false, error: 'wrong_phase' } as const) : connect4.apply(state, seat, { col }, noDraw);
    if (!out.ok) throw new Error(`playColumns : le coup ${index + 1} (colonne ${col}) est refusé (${out.error}).`);
    state = out.state;
  }
  return state;
}
