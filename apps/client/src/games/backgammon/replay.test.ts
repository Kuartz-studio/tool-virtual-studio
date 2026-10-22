import { pickIndex, seededRng } from '@bureau/shared';
import { backgammon, backgammonStateFrom, STARTING_LAYOUT, type BackgammonEvent, type BgPosition } from '@bureau/shared/games/backgammon';
import { describe, expect, test } from 'vitest';
import { applyStepEvent, stepEvents, undoStepEvents } from './replay';

// Rejouer le tour de l'adversaire pion par pion : on part de la position d'avant (celle de l'état final, dont on défait les étapes des événements), puis on refait une étape à la fois.
// Les événements disent d'où, vers où, avec quel dé, et si un pion a été frappé : c'est assez pour défaire comme pour refaire.

type StepEvent = Extract<BackgammonEvent, { type: 'step' }>;
const board = (where: BgPosition): BgPosition => ({ points: where.points, bar: where.bar, off: where.off });
const stepEvent = (seat: 0 | 1, from: StepEvent['from'], to: StepEvent['to'], die: number, hit = false): StepEvent => ({ type: 'step', seat, from, to, die, hit });

describe('stepEvents : les étapes d\'un lot d\'événements', () => {
  test('seulement les événements d\'étape, dans l\'ordre ; ceux d\'un siège donné avec `seat`', () => {
    const events: BackgammonEvent[] = [
      { type: 'dice', seat: 0, values: [5, 2] },
      stepEvent(0, 13, 8, 5),
      { type: 'pass', seat: 1 },
      stepEvent(1, 8, 6, 2),
    ];
    expect(stepEvents(events)).toHaveLength(2);
    expect(stepEvents(events, 1)).toEqual([stepEvent(1, 8, 6, 2)]);
    expect(stepEvents(events, 0)).toEqual([stepEvent(0, 13, 8, 5)]);
    expect(stepEvents([])).toEqual([]);
  });
});

describe('applyStepEvent : une étape de plus sur la position', () => {
  const start = board(backgammonStateFrom({ white: STARTING_LAYOUT, red: STARTING_LAYOUT }));

  test('un pion des Blancs va du point 13 au point 8 : un de moins sur le 13, un de plus sur le 8', () => {
    const after = applyStepEvent(start, stepEvent(0, 13, 8, 5));
    expect(after.points[12]).toBe(4);
    expect(after.points[7]).toBe(4);
    // La position de départ n'est pas modifiée.
    expect(start.points[12]).toBe(5);
  });

  test('un pion des Rouges va de son point 13 à son point 8 : leurs points sont comptés depuis leur maison', () => {
    const after = applyStepEvent(start, stepEvent(1, 13, 8, 5));
    expect(after.points[11]).toBe(-4);
    expect(after.points[16]).toBe(-4);
  });

  test('un pion frappé : celui de l\'autre camp part sur la barre, et le pion qui frappe prend le point', () => {
    const before = board(backgammonStateFrom({ white: { 13: 15 }, red: { 17: 1, 6: 14 } }));
    const after = applyStepEvent(before, stepEvent(0, 13, 8, 5, true));
    expect(after.bar).toEqual([0, 1]);
    expect(after.points[7]).toBe(1);
  });

  test('un pion qui entre depuis la barre, et un pion qui sort', () => {
    const entering = board(backgammonStateFrom({ white: { 6: 14 }, whiteBar: 1, red: { 6: 15 } }));
    const entered = applyStepEvent(entering, stepEvent(0, 'bar', 20, 5));
    expect(entered.bar).toEqual([0, 0]);
    expect(entered.points[19]).toBe(1);
    const bearing = board(backgammonStateFrom({ white: { 3: 1 }, whiteOff: 14, red: { 6: 15 } }));
    const out = applyStepEvent(bearing, stepEvent(0, 3, 'off', 3));
    expect(out.off).toEqual([15, 0]);
    expect(out.points[2]).toBe(0);
  });

  test('jamais de -0 : un point qui se vide vaut 0', () => {
    const before = board(backgammonStateFrom({ white: { 3: 1 }, whiteOff: 14, red: { 6: 15 } }));
    const after = applyStepEvent(before, stepEvent(0, 3, 'off', 3));
    expect(after.points.some((count) => Object.is(count, -0))).toBe(false);
    const red = board(backgammonStateFrom({ red: { 3: 1 }, redOff: 14, white: { 6: 15 } }));
    expect(applyStepEvent(red, stepEvent(1, 3, 'off', 3)).points.some((count) => Object.is(count, -0))).toBe(false);
  });
});

describe('undoStepEvents : la position d\'avant un tour, retrouvée depuis celle d\'après', () => {
  test('refaire les étapes défaites redonne la position d\'après, pour les tours de parties au hasard (pions frappés, barre, sorties comprises)', () => {
    const choice = seededRng(77);
    let checked = 0;
    let hits = 0;
    let entries = 0;
    let outs = 0;
    for (let game = 0; game < 40; game++) {
      const dice = seededRng(300 + game);
      let state = backgammon.create({ seats: 2, first: 0 }, dice).state;
      for (let guard = 0; guard < 1500 && state.phase !== 'over'; guard++) {
        const moves = backgammon.legalMoves(state, state.turn);
        const result = backgammon.apply(state, state.turn, moves[pickIndex(choice, moves.length)]!, dice);
        if (!result.ok) throw new Error(result.error);
        const steps = stepEvents(result.events);
        if (steps.length > 0) {
          const after = board(result.state);
          const before = undoStepEvents(after, steps);
          // Défaire les étapes redonne la position d'avant le tour.
          expect(before).toEqual(board(state));
          // Les refaire une à une redonne celle d'après.
          expect(steps.reduce(applyStepEvent, before)).toEqual(after);
          checked++;
          hits += steps.filter((event) => event.hit).length;
          entries += steps.filter((event) => event.from === 'bar').length;
          outs += steps.filter((event) => event.to === 'off').length;
        }
        state = result.state;
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(hits).toBeGreaterThan(50);
    expect(entries).toBeGreaterThan(20);
    expect(outs).toBeGreaterThan(100);
  });
});
