// La grille du Puissance 4 : sa taille, le passage entre (colonne, rangée) et l'index d'une case, la chute d'un jeton et la recherche des alignements. Tout ici est
// pur et ne connaît que des cases : ni les sièges, ni la fin de partie (c'est le rôle du moteur, dans index.ts).

export const CONNECT4_COLUMNS = 7;
export const CONNECT4_ROWS = 6;
export const CONNECT4_CELLS = CONNECT4_COLUMNS * CONNECT4_ROWS;
// Combien de jetons à la suite font gagner.
export const CONNECT4_LINE = 4;

// Les quatre directions d'une ligne, en (colonnes, rangées) : l'horizontale, la verticale, la diagonale montante et la diagonale descendante. On les lit dans les deux
// sens à partir d'un jeton.
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;

// L'index d'une case : colonne × 6 + rangée, la rangée 0 est en bas (comme dans l'état de la partie).
export function cellIndex(col: number, row: number): number {
  return col * CONNECT4_ROWS + row;
}

export function cellColumn(index: number): number {
  return Math.floor(index / CONNECT4_ROWS);
}

export function cellRow(index: number): number {
  return index % CONNECT4_ROWS;
}

// Une colonne de la grille : un entier de 0 à 6. Rien d'autre n'en est une (−1, 7, 1,5, NaN, un texte…) : un coup qui arrive du réseau peut contenir n'importe quoi.
export function isColumn(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < CONNECT4_COLUMNS;
}

function onGrid(col: number, row: number): boolean {
  return col >= 0 && col < CONNECT4_COLUMNS && row >= 0 && row < CONNECT4_ROWS;
}

// La rangée où tombe un jeton lâché dans cette colonne : la plus basse case libre. −1 si la colonne est pleine, ou si ce n'est pas une colonne.
export function dropRow(cells: readonly number[], col: number): number {
  if (!isColumn(col)) return -1;
  for (let row = 0; row < CONNECT4_ROWS; row++) {
    if (cells[cellIndex(col, row)] === 0) return row;
  }
  return -1;
}

// Les cases (leurs index, triés) de toutes les lignes de quatre jetons ou plus que le jeton de la case `index` tient avec ses voisins, dans les quatre directions ;
// vide s'il n'y en a pas, ou si la case est vide. Une ligne de cinq se rend en entier, et deux lignes qui se croisent se réunissent (la victoire se cherche
// autour du dernier jeton seulement : c'est lui qui a pu les faire).
// On avance case par case en restant sur la grille, jamais en ajoutant un pas à l'index : le haut d'une colonne est suivi, dans le tableau, du bas de la suivante, qui
// n'est pas son voisin.
export function alignedCells(cells: readonly number[], index: number): number[] {
  const piece = cells[index];
  if (piece === undefined || piece === 0) return [];
  const col = cellColumn(index);
  const row = cellRow(index);
  const aligned = new Set<number>();
  for (const [dc, dr] of DIRECTIONS) {
    const line = [index];
    for (const sign of [1, -1]) {
      for (let c = col + sign * dc, r = row + sign * dr; onGrid(c, r) && cells[cellIndex(c, r)] === piece; c += sign * dc, r += sign * dr) {
        line.push(cellIndex(c, r));
      }
    }
    if (line.length >= CONNECT4_LINE) for (const cell of line) aligned.add(cell);
  }
  return [...aligned].sort((a, b) => a - b);
}
