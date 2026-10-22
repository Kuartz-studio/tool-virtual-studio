import { describe, expect, test } from 'vitest';
import { scriptedRng } from '../rng';
import { makeTicTacToe, type TicTacToeState } from './tictactoe';

const game = makeTicTacToe('connect4');
const rng = scriptedRng([], () => 0.5);

// Une partie jouée : les coups à la suite (case de chaque pion, en alternant), à partir de `first`.
function play(cells: number[], first = 0): TicTacToeState {
  let { state } = game.create({ seats: 2, first }, rng);
  for (const cell of cells) {
    const seat = game.turn(state)!;
    const result = game.apply(state, seat, { cell }, rng);
    if (!result.ok) throw new Error(`coup refusé (${cell}) : ${result.error}`);
    state = result.state;
  }
  return state;
}

describe('le morpion jetable : un jeu complet du contrat', () => {
  test('l\'identité et les bornes : deux joueurs, le nom qu\'on lui donne', () => {
    expect(game).toMatchObject({ id: 'connect4', label: 'Morpion', minPlayers: 2, maxPlayers: 2, drawOffers: false });
    expect(makeTicTacToe('chess', { drawOffers: true }).drawOffers).toBe(true);
    expect(makeTicTacToe('chess').id).toBe('chess');
  });

  test('`first` commence', () => {
    expect(game.turn(game.create({ seats: 2, first: 0 }, rng).state)).toBe(0);
    expect(game.turn(game.create({ seats: 2, first: 1 }, rng).state)).toBe(1);
  });

  test('refuse une partie qui n\'est pas à deux', () => {
    expect(() => game.create({ seats: 3, first: 0 }, rng)).toThrow(/deux/);
  });

  test('un pion posé : à l\'autre de jouer, un événement, un coup compté', () => {
    const { state } = game.create({ seats: 2, first: 0 }, rng);
    const result = game.apply(state, 0, { cell: 4 }, rng);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(game.turn(result.state)).toBe(1);
    expect(result.events).toEqual([{ type: 'placed', seat: 0, cell: 4 }]);
    expect(game.countedMoves(result.state)).toBe(1);
    expect(game.countedMoves(state)).toBe(0);
  });

  test('hors tour, hors grille, sur une case prise : refusé, rien ne change', () => {
    const state = play([4]);
    expect(game.apply(state, 0, { cell: 0 }, rng)).toEqual({ ok: false, error: 'not_your_turn' });
    expect(game.apply(state, 1, { cell: 4 }, rng)).toEqual({ ok: false, error: 'illegal' });
    expect(game.apply(state, 1, { cell: 9 }, rng)).toEqual({ ok: false, error: 'illegal' });
    expect(game.apply(state, 5, { cell: 0 }, rng)).toEqual({ ok: false, error: 'not_your_turn' });
  });

  test('trois en ligne gagnent (ligne, colonne, diagonale) : le gagnant est devant', () => {
    // Siège 0 : 0, 1, 2 (ligne du haut) ; siège 1 : 3, 4.
    const row = play([0, 3, 1, 4, 2]);
    expect(game.result(row)).toEqual({ ranking: [[0], [1]], reason: 'line', detail: { cells: [0, 1, 2] } });
    expect(game.turn(row)).toBeNull();
    // Siège 0 : 0, 3, 6 (colonne de gauche) ; siège 1 : 1, 4.
    expect(game.result(play([0, 1, 3, 4, 6]))?.detail).toEqual({ cells: [0, 3, 6] });
    // Siège 1 gagne la diagonale 2, 4, 6 ; siège 0 : 0, 1, 5.
    const diagonal = play([0, 2, 1, 4, 5, 6]);
    expect(game.result(diagonal)).toEqual({ ranking: [[1], [0]], reason: 'line', detail: { cells: [2, 4, 6] } });
  });

  test('la grille pleine sans ligne est nulle : un seul groupe', () => {
    // X O X / X O O / O X X : aucune ligne.
    const full = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(game.result(full)).toEqual({ ranking: [[0, 1]], reason: 'full' });
    expect(game.turn(full)).toBeNull();
  });

  test('plus de coup une fois la partie finie', () => {
    const won = play([0, 3, 1, 4, 2]);
    expect(game.legalMoves(won, 0)).toEqual([]);
    expect(game.legalMoves(won, 1)).toEqual([]);
    expect(game.apply(won, 1, { cell: 8 }, rng).ok).toBe(false);
  });

  test('legalMoves : les cases vides, au siège qui a le trait seulement', () => {
    const state = play([4]);
    expect(game.legalMoves(state, 0)).toEqual([]);
    expect(game.legalMoves(state, 1).map((move) => move.cell)).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
  });

  test('l\'abandon (ou le délai, ou le départ) donne la partie à l\'autre, avec la raison de la plateforme', () => {
    for (const reason of ['resign', 'timeout', 'disconnect'] as const) {
      const { state, events } = game.forfeit(play([4]), 1, reason);
      expect(game.result(state)).toEqual({ ranking: [[0], [1]], reason });
      expect(game.turn(state)).toBeNull();
      expect(events).toEqual([{ type: 'forfeited', seat: 1, reason }]);
    }
  });

  test('un abandon après la fin ne change rien', () => {
    const won = play([0, 3, 1, 4, 2]);
    expect(game.forfeit(won, 0, 'resign').state).toEqual(won);
  });

  test('la nulle par accord (si le jeu l\'offre) termine la partie à égalité', () => {
    const withDraws = makeTicTacToe('chess', { drawOffers: true });
    const { state } = withDraws.create({ seats: 2, first: 0 }, rng);
    const ended = withDraws.agreeDraw!(state).state;
    expect(withDraws.result(ended)).toEqual({ ranking: [[0, 1]], reason: 'agreement' });
    expect(game.agreeDraw).toBeUndefined();
  });

  test('invariants : [] pour toute partie jouée, une phrase par défaut sur un état abîmé', () => {
    expect(game.invariants(play([0, 3, 1, 4]))).toEqual([]);
    const ok = play([0, 3]);
    expect(game.invariants({ ...ok, cells: ok.cells.slice(0, 8) })).not.toEqual([]);
    expect(game.invariants({ ...ok, moves: 5 })).not.toEqual([]);
    expect(game.invariants({ ...ok, next: 3 })).not.toEqual([]);
    expect(game.invariants({ ...ok, cells: ok.cells.map((cell, i) => (i === 8 ? 2 : cell)) as TicTacToeState['cells'] })).not.toEqual([]);
  });
});
