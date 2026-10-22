import { describe, expect, test } from 'vitest';
import { ELO_K, ELO_K_NEW, ELO_K_NEW_GAMES, ELO_START, eloChanges, expectedScore, kFactor, roundHalfAwayFromZero } from './elo';

// Les notes d'après une partie, dans l'ordre des joueurs. `games` : combien de parties classées chacun a déjà jouées à ce jeu.
function after(players: Array<{ rating: number; games?: number }>, ranking: number[][]): number[] {
  return eloChanges(
    players.map((player, i) => ({ userId: `u${i}`, rating: player.rating, games: player.games ?? 0 })),
    ranking,
  ).map((change) => change.after);
}

describe('les réglages', () => {
  test('départ à 1200, K 32 puis 20 après 30 parties', () => {
    expect(ELO_START).toBe(1200);
    expect(ELO_K_NEW).toBe(32);
    expect(ELO_K).toBe(20);
    expect(ELO_K_NEW_GAMES).toBe(30);
  });

  test('kFactor(29) = 32, kFactor(30) = 20', () => {
    expect(kFactor(0)).toBe(32);
    expect(kFactor(29)).toBe(32);
    expect(kFactor(30)).toBe(20);
    expect(kFactor(400)).toBe(20);
  });
});

describe('expectedScore', () => {
  test('à égalité, 0,5 ; l\'attendu des deux joueurs fait 1', () => {
    expect(expectedScore(1200, 1200)).toBe(0.5);
    expect(expectedScore(1400, 1200) + expectedScore(1200, 1400)).toBeCloseTo(1, 12);
  });

  test('200 points d\'avance : 0,7597', () => {
    expect(expectedScore(1400, 1200)).toBeCloseTo(0.7597, 4);
  });
});

describe('roundHalfAwayFromZero', () => {
  test('la moitié va loin de zéro, des deux côtés (Math.round ramènerait −15,5 à −15)', () => {
    expect(roundHalfAwayFromZero(15.5)).toBe(16);
    expect(roundHalfAwayFromZero(-15.5)).toBe(-16);
  });

  test('sinon l\'entier le plus proche', () => {
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
    expect(roundHalfAwayFromZero(-2.4)).toBe(-2);
    expect(roundHalfAwayFromZero(2.6)).toBe(3);
    expect(roundHalfAwayFromZero(-2.6)).toBe(-3);
    expect(Object.is(roundHalfAwayFromZero(0.2), 0)).toBe(true);
  });
});

describe('eloChanges : le tableau du document des jeux (§ 6.3)', () => {
  test('P1 victoire à égalité, K 32 : 1216 et 1184', () => {
    expect(after([{ rating: 1200 }, { rating: 1200 }], [[0], [1]])).toEqual([1216, 1184]);
  });

  test('P2 nulle à égalité : personne ne bouge', () => {
    expect(after([{ rating: 1200 }, { rating: 1200 }], [[0, 1]])).toEqual([1200, 1200]);
  });

  test('P3 le favori gagne (attendu 0,7597) : 1408 et 1192', () => {
    expect(after([{ rating: 1400 }, { rating: 1200 }], [[0], [1]])).toEqual([1408, 1192]);
  });

  test('P4 l\'outsider gagne : 1376 et 1224', () => {
    expect(after([{ rating: 1400 }, { rating: 1200 }], [[1], [0]])).toEqual([1376, 1224]);
  });

  test('P5 chacun son K (40 parties contre aucune) : 1210 et 1184', () => {
    expect(after([{ rating: 1200, games: 40 }, { rating: 1200, games: 0 }], [[0], [1]])).toEqual([1210, 1184]);
  });

  test('P6 à trois, K 32 : 1216, 1200 et 1184', () => {
    expect(after([{ rating: 1200 }, { rating: 1200 }, { rating: 1200 }], [[0], [1], [2]])).toEqual([1216, 1200, 1184]);
  });

  test('P7 à quatre, K 32 (comparaison par paires, K/3) : 1216, 1205, 1195 et 1184', () => {
    const four = [{ rating: 1200 }, { rating: 1200 }, { rating: 1200 }, { rating: 1200 }];
    expect(after(four, [[0], [1], [2], [3]])).toEqual([1216, 1205, 1195, 1184]);
  });

  test('à quatre avec deux ex æquo au milieu : 1216, 1200, 1200 et 1184', () => {
    const four = [{ rating: 1200 }, { rating: 1200 }, { rating: 1200 }, { rating: 1200 }];
    expect(after(four, [[0], [1, 2], [3]])).toEqual([1216, 1200, 1200, 1184]);
  });

  test('un classement donne les sièges dans n\'importe quel ordre de groupe : le premier groupe est le meilleur, quel que soit l\'indice', () => {
    expect(after([{ rating: 1200 }, { rating: 1200 }, { rating: 1200 }], [[2], [0], [1]])).toEqual([1200, 1184, 1216]);
  });

  test('à deux et à K égal, ce que l\'un gagne l\'autre le perd', () => {
    for (const [a, b] of [[1200, 1200], [1500, 1100], [1000, 1337], [1800, 1802]] as const) {
      const [winner, loser] = after([{ rating: a }, { rating: b }], [[0], [1]]);
      expect(winner! - a).toBe(b - loser!);
    }
  });

  test('chaque changement garde l\'identifiant du joueur et sa note d\'avant', () => {
    const changes = eloChanges(
      [
        { userId: 'alice', rating: 1250, games: 3 },
        { userId: 'bastien', rating: 1180, games: 31 },
      ],
      [[1], [0]],
    );
    expect(changes.map(({ userId, before }) => ({ userId, before }))).toEqual([
      { userId: 'alice', before: 1250 },
      { userId: 'bastien', before: 1180 },
    ]);
    expect(changes[1]!.after).toBeGreaterThan(1180);
    expect(changes[0]!.after).toBeLessThan(1250);
  });

  test('un seul joueur : sa note ne change pas', () => {
    expect(eloChanges([{ userId: 'seul', rating: 1300, games: 5 }], [[0]])).toEqual([{ userId: 'seul', before: 1300, after: 1300 }]);
  });

  test('un classement qui oublie un joueur lève une erreur : il ne faut jamais écrire un classement faux', () => {
    expect(() => after([{ rating: 1200 }, { rating: 1200 }], [[0]])).toThrow(/ne contient pas/);
  });
});
