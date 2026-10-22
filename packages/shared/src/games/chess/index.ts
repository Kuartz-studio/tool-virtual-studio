import { z } from 'zod';
import type { ApplyResult, ForfeitReason, GameDefinition, GameResult, GameSetup, Rng } from '../types';
import { analyse, analysePosition, endOfGame, type Analysis, type EndReason } from './analysis';
import { chessInvariants } from './invariants';
import {
  BISHOP,
  BLACK,
  EMPTY,
  FLAG_CASTLE_KING,
  FLAG_CASTLE_QUEEN,
  FLAG_EN_PASSANT,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  moveFlags,
  moveFrom,
  movePromotion,
  moveTo,
  type Color,
} from './position';
import { sanOf } from './san';
import { MAX_PLIES_KEPT, SQUARES, START_FEN, type ChessEvent, type ChessMove, type ChessPly, type ChessState, type PieceType, type Promotion } from './types';

export * from './types';
export { positionKey, stateFromFen };

// Les échecs, règles de la FIDE (§ 13 du document des jeux) écrites à la main, sans dépendance, et prouvées par perft (perft.test.ts). Ce fichier est l'enveloppe du
// contrat `GameDefinition` : il parle JSON (l'état part tel quel à tout le bureau) et laisse le travail à `position.ts` (coups légaux), `analysis.ts` (fin de partie,
// répétitions), `san.ts` et `invariants.ts`.

// La forme d'un coup, pas sa légalité : deux cases, et la pièce choisie quand un pion arrive au bout. Les cases sont énumérées, pas devinées par une expression
// régulière : c'est le type `Square` lui-même.
export const chessMoveSchema: z.ZodType<ChessMove> = z.object({
  from: z.enum(SQUARES),
  to: z.enum(SQUARES),
  promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
});

// Le type d'une pièce (1 à 6) en lettre minuscule : 1 → « p », 5 → « q ».
const pieceLetter = (type: number): PieceType => 'pnbrqk'[type - 1] as PieceType;

const SQUARE_INDEX = new Map<string, number>(SQUARES.map((square, index) => [square, index]));
const PROMOTION_TYPES = new Map<string, number>([['q', QUEEN], ['r', ROOK], ['b', BISHOP], ['n', KNIGHT]]);

// Le siège qui a cette couleur : les Blancs sont à `white`, les Noirs à l'autre (R12 : un siège n'est pas une couleur).
const seatOf = (white: number, color: Color): number => (color === WHITE ? white : 1 - white);

// La couleur au trait, lue sur le FEN sans le décoder en entier (le deuxième champ).
const sideToMove = (fen: string): Color => (fen.charAt(fen.indexOf(' ') + 1) === 'w' ? WHITE : BLACK);

const toChessMove = (packed: number): ChessMove => {
  const promotion = movePromotion(packed);
  const move: ChessMove = { from: SQUARES[moveFrom(packed)]!, to: SQUARES[moveTo(packed)]! };
  if (promotion !== 0) move.promotion = pieceLetter(promotion) as Promotion;
  return move;
};

// Retrouve, parmi les coups légaux, celui que le joueur demande : mêmes cases, et la même pièce de promotion (ni plus, ni moins : une promotion oubliée comme une
// promotion en trop est refusée). Tout ce qui n'est pas la forme d'un coup rend -1 : `apply` se méfie de ce qu'on lui passe (R4).
function findLegalMove(analysis: Analysis, move: unknown): number {
  if (typeof move !== 'object' || move === null) return -1;
  const { from, to, promotion } = move as { from?: unknown; to?: unknown; promotion?: unknown };
  if (typeof from !== 'string' || typeof to !== 'string') return -1;
  const fromIndex = SQUARE_INDEX.get(from);
  const toIndex = SQUARE_INDEX.get(to);
  if (fromIndex === undefined || toIndex === undefined) return -1;
  let promotionType = 0;
  if (promotion !== undefined) {
    const known = typeof promotion === 'string' ? PROMOTION_TYPES.get(promotion) : undefined;
    if (known === undefined) return -1;
    promotionType = known;
  }
  for (const packed of analysis.moves) {
    if (moveFrom(packed) === fromIndex && moveTo(packed) === toIndex && movePromotion(packed) === promotionType) return packed;
  }
  return -1;
}

// Ce qu'une fin de partie découverte par les règles donne : le mat à celui qui vient de jouer, les autres raisons une nulle.
function resultOf(reason: EndReason, mover: number): GameResult {
  return reason === 'checkmate' ? { ranking: [[mover], [1 - mover]], reason } : { ranking: [[0, 1]], reason };
}

// Le demi-coup tel que l'état le garde. `before` : la position avant le coup, `after` : celle qu'il produit.
function plyOf(before: Analysis, packed: number, after: Analysis): ChessPly {
  const from = moveFrom(packed);
  const to = moveTo(packed);
  const flags = moveFlags(packed);
  const promotion = movePromotion(packed);
  const mate = after.inCheck && after.moves.length === 0;
  const captured = flags & FLAG_EN_PASSANT ? PAWN : before.position.board[to]! & 7;
  const ply: ChessPly = {
    from: SQUARES[from]!,
    to: SQUARES[to]!,
    san: sanOf(before.position, before.moves, packed, after.inCheck, mate),
    piece: pieceLetter(before.position.board[from]! & 7),
  };
  // Les clés absentes sont omises, jamais mises à `undefined` (R2 : l'état est du JSON).
  if (promotion !== 0) ply.promotion = pieceLetter(promotion) as Promotion;
  if (captured !== EMPTY) ply.captured = pieceLetter(captured);
  if (flags & FLAG_CASTLE_KING) ply.castle = 'k';
  if (flags & FLAG_CASTLE_QUEEN) ply.castle = 'q';
  if (flags & FLAG_EN_PASSANT) ply.enPassant = true;
  if (after.inCheck) ply.check = true;
  if (mate) ply.mate = true;
  return ply;
}

