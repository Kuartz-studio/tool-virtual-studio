import { LUDO_FIRST_LANE, LUDO_HOME, LUDO_STABLE, trackCell } from '@bureau/shared/games/ludo';

// La géométrie du plateau des petits chevaux (§ 16.6 du document des jeux) : un plateau en croix de 15 × 15 cases, dont les coordonnées (colonne, rangée) se comptent depuis le
// coin haut gauche. Tout est dit ici pour un plateau « rouge en haut à gauche » ; l'orientation (turnsFor) tourne ensuite les points par quarts de tour, au moment de dessiner.
// L'avancée d'un cheval passe à sa case par une seule fonction, `trackCell` du moteur, que ce fichier ne refait pas : les rencontres se jugent sur la case de piste.

// Le plateau fait 15 cases de côté.
export const BOARD_CELLS = 15;

export type Cell = readonly [col: number, row: number];
export interface Point {
  x: number;
  y: number;
}

// Les 52 cases de la piste, dans le sens des aiguilles d'une montre, comme les numérote le moteur (la case 0 est le départ du rouge). Les quatre pas en diagonale (4 → 5, 17 → 18,
// 30 → 31 et 43 → 44) contournent les coins du carré central.
export const TRACK_CELLS: readonly Cell[] = [
  // 0 à 4
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  // 5 à 10
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  // 11
  [7, 0],
  // 12 à 17
  [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  // 18 à 23
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  // 24
  [14, 7],
  // 25 à 30
  [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  // 31 à 36
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  // 37
  [7, 14],
  // 38 à 43
  [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  // 44 à 49
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  // 50 et 51
  [0, 7], [0, 6],
];

// Les allées (avancées 51 à 55) de chaque couleur, de l'entrée vers le centre : rouge, vert, jaune, bleu.
export const LANE_CELLS: readonly (readonly Cell[])[] = [
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
];

// Les écuries : les quatre coins de 6 × 6 cases, rouge en haut à gauche, vert en haut à droite, jaune en bas à droite, bleu en bas à gauche. L'origine est la case du coin haut gauche.
export const YARD_SIZE = 6;
export const YARD_ORIGINS: readonly Cell[] = [[0, 0], [9, 0], [9, 9], [0, 9]];

// Les quatre places d'une écurie, à deux cases l'une de l'autre autour de son centre : le cheval 0 en haut à gauche, 1 en haut à droite, 2 en bas à gauche, 3 en bas à droite.
const YARD_SLOT_OFFSET = 2;
const YARD_SLOT_GAP = 2;

// L'arrivée : le carré central (cases 6 à 8), coupé par ses diagonales en quatre triangles, un par couleur, du côté de son allée.
const HOME_MIN = 6;
const HOME_MAX = 9;
const HOME_CENTER = 7.5;
export const HOME_TRIANGLES: readonly (readonly Point[])[] = [
  [{ x: HOME_MIN, y: HOME_MIN }, { x: HOME_MIN, y: HOME_MAX }, { x: HOME_CENTER, y: HOME_CENTER }],
  [{ x: HOME_MIN, y: HOME_MIN }, { x: HOME_MAX, y: HOME_MIN }, { x: HOME_CENTER, y: HOME_CENTER }],
  [{ x: HOME_MAX, y: HOME_MIN }, { x: HOME_MAX, y: HOME_MAX }, { x: HOME_CENTER, y: HOME_CENTER }],
  [{ x: HOME_MIN, y: HOME_MAX }, { x: HOME_MAX, y: HOME_MAX }, { x: HOME_CENTER, y: HOME_CENTER }],
];

// Le point d'ancrage de chaque triangle (son centre) : où l'on dessine les chevaux arrivés de cette couleur, et leur nombre.
export const HOME_ANCHORS: readonly Point[] = HOME_TRIANGLES.map((triangle) => ({
  x: triangle.reduce((sum, point) => sum + point.x, 0) / triangle.length,
  y: triangle.reduce((sum, point) => sum + point.y, 0) / triangle.length,
}));

// Le centre d'une case.
export function cellCenter([col, row]: Cell): Point {
  return { x: col + 0.5, y: row + 0.5 };
}

// La place du cheval n dans l'écurie de cette couleur.
export function yardSlot(color: number, horse: number): Point {
  const [col, row] = YARD_ORIGINS[color]!;
  return { x: col + YARD_SLOT_OFFSET + YARD_SLOT_GAP * (horse % 2), y: row + YARD_SLOT_OFFSET + YARD_SLOT_GAP * Math.floor(horse / 2) };
}

// Où est dessiné un cheval, d'après son avancée : sa place à l'écurie (−1), le centre de sa case de piste (0 à 50, par `trackCell` du moteur), de sa case d'allée (51 à 55), ou le point
// d'ancrage de son triangle (arrivé).
export function horseCenter(color: number, horse: number, advance: number): Point {
  if (advance <= LUDO_STABLE) return yardSlot(color, horse);
  if (advance >= LUDO_HOME) return HOME_ANCHORS[color]!;
  const cell = trackCell(color, advance);
  if (cell !== null) return cellCenter(TRACK_CELLS[cell]!);
  return cellCenter(LANE_CELLS[color]![advance - LUDO_FIRST_LANE]!);
}

// Ce point, après ce nombre de quarts de tour dans le sens des aiguilles d'une montre autour du centre du plateau : (x, y) devient (15 − y, x). Un nombre négatif tourne dans l'autre sens.
export function rotatePoint(point: Point, turns: number): Point {
  let { x, y } = point;
  for (let i = 0, count = ((turns % 4) + 4) % 4; i < count; i++) [x, y] = [BOARD_CELLS - y, x];
  return { x, y };
}

// Les quarts de tour qui amènent l'écurie de cette couleur en bas à gauche : rouge (en haut à gauche) 3, vert (en haut à droite) 2, jaune (en bas à droite) 1, bleu 0. Sans couleur (un
// spectateur, l'aperçu), le plateau ne tourne pas.
export function turnsFor(color: number | undefined): number {
  return color === undefined ? 0 : (3 - color + 4) % 4;
}
