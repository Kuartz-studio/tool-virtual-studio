import type { GameMatchView, GameResult, GameTableView } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { chairOf, countdownVisible, endText, formatClock, formatDelta, ratingLines, rematchAskers, rematchLine, seatOf, soleWinner } from './table-view';

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

describe('la revanche : la phrase de la barre, et qui la demande', () => {
  // Une table dont la partie est finie : les chaises (null : libre), et qui a accepté la revanche (est prêt).
  const after = (chairs: Array<string | null>, ready: string[] = []): GameTableView => {
    const view = table(chairs);
    return {
      ...view,
      chairs: view.chairs.map((chair) => chair && { ...chair, ready: ready.includes(chair.userId) }),
      match: match(chairs.flatMap((userId) => (userId ? [userId] : [])), { status: 'ended' }),
    };
  };

  test('personne ne l\'a acceptée : la règle, elle commence quand tout le monde l\'a acceptée', () => {
    expect(rematchLine(after(['a', 'b']), 'a', 2)).toBe('La revanche commence dès que tout le monde l\'a acceptée.');
  });

  test('je l\'ai demandée : qui on attend', () => {
    expect(rematchLine(after(['a', 'b'], ['a']), 'a', 2)).toBe('Revanche demandée : on attend B.');
    expect(rematchLine(after(['a', 'b', 'c'], ['a']), 'a', 2)).toBe('Revanche demandée : on attend B et C.');
  });

  test('un autre l\'a demandée : qui, et si l\'on n\'attend plus que moi', () => {
    expect(rematchLine(after(['a', 'b'], ['b']), 'a', 2)).toBe('B veut la revanche : on n\'attend plus que toi.');
    expect(rematchLine(after(['a', 'b', 'c'], ['b', 'c']), 'a', 2)).toBe('B et C veulent la revanche : on n\'attend plus que toi.');
    expect(rematchLine(after(['a', 'b', 'c', 'd'], ['b']), 'a', 2)).toBe('B veut la revanche. On attend encore C, D et toi.');
    expect(rematchLine(after(['a', 'b', 'c', 'd'], ['b', 'd']), 'a', 2)).toBe('B et D veulent la revanche. On attend encore C et toi.');
  });

  test('l\'autre s\'est levé : il faut assez de joueurs ; sans module, on ne le sait pas', () => {
    expect(rematchLine(after(['a', null], ['a']), 'a', 2)).toBe('Il faut 2 joueurs au moins pour commencer.');
    expect(rematchLine(after(['a', null], ['a']), 'a', null)).toBe('Tout le monde est prêt : la partie commence.');
  });

  test('qui demande la revanche à une personne assise qui ne l\'a pas encore acceptée ; personne d\'autre ne l\'apprend', () => {
    expect(rematchAskers(after(['a', 'b'], ['b']), 'a').map((chair) => chair.userId)).toEqual(['b']);
    expect(rematchAskers(after(['a', 'b', 'c'], ['b', 'c']), 'a').map((chair) => chair.userId)).toEqual(['b', 'c']);
    // Elle l'a déjà acceptée, personne ne l'a demandée, elle n'est pas assise, la partie n'est pas finie : personne.
    expect(rematchAskers(after(['a', 'b'], ['a', 'b']), 'a')).toEqual([]);
    expect(rematchAskers(after(['a', 'b']), 'a')).toEqual([]);
    expect(rematchAskers(after(['b', 'c'], ['b']), 'a')).toEqual([]);
    expect(rematchAskers({ ...after(['a', 'b'], ['b']), match: match(['a', 'b']) }, 'a')).toEqual([]);
    expect(rematchAskers(undefined, 'a')).toEqual([]);
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
