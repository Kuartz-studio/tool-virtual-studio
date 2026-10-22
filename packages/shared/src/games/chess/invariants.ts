import { analyse, endOfGame, type Analysis, type EndReason } from './analysis';
import { BLACK, CASTLE_BLACK_KING, CASTLE_BLACK_QUEEN, CASTLE_WHITE_KING, CASTLE_WHITE_QUEEN, KING, PAWN, ROOK, WHITE, isAttacked, type Color } from './position';
import { MAX_PLIES_KEPT, SQUARES } from './types';

// Les invariants d'un état d'échecs (§ 13.3 du document des jeux) : tout état que le jeu produit les satisfait, et tout état fabriqué à la main (les tests de bout en
// bout en posent) doit les satisfaire pour être accepté. Une phrase par violation, jamais une exception : l'entrée peut être n'importe quoi.

// Les raisons de fin que le moteur découvre seul, et celles que la plateforme apporte.
const ENGINE_REASONS: readonly string[] = ['checkmate', 'stalemate', 'insufficient', 'threefold', 'fifty'];
const FORFEIT_END_REASONS: readonly string[] = ['resign', 'timeout', 'disconnect'];

// Le siège qui joue la couleur donnée.
const seatOf = (white: number, color: Color): number => (color === WHITE ? white : 1 - white);

// Les droits de roque, avec la case du roi et celle de la tour que chacun suppose.
const CASTLING_RIGHTS = [
  { bit: CASTLE_WHITE_KING, name: 'K', king: 4, rook: 7, color: WHITE },
  { bit: CASTLE_WHITE_QUEEN, name: 'Q', king: 4, rook: 0, color: WHITE },
  { bit: CASTLE_BLACK_KING, name: 'k', king: 60, rook: 63, color: BLACK },
  { bit: CASTLE_BLACK_QUEEN, name: 'q', king: 60, rook: 56, color: BLACK },
] as const;

function checkPosition(analysis: Analysis, problems: string[]): void {
  const { board, castling, enPassant, turn, fullmove } = analysis.position;

  for (let square = 0; square < 64; square++) {
    if ((board[square]! & 7) === PAWN && (square < 8 || square >= 56)) problems.push(`un pion est sur la première ou la huitième rangée (${SQUARES[square]})`);
  }

  // Le camp qui n'a pas le trait vient de jouer : son roi ne peut pas être attaqué, sinon le coup précédent aurait laissé son roi en échec.
  const idle = (1 - turn) as Color;
  if (isAttacked(board, analysis.position.kings[idle], turn)) problems.push('le camp qui n\'a pas le trait est en échec : le coup précédent aurait laissé son roi attaqué');

  for (const right of CASTLING_RIGHTS) {
    if (!(castling & right.bit)) continue;
    const colorBits = right.color << 3;
    if (board[right.king] !== (KING | colorBits) || board[right.rook] !== (ROOK | colorBits)) {
      problems.push(`le droit de roque « ${right.name} » n'a plus son roi et sa tour sur leurs cases de départ`);
    }
  }

  if (enPassant >= 0) {
    // Les Noirs au trait : un pion blanc vient d'avancer de deux cases, la case de prise en passant est sur la 3e rangée, le pion est en face sur la 4e. Les Blancs au
    // trait : la 6e rangée et la 5e. La case et celle d'où le pion est parti sont vides.
    const rank = enPassant >> 3;
    const expectedRank = turn === WHITE ? 5 : 2;
    const forward = turn === WHITE ? -8 : 8;
    const pawn = PAWN | ((1 - turn) << 3);
    if (rank !== expectedRank) {
      problems.push(`la case de prise en passant ${SQUARES[enPassant]} n'est pas sur la ${expectedRank + 1}e rangée, où elle doit être avec ${turn === WHITE ? 'les Blancs' : 'les Noirs'} au trait`);
    } else if (board[enPassant] !== 0 || board[enPassant - forward] !== 0 || board[enPassant + forward] !== pawn) {
      problems.push(`la case de prise en passant ${SQUARES[enPassant]} n'a pas, devant elle, le pion qui vient d'avancer de deux cases (cases à vider ou pion manquant)`);
    }
  }

  if (fullmove < 1) problems.push('le numéro du coup vaut 0 : il commence à 1');
}

// L'état de `positions` : la position courante y figure, chaque compte est un entier d'au moins 1.
function checkPositions(analysis: Analysis, positions: Record<string, unknown>, problems: string[]): void {
  for (const [key, count] of Object.entries(positions)) {
    if (!Number.isInteger(count) || (count as number) < 1) problems.push(`positions : « ${key} » compte ${String(count)} apparition(s), un entier d'au moins 1 est attendu`);
  }
  if (!Number.isInteger(positions[analysis.key])) problems.push('positions ne contient pas la clé de répétition de la position courante');
}

