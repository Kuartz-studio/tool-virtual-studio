import { pickIndex, seededRng } from '@bureau/shared';
import { backgammon, backgammonStateFrom, nextSteps, STARTING_LAYOUT, type BackgammonLayout, type BackgammonMove, type BackgammonState, type BgStep } from '@bureau/shared/games/backgammon';
import { describe, expect, test } from 'vitest';
import { diceUsed, isTurnComplete, pickStep, sourcesOf, targetsFrom, turnKey } from './turn';

// Construire un tour pas à pas : ce que l'interface éclaire (les pions jouables, leurs arrivées), quelle étape un clic fait, quand le tour est complet, quel dé s'estompe. Tout
// se lit sur les aides du moteur (`nextSteps`, `previewSteps`) : ici on vérifie ce que l'interface en tire.

const position = (layout: BackgammonLayout): BackgammonState => backgammonStateFrom(layout);
const start = (dice: number[]): BackgammonState => position({ white: STARTING_LAYOUT, red: STARTING_LAYOUT, dice });
const step = (from: BgStep['from'], to: BgStep['to'], die: number): BgStep => ({ from, to, die });

describe('sourcesOf et targetsFrom : ce que l\'interface éclaire', () => {
  const steps = [step(13, 8, 5), step(13, 11, 2), step(8, 3, 5), step(8, 6, 2), step('bar', 20, 5), step(2, 'off', 5), step(2, 'off', 6)];

  test('les pions jouables : les départs des étapes proposées, sans doublon, dans l\'ordre', () => {
    expect(sourcesOf(steps)).toEqual([13, 8, 'bar', 2]);
    expect(sourcesOf([])).toEqual([]);
  });

  test('les arrivées d\'un pion : celles de ses étapes, sans doublon (deux dés qui sortent le même pion ne font qu\'une arrivée)', () => {
    expect(targetsFrom(steps, 13)).toEqual([8, 11]);
    expect(targetsFrom(steps, 'bar')).toEqual([20]);
    expect(targetsFrom(steps, 2)).toEqual(['off']);
    expect(targetsFrom(steps, 7)).toEqual([]);
  });

  test('l\'étape d\'un clic : celle qui va de ce départ à cette arrivée ; avec deux dés possibles, le plus petit (le plus grand reste pour un autre pion)', () => {
    expect(pickStep(steps, 13, 11)).toEqual(step(13, 11, 2));
    expect(pickStep(steps, 2, 'off')).toEqual(step(2, 'off', 5));
    expect(pickStep([step(2, 'off', 6), step(2, 'off', 4)], 2, 'off')).toEqual(step(2, 'off', 4));
    expect(pickStep(steps, 13, 3)).toBeNull();
    expect(pickStep(steps, 9, 8)).toBeNull();
  });
});

describe('isTurnComplete : le tour est complet quand on a joué autant de dés qu\'il faut', () => {
  test('deux dés : après deux étapes ; un doublé : après quatre', () => {
    const state = start([6, 1]);
    expect(isTurnComplete(state, [])).toBe(false);
    expect(isTurnComplete(state, [step(13, 7, 6)])).toBe(false);
    expect(isTurnComplete(state, [step(13, 7, 6), step(8, 7, 1)])).toBe(true);
    const doublet = start([6, 6]);
    expect(isTurnComplete(doublet, [step(24, 18, 6), step(24, 18, 6), step(13, 7, 6)])).toBe(false);
    expect(isTurnComplete(doublet, [step(24, 18, 6), step(24, 18, 6), step(13, 7, 6), step(13, 7, 6)])).toBe(true);
  });

  test('quand un seul dé se joue, le tour est complet après une étape ; hors de la phase `move`, il ne l\'est jamais', () => {
    const one = position({ white: { 9: 1 }, whiteOff: 14, red: { 24: 2, 6: 13 }, dice: [6, 2] });
    expect(isTurnComplete(one, [step(9, 3, 6)])).toBe(true);
    expect(isTurnComplete(position({ white: STARTING_LAYOUT, red: STARTING_LAYOUT }), [])).toBe(false);
  });
});

describe('diceUsed : quel dé s\'estompe', () => {
  test('deux dés différents : celui dont la valeur vient d\'être jouée, dans l\'ordre où ils sont posés', () => {
    const state = start([2, 5]);
    expect(diceUsed(state, [])).toEqual([false, false]);
    expect(diceUsed(state, [step(13, 8, 5)])).toEqual([false, true]);
    expect(diceUsed(state, [step(13, 8, 5), step(13, 11, 2)])).toEqual([true, true]);
  });

  test('un doublé : chaque dé affiché vaut deux étapes, le premier s\'estompe après deux, le second après quatre', () => {
    const state = start([6, 6]);
    const played = [step(24, 18, 6), step(24, 18, 6), step(13, 7, 6), step(13, 7, 6)];
    expect(diceUsed(state, played.slice(0, 1))).toEqual([false, false]);
    expect(diceUsed(state, played.slice(0, 2))).toEqual([true, false]);
    expect(diceUsed(state, played.slice(0, 3))).toEqual([true, false]);
    expect(diceUsed(state, played)).toEqual([true, true]);
  });
});

describe('turnKey : ce qui change quand le serveur répond', () => {
  test('la clé change avec le trait, la phase, les dés et les tours joués, pas avec le dernier tour', () => {
    const state = start([3, 1]);
    expect(turnKey(state)).toBe(turnKey({ ...state, last: { seat: 1, dice: [1, 2], steps: [] } }));
    expect(turnKey(state)).not.toBe(turnKey({ ...state, dice: [3, 2] }));
    expect(turnKey(state)).not.toBe(turnKey({ ...state, turns: 1 }));
    expect(turnKey(state)).not.toBe(turnKey({ ...state, phase: 'roll', dice: [] }));
    expect(turnKey(state)).not.toBe(turnKey({ ...state, turn: 1 }));
  });
});

describe('construire un tour avec ces aides, c\'est toujours un tour que le moteur accepte', () => {
  test('des parties au hasard : à chaque tour, on choisit un pion jouable, une arrivée, on pose l\'étape, jusqu\'à ce que le tour soit complet ; le moteur l\'accepte', () => {
    const choice = seededRng(31);
    let built = 0;
    for (let game = 0; game < 25; game++) {
      const dice = seededRng(900 + game);
      let state = backgammon.create({ seats: 2, first: 0 }, dice).state;
      for (let guard = 0; guard < 1500 && state.phase !== 'over'; guard++) {
        let move: BackgammonMove;
        if (state.phase === 'roll') move = { type: 'roll' };
        else {
          const done: BgStep[] = [];
          while (!isTurnComplete(state, done)) {
            const available = nextSteps(state, done);
            expect(available.length, `aucune étape alors que le tour n'est pas complet (partie ${game})`).toBeGreaterThan(0);
            const sources = sourcesOf(available);
            const from = sources[pickIndex(choice, sources.length)]!;
            const targets = targetsFrom(available, from);
            const to = targets[pickIndex(choice, targets.length)]!;
            const picked = pickStep(available, from, to);
            expect(picked).not.toBeNull();
            done.push(picked!);
          }
          move = { type: 'play', steps: done };
          built++;
        }
        const result = backgammon.apply(state, state.turn, move, dice);
        expect(result.ok, `le moteur refuse un tour construit par l'interface : ${JSON.stringify(move)}`).toBe(true);
        if (!result.ok) return;
        state = result.state;
      }
    }
    expect(built).toBeGreaterThan(500);
  });
});
