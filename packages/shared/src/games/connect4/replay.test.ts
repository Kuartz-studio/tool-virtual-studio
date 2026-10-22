import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { replayMatch } from '../conformance';
import type { MatchLogEntry } from '../protocol';
import type { GameResult } from '../types';
import { connect4, playColumns, type Connect4Seat, type Connect4State } from './index';

// Des parties enregistrées, rejouées comme le fait la plateforme (§ 4.3 et § 11.2 du document des jeux) : un journal `MatchLogEntry[]`, exactement ce qu'elle écrit
// dans la colonne `moves` de `game_match`, redonne l'état final de la partie. Les journaux sont dans fixtures/. Ils ont été fabriqués avec un second moteur de
// Puissance 4, écrit à part de celui qu'on teste (une pile par colonne, la grille entière cherchée à chaque jeton) : ni les journaux ni ce qu'on en attend ne
// viennent donc du code qu'ils jugent.

function loadLog(name: string): MatchLogEntry[] {
  return JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')) as MatchLogEntry[];
}

// La grille que donnent ces colonnes jouées à la suite à partir de `first`, calculée ici d'une autre façon que le moteur (une hauteur par colonne, rien d'autre).
function boardOf(first: Connect4Seat, columns: readonly number[]): number[] {
  const heights = [0, 0, 0, 0, 0, 0, 0];
  const cells = Array.from({ length: 42 }, () => 0);
  for (const [index, col] of columns.entries()) {
    cells[col * 6 + heights[col]!] = ((first + index) % 2) + 1;
    heights[col]!++;
  }
  return cells;
}

interface Fixture {
  file: string;
  // Ce que raconte la partie.
  story: string;
  first: Connect4Seat;
  // Le nombre de jetons posés à la fin.
  moves: number;
  result: GameResult;
}

const FIXTURES: Fixture[] = [
  {
    file: 'c9.json',
    story: 'C9 : le siège 0 commence, et son 27e jeton achève la verticale et la diagonale à la fois (sept cases)',
    first: 0,
    moves: 27,
    result: { ranking: [[0], [1]], reason: 'four', detail: { cells: [18, 25, 32, 36, 37, 38, 39] } },
  },
  {
    file: 'c10.json',
    story: 'C10 : le siège 1 commence, la grille se remplit sans alignement : nulle au 42e jeton',
    first: 1,
    moves: 42,
    result: { ranking: [[0, 1]], reason: 'full' },
  },
  {
    file: 'c11.json',
    story: 'C11 : le siège 1 commence, et le siège 0 gagne au 42e jeton (rangée du haut, cinq cases)',
    first: 1,
    moves: 42,
    result: { ranking: [[0], [1]], reason: 'four', detail: { cells: [5, 11, 17, 23, 29] } },
  },
  {
    file: 'hasard-quatre.json',
    story: 'une partie tirée au hasard (graine 1) : le siège 1 commence et gagne au 29e jeton, par la verticale de la colonne 4',
    first: 1,
    moves: 29,
    result: { ranking: [[1], [0]], reason: 'four', detail: { cells: [24, 25, 26, 27] } },
  },
  {
    file: 'hasard-abandon.json',
    story: 'une partie tirée au hasard (graine 1000) : après 17 jetons, le siège 1, qui avait le trait, laisse passer son délai : le siège 0 gagne',
    first: 0,
    moves: 17,
    result: { ranking: [[0], [1]], reason: 'timeout' },
  },
  {
    file: 'c10-posee-par-debug.json',
    story: 'C10 posée par `debug:game` (E2E) : deux coups joués, puis la grille de C10 moins son dernier jeton posée telle quelle, puis le dernier jeton : nulle',
    first: 1,
    moves: 42,
    result: { ranking: [[0, 1]], reason: 'full' },
  },
];

