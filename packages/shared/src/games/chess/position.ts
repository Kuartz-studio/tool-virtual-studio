import { SQUARES } from './types';

// Le cœur des règles : une position, ses coups légaux, jouer et défaire un coup, le FEN. Tout est écrit pour la vitesse (tableaux d'entiers, coups compactés, jouer
// puis défaire sur place) parce que les perft comptent des millions de positions et que les parties au hasard en traversent des centaines de milliers. L'enveloppe
// qui parle JSON (index.ts) reste, elle, lisible. Rien ici n'est écrit à la main d'après une autre bibliothèque : la preuve, ce sont les perft.

export const WHITE = 0;
export const BLACK = 1;
export type Color = 0 | 1;

// Une pièce est son type (1 à 6) plus 8 pour les noires ; 0 est une case vide. Ainsi `piece & 7` donne le type et `piece >> 3` la couleur.
export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

// Les droits de roque tiennent dans quatre bits.
export const CASTLE_WHITE_KING = 1;
export const CASTLE_WHITE_QUEEN = 2;
export const CASTLE_BLACK_KING = 4;
export const CASTLE_BLACK_QUEEN = 8;

// Les particularités d'un coup.
export const FLAG_DOUBLE = 1;
export const FLAG_EN_PASSANT = 2;
export const FLAG_CASTLE_KING = 4;
export const FLAG_CASTLE_QUEEN = 8;

// Un coup tient dans un entier : case de départ et case d'arrivée (6 bits chacune), type de la pièce de promotion (3 bits), puis les drapeaux. On évite ainsi
// d'allouer un objet par coup, ce qui compte pour des perft de plusieurs millions de feuilles. La pièce qui bouge et celle qui est prise se lisent sur l'échiquier.
export const pack = (from: number, to: number, promotion = 0, flags = 0): number => from | (to << 6) | (promotion << 12) | (flags << 15);
export const moveFrom = (move: number): number => move & 63;
export const moveTo = (move: number): number => (move >> 6) & 63;
export const movePromotion = (move: number): number => (move >> 12) & 7;
export const moveFlags = (move: number): number => move >> 15;

// Les cases s'indexent rangée par rangée depuis a1 : index = rangée × 8 + colonne (a1 = 0, h1 = 7, a8 = 56, h8 = 63).
const PIECE_LETTERS = 'pnbrqk';

function pieceFromLetter(letter: string): number {
  const type = PIECE_LETTERS.indexOf(letter.toLowerCase()) + 1;
  if (type === 0 || letter.length !== 1) return -1;
  return letter === letter.toLowerCase() ? type | (BLACK << 3) : type;
}

// Les pièces qui sautent ou font un pas (cavalier, roi), et les huit directions des pièces qui glissent : les quatre premières sont celles de la tour, les quatre
// dernières celles du fou.
const KNIGHT_JUMPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING_STEPS = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;
const DIRECTIONS = KING_STEPS;

// Les cases qu'une pièce à pas fixes atteint depuis chaque case, déjà bornées à l'échiquier.
function stepTargets(steps: ReadonlyArray<readonly [number, number]>): number[][] {
  return Array.from({ length: 64 }, (_, square) =>
    steps.flatMap(([df, dr]) => {
      const file = (square & 7) + df;
      const rank = (square >> 3) + dr;
      return file >= 0 && file < 8 && rank >= 0 && rank < 8 ? [rank * 8 + file] : [];
    }),
  );
}
const KNIGHT_TARGETS = stepTargets(KNIGHT_JUMPS);
const KING_TARGETS = stepTargets(KING_STEPS);

// Pour chaque case et chaque direction, les cases qu'on rencontre en s'éloignant, dans l'ordre.
const RAYS: number[][][] = Array.from({ length: 64 }, (_, square) =>
  DIRECTIONS.map(([df, dr]) => {
    const ray: number[] = [];
    let file = (square & 7) + df;
    let rank = (square >> 3) + dr;
    while (file >= 0 && file < 8 && rank >= 0 && rank < 8) {
      ray.push(rank * 8 + file);
      file += df;
      rank += dr;
    }
    return ray;
  }),
);

