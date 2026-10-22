import { describe, expect, test } from 'vitest';
import { replayMatch } from '../conformance';
import type { MatchLogEntry } from '../protocol';
import { chess, MAX_PLIES_KEPT, stateFromFen, type ChessState } from './index';
import fouMate from './fixtures/mat-du-fou.json';
import longRandom from './fixtures/hasard-60.json';
import mateRandom from './fixtures/hasard-1889.json';
import scholarsMate from './fixtures/mat-du-berger.json';
import samLoyd from './fixtures/pat-de-sam-loyd.json';
import stalemateRandom from './fixtures/hasard-15.json';
import { moveOf, noRandom } from './test-helpers';

// Le rejeu (§ 11.2 et § 13.5 du document des jeux) : des parties enregistrées, au format du journal que le serveur garde (`MatchLogEntry[]`), rejouées par
// `replayMatch` : l'état final et le résultat doivent être ceux qu'on a notés. Trois parties du document (C19, C20, C22) et trois parties au hasard à graines fixes
// (le mat le plus court de 3 000 essais, un pat, une partie de plus de 650 demi-coups qui éprouve la borne de l'historique). Si les règles changent sans qu'on le
// veuille, ces journaux ne donnent plus la même fin : c'est ce qu'ils gardent.
const asLog = (fixture: unknown): MatchLogEntry[] => fixture as MatchLogEntry[];

interface Recorded {
  name: string;
  log: MatchLogEntry[];
  // Le FEN final, le résultat, le nombre de demi-coups joués au journal, et l'historique gardé par l'état.
  fen: string;
  ranking: number[][];
  reason: string;
  moves: number;
  kept: number;
}

const RECORDED: Recorded[] = [
  {
    name: 'le mat du berger (C19)',
    log: asLog(scholarsMate),
    fen: 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4',
    ranking: [[0], [1]],
    reason: 'checkmate',
    moves: 7,
    kept: 7,
  },
  {
    name: 'le mat du fou (C20)',
    log: asLog(fouMate),
    fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
    ranking: [[1], [0]],
    reason: 'checkmate',
    moves: 4,
    kept: 4,
  },
  {
    name: 'le pat de Sam Loyd (C22)',
    log: asLog(samLoyd),
    fen: '5bnr/4p1pq/4Qpkr/7p/7P/4P3/PPPP1PP1/RNB1KBNR b KQ - 2 10',
    ranking: [[0, 1]],
    reason: 'stalemate',
    moves: 19,
    kept: 19,
  },
  {
    name: 'au hasard, graine 1889 : un mat en 8 demi-coups, les Blancs au siège 1',
    log: asLog(mateRandom),
    fen: 'rnb2bnr/pppp1kpp/4p3/5p2/1P4Pq/5P1P/P1PPP3/RNBQKBNR w KQ - 1 5',
    ranking: [[0], [1]],
    reason: 'checkmate',
    moves: 8,
    kept: 8,
  },
  {
    name: 'au hasard, graine 15 : un pat après 257 demi-coups, les Blancs au siège 1',
    log: asLog(stalemateRandom),
    fen: '8/8/2R5/6k1/6P1/6K1/8/8 b - - 12 129',
    ranking: [[0, 1]],
    reason: 'stalemate',
    moves: 257,
    kept: 257,
  },
  {
    name: 'au hasard, graine 60 : 684 demi-coups, un roi seul contre un roi (matériel insuffisant), historique borné',
    log: asLog(longRandom),
    fen: '4k3/8/8/8/8/1K6/8/8 w - - 0 343',
    ranking: [[0, 1]],
    reason: 'insufficient',
    moves: 684,
    kept: MAX_PLIES_KEPT,
  },
];

