import { describe, expect, test } from 'vitest';
import { deepFreeze } from '../conformance';
import { pickIndex, rngFromDice, scriptedRng, seededRng, type Rng } from '../rng';
import { backgammon, maxPlayableSteps, nextSteps, previewSteps, type BackgammonMove, type BackgammonState, type BgPosition, type BgStep } from './index';
import { randomPosition, referenceTurn } from './reference';

// Le moteur contre une seconde implémentation naïve des règles d'un tour (`reference.ts`), sur des milliers de positions : celles que des parties au hasard traversent,
// et des positions tirées au hasard qui visent les cas rares (barre pleine, sortie avec des pions adverses dans la maison, points fermés). Pour chaque position : le
// nombre de dés à jouer, les positions finales des coups légaux, l'acceptation de chaque suite légale et le refus de chaque autre, les étapes proposées après un début
// de tour, et le tour passé quand rien ne se joue. Un désaccord montre la position, les dés et ce qui diffère.
// `JEUX_ORACLE=20000` en essaie vingt mille (commande à part) ; par défaut 1 500 positions tirées et 25 parties.
const SYNTHETIC = Number(process.env.JEUX_ORACLE ?? 1500);
const PLAYOUTS = Math.max(25, Math.round(SYNTHETIC / 60));
// Combien de suites on essaie par position : toutes quand il y en a peu, un échantillon sinon (un doublé en a des milliers).
const SAMPLE = 40;

const key = (position: BgPosition): string => JSON.stringify([position.points, position.bar, position.off]);
const stepKey = (step: BgStep): string => `${step.from}>${step.to}/${step.die}`;
const describePosition = (state: BackgammonState): string => `${JSON.stringify({ points: state.points, bar: state.bar, off: state.off, turn: state.turn, dice: state.dice })}`;

// Un échantillon sans remise, sans tout trier : on tire au hasard avec le générateur donné.
function sample<T>(list: readonly T[], size: number, unit: Rng): T[] {
  if (list.length <= size) return [...list];
  const pool = [...list];
  const picked: T[] = [];
  while (picked.length < size) picked.push(pool.splice(pickIndex(unit, pool.length), 1)[0]!);
  return picked;
}

// Compare le moteur et la référence sur une position en phase `move`. Rend les désaccords, un texte chacun.
function disagreements(state: BackgammonState, unit: Rng): string[] {
  const problems: string[] = [];
  const where = describePosition(state);
  const seat = state.turn;
  const reference = referenceTurn(state, seat, state.dice);

  if (maxPlayableSteps(state) !== reference.max) problems.push(`${where} : ${maxPlayableSteps(state)} dés à jouer, la référence dit ${reference.max}`);

  // Les coups légaux : une suite par position finale, et exactement les positions finales de la référence.
  const plays = backgammon.legalMoves(state, seat).filter((move): move is Extract<BackgammonMove, { type: 'play' }> => move.type === 'play');
  const engineFinals = plays.map((move) => {
    const after = previewSteps(state, move.steps);
    return after === null ? 'aperçu impossible' : key(after);
  });
  const referenceFinals = new Set(reference.legal.map((sequence) => key(sequence.final)));
  if (new Set(engineFinals).size !== engineFinals.length) problems.push(`${where} : deux coups légaux mènent à la même position`);
  if (new Set(engineFinals).size !== referenceFinals.size || engineFinals.some((final) => !referenceFinals.has(final))) {
    problems.push(`${where} : ${engineFinals.length} coups légaux (positions différentes : ${new Set(engineFinals).size}), la référence en voit ${referenceFinals.size}`);
  }

  // Chaque suite légale de la référence est acceptée et donne sa position ; chaque autre est refusée.
  for (const sequence of sample(reference.legal, SAMPLE, unit)) {
    const result = backgammon.apply(state, seat, { type: 'play', steps: sequence.steps }, scriptedRng([]));
    if (!result.ok) problems.push(`${where} : suite légale refusée (${result.error}) : ${JSON.stringify(sequence.steps)}`);
    else if (key(result.state) !== key(sequence.final)) problems.push(`${where} : suite légale ${JSON.stringify(sequence.steps)} : position différente de la référence`);
  }
  for (const sequence of sample(reference.rejected, SAMPLE, unit)) {
    if (backgammon.apply(state, seat, { type: 'play', steps: sequence.steps }, scriptedRng([])).ok) problems.push(`${where} : suite illégale acceptée : ${JSON.stringify(sequence.steps)}`);
  }

  // Les étapes proposées après un début de tour : celles des suites légales qui commencent par ces étapes-là.
  for (const sequence of sample(reference.legal, 6, unit)) {
    for (let done = 0; done <= sequence.steps.length; done++) {
      const prefix = sequence.steps.slice(0, done);
      const expected = new Set(
        reference.legal.filter((other) => other.steps.length > done && prefix.every((step, index) => stepKey(step) === stepKey(other.steps[index]!))).map((other) => stepKey(other.steps[done]!)),
      );
      const found = new Set(nextSteps(state, prefix).map(stepKey));
      if (expected.size !== found.size || [...expected].some((step) => !found.has(step))) {
        problems.push(`${where} : après ${JSON.stringify(prefix)}, nextSteps donne ${JSON.stringify([...found])} et la référence ${JSON.stringify([...expected])}`);
      }
    }
  }
  for (const sequence of sample(reference.rejected, 6, unit)) {
    const found = nextSteps(state, sequence.steps);
    const expected = new Set(
      reference.legal.filter((other) => other.steps.length > sequence.steps.length && sequence.steps.every((step, index) => stepKey(step) === stepKey(other.steps[index]!))).map((other) => stepKey(other.steps[sequence.steps.length]!)),
    );
    if (found.length !== expected.size || found.some((step) => !expected.has(stepKey(step)))) problems.push(`${where} : après la suite refusée ${JSON.stringify(sequence.steps)}, nextSteps donne ${JSON.stringify(found)}`);
  }
  return problems;
}

