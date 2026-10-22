import { describe, expect, test } from 'vitest';
import { boardFor, checkersAt, mirrorPoint, pipCount, pointIndex, pointNumber, positionFrom, startingPoints } from './board';
import { POINT_COUNT } from './constants';
import { backgammonStateFrom } from './layout';

// Les deux numérotations sont la première source de bogues du backgammon (§ 14.7 du document des jeux) : les fonctions de conversion se testent seules, avant tout le
// reste.

describe('backgammon : les deux numérotations', () => {
  test('pointIndex : le point p du siège 0 est points[p − 1], celui du siège 1 est points[24 − p]', () => {
    expect(pointIndex(0, 1)).toBe(0);
    expect(pointIndex(0, 24)).toBe(23);
    expect(pointIndex(0, 13)).toBe(12);
    expect(pointIndex(1, 1)).toBe(23);
    expect(pointIndex(1, 24)).toBe(0);
    expect(pointIndex(1, 13)).toBe(11);
  });

  test('pointNumber est le contraire de pointIndex, pour les deux sièges, sur les 24 points', () => {
    for (const seat of [0, 1]) {
      for (let point = 1; point <= POINT_COUNT; point++) {
        expect(pointNumber(seat, pointIndex(seat, point))).toBe(point);
        expect(pointIndex(seat, pointNumber(seat, point - 1))).toBe(point - 1);
      }
    }
  });

  test('mirrorPoint : le point p d\'un siège est le point 25 − p de l\'autre, et c\'est la même case de `points`', () => {
    expect(mirrorPoint(1)).toBe(24);
    expect(mirrorPoint(24)).toBe(1);
    expect(mirrorPoint(8)).toBe(17);
    for (let point = 1; point <= POINT_COUNT; point++) {
      expect(mirrorPoint(mirrorPoint(point))).toBe(point);
      expect(pointIndex(1, mirrorPoint(point))).toBe(pointIndex(0, point));
    }
  });

  test('checkersAt : qui tient un point et combien de pions, vu depuis chaque siège', () => {
    const state = backgammonStateFrom({ white: { 13: 3, 6: 12 }, red: { 8: 4, 24: 11 } });
    expect(checkersAt(state, 0, 13)).toEqual({ owner: 0, count: 3 });
    expect(checkersAt(state, 0, 6)).toEqual({ owner: 0, count: 12 });
    // Le point 8 des Rouges est le point 17 des Blancs.
    expect(checkersAt(state, 1, 8)).toEqual({ owner: 1, count: 4 });
    expect(checkersAt(state, 0, 17)).toEqual({ owner: 1, count: 4 });
    // Le point 24 des Rouges est le point 1 des Blancs.
    expect(checkersAt(state, 0, 1)).toEqual({ owner: 1, count: 11 });
    expect(checkersAt(state, 1, 13)).toEqual({ owner: null, count: 0 });
    expect(checkersAt(state, 0, 2)).toEqual({ owner: null, count: 0 });
  });

  test('pipCount : le numéro du point pour chaque pion, 25 pour un pion sur la barre, 0 pour un pion sorti', () => {
    const state = backgammonStateFrom({ white: { 13: 2, 2: 1 }, whiteBar: 2, whiteOff: 10, red: { 24: 1, 10: 1 }, redBar: 1, redOff: 12 });
    expect(pipCount(state, 0)).toBe(2 * 13 + 2 + 2 * 25);
    expect(pipCount(state, 1)).toBe(24 + 10 + 25);
    expect(pipCount(backgammonStateFrom({ white: { 1: 5 }, whiteOff: 10, red: { 1: 5 }, redOff: 10 }), 1)).toBe(5);
  });

  test('startingPoints : le tableau du document, quinze pions chacun, le point 24 de l\'un est le point 1 de l\'autre', () => {
    const points = startingPoints();
    expect(points).toEqual([-2, 0, 0, 0, 0, 5, 0, 3, 0, 0, 0, -5, 5, 0, 0, 0, -3, 0, -5, 0, 0, 0, 0, 2]);
    expect(points.filter((count) => count > 0).reduce((total, count) => total + count, 0)).toBe(15);
    expect(points.filter((count) => count < 0).reduce((total, count) => total - count, 0)).toBe(15);
    // Chaque appel rend un tableau neuf : modifier le résultat ne change pas le départ suivant.
    points[0] = 99;
    expect(startingPoints()[0]).toBe(-2);
  });

  test('boardFor puis positionFrom : un aller-retour exact pour les deux sièges, sans jamais produire de -0', () => {
    const state = backgammonStateFrom({ white: { 13: 5, 8: 3, 6: 4 }, whiteBar: 1, whiteOff: 2, red: { 24: 2, 16: 3, 3: 6 }, redBar: 2, redOff: 2 });
    for (const seat of [0, 1]) {
      const back = positionFrom(boardFor(state, seat), seat);
      expect(back.points).toEqual(state.points);
      expect(back.bar).toEqual(state.bar);
      expect(back.off).toEqual(state.off);
      expect(back.points.some((count) => Object.is(count, -0))).toBe(false);
    }
  });

  test('boardFor : les pions de celui qui joue sont sur ses points, ceux de l\'autre sur les mêmes points comptés dans la numérotation de qui joue', () => {
    const state = backgammonStateFrom({ white: { 13: 5, 8: 3, 6: 7 }, red: { 24: 2, 15: 4, 6: 9 } });
    const white = boardFor(state, 0);
    expect([white.own[13], white.own[8], white.own[6]]).toEqual([5, 3, 7]);
    // Les points des Rouges, dans la numérotation des Blancs : 24 → 1, 15 → 10, 6 → 19.
    expect([white.opp[1], white.opp[10], white.opp[19]]).toEqual([2, 4, 9]);
    const red = boardFor(state, 1);
    expect([red.own[24], red.own[15], red.own[6]]).toEqual([2, 4, 9]);
    // Les points des Blancs, dans la numérotation des Rouges : 13 → 12, 8 → 17, 6 → 19.
    expect([red.opp[12], red.opp[17], red.opp[19]]).toEqual([5, 3, 7]);
    // Aucun point n'est à la fois aux deux camps.
    for (let point = 1; point <= POINT_COUNT; point++) expect(white.own[point]! > 0 && white.opp[point]! > 0).toBe(false);
  });
});