// Quand un coup part d'une de ces cases ou y arrive, des droits de roque disparaissent : la case du roi les ôte tous les deux, celle d'une tour le sien. Cela couvre
// aussi la tour prise sur sa case de départ.
const CASTLE_MASK = new Uint8Array(64).fill(15);
CASTLE_MASK[0] = 15 & ~CASTLE_WHITE_QUEEN;
CASTLE_MASK[4] = 15 & ~(CASTLE_WHITE_KING | CASTLE_WHITE_QUEEN);
CASTLE_MASK[7] = 15 & ~CASTLE_WHITE_KING;
CASTLE_MASK[56] = 15 & ~CASTLE_BLACK_QUEEN;
CASTLE_MASK[60] = 15 & ~(CASTLE_BLACK_KING | CASTLE_BLACK_QUEEN);
CASTLE_MASK[63] = 15 & ~CASTLE_BLACK_KING;

// Les pièces qu'un pion peut devenir, dans l'ordre où on les propose.
const PROMOTIONS = [QUEEN, ROOK, BISHOP, KNIGHT] as const;

// Cette case est-elle attaquée par une pièce de cette couleur ? On part de la case et on cherche : pions, cavaliers, roi, puis chaque direction jusqu'à la première
// pièce rencontrée.
export function isAttacked(board: Int8Array, square: number, by: Color): boolean {
  const offset = by << 3;
  const file = square & 7;
  const rank = square >> 3;
  // Un pion blanc attaque vers le haut : ses attaquants sont une rangée plus bas (plus haut pour un pion noir).
  const pawnRank = by === WHITE ? rank - 1 : rank + 1;
  if (pawnRank >= 0 && pawnRank < 8) {
    const pawn = PAWN | offset;
    if (file > 0 && board[pawnRank * 8 + file - 1] === pawn) return true;
    if (file < 7 && board[pawnRank * 8 + file + 1] === pawn) return true;
  }
  const knight = KNIGHT | offset;
  const knightTargets = KNIGHT_TARGETS[square]!;
  for (let i = 0; i < knightTargets.length; i++) if (board[knightTargets[i]!] === knight) return true;
  const king = KING | offset;
  const kingTargets = KING_TARGETS[square]!;
  for (let i = 0; i < kingTargets.length; i++) if (board[kingTargets[i]!] === king) return true;
  const rook = ROOK | offset;
  const bishop = BISHOP | offset;
  const queen = QUEEN | offset;
  const rays = RAYS[square]!;
  for (let direction = 0; direction < 8; direction++) {
    const slider = direction < 4 ? rook : bishop;
    const ray = rays[direction]!;
    for (let i = 0; i < ray.length; i++) {
      const piece = board[ray[i]!]!;
      if (piece === EMPTY) continue;
      if (piece === slider || piece === queen) return true;
      break;
    }
  }
  return false;
}

// Une position : l'échiquier, le trait, les droits de roque, la case de prise en passant et les deux compteurs du FEN. Elle se joue et se défait sur place (`make`,
// `unmake`) ; l'enveloppe qui la garde en mémoire ne la modifie jamais, elle en prend une copie (`clone`) avant de jouer.
export class Position {
  readonly board = new Int8Array(64);
  turn: Color = WHITE;
  castling = 0;
  // La case « derrière » le pion qui vient d'avancer de deux cases, ou -1. Elle est posée après toute avance de deux cases, même quand aucune prise n'est possible
  // (c'est le FEN standard) ; les coups, eux, ne l'utilisent que si la prise existe.
  enPassant = -1;
  halfmove = 0;
  fullmove = 1;
  // La case de chaque roi, tenue à jour par `make` : tester l'échec après chaque coup pseudo-légal doit rester bon marché.
  readonly kings: [number, number] = [-1, -1];
  // Ce qu'il faut pour défaire un coup, quatre entiers par coup joué : pièce prise, droits de roque, case de prise en passant, demi-coups.
  private readonly undo: number[] = [];