describe('backgammon : le moteur contre une seconde implémentation des règles d\'un tour', () => {
  test(`les positions que ${PLAYOUTS} parties au hasard traversent`, () => {
    const unit = seededRng(20261022);
    const problems: string[] = [];
    let positions = 0;
    for (let game = 0; game < PLAYOUTS && problems.length < 5; game++) {
      const dice = seededRng(1000 + game);
      let { state } = backgammon.create({ seats: 2, first: 0 }, dice);
      for (let step = 0; step < 2000 && state.phase !== 'over' && problems.length < 5; step++) {
        const frozen = deepFreeze(state);
        if (frozen.phase === 'move') {
          positions++;
          problems.push(...disagreements(frozen, unit));
        }
        const moves = backgammon.legalMoves(frozen, frozen.turn);
        const result = backgammon.apply(frozen, frozen.turn, moves[pickIndex(unit, moves.length)]!, dice);
        if (!result.ok) throw new Error(`coup légal refusé : ${result.error}`);
        state = result.state;
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(positions).toBeGreaterThan(PLAYOUTS * 20);
  }, 300_000);

  test(`${SYNTHETIC} positions tirées au hasard, dés compris (barre, sortie, points fermés)`, () => {
    const unit = seededRng(7_654_321);
    const problems: string[] = [];
    const seen = { passes: 0, bar: 0, bearOff: 0, doublets: 0, hits: 0, longest: 0 };
    for (let index = 0; index < SYNTHETIC && problems.length < 5; index++) {
      const position = randomPosition(unit);
      const seat = pickIndex(unit, 2) as 0 | 1;
      const dice: [number, number] = [1 + pickIndex(unit, 6), 1 + pickIndex(unit, 6)];
      const rolling: BackgammonState = deepFreeze({ ...position, turn: seat, phase: 'roll', dice: [], opening: [[2, 1]], turns: 0, last: null, result: null });
      expect(backgammon.invariants(rolling), `la position tirée doit être légale : ${JSON.stringify(position)}`).toEqual([]);
      const reference = referenceTurn(position, seat, dice);
      const rolled = backgammon.apply(rolling, seat, { type: 'roll' }, scriptedRng(rngFromDice(dice)));
      if (!rolled.ok) throw new Error(`lancer refusé : ${rolled.error}`);
      // Aucune étape possible : le lancer passe le tour tout seul ; sinon on est en phase `move`, avec les dés tirés.
      if (reference.max === 0) {
        seen.passes++;
        if (rolled.state.phase !== 'roll' || rolled.state.turn !== 1 - seat || !rolled.events.some((event) => event.type === 'pass')) {
          problems.push(`${describePosition({ ...rolling, dice })} : aucun coup possible, et le tour n'est pas passé`);
        }
        continue;
      }
      if (rolled.state.phase !== 'move' || rolled.events.some((event) => event.type === 'pass')) {
        problems.push(`${describePosition({ ...rolling, dice })} : ${reference.max} dés à jouer, et le tour est passé`);
        continue;
      }
      expect(rolled.state.dice).toEqual(dice);
      if (position.bar[seat] > 0) seen.bar++;
      if (dice[0] === dice[1]) seen.doublets++;
      if (position.off[seat] > 0 && position.bar[seat] === 0) seen.bearOff++;
      if (reference.legal.some((sequence) => sequence.final.bar[1 - seat] > position.bar[1 - seat])) seen.hits++;
      seen.longest = Math.max(seen.longest, reference.legal.length);
      problems.push(...disagreements(deepFreeze(rolled.state), unit));
    }
    expect(problems.slice(0, 5)).toEqual([]);
    // Le tirage a bien visé les cas rares : de la barre, des sorties, des doublés, des pions frappés, des tours passés.
    expect(seen.passes).toBeGreaterThan(0);
    expect(seen.bar).toBeGreaterThan(0);
    expect(seen.bearOff).toBeGreaterThan(0);
    expect(seen.doublets).toBeGreaterThan(0);
    expect(seen.hits).toBeGreaterThan(0);
  }, 300_000);
});
