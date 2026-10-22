import { BAR_POINT, POINT_COUNT, STARTING_LAYOUT } from './constants';
import type { BgPoint, BgPosition } from './types';

// Les deux numérotations. Chaque joueur compte les points de 1 à 24 depuis sa maison : le point p du siège 0 est le point 25 − p du siège 1. Tout le plateau est
// rangé dans `points`, dans la numérotation du siège 0 ; tout calcul qui passe d'une numérotation à l'autre passe par les trois fonctions qui suivent, et par
// elles seules (§ 14.7 du document des jeux : c'est la première source de bogues du backgammon).

// L'index, dans `points`, du point `point` de ce siège (sa propre numérotation). Siège 0 : point − 1. Siège 1 : 24 − point.
export function pointIndex(seat: number, point: BgPoint): number {
  return seat === 0 ? point - 1 : POINT_COUNT - point;
}

// Le contraire : le point, dans la numérotation de ce siège, que représente l'index de `points`.
export function pointNumber(seat: number, index: number): BgPoint {
  return seat === 0 ? index + 1 : POINT_COUNT - index;
}

// Le numéro que l'adversaire donne au même point : 25 − p.
export function mirrorPoint(point: BgPoint): BgPoint {
  return POINT_COUNT + 1 - point;
}

// Qui tient le point `point` (numérotation de `seat`) et combien de pions il y a : `owner` est null quand il est vide.
export function checkersAt(position: BgPosition, seat: number, point: BgPoint): { owner: 0 | 1 | null; count: number } {
  const value = position.points[pointIndex(seat, point)] ?? 0;
  return { owner: value > 0 ? 0 : value < 0 ? 1 : null, count: Math.abs(value) };
}

// La course : la somme des numéros des points de ses pions, 25 pour un pion sur la barre, 0 pour un pion sorti. Plus elle est basse, plus on est près d'avoir fini.
export function pipCount(position: BgPosition, seat: number): number {
  let total = (position.bar[seat] ?? 0) * BAR_POINT;
  for (let point = 1; point <= POINT_COUNT; point++) {
    const { owner, count } = checkersAt(position, seat, point);
    if (owner === seat) total += count * point;
  }
  return total;
}

// Le départ : chaque joueur pose ses pions comme `STARTING_LAYOUT` le dit, depuis sa maison. Le résultat est le tableau écrit dans le document des jeux (§ 14.3).
export function startingPoints(): number[] {
  const points = new Array<number>(POINT_COUNT).fill(0);
  for (const seat of [0, 1] as const) {
    for (const [point, count] of Object.entries(STARTING_LAYOUT)) {
      // Jamais de -0 : un zéro négatif ne survit pas à JSON.
      points[pointIndex(seat, Number(point))] = seat === 0 ? count : 0 - count;
    }
  }
  return points;
}

// Le plateau vu par celui qui joue, pour chercher les coups : ses pions sur ses propres points (index 1 à 24 ; l'index 0 reste vide), ceux de l'adversaire sur les
// mêmes points, comptés dans la numérotation de qui joue. Ce que cherchent les règles (« mon point p − d est-il ouvert ? ») s'y lit sans jamais convertir.
export interface Board {
  own: number[];
  opp: number[];
  bar: number;
  oppBar: number;
  off: number;
  oppOff: number;
}

export function boardFor(position: BgPosition, seat: number): Board {
  const own = new Array<number>(POINT_COUNT + 1).fill(0);
  const opp = new Array<number>(POINT_COUNT + 1).fill(0);
  for (let point = 1; point <= POINT_COUNT; point++) {
    const value = position.points[pointIndex(seat, point)] ?? 0;
    // Positif = pions du siège 0. Pour le siège 1, ce sont ceux de l'adversaire.
    const mine = seat === 0 ? value : 0 - value;
    if (mine > 0) own[point] = mine;
    else if (mine < 0) opp[point] = 0 - mine;
  }
  const other = 1 - seat;
  return {
    own,
    opp,
    bar: position.bar[seat] ?? 0,
    oppBar: position.bar[other] ?? 0,
    off: position.off[seat] ?? 0,
    oppOff: position.off[other] ?? 0,
  };
}

// Le plateau de `Board` remis dans la forme de l'état (tout dans la numérotation du siège 0), pour le siège `seat` qui jouait.
export function positionFrom(board: Board, seat: number): BgPosition {
  const points = new Array<number>(POINT_COUNT).fill(0);
  for (let point = 1; point <= POINT_COUNT; point++) {
    const net = (board.own[point] ?? 0) - (board.opp[point] ?? 0);
    points[pointIndex(seat, point)] = seat === 0 ? net : 0 - net;
  }
  return {
    points,
    bar: seat === 0 ? [board.bar, board.oppBar] : [board.oppBar, board.bar],
    off: seat === 0 ? [board.off, board.oppOff] : [board.oppOff, board.off],
  };
}
