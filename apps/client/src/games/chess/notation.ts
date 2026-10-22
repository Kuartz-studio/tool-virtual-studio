import { SQUARES, type ChessState, type PieceType, type Square } from '@bureau/shared/games/chess';
import type { PieceColor } from './fr';

// Les aides pures de l'interface (sans React) : le plateau lu sur le FEN, les pièces prises lues sur le plateau, la notation française des coups, et la liste des coups numérotée.
// L'état du jeu garde au plus les 600 derniers demi-coups (MAX_PLIES_KEPT) : ni la numérotation ni les pièces prises ne se lisent donc dans l'historique, mais dans le FEN.

export interface BoardPiece {
  type: PieceType;
  color: PieceColor;
}

// Le plateau d'un FEN : les cases occupées, et rien d'autre.
export function boardFromFen(fen: string): Map<Square, BoardPiece> {
  const board = new Map<Square, BoardPiece>();
  const ranks = fen.split(' ')[0]!.split('/');
  ranks.forEach((line, index) => {
    const rank = 7 - index;
    let file = 0;
    for (const letter of line) {
      if (letter >= '1' && letter <= '8') {
        file += Number(letter);
        continue;
      }
      board.set(SQUARES[rank * 8 + file]!, { type: letter.toLowerCase() as PieceType, color: letter === letter.toLowerCase() ? 'b' : 'w' });
      file++;
    }
  });
  return board;
}

// Ce que vaut chaque pièce, pour l'avance matérielle (le roi n'a pas de prix : il ne se prend pas).
export const PIECE_POINTS = { p: 1, n: 3, b: 3, r: 5, q: 9 } as const;
type Priced = keyof typeof PIECE_POINTS;

// Les pièces de chaque camp au départ, et l'ordre où on les range : de la plus forte à la plus faible (le fou avant le cavalier, à valeur égale).
const INITIAL: Record<Priced, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const BY_STRENGTH: readonly Priced[] = ['q', 'r', 'b', 'n', 'p'];

export interface Material {
  // Les pièces que chaque camp a prises : celles de l'adversaire qui manquent sur le plateau, de la plus forte à la plus faible.
  captured: Record<PieceColor, PieceType[]>;
  // L'avance de points, d'après les pièces qui restent : positive si les Blancs mènent, négative si les Noirs mènent.
  advantage: number;
}

// Les pièces prises et l'avance, lues sur le plateau seul. Une promotion rend les comptes ambigus (une dame de plus, un pion de moins) : toute pièce au-delà de ce que le départ donnait
// est un pion promu, qui n'a donc pas été pris. L'avance, elle, compte ce qui est sur le plateau : elle est exacte même quand on ne sait pas qui a pris quoi.
export function materialFromFen(fen: string): Material {
  const counts: Record<PieceColor, Record<Priced, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };
  for (const { type, color } of boardFromFen(fen).values()) if (type !== 'k') counts[color][type]++;

  const missing = (color: PieceColor): PieceType[] => {
    const have = counts[color];
    const promoted = (['n', 'b', 'r', 'q'] as const).reduce((sum, type) => sum + Math.max(0, have[type] - INITIAL[type]), 0);
    const lost: Record<Priced, number> = {
      p: Math.max(0, INITIAL.p - have.p - promoted),
      n: Math.max(0, INITIAL.n - have.n),
      b: Math.max(0, INITIAL.b - have.b),
      r: Math.max(0, INITIAL.r - have.r),
      q: Math.max(0, INITIAL.q - have.q),
    };
    return BY_STRENGTH.flatMap((type) => Array.from({ length: lost[type] }, () => type));
  };
  const points = (color: PieceColor): number => BY_STRENGTH.reduce((sum, type) => sum + counts[color][type] * PIECE_POINTS[type], 0);
  return { captured: { w: missing('b'), b: missing('w') }, advantage: points('w') - points('b') };
}

const FRENCH_PIECES: Record<string, string> = { K: 'R', Q: 'D', R: 'T', B: 'F', N: 'C' };

// La notation à l'écran (R16) : les initiales françaises (R, D, T, F, C ; le pion n'en a pas), « 0-0 » et « 0-0-0 », « =D » pour la promotion. « + » et « # » ne changent pas. Les lettres
// d'une pièce sont des majuscules, celles d'une colonne des minuscules : « Bxc3 » est un coup de fou, « bxc3 » une prise de pion.
export function frenchSan(san: string): string {
  if (san === '') return '';
  if (san.startsWith('O-O')) return san.replaceAll('O', '0');
  const head = FRENCH_PIECES[san[0]!] ?? san[0]!;
  return (head + san.slice(1)).replace(/=([QRBN])/, (_match, piece: string) => `=${FRENCH_PIECES[piece]}`);
}

export interface MoveCell {
  // La SAN anglaise de l'état, et son écriture à l'écran.
  san: string;
  text: string;
  // C'est le dernier demi-coup joué.
  last: boolean;
}
export interface MoveRow {
  number: number;
  white: MoveCell | null;
  black: MoveCell | null;
}

// La liste des coups, une ligne par coup entier. Le numéro vient du FEN : le coup en cours y est compté, et le dernier demi-coup en découle (le coup F des Blancs est le demi-coup 2 (F − 1),
// celui des Noirs le suivant). Quand l'historique est borné, la première ligne peut ne commencer que par un coup des Noirs. Un FEN qui ne colle pas à l'historique (une position posée à la main)
// fait numéroter à partir de 1.
export function moveRows(state: ChessState): MoveRow[] {
  const { plies } = state;
  if (plies.length === 0) return [];
  const fields = state.fen.split(' ');
  const whiteToMove = fields[1] === 'w';
  const fullmove = Number(fields[5]) || 1;
  const lastMove = whiteToMove ? fullmove - 1 : fullmove;
  const lastHalf = 2 * (lastMove - 1) + (whiteToMove ? 1 : 0);
  const firstHalf = Math.max(0, lastHalf - (plies.length - 1));

  const rows: MoveRow[] = [];
  plies.forEach((ply, index) => {
    const half = firstHalf + index;
    const number = Math.floor(half / 2) + 1;
    const cell: MoveCell = { san: ply.san, text: frenchSan(ply.san), last: index === plies.length - 1 };
    let row = rows.at(-1);
    if (!row || row.number !== number) {
      row = { number, white: null, black: null };
      rows.push(row);
    }
    if (half % 2 === 0) row.white = cell;
    else row.black = cell;
  });
  return rows;
}
