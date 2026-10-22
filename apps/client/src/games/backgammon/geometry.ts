import { mirrorPoint, POINT_COUNT } from '@bureau/shared/games/backgammon';

// La géométrie du tablier, en pixels : deux dispositions, selon la largeur du conteneur (§ 9.5.1 du document des jeux : le plateau se mesure sur son conteneur, jamais sur la
// fenêtre). La large, pour les 408 px d'un panneau d'ordinateur : une barre de 24 px qui se clique, et à droite une zone où s'empilent les pions sortis. La serrée, pour les 311 px
// d'un téléphone : des flèches de 24 px, une barre de 12 px (qui ne se clique pas : un pion sur la barre est choisi tout seul, c'est le seul coup), et un bouton « Sortir » sous le
// tablier au lieu de la zone de sortie. Chaque cible fait 24 px au moins [WCAG 2.5.8].

export const POINTS_PER_ROW = 12;
// Un point sur deux côtés de la barre : six à gauche, six à droite.
const HALF = 6;
// Combien de pions une pile montre avant le « +n ».
export const VISIBLE_STACK = 5;
// La plus petite cible qui se clique.
export const MIN_TARGET = 24;
// Une largeur inconnue (avant la première mesure) : celle d'un panneau d'ordinateur.
const FALLBACK_WIDTH = 408;

// Les deux dispositions. `slack` : le jeu, en pixels, entre cinq pions empilés et la pointe de leur flèche. `band` : la hauteur des deux bandes où s'écrivent les numéros des points,
// au-dessus et au-dessous du tablier. La serrée est plus basse (246 px de tablier, 266 avec ses numéros) : sur un téléphone, tout le plateau, boutons compris, tient en 380 px.
const COMPACT = { pad: 3, bar: 12, minCell: 24, maxCell: 30, discArt: 11, artPixel: 2, gap: 16, slack: 2, band: 10 } as const;
const WIDE = { pad: 6, bar: 24, minCell: 26, maxCell: 44, discArt: 13, artPixel: 2, gap: 24, slack: 4, band: 12, offGap: 4, offMin: 44, offMax: 60 } as const;

// La largeur à partir de laquelle la disposition large tient : des flèches de 26 px, la barre, et la zone de sortie.
export const WIDE_MIN_WIDTH = 2 * WIDE.pad + POINTS_PER_ROW * WIDE.minCell + WIDE.bar + WIDE.offGap + WIDE.offMin;

// La hauteur d'un pion sorti, posé à plat dans la zone de sortie, et sa largeur.
const OFF_DISC_HEIGHT = 5;
const OFF_DISC_INSET = 6;