  // Lit un FEN de 4 à 6 champs (les compteurs manquants valent 0 et 1). Lève une `Error` en français sur tout ce qui n'est pas un FEN, ou qui n'a pas exactement un
  // roi de chaque couleur : sans roi, le moteur n'aurait plus rien à tester.
  static fromFen(fen: string): Position {
    const fields = fen.trim().split(/\s+/);
    if (fields.length < 4 || fields.length > 6) throw new Error(`FEN illisible : ${fields.length} champ(s) au lieu de 4 à 6`);
    const [placement, side, rights, enPassant, halfmove = '0', fullmove = '1'] = fields as [string, string, string, string, string?, string?];
    const position = new Position();

    const ranks = placement.split('/');
    if (ranks.length !== 8) throw new Error('FEN illisible : le plateau n\'a pas huit rangées');
    const kings = [0, 0];
    for (let index = 0; index < 8; index++) {
      const rank = 7 - index;
      let file = 0;
      for (const letter of ranks[index]!) {
        if (letter >= '1' && letter <= '8') {
          file += Number(letter);
          continue;
        }
        const piece = pieceFromLetter(letter);
        if (piece < 0 || file > 7) throw new Error(`FEN illisible : « ${letter} » n'a pas sa place dans la rangée ${rank + 1}`);
        position.board[rank * 8 + file] = piece;
        if ((piece & 7) === KING) {
          kings[piece >> 3]!++;
          position.kings[piece >> 3 === WHITE ? WHITE : BLACK] = rank * 8 + file;
        }
        file++;
      }
      if (file !== 8) throw new Error(`FEN illisible : la rangée ${rank + 1} n'a pas huit cases`);
    }
    if (kings[0] !== 1 || kings[1] !== 1) throw new Error('FEN illisible : il faut exactement un roi de chaque couleur');

    if (side !== 'w' && side !== 'b') throw new Error(`FEN illisible : le trait « ${side} » n'est ni w ni b`);
    position.turn = side === 'w' ? WHITE : BLACK;

    if (rights !== '-') {
      if (!/^(?!.*(.).*\1)[KQkq]+$/.test(rights)) throw new Error(`FEN illisible : les droits de roque « ${rights} »`);
      if (rights.includes('K')) position.castling |= CASTLE_WHITE_KING;
      if (rights.includes('Q')) position.castling |= CASTLE_WHITE_QUEEN;
      if (rights.includes('k')) position.castling |= CASTLE_BLACK_KING;
      if (rights.includes('q')) position.castling |= CASTLE_BLACK_QUEEN;
    }

    if (enPassant !== '-') {
      if (!/^[a-h][1-8]$/.test(enPassant)) throw new Error(`FEN illisible : la case de prise en passant « ${enPassant} »`);
      position.enPassant = SQUARES.indexOf(enPassant as (typeof SQUARES)[number]);
    }

    if (!/^\d{1,6}$/.test(halfmove) || !/^\d{1,6}$/.test(fullmove)) throw new Error('FEN illisible : les compteurs de coups doivent être des entiers');
    position.halfmove = Number(halfmove);
    position.fullmove = Number(fullmove);
    return position;
  }