// Le résultat et la position doivent dire la même chose : pas de résultat tant que la position n'est pas finie, et un résultat qui correspond à ce qu'elle est.
function checkResult(state: { white: number; result: unknown }, analysis: Analysis, positions: Record<string, unknown>, problems: string[]): void {
  const repetitions = Number.isInteger(positions[analysis.key]) ? (positions[analysis.key] as number) : 0;
  const ended: EndReason | null = endOfGame(analysis, repetitions);
  const result = state.result;
  if (result === null) {
    if (ended !== null) problems.push(`la partie est finie (${ended}) mais le résultat est nul`);
    return;
  }
  if (typeof result !== 'object' || result === undefined) {
    problems.push('le résultat n\'est ni nul ni un objet');
    return;
  }
  const { ranking, reason } = result as { ranking?: unknown; reason?: unknown };
  if (typeof reason !== 'string') {
    problems.push('le résultat n\'a pas de raison');
    return;
  }
  const seats = Array.isArray(ranking) ? (ranking as unknown[]).flatMap((group) => (Array.isArray(group) ? (group as unknown[]) : [NaN])) : [NaN];
  if (seats.length !== 2 || !seats.includes(0) || !seats.includes(1)) {
    problems.push(`le classement ${JSON.stringify(ranking)} doit contenir les sièges 0 et 1, chacun une fois`);
    return;
  }
  if (ENGINE_REASONS.includes(reason)) {
    if (reason !== ended) problems.push(`le résultat dit « ${reason} » mais la position dit « ${ended ?? 'la partie continue'} »`);
    if (reason === 'checkmate') {
      // Celui qui n'a pas le trait vient de jouer le mat : c'est lui le gagnant.
      const winner = seatOf(state.white, (1 - analysis.position.turn) as Color);
      if (JSON.stringify(ranking) !== JSON.stringify([[winner], [1 - winner]])) problems.push(`un mat doit classer le gagnant (siège ${winner}) devant l'autre : ${JSON.stringify(ranking)}`);
    } else if (JSON.stringify(ranking) !== JSON.stringify([[0, 1]])) {
      problems.push(`une nulle doit se classer en un seul groupe [[0, 1]] : ${JSON.stringify(ranking)}`);
    }
  } else if (FORFEIT_END_REASONS.includes(reason)) {
    if ((ranking as unknown[]).length !== 2) problems.push(`une défaite (${reason}) classe un gagnant puis un perdant : ${JSON.stringify(ranking)}`);
  } else if (reason === 'agreement') {
    if (JSON.stringify(ranking) !== JSON.stringify([[0, 1]])) problems.push(`la nulle par accord doit se classer en un seul groupe [[0, 1]] : ${JSON.stringify(ranking)}`);
  } else {
    problems.push(`la raison de fin « ${reason} » est inconnue`);
  }
}

export function chessInvariants(input: unknown): string[] {
  const problems: string[] = [];
  try {
    if (typeof input !== 'object' || input === null) return ['l\'état n\'est pas un objet'];
    const state = input as { fen?: unknown; white?: unknown; plies?: unknown; positions?: unknown; result?: unknown };
    if (typeof state.fen !== 'string') problems.push('le FEN manque ou n\'est pas du texte');
    if (state.white !== 0 && state.white !== 1) problems.push(`le siège des Blancs vaut ${String(state.white)} au lieu de 0 ou 1`);
    if (!Array.isArray(state.plies)) problems.push('les demi-coups ne sont pas une liste');
    else if (state.plies.length > MAX_PLIES_KEPT) problems.push(`l'historique garde ${state.plies.length} demi-coups, ${MAX_PLIES_KEPT} au plus (l'état doit rester petit)`);
    const positions = state.positions;
    if (typeof positions !== 'object' || positions === null || Array.isArray(positions)) problems.push('positions n\'est pas un objet');
    if (state.result === undefined) problems.push('le résultat manque (il vaut null tant que la partie dure)');
    if (problems.length > 0 || typeof state.fen !== 'string') return problems;

    let analysis: Analysis;
    try {
      analysis = analyse(state.fen);
    } catch (err) {
      return [err instanceof Error ? err.message : String(err)];
    }
    checkPosition(analysis, problems);
    checkPositions(analysis, positions as Record<string, unknown>, problems);
    checkResult({ white: state.white as number, result: state.result }, analysis, positions as Record<string, unknown>, problems);
  } catch (err) {
    problems.push(`l'état n'a pas pu être examiné : ${err instanceof Error ? err.message : String(err)}`);
  }
  return problems;
}