export interface BoardLayout {
  mode: 'wide' | 'compact';
  width: number;
  // La hauteur du tablier lui-même, et celle de la scène : le tablier plus les deux bandes de numéros (`band` chacune).
  height: number;
  band: number;
  stageHeight: number;
  pad: number;
  // La largeur d'une flèche, de la barre et de la zone de sortie (0 en disposition serrée), et le jeu entre le tablier et elle.
  cell: number;
  bar: number;
  off: number;
  offGap: number;
  // Le jeu vertical entre les deux rangées de flèches : c'est là que se posent les dés.
  gap: number;
  // Le diamètre d'un pion, le nombre de pixels d'art de ce diamètre, et la taille d'un pixel d'art (toujours un entier : le pixel art ne se mélange pas).
  checker: number;
  discArt: number;
  artPixel: number;
  pointLength: number;
  visibleStack: number;
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

export function layoutFor(containerWidth: number): BoardLayout {
  const available = containerWidth > 0 ? containerWidth : FALLBACK_WIDTH;
  if (available >= WIDE_MIN_WIDTH) {
    const fixed = 2 * WIDE.pad + WIDE.bar + WIDE.offGap;
    const cell = clamp(Math.floor((available - fixed - WIDE.offMin) / POINTS_PER_ROW), WIDE.minCell, WIDE.maxCell);
    const off = clamp(available - fixed - POINTS_PER_ROW * cell, WIDE.offMin, WIDE.offMax);
    const checker = WIDE.discArt * WIDE.artPixel;
    const pointLength = VISIBLE_STACK * checker + WIDE.slack;
    const height = 2 * WIDE.pad + 2 * pointLength + WIDE.gap;
    return {
      mode: 'wide',
      width: fixed + POINTS_PER_ROW * cell + off,
      height,
      band: WIDE.band,
      stageHeight: height + 2 * WIDE.band,
      pad: WIDE.pad,
      cell,
      bar: WIDE.bar,
      off,
      offGap: WIDE.offGap,
      gap: WIDE.gap,
      checker,
      discArt: WIDE.discArt,
      artPixel: WIDE.artPixel,
      pointLength,
      visibleStack: VISIBLE_STACK,
    };
  }
  const fixed = 2 * COMPACT.pad + COMPACT.bar;
  const cell = clamp(Math.floor((available - fixed) / POINTS_PER_ROW), COMPACT.minCell, COMPACT.maxCell);
  const checker = COMPACT.discArt * COMPACT.artPixel;
  const pointLength = VISIBLE_STACK * checker + COMPACT.slack;
  const height = 2 * COMPACT.pad + 2 * pointLength + COMPACT.gap;
  return {
    mode: 'compact',
    width: fixed + POINTS_PER_ROW * cell,
    height,
    band: COMPACT.band,
    stageHeight: height + 2 * COMPACT.band,
    pad: COMPACT.pad,
    cell,
    bar: COMPACT.bar,
    off: 0,
    offGap: 0,
    gap: COMPACT.gap,
    checker,
    discArt: COMPACT.discArt,
    artPixel: COMPACT.artPixel,
    pointLength,
    visibleStack: VISIBLE_STACK,
  };
}

export type CellId = `p${number}` | 'bar' | 'off';

export interface Cell {
  id: CellId;
  kind: 'point' | 'bar' | 'off';
  // Le numéro du point, dans la numérotation de celui qui regarde ; absent pour la barre et la sortie.
  point?: number;
  row: 'top' | 'bottom';
  x: number;
  y: number;
  width: number;
  height: number;
  // Se clique-t-elle ? Une cible de moins de 24 px ne l'est pas (la barre serrée) : elle reste au clavier.
  pointer: boolean;
}

// Où est ce point à l'écran, pour celui qui regarde (sa numérotation) : sa maison, les points 1 à 6, est en bas à droite, les points 7 à 12 en bas à gauche, 13 à 18 en haut à
// gauche, 19 à 24 en haut à droite. Les colonnes vont de 0 (à gauche) à 11 (à droite).
export function pointPlace(point: number): { row: 'top' | 'bottom'; column: number } {
  return point <= POINTS_PER_ROW ? { row: 'bottom', column: POINTS_PER_ROW - point } : { row: 'top', column: point - POINTS_PER_ROW - 1 };
}

// Le bord gauche d'une colonne : la barre se glisse entre la sixième et la septième.
export function columnX(layout: BoardLayout, column: number): number {
  return layout.pad + column * layout.cell + (column >= HALF ? layout.bar : 0);
}

export function pointCell(layout: BoardLayout, point: number): Cell {
  const { row, column } = pointPlace(point);
  return {
    id: `p${point}`,
    kind: 'point',
    point,
    row,
    x: columnX(layout, column),
    y: row === 'top' ? layout.pad : layout.height - layout.pad - layout.pointLength,
    width: layout.cell,
    height: layout.pointLength,
    pointer: layout.cell >= MIN_TARGET && layout.pointLength >= MIN_TARGET,
  };
}

// Où commence la zone de sortie : à droite des flèches, après le jeu qui l'en sépare.
export function offX(layout: BoardLayout): number {
  return layout.pad + POINTS_PER_ROW * layout.cell + layout.bar + layout.offGap;
}

// Les cases du tablier : les 24 points, la barre, et en disposition large la zone de sortie de celui qui regarde (la moitié du bas : c'est sa maison).
export function cellsOf(layout: BoardLayout): Cell[] {
  const cells: Cell[] = Array.from({ length: POINT_COUNT }, (_, index) => pointCell(layout, index + 1));
  cells.push({
    id: 'bar',
    kind: 'bar',
    row: 'bottom',
    x: layout.pad + HALF * layout.cell,
    y: layout.pad,
    width: layout.bar,
    height: layout.height - 2 * layout.pad,
    pointer: layout.bar >= MIN_TARGET,
  });
  if (layout.off > 0) {
    const top = Math.round(layout.height / 2) + 2;
    cells.push({ id: 'off', kind: 'off', row: 'bottom', x: offX(layout), y: top, width: layout.off, height: layout.height - layout.pad - top, pointer: true });
  }
  return cells;
}

// Le centre du pion n de la pile d'un point : le premier touche le bord du tablier, les suivants s'empilent vers le milieu.
export function stackSlot(layout: BoardLayout, cell: Cell, index: number): { x: number; y: number } {
  const offset = layout.checker / 2 + index * layout.checker;
  return { x: cell.x + cell.width / 2, y: cell.row === 'top' ? layout.pad + offset : layout.height - layout.pad - offset };
}

// Le centre du pion n sur la barre : ceux de celui qui regarde (en bas) s'empilent vers le bas depuis le milieu du tablier, ceux de l'autre vers le haut.
export function barSlot(layout: BoardLayout, side: 'top' | 'bottom', index: number): { x: number; y: number } {
  const offset = layout.checker / 2 + index * layout.checker;
  const middle = layout.height / 2;
  return { x: layout.pad + HALF * layout.cell + layout.bar / 2, y: side === 'bottom' ? middle + offset : middle - offset };
}

// Le centre du pion sorti n : à plat, empilés depuis le bord (ceux de celui qui regarde en bas, en montant ; ceux de l'autre en haut, en descendant).
export function offSlot(layout: BoardLayout, side: 'top' | 'bottom', index: number): { x: number; y: number } {
  const offset = OFF_DISC_HEIGHT / 2 + index * OFF_DISC_HEIGHT;
  return { x: offX(layout) + layout.off / 2, y: side === 'bottom' ? layout.height - layout.pad - offset : layout.pad + offset };
}

// La largeur d'un pion sorti, à plat.
export function offDiscWidth(layout: BoardLayout): number {
  return layout.off - 2 * OFF_DISC_INSET;
}
export const OFF_DISC = { height: OFF_DISC_HEIGHT, inset: OFF_DISC_INSET } as const;

// Où se posent les dés : au milieu de la moitié droite du tablier pour celui qui regarde (c'est sa moitié), au milieu de la gauche pour l'autre, à mi-hauteur.
export function diceCentre(layout: BoardLayout, side: 'mine' | 'theirs'): { x: number; y: number } {
  const halfWidth = HALF * layout.cell;
  const left = layout.pad;
  const right = layout.pad + HALF * layout.cell + layout.bar;
  return { x: (side === 'mine' ? right : left) + halfWidth / 2, y: layout.height / 2 };
}

// Le numéro d'un point, dans la numérotation de celui qui regarde : le même s'il est donné dans celle de ce siège-là, 25 − p sinon.
export function toViewPoint(viewSeat: number, seat: number, point: number): number {
  return seat === viewSeat ? point : mirrorPoint(point);
}