  // Le FEN complet, à six champs. La case de prise en passant est écrite telle qu'elle a été posée.
  toFen(): string {
    let placement = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const piece = this.board[rank * 8 + file]!;
        if (piece === EMPTY) {
          empty++;
          continue;
        }
        if (empty > 0) placement += empty;
        empty = 0;
        const letter = PIECE_LETTERS[(piece & 7) - 1]!;
        placement += piece >> 3 === WHITE ? letter.toUpperCase() : letter;
      }
      if (empty > 0) placement += empty;
      if (rank > 0) placement += '/';
    }
    const rights =
      (this.castling & CASTLE_WHITE_KING ? 'K' : '') +
      (this.castling & CASTLE_WHITE_QUEEN ? 'Q' : '') +
      (this.castling & CASTLE_BLACK_KING ? 'k' : '') +
      (this.castling & CASTLE_BLACK_QUEEN ? 'q' : '');
    const enPassant = this.enPassant < 0 ? '-' : SQUARES[this.enPassant]!;
    return `${placement} ${this.turn === WHITE ? 'w' : 'b'} ${rights || '-'} ${enPassant} ${this.halfmove} ${this.fullmove}`;
  }

  clone(): Position {
    const copy = new Position();
    copy.board.set(this.board);
    copy.turn = this.turn;
    copy.castling = this.castling;
    copy.enPassant = this.enPassant;
    copy.halfmove = this.halfmove;
    copy.fullmove = this.fullmove;
    copy.kings[0] = this.kings[0];
    copy.kings[1] = this.kings[1];
    return copy;
  }

  // Le camp au trait est-il en échec ?
  inCheck(): boolean {
    return isAttacked(this.board, this.kings[this.turn], (1 - this.turn) as Color);
  }

  // Joue un coup pseudo-légal ou légal sur place. `unmake` le défait ; sans lui, la position reste jouée.
  make(move: number): void {
    const from = moveFrom(move);
    const to = moveTo(move);
    const promotion = movePromotion(move);
    const flags = moveFlags(move);
    const board = this.board;
    const us = this.turn;
    const piece = board[from]!;
    let captured = board[to]!;
    if (flags & FLAG_EN_PASSANT) {
      // Le pion pris n'est pas sur la case d'arrivée mais à côté de la case de départ.
      const victim = us === WHITE ? to - 8 : to + 8;
      captured = board[victim]!;
      board[victim] = EMPTY;
    }
    this.undo.push(captured, this.castling, this.enPassant, this.halfmove);
    board[to] = promotion ? promotion | (us << 3) : piece;
    board[from] = EMPTY;
    if (flags & FLAG_CASTLE_KING) {
      board[to - 1] = board[to + 1]!;
      board[to + 1] = EMPTY;
    } else if (flags & FLAG_CASTLE_QUEEN) {
      board[to + 1] = board[to - 2]!;
      board[to - 2] = EMPTY;
    }
    if ((piece & 7) === KING) this.kings[us] = to;
    this.castling &= CASTLE_MASK[from]! & CASTLE_MASK[to]!;
    // La case de prise en passant est celle que le pion a survolée : le milieu de son avance.
    this.enPassant = flags & FLAG_DOUBLE ? (from + to) >> 1 : -1;
    this.halfmove = (piece & 7) === PAWN || captured !== EMPTY ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.turn = (1 - us) as Color;
  }

  // Défait le dernier coup joué par `make` (le même, passé en argument).
  unmake(move: number): void {
    const from = moveFrom(move);
    const to = moveTo(move);
    const promotion = movePromotion(move);
    const flags = moveFlags(move);
    const board = this.board;
    const us = (1 - this.turn) as Color;
    this.halfmove = this.undo.pop()!;
    this.enPassant = this.undo.pop()!;
    this.castling = this.undo.pop()!;
    const captured = this.undo.pop()!;
    // Une promotion défaite redevient un pion.
    const piece = promotion ? PAWN | (us << 3) : board[to]!;
    board[from] = piece;
    if (flags & FLAG_EN_PASSANT) {
      board[to] = EMPTY;
      board[us === WHITE ? to - 8 : to + 8] = captured;
    } else {
      board[to] = captured;
    }
    if (flags & FLAG_CASTLE_KING) {
      board[to + 1] = board[to - 1]!;
      board[to - 1] = EMPTY;
    } else if (flags & FLAG_CASTLE_QUEEN) {
      board[to - 2] = board[to + 1]!;
      board[to + 1] = EMPTY;
    }
    if ((piece & 7) === KING) this.kings[us] = from;
    if (us === BLACK) this.fullmove--;
    this.turn = us;
  }

  // Tous les coups légaux du camp au trait : on génère les coups pseudo-légaux, puis on rejette ceux qui laissent son roi attaqué (jouer, tester, défaire). C'est la
  // règle R6 telle quelle, sans cas particulier : clouages, prise en passant qui découvre le roi et roi qui prend une pièce protégée y passent tous.
  legalMoves(): number[] {
    const pseudo: number[] = [];
    this.pseudoLegalMoves(pseudo);
    const us = this.turn;
    const them = (1 - us) as Color;
    const legal: number[] = [];
    for (let index = 0; index < pseudo.length; index++) {
      const move = pseudo[index]!;
      this.make(move);
      if (!isAttacked(this.board, this.kings[us], them)) legal.push(move);
      this.unmake(move);
    }
    return legal;
  }

  // Les coups que les pièces du camp au trait peuvent faire en ignorant l'échec, roques compris (ceux-là vérifient leurs cases eux-mêmes).
  pseudoLegalMoves(out: number[]): void {
    const board = this.board;
    const us = this.turn;
    for (let from = 0; from < 64; from++) {
      const piece = board[from]!;
      if (piece === EMPTY || piece >> 3 !== us) continue;
      switch (piece & 7) {
        case PAWN:
          this.pawnMoves(from, out);
          break;
        case KNIGHT:
          this.stepMoves(from, KNIGHT_TARGETS[from]!, out);
          break;
        case BISHOP:
          this.slideMoves(from, 4, 8, out);
          break;
        case ROOK:
          this.slideMoves(from, 0, 4, out);
          break;
        case QUEEN:
          this.slideMoves(from, 0, 8, out);
          break;
        default:
          this.stepMoves(from, KING_TARGETS[from]!, out);
          this.castlingMoves(from, out);
      }
    }
  }

  private stepMoves(from: number, targets: readonly number[], out: number[]): void {
    const us = this.turn;
    for (let i = 0; i < targets.length; i++) {
      const to = targets[i]!;
      const target = this.board[to]!;
      if (target === EMPTY || target >> 3 !== us) out.push(pack(from, to));
    }
  }

  // Les directions `first` à `last - 1` de la table des rayons : on avance jusqu'à la première pièce, qu'on prend si elle est adverse.
  private slideMoves(from: number, first: number, last: number, out: number[]): void {
    const us = this.turn;
    const rays = RAYS[from]!;
    for (let direction = first; direction < last; direction++) {
      const ray = rays[direction]!;
      for (let i = 0; i < ray.length; i++) {
        const to = ray[i]!;
        const target = this.board[to]!;
        if (target === EMPTY) {
          out.push(pack(from, to));
          continue;
        }
        if (target >> 3 !== us) out.push(pack(from, to));
        break;
      }
    }
  }

  private pawnMoves(from: number, out: number[]): void {
    const board = this.board;
    const us = this.turn;
    const forward = us === WHITE ? 8 : -8;
    const one = from + forward;
    // Un pion ne peut pas être sur la dernière rangée (l'état le garantit) : s'il y était, il n'aurait plus de case devant lui.
    if (one < 0 || one > 63) return;
    const lastRank = us === WHITE ? 7 : 0;
    if (board[one] === EMPTY) {
      if (one >> 3 === lastRank) for (const promotion of PROMOTIONS) out.push(pack(from, one, promotion));
      else out.push(pack(from, one));
      if (from >> 3 === (us === WHITE ? 1 : 6) && board[one + forward] === EMPTY) out.push(pack(from, one + forward, 0, FLAG_DOUBLE));
    }
    const file = from & 7;
    if (file > 0) this.pawnCapture(from, one - 1, lastRank, out);
    if (file < 7) this.pawnCapture(from, one + 1, lastRank, out);
  }

  // Une prise en diagonale : sur une pièce adverse, ou en passant sur la case que le pion adverse vient de survoler.
  private pawnCapture(from: number, to: number, lastRank: number, out: number[]): void {
    const us = this.turn;
    const target = this.board[to]!;
    if (target !== EMPTY) {
      if (target >> 3 === us) return;
      if (to >> 3 === lastRank) for (const promotion of PROMOTIONS) out.push(pack(from, to, promotion));
      else out.push(pack(from, to));
      return;
    }
    if (to !== this.enPassant || to >> 3 !== (us === WHITE ? 5 : 2)) return;
    // Le pion à prendre est juste derrière la case de prise en passant, du point de vue de celui qui prend.
    const victim = us === WHITE ? to - 8 : to + 8;
    if (this.board[victim] === (PAWN | ((1 - us) << 3))) out.push(pack(from, to, 0, FLAG_EN_PASSANT));
  }

  // Le roque (R5) : le droit est tenu, le roi et la tour sont sur leurs cases, les cases entre eux sont vides, et ni le roi, ni la case qu'il traverse, ni celle où il
  // arrive ne sont attaqués. La tour, elle, peut l'être ; et au grand roque la case b peut l'être, du moment qu'elle est vide : le roi ne la traverse pas.
  private castlingMoves(from: number, out: number[]): void {
    const us = this.turn;
    if (from !== (us === WHITE ? 4 : 60)) return;
    const kingSide = us === WHITE ? CASTLE_WHITE_KING : CASTLE_BLACK_KING;
    const queenSide = us === WHITE ? CASTLE_WHITE_QUEEN : CASTLE_BLACK_QUEEN;
    if ((this.castling & (kingSide | queenSide)) === 0) return;
    const board = this.board;
    const them = (1 - us) as Color;
    if (isAttacked(board, from, them)) return;
    const rook = ROOK | (us << 3);
    if (
      this.castling & kingSide &&
      board[from + 3] === rook &&
      board[from + 1] === EMPTY &&
      board[from + 2] === EMPTY &&
      !isAttacked(board, from + 1, them) &&
      !isAttacked(board, from + 2, them)
    ) {
      out.push(pack(from, from + 2, 0, FLAG_CASTLE_KING));
    }
    if (
      this.castling & queenSide &&
      board[from - 4] === rook &&
      board[from - 1] === EMPTY &&
      board[from - 2] === EMPTY &&
      board[from - 3] === EMPTY &&
      !isAttacked(board, from - 1, them) &&
      !isAttacked(board, from - 2, them)
    ) {
      out.push(pack(from, from - 2, 0, FLAG_CASTLE_QUEEN));
    }
  }
}
