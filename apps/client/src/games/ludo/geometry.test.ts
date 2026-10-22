import { LUDO_FIRST_LANE, LUDO_HOME, LUDO_LAST_TRACK, LUDO_START, LUDO_STABLE, LUDO_TRACK, trackCell } from '@bureau/shared/games/ludo';
import { describe, expect, test } from 'vitest';
import { BOARD_CELLS, HOME_ANCHORS, HOME_TRIANGLES, LANE_CELLS, TRACK_CELLS, YARD_ORIGINS, YARD_SIZE, cellCenter, horseCenter, rotatePoint, turnsFor, yardSlot, type Cell } from './geometry';

// La géométrie du plateau de 15 × 15 (§ 16.6 du document des jeux), vérifiée contre les lignes du tableau du document, relues ici telles qu'il les écrit.

// Le tableau du § 16.6 : « 0 à 4 | (1, 6) → (5, 6) ». Chaque ligne est une rangée ou une colonne droite de cases : la lire, c'est la dérouler.
const SPEC_TRACK: Array<[string, string]> = [
  ['0 à 4', '(1, 6) → (5, 6)'],
  ['5 à 10', '(6, 5) → (6, 0)'],
  ['11', '(7, 0)'],
  ['12 à 17', '(8, 0) → (8, 5)'],
  ['18 à 23', '(9, 6) → (14, 6)'],
  ['24', '(14, 7)'],
  ['25 à 30', '(14, 8) → (9, 8)'],
  ['31 à 36', '(8, 9) → (8, 14)'],
  ['37', '(7, 14)'],
  ['38 à 43', '(6, 14) → (6, 9)'],
  ['44 à 49', '(5, 8) → (0, 8)'],
  ['50', '(0, 7)'],
  ['51', '(0, 6)'],
];

// « (1, 6) → (5, 6) » : les cases de la première à la dernière, une à une.
function unroll(text: string): Cell[] {
  const points = [...text.matchAll(/\((\d+), (\d+)\)/g)].map((match) => [Number(match[1]), Number(match[2])] as const);
  const [from, to] = [points[0]!, points.at(-1)!];
  const length = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])) + 1;
  return Array.from({ length }, (_, i) => [from[0] + Math.sign(to[0] - from[0]) * i, from[1] + Math.sign(to[1] - from[1]) * i] as const);
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('la piste : 52 cases, dans l\'ordre du document', () => {
  test('les cases du tableau, une à une, dans l\'ordre', () => {
    const expected = SPEC_TRACK.flatMap(([, run]) => unroll(run));
    expect(expected).toHaveLength(LUDO_TRACK);
    expect(TRACK_CELLS).toEqual(expected);
    // Les numéros que le tableau donne à chaque ligne : « 5 à 10 » commence à la case 5.
    let next = 0;
    for (const [range, run] of SPEC_TRACK) {
      expect(Number(range.split(' ')[0])).toBe(next);
      next += unroll(run).length;
    }
  });

  test('52 cases différentes, toutes dans le plateau, chacune voisine de la suivante (quatre pas en diagonale)', () => {
    expect(new Set(TRACK_CELLS.map(([col, row]) => `${col},${row}`)).size).toBe(LUDO_TRACK);
    for (const [col, row] of TRACK_CELLS) {
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThan(BOARD_CELLS);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(BOARD_CELLS);
    }
    const steps = TRACK_CELLS.map((cell, i) => distance(cellCenter(cell), cellCenter(TRACK_CELLS[(i + 1) % LUDO_TRACK]!)));
    expect(steps.filter((step) => Math.abs(step - 1) < 1e-9)).toHaveLength(LUDO_TRACK - 4);
    expect(steps.filter((step) => Math.abs(step - Math.SQRT2) < 1e-9)).toHaveLength(4);
  });

  test('les départs : rouge (1, 6) = case 0, vert (8, 1) = 13, jaune (13, 8) = 26, bleu (6, 13) = 39', () => {
    expect(LUDO_START.map((cell) => TRACK_CELLS[cell])).toEqual([[1, 6], [8, 1], [13, 8], [6, 13]]);
  });
});

