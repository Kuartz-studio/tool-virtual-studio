import { EMPTY, FLAG_CASTLE_KING, FLAG_CASTLE_QUEEN, FLAG_EN_PASSANT, PAWN, moveFlags, moveFrom, movePromotion, moveTo, type Position } from './position';
import { SQUARES } from './types';

// La notation algébrique abrégée (SAN) anglaise standard, celle que l'état garde : « Nf3 », « exf6 », « O-O », « a8=Q+ », « Qxf7# ». Le client la met en français
// pour l'écran (R16) ; l'état, lui, reste dans la notation que tout outil d'échecs lit. Les initiales sont indexées par le type de la pièce ; le pion n'en a pas.
const SAN_LETTERS = ['', '', 'N', 'B', 'R', 'Q', 'K'];

// Ce qu'il faut ajouter à la lettre d'une pièce quand une autre pièce de même type peut aller sur la même case par un coup légal : la colonne si elle suffit,
// sinon la rangée, sinon les deux. Seuls les coups légaux comptent : une pièce clouée ne crée aucune ambiguïté.
function disambiguation(position: Position, legal: readonly number[], from: number, to: number, type: number): string {
  let ambiguous = false;
  let sameFile = false;
  let sameRank = false;
  for (let index = 0; index < legal.length; index++) {
    const other = legal[index]!;
    const otherFrom = moveFrom(other);
    if (otherFrom === from || moveTo(other) !== to || (position.board[otherFrom]! & 7) !== type) continue;
    ambiguous = true;
    if ((otherFrom & 7) === (from & 7)) sameFile = true;
    if (otherFrom >> 3 === from >> 3) sameRank = true;
  }
  if (!ambiguous) return '';
  const square = SQUARES[from]!;
  if (!sameFile) return square[0]!;
  if (!sameRank) return square[1]!;
  return square;
}

// Le SAN d'un coup légal de `position` (avant qu'il soit joué). `legal` : tous les coups légaux de cette position ; `check` et `mate` : ce que le coup provoque.
export function sanOf(position: Position, legal: readonly number[], move: number, check: boolean, mate: boolean): string {
  const suffix = mate ? '#' : check ? '+' : '';
  const flags = moveFlags(move);
  if (flags & FLAG_CASTLE_KING) return `O-O${suffix}`;
  if (flags & FLAG_CASTLE_QUEEN) return `O-O-O${suffix}`;
  const from = moveFrom(move);
  const to = moveTo(move);
  const type = position.board[from]! & 7;
  const capture = position.board[to] !== EMPTY || (flags & FLAG_EN_PASSANT) !== 0;
  if (type !== PAWN) {
    return `${SAN_LETTERS[type]}${disambiguation(position, legal, from, to, type)}${capture ? 'x' : ''}${SQUARES[to]}${suffix}`;
  }
  // Un pion qui prend dit sa colonne de départ ; une promotion ajoute la pièce choisie.
  const promotion = movePromotion(move);
  return `${capture ? `${SQUARES[from]![0]}x` : ''}${SQUARES[to]}${promotion ? `=${SAN_LETTERS[promotion]}` : ''}${suffix}`;
}
