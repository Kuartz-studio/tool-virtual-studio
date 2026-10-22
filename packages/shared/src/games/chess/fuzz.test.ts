import { describe, expect, test } from 'vitest';
import { MAX_STATE_BYTES, runGameConformance } from '../conformance';
import { pickIndex, type Rng } from '../rng';
import { chess, SQUARES, type ChessMove, type ChessState, type Promotion } from './index';
import { env } from './test-helpers';

// Le harnais de conformité du document des jeux (§ 11.2) contre les échecs : des parties au hasard, et à chaque pas les règles R1 à R10 (état gelé, aller-retour JSON,
// déterminisme, `invariants` vide, `turn` nul si et seulement si `result` ne l'est pas…), puis le rejeu de chaque partie depuis son journal. Cent parties dans
// `pnpm test` ; `JEUX_FUZZ=10000 pnpm vitest run packages/shared/src/games/chess/fuzz.test.ts` en joue dix mille (la durée est notée dans le rapport).
const GAMES = Number(env.JEUX_FUZZ ?? 100);

const PROMOTIONS: readonly Promotion[] = ['q', 'r', 'b', 'n'];

// Un coup sans doute illégal. Une fois sur deux, deux cases tirées au hasard (presque toujours absurdes) ; sinon un coup légal abîmé d'un cran : sa promotion ôtée,
// ajoutée ou changée, ou son arrivée décalée. Le jeu doit refuser, ou accepter un coup qui est en fait légal (le harnais le vérifie).
function illegal(state: unknown, rng: Rng): ChessMove {
  const chosen = chess.turn(state as ChessState);
  const legal = chosen === null ? [] : chess.legalMoves(state as ChessState, chosen);
  if (legal.length === 0 || rng() < 0.5) {
    const move: ChessMove = { from: SQUARES[pickIndex(rng, 64)]!, to: SQUARES[pickIndex(rng, 64)]! };
    if (rng() < 0.3) move.promotion = PROMOTIONS[pickIndex(rng, 4)]!;
    return move;
  }
  const base = legal[pickIndex(rng, legal.length)]!;
  const move: ChessMove = { from: base.from, to: base.to };
  switch (pickIndex(rng, 3)) {
    case 0:
      // La promotion change : oubliée si elle était obligatoire, ajoutée si le coup n'en avait pas, une autre pièce sinon.
      if (base.promotion === undefined) move.promotion = PROMOTIONS[pickIndex(rng, 4)]!;
      else if (rng() < 0.5) move.promotion = PROMOTIONS[(PROMOTIONS.indexOf(base.promotion) + 1) % 4]!;
      break;
    case 1:
      move.to = SQUARES[(SQUARES.indexOf(base.to) + 1 + pickIndex(rng, 7)) % 64]!;
      if (base.promotion !== undefined) move.promotion = base.promotion;
      break;
    default:
      move.from = SQUARES[(SQUARES.indexOf(base.from) + 1 + pickIndex(rng, 7)) % 64]!;
  }
  return move;
}

describe('parties au hasard (harnais de conformité)', () => {
  // Cent parties : 120 s. Pour un grand nombre, une seconde par partie : le test ne doit pas échouer parce qu'on a demandé beaucoup.
  test(`${GAMES} parties au hasard : aucun état illégal, toutes finies, rejouées à l'identique`, { timeout: Math.max(120_000, GAMES * 1000) }, () => {
    const report = runGameConformance(chess, { games: GAMES, seats: [2], maxActions: 12_000, drawRate: 0.01, illegal });
    expect(report.games).toBe(GAMES);
    expect(report.actions).toBeGreaterThan(GAMES * 10);
    // Le harnais l'aurait déjà refusé, mais on garde la mesure sous les yeux : R8, l'état part à tout le bureau à chaque coup.
    expect(report.biggestStateBytes).toBeLessThan(MAX_STATE_BYTES);
    expect(report.longest).toBeLessThan(12_000);
    console.info(`échecs : ${report.games} parties, ${report.actions} coups, la plus longue ${report.longest} actions, le plus gros état ${report.biggestStateBytes} octets`);
  });

  test('la même graine rejoue les mêmes parties', () => {
    const options = { games: 5, seats: [2], maxActions: 12_000, seed: 4242, illegal };
    expect(runGameConformance(chess, options)).toEqual(runGameConformance(chess, options));
  });
});
