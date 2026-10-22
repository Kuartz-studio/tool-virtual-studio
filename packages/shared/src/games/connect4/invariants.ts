import { FORFEIT_REASONS } from '../types';
import { CONNECT4_CELLS, CONNECT4_COLUMNS, CONNECT4_ROWS, alignedCells, cellIndex, dropRow, isColumn } from './board';
import type { Connect4State } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Deux listes de nombres égales, dans le même ordre (la forme JSON suffit : ce sont des nombres).
function sameList(a: unknown, b: readonly number[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Des cases, triées, pour une phrase.
function list(cells: Iterable<number>): string {
  return [...cells].sort((a, b) => a - b).join(', ');
}

// Le résultat a-t-il cette raison et ce classement ? On lit les deux champs un à un plutôt que de comparer l'objet entier : un état fabriqué par un test écrit ses
// clés dans l'ordre qu'il veut.
function resultIs(result: unknown, ranking: number[][], reason: string): boolean {
  return isRecord(result) && result.reason === reason && JSON.stringify(result.ranking) === JSON.stringify(ranking);
}

// Les phrases qui disent pourquoi un état n'est pas légal ; [] s'il l'est (§ 15.3). L'état peut venir de n'importe où (`debug:game` envoie du JSON que personne n'a
// vérifié) : on s'assure d'abord de sa forme, et une forme fausse est une phrase, jamais une exception.
export function connect4Invariants(state: Connect4State): string[] {
  if (!isRecord(state)) return ['l\'état n\'est pas un objet'];
  const { cells, first, moves, winLine, result } = state as unknown as Record<string, unknown>;

  const shape: string[] = [];
  if (first !== 0 && first !== 1) shape.push(`le siège qui commence vaut ${String(first)} : 0 ou 1 attendu`);
  if (!Array.isArray(cells)) {
    shape.push('cells n\'est pas la liste des cases');
  } else {
    if (cells.length !== CONNECT4_CELLS) shape.push(`la grille a ${cells.length} cases au lieu de ${CONNECT4_CELLS}`);
    for (const [index, cell] of cells.entries()) {
      if (cell !== 0 && cell !== 1 && cell !== 2) shape.push(`la case ${index} vaut ${String(cell)} : 0, 1 ou 2 attendu`);
    }
  }
  if (!Array.isArray(moves)) {
    shape.push('moves n\'est pas la liste des coups joués');
  } else {
    if (moves.length > CONNECT4_CELLS) shape.push(`${moves.length} coups joués pour ${CONNECT4_CELLS} cases`);
    for (const [index, col] of moves.entries()) {
      if (!isColumn(col)) shape.push(`le coup ${index + 1} joue la colonne ${String(col)}, qui n'existe pas`);
    }
  }
  if (!Array.isArray(winLine) || winLine.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= CONNECT4_CELLS)) {
    shape.push('winLine n\'est pas une liste de cases de la grille');
  }
  if (result !== null && !(isRecord(result) && Array.isArray(result.ranking) && typeof result.reason === 'string')) {
    shape.push('result n\'est ni nul ni un résultat (un classement et une raison)');
  }
  // Sans une forme juste, le reste n'a pas de sens.
  if (shape.length > 0) return shape;

  const grid = cells as number[];
  const played = moves as number[];
  const line = winLine as number[];
  const firstSeat = first as 0 | 1;
  const problems: string[] = [];

  // Aucun trou : dans chaque colonne, les jetons sont posés du fond vers le haut.
  for (let col = 0; col < CONNECT4_COLUMNS; col++) {
    const free = dropRow(grid, col);
    const height = free === -1 ? CONNECT4_ROWS : free;
    for (let row = height + 1; row < CONNECT4_ROWS; row++) {
      if (grid[cellIndex(col, row)] !== 0) {
        problems.push(`un jeton flotte en colonne ${col} : la rangée ${row} est occupée, la rangée ${height} est vide dessous`);
        break;
      }
    }
  }

  // Les joueurs jouent à tour de rôle : celui qui a commencé a autant de jetons que l'autre, ou un de plus.
  const firstPiece = firstSeat + 1;
  const otherPiece = 2 - firstSeat;
  const firstCount = grid.filter((cell) => cell === firstPiece).length;
  const otherCount = grid.filter((cell) => cell === otherPiece).length;
  if (firstCount - otherCount !== 0 && firstCount - otherCount !== 1) {
    problems.push(`le siège qui commence a ${firstCount} jetons et l'autre ${otherCount} : il en a autant, ou un de plus`);
  }

  // Rejouer les coups sur une grille vide redonne la grille (et dit où est le dernier jeton).
  const replayed = Array.from({ length: CONNECT4_CELLS }, () => 0);
  let lastIndex = -1;
  let replayable = true;
  for (const [index, col] of played.entries()) {
    const row = dropRow(replayed, col);
    if (row === -1) {
      problems.push(`le coup ${index + 1} joue la colonne ${col}, déjà pleine`);
      replayable = false;
      break;
    }
    lastIndex = cellIndex(col, row);
    replayed[lastIndex] = ((firstSeat + index) % 2) + 1;
  }
  if (replayable && replayed.some((cell, index) => cell !== grid[index])) problems.push('rejouer les coups ne redonne pas la grille');
  // Si la grille et les coups ne s'accordent pas, ce qui suit ne dirait que du bruit.
  if (problems.length > 0) return problems;

  // Aucune ligne de quatre sur la grille, sauf celle que le dernier jeton vient de faire : c'est elle qui a fini la partie.
  const lastLine = lastIndex === -1 ? [] : alignedCells(grid, lastIndex);
  const others = new Set<number>();
  for (const index of grid.keys()) {
    for (const cell of alignedCells(grid, index)) if (!lastLine.includes(cell)) others.add(cell);
  }
  if (others.size > 0) problems.push(`la grille a une ligne de quatre qui n'est pas celle du dernier jeton (cases ${list(others)})`);
  if (!sameList(line, lastLine)) problems.push(`winLine (${line.join(', ')}) n'est pas la ligne que le dernier jeton a faite (${lastLine.join(', ')})`);

  // Le résultat est non nul si et seulement si la partie est finie : par un alignement, par la grille pleine, ou par un abandon (la raison seule dit lequel).
  const untold = (why: string) => problems.push(`${why}, mais le résultat ne le dit pas : ${JSON.stringify(result)}`);
  if (lastLine.length > 0) {
    const winner = (firstSeat + played.length - 1) % 2;
    const told = resultIs(result, [[winner], [1 - winner]], 'four') && isRecord(result) && isRecord(result.detail) && sameList(result.detail.cells, lastLine);
    if (!told) untold(`la partie est gagnée par le siège ${winner} (cases ${list(lastLine)})`);
  } else if (played.length === CONNECT4_CELLS) {
    if (!resultIs(result, [[0, 1]], 'full')) untold('la grille est pleine sans alignement : c\'est une nulle');
  } else if (result !== null) {
    const forfeited = FORFEIT_REASONS.some((reason) => resultIs(result, [[0], [1]], reason) || resultIs(result, [[1], [0]], reason));
    if (!forfeited) problems.push(`la partie n'est pas finie, et le résultat n'est pas un abandon : ${JSON.stringify(result)}`);
  }
  return problems;
}
