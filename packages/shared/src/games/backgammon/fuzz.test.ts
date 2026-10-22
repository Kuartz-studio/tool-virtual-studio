import { describe, expect, test } from 'vitest';
import { runGameConformance } from '../conformance';
import { pickIndex, type Rng } from '../rng';
import { backgammon, checkersAt, DIE_SIDES, POINT_COUNT, type BackgammonMove, type BackgammonState, type BgStep } from './index';

// Des parties jouées au hasard contre le contrat entier (le harnais de conformité, § 11.2 du document des jeux) : à chaque pas, l'état est légal, tient dans JSON,
// n'est jamais modifié, `turn` est nul si et seulement si `result` ne l'est pas, les coups légaux passent le schéma et sont acceptés, un coup sans doute illégal est
// refusé ou donne la position d'un coup légal, et le journal de chaque partie, rejoué, redonne son état final.
// `JEUX_FUZZ=10000` en joue dix mille (commande à part, plusieurs minutes) ; `pnpm test` en joue 300.
const GAMES = Number(process.env.JEUX_FUZZ ?? 300);
// Le délai de ce test est celui de la plateforme (120 s) pour les 300 parties de tous les jours, plus 100 ms par partie au-delà : dix mille parties prennent environ
// 200 s sur une machine au repos, le délai leur en laisse largement plus quand elle est occupée.
const TIMEOUT_MS = 120_000 + Math.max(0, GAMES - 300) * 100;

// Un coup sans doute illégal, fabriqué à partir de l'état : un tour légal dont on a mélangé, raccourci ou faussé les étapes, ou des étapes tirées au hasard. La
// plupart sont refusées ; celles qui ne le sont pas (le même tour joué dans un autre ordre) doivent donner la position d'un coup légal.
function illegal(raw: unknown, rng: Rng): BackgammonMove {
  const state = raw as BackgammonState;
  const legal = backgammon.legalMoves(state, state.turn).filter((move): move is Extract<BackgammonMove, { type: 'play' }> => move.type === 'play');
  const anyStep = (): BgStep => {
    const seatOwns = [...Array(POINT_COUNT).keys()].map((index) => index + 1).filter((point) => checkersAt(state, state.turn, point).owner === state.turn);
    const from: BgStep['from'] = state.bar[state.turn] > 0 && pickIndex(rng, 2) === 0 ? 'bar' : (seatOwns[pickIndex(rng, Math.max(1, seatOwns.length))] ?? 1 + pickIndex(rng, POINT_COUNT));
    const die = state.dice.length > 0 && pickIndex(rng, 3) > 0 ? state.dice[pickIndex(rng, state.dice.length)]! : 1 + pickIndex(rng, DIE_SIDES);
    const to: BgStep['to'] = from === 'bar' ? POINT_COUNT + 1 - die : from - die >= 1 ? from - die : 'off';
    // Une fois sur cinq, une arrivée fausse.
    return { from, to: pickIndex(rng, 5) === 0 ? 1 + pickIndex(rng, POINT_COUNT) : to, die };
  };
  const mode = legal.length > 0 ? pickIndex(rng, 5) : 4;
  const base = legal.length > 0 ? legal[pickIndex(rng, legal.length)]!.steps.map((step) => ({ ...step })) : [];
  switch (mode) {
    case 0: {
      // Les étapes d'un tour légal, dans un autre ordre (Fisher-Yates avec le générateur donné).
      for (let index = base.length - 1; index > 0; index--) {
        const other = pickIndex(rng, index + 1);
        [base[index], base[other]] = [base[other]!, base[index]!];
      }
      return { type: 'play', steps: base };
    }
    case 1:
      // Un tour légal sans sa dernière étape : plus court que le maximum.
      return { type: 'play', steps: base.slice(0, -1) };
    case 2: {
      // Un tour légal dont une étape joue un autre dé.
      const steps = base.map((step) => ({ ...step }));
      const victim = steps[pickIndex(rng, steps.length)]!;
      victim.die = 1 + pickIndex(rng, DIE_SIDES);
      return { type: 'play', steps };
    }
    case 3:
      // Un `lancer` hors de sa phase, ou un tour légal rejoué avec une étape de trop.
      return pickIndex(rng, 2) === 0 ? { type: 'roll' } : { type: 'play', steps: [...base, anyStep()] };
    default:
      // N'importe quelles étapes, de une à quatre.
      return { type: 'play', steps: Array.from({ length: 1 + pickIndex(rng, 4) }, anyStep) };
  }
}

// Deux états « au même point » : le plateau, le trait, la phase, les dés et le résultat, sans le dernier tour (qui garde l'ordre des étapes, donc change quand
// on rejoue le même tour dans un autre ordre).
function sameOutcome(a: unknown, b: unknown): boolean {
  const pick = (state: BackgammonState) => JSON.stringify([state.points, state.bar, state.off, state.turn, state.phase, state.dice, state.result]);
  return pick(a as BackgammonState) === pick(b as BackgammonState);
}

describe('backgammon : parties au hasard', () => {
  test(`${GAMES} parties au hasard : l'état reste légal, toutes finissent, chaque journal rejoué redonne l'état final`, () => {
    const report = runGameConformance(backgammon, { games: GAMES, seats: [2], maxActions: 20_000, illegal, sameOutcome });
    expect(report.games).toBe(GAMES);
    // Un état de backgammon reste minuscule : bien en dessous des 50 ko que la plateforme tolère.
    expect(report.biggestStateBytes).toBeLessThan(5_000);
  }, TIMEOUT_MS);
});