describe('les allées, les écuries et l\'arrivée', () => {
  test('les allées du document : rouge (1, 7) → (5, 7), vert (7, 1) → (7, 5), jaune (13, 7) → (9, 7), bleu (7, 13) → (7, 9)', () => {
    expect(LANE_CELLS).toEqual([unroll('(1, 7) → (5, 7)'), unroll('(7, 1) → (7, 5)'), unroll('(13, 7) → (9, 7)'), unroll('(7, 13) → (7, 9)')]);
  });

  test('les écuries : des coins de 6 × 6, rouge en haut à gauche, vert en haut à droite, jaune en bas à droite, bleu en bas à gauche', () => {
    expect(YARD_SIZE).toBe(6);
    expect(YARD_ORIGINS).toEqual([[0, 0], [9, 0], [9, 9], [0, 9]]);
  });

  test('chaque écurie a quatre places, distinctes, à l\'intérieur de son coin, symétriques autour de son centre', () => {
    for (const color of [0, 1, 2, 3]) {
      const [originCol, originRow] = YARD_ORIGINS[color]!;
      const slots = [0, 1, 2, 3].map((horse) => yardSlot(color, horse));
      expect(new Set(slots.map((slot) => `${slot.x},${slot.y}`)).size).toBe(4);
      for (const slot of slots) {
        expect(slot.x).toBeGreaterThan(originCol);
        expect(slot.x).toBeLessThan(originCol + YARD_SIZE);
        expect(slot.y).toBeGreaterThan(originRow);
        expect(slot.y).toBeLessThan(originRow + YARD_SIZE);
      }
      const center = { x: originCol + YARD_SIZE / 2, y: originRow + YARD_SIZE / 2 };
      expect(slots.reduce((sum, slot) => sum + slot.x, 0) / 4).toBeCloseTo(center.x);
      expect(slots.reduce((sum, slot) => sum + slot.y, 0) / 4).toBeCloseTo(center.y);
    }
  });

  test('l\'arrivée : le carré central de 3 × 3, quatre triangles qui le couvrent exactement, un par couleur, du côté de son allée', () => {
    const area = (triangle: readonly { x: number; y: number }[]) => Math.abs((triangle[1]!.x - triangle[0]!.x) * (triangle[2]!.y - triangle[0]!.y) - (triangle[2]!.x - triangle[0]!.x) * (triangle[1]!.y - triangle[0]!.y)) / 2;
    expect(HOME_TRIANGLES).toHaveLength(4);
    expect(HOME_TRIANGLES.reduce((sum, triangle) => sum + area(triangle), 0)).toBeCloseTo(9);
    for (const triangle of HOME_TRIANGLES) for (const point of triangle) expect(point.x >= 6 && point.x <= 9 && point.y >= 6 && point.y <= 9).toBe(true);
    // Le centre de chaque triangle est son point d'ancrage, et il est du côté de l'allée de sa couleur : l'allée rouge arrive par la gauche, la verte par le haut…
    HOME_TRIANGLES.forEach((triangle, color) => {
      const centroid = { x: triangle.reduce((sum, p) => sum + p.x, 0) / 3, y: triangle.reduce((sum, p) => sum + p.y, 0) / 3 };
      expect(HOME_ANCHORS[color]!.x).toBeCloseTo(centroid.x);
      expect(HOME_ANCHORS[color]!.y).toBeCloseTo(centroid.y);
      const lastLane = cellCenter(LANE_CELLS[color]![4]!);
      const nearest = HOME_ANCHORS.map((anchor, other) => [other, distance(anchor, lastLane)] as const).sort((a, b) => a[1] - b[1])[0]!;
      expect(nearest[0]).toBe(color);
    });
  });
});

