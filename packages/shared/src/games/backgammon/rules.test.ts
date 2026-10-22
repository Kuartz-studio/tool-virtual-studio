import { describe, expect, test } from 'vitest';
import { deepFreeze } from '../conformance';
import { rngFromDice, scriptedRng } from '../rng';
import {
  backgammon,
  backgammonStateFrom,
  nextSteps,
  pipCount,
  previewSteps,
  STARTING_LAYOUT,
  type BackgammonLayout,
  type BackgammonMove,
  type BackgammonState,
  type BgPosition,
  type BgStep,
} from './index';

// Les cas nommés C1 à C27 du document des jeux (§ 14.5), un test par cas, son numéro en tête du titre. Les positions s'écrivent comme dans le document, dans la
// numérotation de chaque joueur : « Blancs {9: 1}, sortis 14 » est un pion blanc sur le point 9 des Blancs et quatorze sortis. Sauf mention, les Blancs (siège 0)
// ont le trait, en phase `move`, avec les dés indiqués.

type Play = Extract<BackgammonMove, { type: 'play' }>;
type StepSpec = [from: number | 'bar', to: number | 'off', die: number];

// Un coup `play` écrit en raccourci : play([13, 8, 5], [8, 3, 5]).
const play = (...specs: StepSpec[]): Play => ({ type: 'play', steps: specs.map(([from, to, die]): BgStep => ({ from, to, die })) });
const isPlay = (move: BackgammonMove): move is Play => move.type === 'play';

// Un état gelé : une fonction du moteur qui le modifierait lèverait une erreur.
const position = (layout: BackgammonLayout): BackgammonState => deepFreeze(backgammonStateFrom(layout));
const start = (dice?: number[]): BackgammonState => position({ white: STARTING_LAYOUT, red: STARTING_LAYOUT, ...(dice ? { dice } : {}) });

// Un `play` ne tire aucun dé : ce générateur lève si le moteur en demande un.
const noDraw = scriptedRng([]);
const plays = (state: BackgammonState, seat = 0): Play[] => backgammon.legalMoves(state, seat).filter(isPlay);
// Une liste de coups ou d'étapes comparée sans tenir compte de l'ordre.
const canon = (list: readonly unknown[]): string[] => list.map((item) => JSON.stringify(item)).sort();
const board = (where: BgPosition): BgPosition => ({ points: where.points, bar: where.bar, off: where.off });
// Le plateau (points, barre, sorties) qu'un coup légal laisse.
const finalBoard = (state: BackgammonState, move: Play): BgPosition => board(previewSteps(state, move.steps)!);
// Combien de positions finales différentes les coups légaux laissent.
const finals = (state: BackgammonState): number => new Set(plays(state).map((move) => JSON.stringify(finalBoard(state, move)))).size;

// Joue un coup que le moteur doit accepter, et rend son résultat.
function played(state: BackgammonState, move: BackgammonMove, seat = 0, draws: number[] = []) {
  const result = backgammon.apply(state, seat, move, scriptedRng(draws));
  if (!result.ok) throw new Error(`coup refusé (${result.error}) : ${JSON.stringify(move)}`);
  return result;
}
const refused = (state: BackgammonState, move: BackgammonMove, seat = 0): boolean => !backgammon.apply(state, seat, move, noDraw).ok;

