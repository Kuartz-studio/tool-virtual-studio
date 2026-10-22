import type { GameMatchView, GameResult, GameTableView } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { chairOf, countdownVisible, endText, formatClock, formatDelta, ratingLines, seatOf, soleWinner } from './table-view';

const match = (userIds: string[], over: Partial<GameMatchView> = {}): GameMatchView => ({
  id: 'm',
  status: 'playing',
  players: userIds.map((userId) => ({ userId, name: userId.toUpperCase(), avatarKey: null, connected: true, reconnectMs: null, out: false })),
  first: 0,
  state: {},
  events: [],
  turnMs: 1000,
  drawOffer: null,
  startedAt: 0,
  result: null,
  ranked: null,
  ratings: null,
  ...over,
});
const table = (chairs: Array<string | null>): GameTableView => ({
  game: 'chess',
  version: 1,
  chairs: chairs.map((userId) => (userId === null ? null : { userId, name: userId.toUpperCase(), avatarKey: null, ready: false, connected: true })),
  spectators: [],
  match: null,
});

describe('seatOf et chairOf', () => {
  test('le siège d\'une personne dans la partie, ou null (spectateur, personne, pas de partie)', () => {
    expect(seatOf(match(['a', 'b']), 'b')).toBe(1);
    expect(seatOf(match(['a', 'b']), 'c')).toBeNull();
    expect(seatOf(null, 'a')).toBeNull();
    expect(seatOf(match(['a']), null)).toBeNull();
  });

  test('sa chaise à la table, ou null', () => {
    expect(chairOf(table([null, 'b']), 'b')).toBe(1);
    expect(chairOf(table(['a', null]), 'b')).toBeNull();
    expect(chairOf(undefined, 'a')).toBeNull();
    expect(chairOf(table(['a']), null)).toBeNull();
  });
});

describe('formatClock', () => {
  test('minutes et secondes : 1:12, 0:05, 5:00 ; jamais négatif', () => {
    expect(formatClock(72_000)).toBe('1:12');
    expect(formatClock(5_000)).toBe('0:05');
    expect(formatClock(300_000)).toBe('5:00');
    expect(formatClock(-3_000)).toBe('0:00');
  });

  test('les secondes entamées comptent : 59 001 ms disent encore 1:00', () => {
    expect(formatClock(59_001)).toBe('1:00');
    expect(formatClock(59_000)).toBe('0:59');
    expect(formatClock(1)).toBe('0:01');
  });
});

describe('countdownVisible', () => {
  test('seulement dans la dernière minute', () => {
    expect(countdownVisible(null)).toBe(false);
    expect(countdownVisible(61_000)).toBe(false);
    expect(countdownVisible(60_000)).toBe(true);
    expect(countdownVisible(0)).toBe(true);
  });
});

describe('formatDelta', () => {
  test('+16, −16 (le vrai signe moins), ±0', () => {
    expect(formatDelta(16)).toBe('+16');
    expect(formatDelta(-16)).toBe('−16');
    expect(formatDelta(0)).toBe('±0');
  });
});

describe('soleWinner', () => {
  test('le siège qui est seul en tête, sinon null (nulle, ex æquo en tête)', () => {
    expect(soleWinner({ ranking: [[1], [0]], reason: 'x' })).toBe(1);
    expect(soleWinner({ ranking: [[0, 1]], reason: 'x' })).toBeNull();
    expect(soleWinner({ ranking: [[2, 0], [1]], reason: 'x' })).toBeNull();
    expect(soleWinner(null)).toBeNull();
  });
});

describe('endText : comment la fin d\'une partie se dit', () => {
  const names = ['Alice', 'Bastien', 'Claire'];
  const result = (ranking: number[][], reason: string): GameResult => ({ ranking, reason });

  test('un abandon, un délai, un départ, à deux : celui qui sort, et celui qui gagne', () => {
    expect(endText(result([[1], [0]], 'resign'), names, null)).toBe('Alice abandonne. Bastien gagne.');
    expect(endText(result([[0], [1]], 'timeout'), names, null)).toBe('Bastien n\'a pas joué depuis 5 minutes. Alice gagne.');
    expect(endText(result([[1], [0]], 'disconnect'), names, null)).toBe('Alice a quitté le bureau. Bastien gagne.');
  });

  test('à plusieurs, on ne dit que celui qui sort (c\'est le dernier du classement)', () => {
    expect(endText(result([[1], [2], [0]], 'resign'), names, null)).toBe('Alice abandonne.');
  });

  test('la nulle par accord', () => {
    expect(endText(result([[0, 1]], 'agreement'), names, null)).toBe('Nulle par accord.');
  });

  test('une raison du jeu : c\'est le module du jeu qui la dit', () => {
    const own = (r: GameResult, who: string[]) => `Échec et mat : ${who[r.ranking[0]![0]!]} gagne.`;
    expect(endText(result([[1], [0]], 'checkmate'), names, own)).toBe('Échec et mat : Bastien gagne.');
  });

  test('une raison du jeu sans module : le vainqueur, ou la nulle', () => {
    expect(endText(result([[1], [0]], 'checkmate'), names, null)).toBe('Bastien gagne.');
    expect(endText(result([[0, 1]], 'stalemate'), names, null)).toBe('Match nul.');
    expect(endText(result([[0, 2], [1]], 'x'), names, null)).toBe('Alice et Claire gagnent.');
  });
});

describe('ratingLines', () => {
  test('les notes avant et après, avec l\'écart, dans l\'ordre des sièges', () => {
    const ended = match(['a', 'b'], {
      status: 'ended',
      ratings: [
        { userId: 'a', before: 1200, after: 1216 },
        { userId: 'b', before: 1200, after: 1184 },
      ],
    });
    expect(ratingLines(ended)).toEqual([
      { userId: 'a', name: 'A', before: 1200, after: 1216, delta: 16 },
      { userId: 'b', name: 'B', before: 1200, after: 1184, delta: -16 },
    ]);
  });

  test('sans notes (partie non classée, base en panne, partie en cours) : rien', () => {
    expect(ratingLines(match(['a', 'b']))).toEqual([]);
    expect(ratingLines(null)).toEqual([]);
  });
});