// La clé de répétition d'un FEN (R10, § 13.3) : placement, trait, droits de roque, puis la case de prise en passant seulement si une prise en passant est légale.
function positionKey(fen: string): string {
  return analyse(fen).key;
}

// Un état de partie posé sur n'importe quel FEN légal : sans demi-coups joués, la position courante comptée une fois. Si la position est déjà finie (mat, pat,
// matériel insuffisant, 50 coups), le résultat l'est aussi : un état est toujours cohérent. Sert aux tests, et aux tests de bout en bout qui fabriquent une fin de
// partie (`debug:game`). `white` : le siège qui a les Blancs.
function stateFromFen(fen: string, white = 0): ChessState {
  const analysis = analyse(fen);
  const reason = endOfGame(analysis, 1);
  // Si la position est un mat, c'est le camp qui n'a pas le trait qui l'a donné.
  const mover = seatOf(white, (1 - analysis.position.turn) as Color);
  return { fen: analysis.fen, white, plies: [], positions: { [analysis.key]: 1 }, result: reason === null ? null : resultOf(reason, mover) };
}

export const chess: GameDefinition<ChessState, ChessMove, ChessEvent> = {
  id: 'chess',
  label: 'Échecs',
  minPlayers: 2,
  maxPlayers: 2,
  drawOffers: true,
  moveSchema: chessMoveSchema,

  create(setup: GameSetup, _rng: Rng) {
    if (setup.seats !== 2) throw new Error('Les échecs se jouent à deux.');
    if (setup.first !== 0 && setup.first !== 1) throw new Error(`Les Blancs vont au siège 0 ou 1, pas au siège ${setup.first}.`);
    return { state: stateFromFen(START_FEN, setup.first), events: [] };
  },

  turn(state) {
    return state.result !== null ? null : seatOf(state.white, sideToMove(state.fen));
  },

  legalMoves(state, seat) {
    if (state.result !== null || seat !== seatOf(state.white, sideToMove(state.fen))) return [];
    return analyse(state.fen).moves.map(toChessMove);
  },

  apply(state, seat, move, _rng): ApplyResult<ChessState, ChessEvent> {
    if (state.result !== null) return { ok: false, error: 'wrong_phase' };
    if (seat !== seatOf(state.white, sideToMove(state.fen))) return { ok: false, error: 'not_your_turn' };
    const before = analyse(state.fen);
    const packed = findLegalMove(before, move);
    if (packed < 0) return { ok: false, error: 'illegal' };

    // On joue sur une copie : la position en mémoire est partagée par tous ceux qui regardent ce FEN.
    const played = before.position.clone();
    played.make(packed);
    const after = analysePosition(played);
    const ply = plyOf(before, packed, after);

    // Un coup irréversible (mouvement de pion, prise, perte d'un droit de roque) interdit à toute position d'avant de revenir : on repart de zéro avant de compter
    // la nouvelle position, et la table garde 101 entrées au plus.
    const irreversible =
      (before.position.board[moveFrom(packed)]! & 7) === PAWN || ply.captured !== undefined || before.position.castling !== played.castling;
    const positions: Record<string, number> = irreversible ? { [after.key]: 1 } : { ...state.positions, [after.key]: (state.positions[after.key] ?? 0) + 1 };
    const reason = endOfGame(after, positions[after.key]!);
    const result = reason === null ? null : resultOf(reason, seat);

    // L'historique est borné (voir MAX_PLIES_KEPT) : au-delà, le plus ancien demi-coup s'en va.
    const plies = [...state.plies, ply];
    if (plies.length > MAX_PLIES_KEPT) plies.splice(0, plies.length - MAX_PLIES_KEPT);

    const events: ChessEvent[] = [{ type: 'move', seat, ply }];
    if (result !== null) events.push({ type: 'end', reason: result.reason, winner: result.reason === 'checkmate' ? seat : null });
    return { ok: true, state: { fen: after.fen, white: state.white, plies, positions, result }, events };
  },

  // L'abandon, l'inactivité et le départ donnent la partie à l'autre, à tout moment (R14), même s'il ne lui reste qu'un roi.
  forfeit(state, seat, reason: ForfeitReason) {
    if (state.result !== null || (seat !== 0 && seat !== 1)) return { state, events: [] };
    const result: GameResult = { ranking: [[1 - seat], [seat]], reason };
    return { state: { ...state, result }, events: [{ type: 'forfeit', seat, reason }, { type: 'end', reason, winner: 1 - seat }] };
  },

  // La plateforme n'appelle ceci qu'après avoir vérifié les conditions de la nulle (R13) : le jeu n'a plus qu'à la prononcer.
  agreeDraw(state) {
    if (state.result !== null) return { state, events: [] };
    const result: GameResult = { ranking: [[0, 1]], reason: 'agreement' };
    return { state: { ...state, result }, events: [{ type: 'draw' }, { type: 'end', reason: 'agreement', winner: null }] };
  },

  result(state) {
    return state.result;
  },

  // Chaque demi-coup compte : la partie est classée dès qu'un coup a été joué par chaque camp (GAME_MIN_RANKED_MOVES). L'abandon et la nulle n'en sont pas.
  countedMoves(state) {
    return state.plies.length;
  },

  invariants(state) {
    return chessInvariants(state);
  },
};
