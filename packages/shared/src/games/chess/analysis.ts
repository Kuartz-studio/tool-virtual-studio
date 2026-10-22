import { BISHOP, EMPTY, FLAG_EN_PASSANT, KING, KNIGHT, Position, moveFlags } from './position';
import { SQUARES } from './types';

// Ce que les règles savent d'une position : ses coups légaux, si le camp au trait est en échec, sa clé de répétition. Calculé une seule fois par FEN et gardé en
// mémoire, parce que le même état est regardé plusieurs fois de suite (les coups légaux pour le plateau, `apply`, `invariants`, le tour suivant) et que générer les
// coups est la partie coûteuse. Le cache est borné, ne dépend que du texte du FEN (même FEN, même analyse : les fonctions du jeu restent pures) et n'est jamais
// modifié après coup : qui veut jouer un coup en prend une copie de `position`.

export interface Analysis {
  // La position que le FEN décrit. Ne pas la modifier : elle est partagée.
  position: Position;
  // Son FEN canonique, à six champs.
  fen: string;
  // La clé de répétition (R10) : placement, trait, droits de roque, puis la case de prise en passant seulement si une prise en passant est légale, sinon « - ».
  key: string;
  // Les coups légaux, compactés (voir `pack`). Ne pas modifier.
  moves: number[];
  // Le camp au trait est en échec.
  inCheck: boolean;
}

// Les raisons de fin que les règles découvrent seules, par ordre de priorité (R12).
export type EndReason = 'checkmate' | 'stalemate' | 'insufficient' | 'threefold' | 'fifty';

// Combien de FEN on garde : de quoi suivre les tables de jeu et rejouer une partie sans que la mémoire grandisse (une analyse pèse quelques ko).
const CACHE_SIZE = 512;
const cache = new Map<string, Analysis>();

function remember(fen: string, analysis: Analysis): void {
  if (!cache.has(fen) && cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  cache.set(fen, analysis);
}

// Les trois premiers champs d'un FEN : placement, trait, droits de roque.
function firstThreeFields(fen: string): string {
  let end = -1;
  for (let count = 0; count < 3; count++) end = fen.indexOf(' ', end + 1);
  return fen.slice(0, end);
}

// Analyse une position qu'on vient de jouer (ou de lire). Elle est rangée dans le cache sous son FEN canonique : le coup suivant la retrouvera sans la relire.
export function analysePosition(position: Position): Analysis {
  const fen = position.toFen();
  const moves = position.legalMoves();
  // « Même position » (FIDE 9.2.3) : mêmes pièces sur les mêmes cases, même camp au trait, mêmes coups possibles. Les droits de roque et la prise en passant
  // changent les coups possibles ; la case de prise en passant ne compte donc que si une prise est légale, pas dès qu'un pion vient d'avancer de deux cases.
  const enPassantPossible = moves.some((move) => (moveFlags(move) & FLAG_EN_PASSANT) !== 0);
  const key = `${firstThreeFields(fen)} ${enPassantPossible ? SQUARES[position.enPassant] : '-'}`;
  const analysis: Analysis = { position, fen, key, moves, inCheck: position.inCheck() };
  remember(fen, analysis);
  return analysis;
}

// L'analyse d'un FEN. Lève si le FEN est illisible (voir `Position.fromFen`).
export function analyse(fen: string): Analysis {
  const known = cache.get(fen);
  if (known) return known;
  const analysis = analysePosition(Position.fromFen(fen));
  remember(fen, analysis);
  return analysis;
}

// Matériel insuffisant (R9) : la partie est nulle quand il ne reste que (a) les deux rois, (b) les rois et un seul fou, (c) les rois et un seul cavalier, ou
// (d) les rois et des fous, d'un camp ou des deux, tous sur des cases de même couleur. Tout le reste continue : deux cavaliers contre le roi, cavalier contre
// cavalier, fou contre cavalier… on peut encore y mater, au moins avec l'aide de l'adversaire.
export function insufficientMaterial(board: Int8Array): boolean {
  let knights = 0;
  // Les fous comptés selon la couleur de leur case : (colonne + rangée) pair = case sombre (a1 est sombre).
  const bishops = [0, 0];
  for (let square = 0; square < 64; square++) {
    const type = board[square]! & 7;
    if (type === EMPTY || type === KING) continue;
    if (type === KNIGHT) knights++;
    else if (type === BISHOP) bishops[((square & 7) + (square >> 3)) & 1]!++;
    else return false; // un pion, une tour ou une dame suffit à mater
  }
  if (knights === 0) return bishops[0] === 0 || bishops[1] === 0;
  return knights === 1 && bishops[0] === 0 && bishops[1] === 0;
}

// Après un coup, la première condition vraie décide (R12, FIDE 9.6.2 pour le mat d'abord ; l'ordre des nulles est un choix) : mat, pat, matériel insuffisant,
// triple répétition, règle des 50 coups. `repetitions` : combien de fois la position courante est apparue, elle comprise.
export function endOfGame(analysis: Analysis, repetitions: number): EndReason | null {
  if (analysis.moves.length === 0) return analysis.inCheck ? 'checkmate' : 'stalemate';
  if (insufficientMaterial(analysis.position.board)) return 'insufficient';
  if (repetitions >= 3) return 'threefold';
  // 50 coups de chaque camp = 100 demi-coups sans mouvement de pion ni prise.
  if (analysis.position.halfmove >= 100) return 'fifty';
  return null;
}
