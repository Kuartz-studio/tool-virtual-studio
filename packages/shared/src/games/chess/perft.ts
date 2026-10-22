import { scriptedRng } from '../rng';
import { chess } from './index';
import {
  FLAG_CASTLE_KING,
  FLAG_CASTLE_QUEEN,
  FLAG_EN_PASSANT,
  EMPTY,
  Position,
  moveFlags,
  moveFrom,
  movePromotion,
  moveTo,
} from './position';
import { SQUARES, type ChessState } from './types';

// Les perft (« performance test ») : on compte les positions atteignables en n demi-coups depuis une position. Les nombres, publiés pour des positions classiques
// (Chess Programming Wiki), sont la preuve que les coups légaux sont justes : une règle fausse (roque, prise en passant, clouage, promotion) fait sortir au moins un
// nombre de sa valeur. Ce fichier ne sert qu'aux tests ; le client ne l'importe pas.

function count(position: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = position.legalMoves();
  // À la dernière profondeur, compter les coups légaux suffit : pas besoin de les jouer un à un.
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) {
    position.make(move);
    nodes += count(position, depth - 1);
    position.unmake(move);
  }
  return nodes;
}

// Le nombre de positions atteignables en `depth` demi-coups depuis ce FEN.
export function perft(fen: string, depth: number): number {
  return count(Position.fromFen(fen), depth);
}

// Le même nombre, réparti par premier coup (« divide ») : pour chercher d'où vient un écart avec une valeur publiée, on compare cette liste à celle d'un moteur sûr.
export function perftDivide(fen: string, depth: number): Record<string, number> {
  const position = Position.fromFen(fen);
  const parts: Record<string, number> = {};
  for (const move of position.legalMoves()) {
    const promotion = movePromotion(move);
    const name = `${SQUARES[moveFrom(move)]}${SQUARES[moveTo(move)]}${promotion ? 'nbrq'[promotion - 2]! : ''}`;
    position.make(move);
    parts[name] = count(position, depth - 1);
    position.unmake(move);
  }
  return parts;
}

// Ce que les coups de la dernière profondeur ont de particulier : le détail publié en même temps que les nombres, qui attrape des erreurs que le seul total laisserait
// passer (une prise en passant de trop compensée par un roque de moins, par exemple).
export interface PerftDetail {
  nodes: number;
  captures: number;
  enPassant: number;
  castles: number;
  promotions: number;
  checks: number;
  mates: number;
}

export function perftDetail(fen: string, depth: number): PerftDetail {
  const detail: PerftDetail = { nodes: 0, captures: 0, enPassant: 0, castles: 0, promotions: 0, checks: 0, mates: 0 };
  const position = Position.fromFen(fen);
  const walk = (remaining: number): void => {
    for (const move of position.legalMoves()) {
      if (remaining > 1) {
        position.make(move);
        walk(remaining - 1);
        position.unmake(move);
        continue;
      }
      // Dernier demi-coup : on le classe avant de le jouer, puis on regarde si l'adversaire est en échec, et s'il est mat.
      const flags = moveFlags(move);
      detail.nodes++;
      if (position.board[moveTo(move)] !== EMPTY || flags & FLAG_EN_PASSANT) detail.captures++;
      if (flags & FLAG_EN_PASSANT) detail.enPassant++;
      if (flags & (FLAG_CASTLE_KING | FLAG_CASTLE_QUEEN)) detail.castles++;
      if (movePromotion(move) !== 0) detail.promotions++;
      position.make(move);
      if (position.inCheck()) {
        detail.checks++;
        if (position.legalMoves().length === 0) detail.mates++;
      }
      position.unmake(move);
    }
  };
  if (depth > 0) walk(depth);
  return detail;
}

// Le même compte, mais à travers l'enveloppe du jeu : `legalMoves` et `apply`, états JSON. Il prouve ce que le perft du moteur ne voit pas : que chaque coup légal,
// remis à notre forme (promotions, roques, prise en passant), est accepté par `apply` et donne une position juste. Les fins de partie (mat, pat) y arrêtent
// la descente d'elles-mêmes, comme dans un vrai perft ; les profondeurs d'essai ne vont jamais jusqu'à un matériel insuffisant ni jusqu'à une répétition.
export function perftApi(state: ChessState, depth: number): number {
  if (depth === 0) return 1;
  const seat = chess.turn(state);
  if (seat === null) return 0;
  let nodes = 0;
  for (const move of chess.legalMoves(state, seat)) {
    const out = chess.apply(state, seat, move, scriptedRng([]));
    if (!out.ok) throw new Error(`perftApi : le coup légal ${JSON.stringify(move)} est refusé (${out.error}) dans ${state.fen}`);
    nodes += perftApi(out.state, depth - 1);
  }
  return nodes;
}