describe('Puissance 4 : des parties enregistrées, rejouées', () => {
  test.each(FIXTURES)('$story', ({ file, first, moves, result }) => {
    const log = loadLog(file);
    const state = replayMatch(connect4, log) as Connect4State;

    expect(state.first).toBe(first);
    expect(state.moves).toHaveLength(moves);
    expect(connect4.countedMoves(state)).toBe(moves);
    expect(connect4.result(state)).toStrictEqual(result);
    expect(connect4.turn(state)).toBeNull();
    expect(connect4.invariants(state)).toEqual([]);
    // La grille est celle des colonnes jouées, calculée à part ; et c'est aussi celle que `playColumns` fabrique.
    expect(state.cells).toStrictEqual(boardOf(first, state.moves));
    expect(state.cells).toStrictEqual(playColumns(first, state.moves).cells);
    // Les cases gagnantes sont dans l'état, et dans le résultat pour l'interface.
    expect(state.winLine).toStrictEqual(result.reason === 'four' ? (result.detail as { cells: number[] }).cells : []);
  });

  test.each(FIXTURES)('chaque début de journal est un état légal, et le coup suivant est joué par celui qui a le trait : $file', ({ file }) => {
    const log = loadLog(file);
    for (let length = 1; length <= log.length; length++) {
      const state = replayMatch(connect4, log.slice(0, length)) as Connect4State;
      expect(connect4.invariants(state), `${file}, ${length} entrées`).toEqual([]);
      const next = log[length];
      if (next?.kind === 'move') {
        expect(connect4.turn(state), `${file}, ${length} entrées`).toBe(next.seat);
        expect(connect4.legalMoves(state, next.seat).map((move) => move.col), `${file}, ${length} entrées`).toContain((next.move as { col: number }).col);
      }
    }
  });

  test.each(FIXTURES)('un journal est un journal : il commence par `create` à deux sièges, et Puissance 4 n\'a jamais tiré une valeur au hasard : $file', ({ file, first }) => {
    const log = loadLog(file);
    expect(log[0]).toStrictEqual({ kind: 'create', setup: { seats: 2, first }, rng: [] });
    let previous = 0;
    for (const entry of log) {
      expect(['create', 'move', 'forfeit', 'debug']).toContain(entry.kind);
      if (entry.kind === 'create' || entry.kind === 'move') expect(entry.rng, `${file}`).toStrictEqual([]);
      if (entry.kind !== 'create' && entry.kind !== 'draw') {
        expect(entry.at, file).toBeGreaterThan(previous);
        previous = entry.at;
      }
    }
  });

  test('la position posée par `debug:game` est celle que `playColumns` fabrique (la recette pour l\'e2e), légale et avec le trait', () => {
    const log = loadLog('c10-posee-par-debug.json');
    const debug = log.find((entry) => entry.kind === 'debug');
    expect(debug).toBeDefined();
    if (debug?.kind !== 'debug') return;
    const c10 = loadLog('c10.json')
      .filter((entry) => entry.kind === 'move')
      .map((entry) => (entry.move as { col: number }).col);
    expect(debug.state).toStrictEqual(playColumns(1, c10.slice(0, 41)));
    // Ce que le serveur exige d'un état posé : légal, et la partie n'est pas finie.
    expect(connect4.invariants(debug.state as Connect4State)).toEqual([]);
    expect(connect4.turn(debug.state as Connect4State)).toBe(0);
    expect(connect4.legalMoves(debug.state as Connect4State, 0)).toStrictEqual([{ col: 5 }]);
  });

  test('un coup que les règles refusent fait échouer le rejeu : après la fin, hors tour, dans une colonne pleine, après un abandon', () => {
    const won = loadLog('c9.json');
    expect(() => replayMatch(connect4, [...won, { kind: 'move', seat: 1, move: { col: 0 }, rng: [], at: 999_999 }])).toThrow(/refusé/);
    const create: MatchLogEntry = { kind: 'create', setup: { seats: 2, first: 0 }, rng: [] };
    expect(() => replayMatch(connect4, [create, { kind: 'move', seat: 1, move: { col: 3 }, rng: [], at: 1 }])).toThrow(/refusé.*not_your_turn/);
    const column = Array.from({ length: 7 }, (_, index): MatchLogEntry => ({ kind: 'move', seat: index % 2, move: { col: 0 }, rng: [], at: index + 1 }));
    expect(() => replayMatch(connect4, [create, ...column])).toThrow(/refusé.*illegal/);
    const forfeited = loadLog('hasard-abandon.json');
    expect(() => replayMatch(connect4, [...forfeited, { kind: 'move', seat: 0, move: { col: 0 }, rng: [], at: 999_999 }])).toThrow(/refusé.*wrong_phase/);
  });

  test('une sortie du journal est rejouée par `forfeit` du jeu, à tout moment, pour chacune des trois raisons', () => {
    for (const reason of ['resign', 'timeout', 'disconnect'] as const) {
      for (const seat of [0, 1] as const) {
        const log: MatchLogEntry[] = [
          { kind: 'create', setup: { seats: 2, first: 1 }, rng: [] },
          { kind: 'move', seat: 1, move: { col: 3 }, rng: [], at: 1 },
          { kind: 'forfeit', seat, reason, at: 2 },
        ];
        const state = replayMatch(connect4, log) as Connect4State;
        expect(connect4.result(state), `${reason}, siège ${seat}`).toStrictEqual({ ranking: [[1 - seat], [seat]], reason });
      }
    }
  });
});