describe('rejeu des parties enregistrées (fixtures/*.json)', () => {
  test.each(RECORDED)('$name : l\'état final et le résultat sont ceux du journal', (recorded) => {
    expect(recorded.log.filter((entry) => entry.kind === 'move')).toHaveLength(recorded.moves);
    const state = replayMatch(chess as never, recorded.log) as ChessState;
    expect(state.fen).toBe(recorded.fen);
    expect(chess.result(state)).toEqual({ ranking: recorded.ranking, reason: recorded.reason });
    expect(chess.turn(state)).toBeNull();
    expect(state.plies).toHaveLength(recorded.kept);
    expect(chess.invariants(state)).toEqual([]);
  });

  test.each(RECORDED)('$name : jouer le journal coup par coup donne, à chaque pas, l\'état que rend replayMatch', (recorded) => {
    let state: ChessState | null = null;
    const log = recorded.log;
    log.forEach((entry, index) => {
      if (entry.kind === 'create') state = chess.create(entry.setup, noRandom).state;
      else if (entry.kind === 'move') {
        const out = chess.apply(state!, entry.seat, entry.move as never, noRandom);
        if (!out.ok) throw new Error(`le coup ${index} est refusé : ${out.error}`);
        state = out.state;
      }
      // Quelques pas seulement pour les longues parties : le rejeu repart de zéro à chaque fois.
      if (index % Math.max(1, Math.floor(log.length / 25)) === 0 || index === log.length - 1) {
        expect(replayMatch(chess as never, log.slice(0, index + 1))).toStrictEqual(state);
      }
    });
  });

  test('chaque journal est cohérent : le siège de chaque coup est celui qui avait le trait, `rng` est vide (les échecs n\'ont aucun hasard), et il commence par `create`', () => {
    for (const recorded of RECORDED) {
      const [head, ...moves] = recorded.log;
      expect(head).toMatchObject({ kind: 'create', setup: { seats: 2 }, rng: [] });
      let state = chess.create((head as Extract<MatchLogEntry, { kind: 'create' }>).setup, noRandom).state;
      for (const entry of moves) {
        if (entry.kind !== 'move') throw new Error('un journal de fixture ne contient que des coups');
        expect(entry.seat).toBe(chess.turn(state));
        expect(entry.rng).toEqual([]);
        const out = chess.apply(state, entry.seat, entry.move as never, noRandom);
        if (!out.ok) throw new Error(`coup refusé : ${out.error}`);
        state = out.state;
      }
    }
  });

  test('un coup de plus après la fin est refusé au rejeu', () => {
    const log = [...asLog(scholarsMate), { kind: 'move', seat: 1, move: moveOf('a7a6'), rng: [], at: 99_000 } as MatchLogEntry];
    expect(() => replayMatch(chess as never, log)).toThrow(/refusé/);
  });
});

// Ce que le journal d'une partie réelle contient en plus des coups : l'abandon, la nulle par accord, un état de débogage posé tel quel (tests de bout en bout).
describe('rejeu des autres entrées du journal', () => {
  const create: MatchLogEntry = { kind: 'create', setup: { seats: 2, first: 0 }, rng: [] };
  const move = (seat: number, text: string, at: number): MatchLogEntry => ({ kind: 'move', seat, move: moveOf(text), rng: [], at });

  test('un abandon : celui qui abandonne perd, la partie est finie', () => {
    const state = replayMatch(chess as never, [create, move(0, 'e2e4', 1), move(1, 'e7e5', 2), { kind: 'forfeit', seat: 1, reason: 'resign', at: 3 }]) as ChessState;
    expect(chess.result(state)).toEqual({ ranking: [[0], [1]], reason: 'resign' });
    expect(state.plies).toHaveLength(2);
  });

  test('un délai écoulé et un départ du bureau : les mêmes défaites, avec leur raison', () => {
    for (const reason of ['timeout', 'disconnect'] as const) {
      const state = replayMatch(chess as never, [create, move(0, 'e2e4', 1), { kind: 'forfeit', seat: 0, reason, at: 2 }]) as ChessState;
      expect(chess.result(state)).toEqual({ ranking: [[1], [0]], reason });
    }
  });

  test('une nulle par accord : un seul groupe', () => {
    const state = replayMatch(chess as never, [create, move(0, 'e2e4', 1), move(1, 'e7e5', 2), { kind: 'draw', at: 3 }]) as ChessState;
    expect(chess.result(state)).toEqual({ ranking: [[0, 1]], reason: 'agreement' });
  });

  test('un état de débogage remplace celui de la partie, et les coups suivants se jouent depuis lui', () => {
    const forced = stateFromFen('7k/8/6K1/8/8/8/8/R7 w - - 0 60');
    const state = replayMatch(chess as never, [create, move(0, 'e2e4', 1), { kind: 'debug', state: forced, at: 2 }, move(0, 'a1a8', 3)]) as ChessState;
    expect(chess.result(state)).toEqual({ ranking: [[0], [1]], reason: 'checkmate' });
    expect(state.fen).toBe('R6k/8/6K1/8/8/8/8/8 b - - 1 60');
  });
});