describe('backgammon : les cas nommés du document (§ 14.5)', () => {
  test('C1 : create pose les pions de départ, la barre et les sorties vides, une course de 167 pour chacun', () => {
    const { state } = backgammon.create({ seats: 2, first: 0 }, scriptedRng(rngFromDice([4, 2])));
    expect(state.points).toEqual([-2, 0, 0, 0, 0, 5, 0, 3, 0, 0, 0, -5, 5, 0, 0, 0, -3, 0, -5, 0, 0, 0, 0, 2]);
    expect(state.bar).toEqual([0, 0]);
    expect(state.off).toEqual([0, 0]);
    expect(pipCount(state, 0)).toBe(167);
    expect(pipCount(state, 1)).toBe(167);
  });

  test('C2 : l\'ouverture relance les égalités ; le plus haut commence avec ces deux dés, sans nouveau lancer', () => {
    // `first: 1` est donné exprès : l'ouverture décide seule, `first` est ignoré.
    const { state, events } = backgammon.create({ seats: 2, first: 1 }, scriptedRng(rngFromDice([3, 3, 5, 2])));
    expect(state.opening).toEqual([[3, 3], [5, 2]]);
    expect(state).toMatchObject({ turn: 0, phase: 'move', dice: [5, 2], turns: 0, last: null, result: null });
    expect(events).toEqual([{ type: 'opening', rolls: [[3, 3], [5, 2]], first: 0 }]);
    expect(backgammon.turn(state)).toBe(0);

    // Le siège 1 l'emporte : il commence, avec les dés dans l'ordre du lancer (dé du siège 0, dé du siège 1).
    const second = backgammon.create({ seats: 2, first: 0 }, scriptedRng(rngFromDice([2, 5])));
    expect(second.state).toMatchObject({ turn: 1, phase: 'move', dice: [2, 5], opening: [[2, 5]] });
    expect(second.events).toEqual([{ type: 'opening', rolls: [[2, 5]], first: 1 }]);
  });

  test('C3 : départ, dés 6-6 : 11 positions finales différentes, chaque coup a quatre étapes', () => {
    const state = start([6, 6]);
    expect(plays(state).length).toBe(11);
    expect(plays(state).every((move) => move.steps.length === 4)).toBe(true);
    expect(finals(state)).toBe(11);
  });

  test('C4 : départ, dés 3-1, 2-1 et 6-5 : 16, 15 et 7 positions finales différentes, aucune suite à un seul dé', () => {
    for (const [dice, count] of [[[3, 1], 16], [[2, 1], 15], [[6, 5], 7]] as const) {
      const state = start([...dice]);
      expect(finals(state), `dés ${dice.join('-')}`).toBe(count);
      expect(plays(state).every((move) => move.steps.length === 2), `dés ${dice.join('-')}`).toBe(true);
    }
  });

  test('C5 : départ, dés 6-5 : une seule étape (24→18) est refusée, les deux dés se jouent', () => {
    const state = start([6, 5]);
    expect(refused(state, play([24, 18, 6]))).toBe(true);
    expect(refused(state, play([13, 8, 5]))).toBe(true);
    expect(backgammon.apply(state, 0, play([24, 18, 6], [18, 13, 5]), noDraw).ok).toBe(true);
  });

  test('C6 : deux dés dont un seul se joue : le plus grand (9→3 avec le 6) ; 9→7 avec le 2 est refusé', () => {
    const state = position({ white: { 9: 1 }, whiteOff: 14, red: { 24: 2, 6: 13 }, dice: [6, 2] });
    expect(plays(state)).toEqual([play([9, 3, 6])]);
    expect(refused(state, play([9, 7, 2]))).toBe(true);
    expect(played(state, play([9, 3, 6])).state.points[2]).toBe(1);
  });

  test('C7 : si le plus grand dé ne se joue pas, c\'est l\'autre : 9→7 avec le 2', () => {
    const state = position({ white: { 9: 1 }, whiteOff: 14, red: { 22: 2, 24: 2, 6: 11 }, dice: [6, 2] });
    expect(plays(state)).toEqual([play([9, 7, 2])]);
    expect(refused(state, play([9, 3, 6]))).toBe(true);
  });

  test('C8 : un doublé se joue autant que possible : un seul des quatre 5 (13→8)', () => {
    const state = position({ white: { 13: 1 }, whiteOff: 14, red: { 22: 2, 6: 13 }, dice: [5, 5] });
    expect(plays(state)).toEqual([play([13, 8, 5])]);
    expect(refused(state, play([13, 8, 5], [8, 3, 5]))).toBe(true);
  });

  test('C9 : un doublé, trois 5 (13→8, 8→3, 3→sortie) : victoire, gammon', () => {
    const state = position({ white: { 13: 1 }, whiteOff: 14, red: { 6: 15 }, dice: [5, 5] });
    const winning = play([13, 8, 5], [8, 3, 5], [3, 'off', 5]);
    expect(plays(state)).toEqual([winning]);
    const { state: ended, events } = played(state, winning);
    expect(backgammon.result(ended)).toEqual({ ranking: [[0], [1]], reason: 'bearoff', detail: { kind: 'gammon' } });
    expect(backgammon.turn(ended)).toBeNull();
    expect(ended.off).toEqual([15, 0]);
    expect(events.at(-1)).toEqual({ type: 'end', winner: 0, kind: 'gammon' });
    expect(backgammon.legalMoves(ended, 0)).toEqual([]);
    expect(backgammon.legalMoves(ended, 1)).toEqual([]);
  });

  test('C10 : comme C9, avec un pion rouge dans la maison des Blancs : backgammon', () => {
    const state = position({ white: { 13: 1 }, whiteOff: 14, red: { 24: 1, 6: 14 }, dice: [5, 5] });
    const { state: ended, events } = played(state, play([13, 8, 5], [8, 3, 5], [3, 'off', 5]));
    expect(backgammon.result(ended)?.detail).toEqual({ kind: 'backgammon' });
    expect(events.at(-1)).toEqual({ type: 'end', winner: 0, kind: 'backgammon' });
  });

  test('C11 : comme C9, avec un pion rouge déjà sorti : victoire simple', () => {
    const state = position({ white: { 13: 1 }, whiteOff: 14, red: { 6: 14 }, redOff: 1, dice: [5, 5] });
    const { state: ended, events } = played(state, play([13, 8, 5], [8, 3, 5], [3, 'off', 5]));
    expect(backgammon.result(ended)).toEqual({ ranking: [[0], [1]], reason: 'bearoff', detail: { kind: 'simple' } });
    expect(events.at(-1)).toEqual({ type: 'end', winner: 0, kind: 'simple' });
  });

  test('C12 : un pion sur la barre entre d\'abord : exactement trois coups, barre→24 puis 24→18, 13→7 ou 8→2', () => {
    const state = position({ white: { 6: 5, 8: 3, 13: 5, 24: 1 }, whiteBar: 1, red: { 6: 5, 8: 3, 13: 5, 24: 2 }, dice: [6, 1] });
    expect(canon(plays(state))).toEqual(canon([
      play(['bar', 24, 1], [24, 18, 6]),
      play(['bar', 24, 1], [13, 7, 6]),
      play(['bar', 24, 1], [8, 2, 6]),
    ]));
    // Une suite qui ne commence pas par la barre est refusée, même si chaque étape serait légale seule.
    expect(refused(state, play([13, 7, 6], ['bar', 24, 1]))).toBe(true);
    expect(refused(state, play([8, 2, 6], ['bar', 24, 1]))).toBe(true);
    expect(refused(state, play([13, 7, 6], [8, 7, 1]))).toBe(true);
  });

  test('C13 : même position en phase `roll`, dés 6-6 : la barre ne peut pas entrer, le tour passe aux Rouges', () => {
    const state = position({ white: { 6: 5, 8: 3, 13: 5, 24: 1 }, whiteBar: 1, red: { 6: 5, 8: 3, 13: 5, 24: 2 } });
    expect(state.phase).toBe('roll');
    expect(plays(state)).toEqual([]);
    expect(backgammon.legalMoves(state, 0)).toEqual([{ type: 'roll' }]);
    const { state: next, events } = played(state, { type: 'roll' }, 0, rngFromDice([6, 6]));
    expect(events).toEqual([{ type: 'dice', seat: 0, values: [6, 6] }, { type: 'pass', seat: 0 }]);
    expect(next).toMatchObject({ turn: 1, phase: 'roll', dice: [], turns: 0 });
    expect(next.points).toEqual(state.points);
    expect(backgammon.legalMoves(next, 1)).toEqual([{ type: 'roll' }]);
    expect(backgammon.countedMoves(next)).toBe(0);
  });

  test('C14 : deux pions sur la barre, un seul peut entrer : barre→24 avec le 1, le 6 est bloqué', () => {
    const state = position({ white: { 6: 5, 8: 3, 13: 5 }, whiteBar: 2, red: { 6: 5, 8: 3, 13: 5, 24: 2 }, dice: [6, 1] });
    expect(plays(state)).toEqual([play(['bar', 24, 1])]);
    expect(played(state, play(['bar', 24, 1])).state.bar).toEqual([1, 0]);
  });

  test('C15 : un pion rouge seul sur l\'arrivée est frappé : il part sur la barre', () => {
    const state = position({ white: { 13: 15 }, red: { 17: 1, 6: 14 }, dice: [5, 1] });
    const { state: next, events } = played(state, play([13, 8, 5], [13, 12, 1]));
    expect(events[0]).toEqual({ type: 'step', seat: 0, from: 13, to: 8, die: 5, hit: true });
    expect(events[1]).toEqual({ type: 'step', seat: 0, from: 13, to: 12, die: 1, hit: false });
    expect(next.bar).toEqual([0, 1]);
    // Le point 8 des Blancs porte un pion blanc, et le point 17 des Rouges n'a plus de pion rouge.
    expect(next.points[7]).toBe(1);
    expect(next.points.filter((count) => count < 0).reduce((total, count) => total - count, 0)).toBe(14);
  });

  test('C16 : deux pions rouges bloquent le point : aucune étape 13→8', () => {
    const state = position({ white: { 13: 15 }, red: { 17: 2, 6: 13 }, dice: [5, 1] });
    expect(nextSteps(state, []).some((step) => step.to === 8)).toBe(false);
    expect(plays(state).flatMap((move) => move.steps).some((step) => step.to === 8)).toBe(false);
    expect(refused(state, play([13, 8, 5], [13, 12, 1]))).toBe(true);
    // Le 5 ne se joue qu'après le 1 (13→12, puis 12→7).
    expect(plays(state)).toEqual([play([13, 12, 1], [12, 7, 5])]);
  });

  test('C17 : aucun coup possible après le lancer : pass, le tour passe tout seul', () => {
    const state = position({ white: { 13: 1 }, whiteOff: 14, red: { 17: 2, 15: 2, 6: 11 } });
    const { state: next, events } = played(state, { type: 'roll' }, 0, rngFromDice([5, 3]));
    expect(events).toEqual([{ type: 'dice', seat: 0, values: [5, 3] }, { type: 'pass', seat: 0 }]);
    expect(next).toMatchObject({ turn: 1, phase: 'roll', dice: [], turns: 0 });
    expect(next.last).toEqual({ seat: 0, dice: [5, 3], steps: [] });
  });

  test('C18 : un seul ordre possible : 13→10 avec le 3, puis 10→5 avec le 5 (le 5 est bloqué au départ)', () => {
    const state = position({ white: { 13: 1 }, whiteOff: 14, red: { 17: 2, 6: 13 }, dice: [5, 3] });
    expect(plays(state)).toEqual([play([13, 10, 3], [10, 5, 5])]);
    expect(refused(state, play([13, 8, 5], [8, 5, 3]))).toBe(true);
  });

  test('C19 : en sortant, un dé ne sort un pion plus bas que s\'il n\'y en a pas de plus haut : deux positions finales', () => {
    const state = position({ white: { 6: 1, 3: 1 }, whiteOff: 13, red: { 6: 15 }, dice: [4, 1] });
    expect(plays(state).flatMap((move) => move.steps).some((step) => step.from === 3 && step.to === 'off' && step.die === 4)).toBe(false);
    const finalsFound = canon(plays(state).map((move) => finalBoard(state, move)));
    const whiteFinals: Array<Record<number, number>> = [{ 3: 1, 1: 1 }, { 2: 2 }];
    const expected = whiteFinals.map((white) => board(position({ white, whiteOff: 13, red: { 6: 15 }, dice: [4, 1] })));
    expect(finalsFound).toEqual(canon(expected));
    expect(refused(state, play([3, 'off', 4], [6, 5, 1]))).toBe(true);
  });

  test('C20 : les deux pions restants sortent avec 6-5, dans les deux ordres : victoire', () => {
    const state = position({ white: { 3: 1, 2: 1 }, whiteOff: 13, red: { 6: 15 }, dice: [6, 5] });
    for (const winning of [play([3, 'off', 6], [2, 'off', 5]), play([3, 'off', 5], [2, 'off', 6])]) {
      const { state: ended } = played(state, winning);
      expect(backgammon.result(ended)).toMatchObject({ ranking: [[0], [1]], reason: 'bearoff' });
      expect(ended.off[0]).toBe(15);
    }
    // Le pion du point 2 ne sort pas avec le 6 tant qu'un pion plus haut reste.
    expect(refused(state, play([2, 'off', 6], [3, 'off', 5]))).toBe(true);
  });

  test('C21 : aucune sortie avant que le pion du point 7 soit rentré : deux coups seulement', () => {
    const state = position({ white: { 7: 1, 3: 1 }, whiteOff: 13, red: { 6: 15 }, dice: [6, 3] });
    expect(canon(plays(state))).toEqual(canon([play([7, 1, 6], [3, 'off', 3]), play([7, 4, 3], [4, 'off', 6])]));
    expect(refused(state, play([3, 'off', 3], [7, 1, 6]))).toBe(true);
    // Le dernier pion entré dans la maison sort déjà avec le dé suivant du même tour.
    expect(played(state, play([7, 1, 6], [3, 'off', 3])).state.off[0]).toBe(14);
  });

  test('C22 : avec un pion dehors, pas de sortie : barre→20 avec le 5, puis 20→14 avec le 6', () => {
    const state = position({ white: { 2: 1 }, whiteBar: 1, whiteOff: 13, red: { 22: 1, 6: 14 }, dice: [6, 5] });
    expect(plays(state)).toEqual([play(['bar', 20, 5], [20, 14, 6])]);
    expect(refused(state, play(['bar', 20, 5], [2, 'off', 6]))).toBe(true);
  });

  test('C23 : 13→7 puis 8→7, ou 8→7 puis 13→7 : les deux ordres sont acceptés et donnent la même position', () => {
    const state = start([6, 1]);
    const one = played(state, play([13, 7, 6], [8, 7, 1])).state;
    const other = played(state, play([8, 7, 1], [13, 7, 6])).state;
    expect(board(one)).toEqual(board(other));
    expect(one.points[6]).toBe(2);
    // La liste des coups légaux ne garde qu'un coup par position finale.
    const sameFinal = plays(state).filter((move) => JSON.stringify(finalBoard(state, move)) === JSON.stringify(board(one)));
    expect(sameFinal.length).toBe(1);
  });

  test('C24 : un coup hors phase, un dé non tiré, une suite trop courte, le mauvais siège : refusés, l\'état ne change pas', () => {
    const rolling = start();
    const moving = start([3, 1]);
    const before = JSON.stringify(moving);
    const cases: Array<[string, BackgammonState, BackgammonMove, number]> = [
      ['play en phase roll', rolling, play([13, 10, 3], [24, 23, 1]), 0],
      ['roll en phase move', moving, { type: 'roll' }, 0],
      ['un dé qui n\'a pas été tiré', moving, play([13, 9, 4], [24, 23, 1]), 0],
      ['une suite plus courte que le maximum', moving, play([13, 10, 3]), 0],
      ['le même dé deux fois', moving, play([13, 10, 3], [10, 7, 3]), 0],
      ['une étape dont l\'arrivée est fausse', moving, play([13, 9, 3], [24, 23, 1]), 0],
      ['une étape depuis un point sans pion', moving, play([12, 9, 3], [24, 23, 1]), 0],
      ['le mauvais siège', moving, play([13, 10, 3], [24, 23, 1]), 1],
      ['un siège qui n\'existe pas', moving, play([13, 10, 3], [24, 23, 1]), 2],
      ['un coup vide', moving, { type: 'play', steps: [] }, 0],
    ];
    for (const [name, state, move, seat] of cases) {
      const result = backgammon.apply(state, seat, move, noDraw);
      expect(result.ok, name).toBe(false);
    }
    expect(JSON.stringify(moving)).toBe(before);
    expect(backgammon.legalMoves(moving, 1)).toEqual([]);
    expect(backgammon.legalMoves(rolling, 1)).toEqual([]);
  });

  test('C25 : l\'abandon donne la partie à l\'autre, victoire simple', () => {
    const { state, events } = backgammon.forfeit(start([3, 1]), 1, 'resign');
    expect(backgammon.result(state)).toEqual({ ranking: [[0], [1]], reason: 'resign', detail: { kind: 'simple' } });
    expect(backgammon.turn(state)).toBeNull();
    expect(events).toEqual([{ type: 'forfeit', seat: 1, reason: 'resign' }]);
    for (const reason of ['timeout', 'disconnect'] as const) {
      expect(backgammon.result(backgammon.forfeit(start(), 0, reason).state)).toEqual({ ranking: [[1], [0]], reason, detail: { kind: 'simple' } });
    }
  });

  test('C26 : nextSteps sur C12 : seulement barre→24, puis 24→18, 13→7 et 8→2', () => {
    const state = position({ white: { 6: 5, 8: 3, 13: 5, 24: 1 }, whiteBar: 1, red: { 6: 5, 8: 3, 13: 5, 24: 2 }, dice: [6, 1] });
    expect(nextSteps(state, [])).toEqual([{ from: 'bar', to: 24, die: 1 }]);
    expect(canon(nextSteps(state, [{ from: 'bar', to: 24, die: 1 }]))).toEqual(canon([
      { from: 24, to: 18, die: 6 },
      { from: 13, to: 7, die: 6 },
      { from: 8, to: 2, die: 6 },
    ]));
    // Le tour est complet : plus rien à jouer.
    expect(nextSteps(state, [{ from: 'bar', to: 24, die: 1 }, { from: 13, to: 7, die: 6 }])).toEqual([]);
  });

  test('C27 : la course est la somme des numéros des points (25 sur la barre, 0 sortis) : 167 au départ, 101 puis 109 dans C15', () => {
    expect(pipCount(start(), 0)).toBe(167);
    expect(pipCount(start(), 1)).toBe(167);
    const before = position({ white: { 13: 15 }, red: { 17: 1, 6: 14 }, dice: [5, 1] });
    expect(pipCount(before, 1)).toBe(101);
    expect(pipCount(before, 0)).toBe(195);
    const after = played(before, play([13, 8, 5], [13, 12, 1])).state;
    expect(pipCount(after, 1)).toBe(109);
    expect(pipCount(after, 0)).toBe(195 - 6);
  });
});