describe('horseCenter : où est dessiné un cheval, d\'après son avancée', () => {
  test('à l\'écurie : sa place ; arrivé : le point d\'ancrage du triangle de sa couleur', () => {
    for (const color of [0, 1, 2, 3]) {
      for (const horse of [0, 1, 2, 3]) expect(horseCenter(color, horse, LUDO_STABLE)).toEqual(yardSlot(color, horse));
      expect(horseCenter(color, 0, LUDO_HOME)).toEqual(HOME_ANCHORS[color]);
    }
  });

  test('sur la piste, par la seule fonction de passage de l\'avancée à la case (celle du moteur) : le centre de la case', () => {
    for (const color of [0, 1, 2, 3]) {
      for (let advance = 0; advance <= LUDO_LAST_TRACK; advance++) {
        expect(horseCenter(color, 0, advance)).toEqual(cellCenter(TRACK_CELLS[trackCell(color, advance)!]!));
      }
    }
  });

  test('deux chevaux de couleurs différentes sur la même case de piste sont dessinés au même endroit : une prise se voit', () => {
    // Rouge à l'avancée 14 et vert à l'avancée 1 : la case 14 (cas C8 des règles).
    expect(horseCenter(0, 0, 14)).toEqual(horseCenter(1, 0, 1));
    // Vert à l'avancée 39 et la sortie du rouge : la case 0, le départ des rouges (cas C9).
    expect(horseCenter(1, 0, 39)).toEqual(horseCenter(0, 0, 0));
    // Vert à l'avancée 45 et rouge à 6 : la case 6 (cas C10).
    expect(horseCenter(1, 0, 45)).toEqual(horseCenter(0, 0, 6));
  });

  test('dans l\'allée : les cinq cases de sa couleur, dans l\'ordre ; elles ne sont sur aucune case de la piste', () => {
    const trackCenters = new Set(TRACK_CELLS.map((cell) => `${cellCenter(cell).x},${cellCenter(cell).y}`));
    for (const color of [0, 1, 2, 3]) {
      for (let k = 0; k < 5; k++) {
        const point = horseCenter(color, 0, LUDO_FIRST_LANE + k);
        expect(point).toEqual(cellCenter(LANE_CELLS[color]![k]!));
        expect(trackCenters.has(`${point.x},${point.y}`)).toBe(false);
      }
    }
  });

  test('de son départ à l\'arrivée, chaque pas d\'un cheval est court : une case, ou un peu plus à l\'entrée de l\'allée et au centre', () => {
    for (const color of [0, 1, 2, 3]) {
      for (let advance = 0; advance < LUDO_HOME; advance++) {
        const step = distance(horseCenter(color, 0, advance), horseCenter(color, 0, advance + 1));
        expect(step, `couleur ${color}, ${advance} → ${advance + 1}`).toBeLessThanOrEqual(Math.SQRT2 + 1e-9);
        expect(step).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('l\'orientation : une rotation par quarts de tour qui amène son écurie en bas à gauche', () => {
  test('rotatePoint : un quart de tour dans le sens des aiguilles d\'une montre autour du centre du plateau', () => {
    expect(rotatePoint({ x: 0.5, y: 0.5 }, 1)).toEqual({ x: 14.5, y: 0.5 });
    expect(rotatePoint({ x: 14.5, y: 0.5 }, 1)).toEqual({ x: 14.5, y: 14.5 });
    expect(rotatePoint({ x: 3, y: 4 }, 0)).toEqual({ x: 3, y: 4 });
    expect(rotatePoint({ x: 3, y: 4 }, 4)).toEqual({ x: 3, y: 4 });
    expect(rotatePoint({ x: 3, y: 4 }, 2)).toEqual({ x: 12, y: 11 });
    expect(rotatePoint({ x: 3, y: 4 }, -1)).toEqual(rotatePoint({ x: 3, y: 4 }, 3));
  });

  test('turnsFor : rouge 3, vert 2, jaune 1, bleu 0 ; pas de couleur (spectateur), pas de rotation', () => {
    expect([0, 1, 2, 3].map(turnsFor)).toEqual([3, 2, 1, 0]);
    expect(turnsFor(undefined)).toBe(0);
  });

  test('avec ces quarts de tour, l\'écurie de chaque couleur est en bas à gauche', () => {
    for (const color of [0, 1, 2, 3]) {
      const [col, row] = YARD_ORIGINS[color]!;
      const center = rotatePoint({ x: col + YARD_SIZE / 2, y: row + YARD_SIZE / 2 }, turnsFor(color));
      expect(center.x).toBeLessThan(BOARD_CELLS / 2);
      expect(center.y).toBeGreaterThan(BOARD_CELLS / 2);
    }
  });
});
