import { describe, expect, test } from 'vitest';
import { deepFreeze, replayMatch, runGameConformance, type ConformanceOptions } from './conformance';
import type { MatchLogEntry } from './protocol';
import { scriptedRng } from './rng';
import { brokenGames, makeTicTacToe } from './testing';

const options: ConformanceOptions = { games: 80, seats: [2], maxActions: 30, seed: 1 };
const tictactoe = makeTicTacToe('connect4');

describe('deepFreeze', () => {
  test('gèle l\'objet et tout ce qu\'il contient, et le rend lui-même', () => {
    const value = { list: [{ a: 1 }], inner: { deep: { x: 1 } } };
    expect(deepFreeze(value)).toBe(value);
    expect(Object.isFrozen(value.list)).toBe(true);
    expect(Object.isFrozen(value.list[0])).toBe(true);
    expect(Object.isFrozen(value.inner.deep)).toBe(true);
    expect(() => {
      value.inner.deep.x = 2;
    }).toThrow(TypeError);
  });

  test('laisse passer les valeurs simples', () => {
    expect(deepFreeze(3)).toBe(3);
    expect(deepFreeze(null)).toBeNull();
    expect(deepFreeze('x')).toBe('x');
  });
});

describe('replayMatch', () => {
  test('rejoue un journal : l\'état final de la partie', () => {
    const log: MatchLogEntry[] = [
      { kind: 'create', setup: { seats: 2, first: 0 }, rng: [] },
      { kind: 'move', seat: 0, move: { cell: 0 }, rng: [], at: 1 },
      { kind: 'move', seat: 1, move: { cell: 3 }, rng: [], at: 2 },
      { kind: 'move', seat: 0, move: { cell: 1 }, rng: [], at: 3 },
      { kind: 'move', seat: 1, move: { cell: 4 }, rng: [], at: 4 },
      { kind: 'move', seat: 0, move: { cell: 2 }, rng: [], at: 5 },
    ];
    const state = replayMatch(tictactoe as never, log) as ReturnType<typeof tictactoe.create>['state'];
    expect(state.result).toEqual({ ranking: [[0], [1]], reason: 'line', detail: { cells: [0, 1, 2] } });
  });

  test('une sortie du journal est rejouée', () => {
    const log: MatchLogEntry[] = [
      { kind: 'create', setup: { seats: 2, first: 0 }, rng: [] },
      { kind: 'forfeit', seat: 0, reason: 'timeout', at: 5 },
    ];
    expect((replayMatch(tictactoe as never, log) as ReturnType<typeof tictactoe.create>['state']).result?.reason).toBe('timeout');
  });

  test('une nulle par accord est rejouée, et un jeu qui ne l\'offre pas la refuse', () => {
    const log: MatchLogEntry[] = [
      { kind: 'create', setup: { seats: 2, first: 0 }, rng: [] },
      { kind: 'draw', at: 5 },
    ];
    expect((replayMatch(makeTicTacToe('chess', { drawOffers: true }) as never, log) as ReturnType<typeof tictactoe.create>['state']).result?.reason).toBe('agreement');
    expect(() => replayMatch(tictactoe as never, log)).toThrow(/n'offre pas/);
  });

  test('un état de débogage est posé tel quel', () => {
    const { state } = tictactoe.create({ seats: 2, first: 1 }, scriptedRng([]));
    const forced = { ...state, moves: 0, next: 0 };
    const log: MatchLogEntry[] = [
      { kind: 'create', setup: { seats: 2, first: 1 }, rng: [] },
      { kind: 'debug', state: forced, at: 1 },
    ];
    expect(replayMatch(tictactoe as never, log)).toEqual(forced);
  });

  test('un coup refusé au rejeu, un journal vide ou sans `create` : une erreur qui le dit', () => {
    expect(() =>
      replayMatch(tictactoe as never, [
        { kind: 'create', setup: { seats: 2, first: 0 }, rng: [] },
        { kind: 'move', seat: 1, move: { cell: 0 }, rng: [], at: 1 },
      ]),
    ).toThrow(/refusé/);
    expect(() => replayMatch(tictactoe as never, [])).toThrow(/vide/);
    expect(() => replayMatch(tictactoe as never, [{ kind: 'draw', at: 1 }])).toThrow(/ne commence pas/);
  });
});

describe('runGameConformance : un jeu juste passe', () => {
  test('le morpion : 80 parties, toutes finies, sans une violation', () => {
    const report = runGameConformance(tictactoe as never, options);
    expect(report.games).toBe(80);
    expect(report.actions).toBeGreaterThanOrEqual(80 * 3);
    expect(report.longest).toBeGreaterThan(3);
    expect(report.longest).toBeLessThanOrEqual(10);
    expect(report.biggestStateBytes).toBeGreaterThan(0);
    expect(report.biggestStateBytes).toBeLessThan(1000);
  });

  test('avec la nulle par accord, et des abandons qui tombent à tout moment', () => {
    const report = runGameConformance(makeTicTacToe('chess', { drawOffers: true }) as never, { ...options, games: 150, drawRate: 0.5, forfeitRate: 0.5 });
    expect(report.games).toBe(150);
  });

  test('toujours une nulle par accord : les parties s\'arrêtent après deux pions', () => {
    const report = runGameConformance(makeTicTacToe('chess', { drawOffers: true }) as never, { ...options, games: 20, drawRate: 1, forfeitRate: 0 });
    expect(report.actions).toBe(20 * 2);
  });

  test('un coup sans doute illégal, refusé par le jeu : la partie continue', () => {
    const report = runGameConformance(tictactoe as never, {
      ...options,
      illegal: (state) => ({ cell: (state as { cells: unknown[] }).cells.findIndex((cell) => cell !== null) }),
    });
    expect(report.games).toBe(80);
  });

  test('la même graine rejoue les mêmes parties', () => {
    const a = runGameConformance(tictactoe as never, { ...options, games: 30, seed: 99 });
    const b = runGameConformance(tictactoe as never, { ...options, games: 30, seed: 99 });
    expect(a).toEqual(b);
  });
});

// Ce que chaque jeu faux exprès doit déclencher.
const EXPECTED: Record<keyof typeof brokenGames, RegExp> = {
  mutatesState: /apply a levé/,
  mutatesLaterStates: /apply a levé/,
  undefinedInState: /aller-retour par JSON/,
  nondeterministic: /pas déterministe/,
  rankingMissesASeat: /ne contient pas chaque siège une fois/,
  turnAfterTheEnd: /exactement l'un des deux doit être nul/,
  legalMoveRefused: /apply refuse un coup légal/,
  oversizedState: /trop gros/,
  neverEnds: /ne finit pas/,
  acceptsIllegalMove: /a accepté un coup illégal/,
};

describe('runGameConformance : chaque jeu faux exprès est attrapé', () => {
  test('chaque jeu faux a sa règle attendue, et inversement', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(brokenGames).sort());
  });

  const illegal = (state: unknown) => ({ cell: (state as { cells: unknown[] }).cells.findIndex((cell) => cell !== null) });

  test.each(Object.entries(brokenGames))('%s', (name, game) => {
    const run = () => runGameConformance(game, { ...options, illegal: name === 'acceptsIllegalMove' ? illegal : undefined });
    expect(run).toThrow(EXPECTED[name as keyof typeof brokenGames]);
  });

  test('l\'erreur donne le jeu, la graine, le pas et la fin du journal : de quoi rejouer la partie', () => {
    let message = '';
    try {
      runGameConformance(brokenGames.turnAfterTheEnd, options);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/^connect4 : /);
    expect(message).toMatch(/graine \d+, 2 joueurs, pas \d+/);
    expect(message).toMatch(/Dernières entrées du journal : \[\{"kind":"create"/);
  });
});
