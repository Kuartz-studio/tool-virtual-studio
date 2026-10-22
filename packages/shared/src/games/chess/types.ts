import type { ForfeitReason, GameResult } from '../types';

// Les types que l'état, les coups et les événements des échecs partagent avec l'interface. Tout est du JSON : l'état part tel quel à tout le bureau à chaque coup.

export type FileLetter = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
export type Square = `${FileLetter}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Promotion = 'q' | 'r' | 'b' | 'n';

// Les soixante-quatre cases, dans l'ordre des indices du moteur : a1 = 0, b1 = 1, … h1 = 7, a2 = 8, … h8 = 63.
export const SQUARES: readonly Square[] = Array.from({ length: 64 }, (_, index) => `${'abcdefgh'[index & 7]}${(index >> 3) + 1}` as Square);

// La position de départ, en FEN : le premier mot du plateau est la huitième rangée, vue des Blancs.
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Ce qu'un joueur envoie : la case de départ, celle d'arrivée, et la pièce choisie quand un pion arrive au bout. Le roque se joue en amenant le roi sur g1/c1
// (g8/c8) ; le client n'envoie jamais de notation (SAN).
export interface ChessMove {
  from: Square;
  to: Square;
  promotion?: Promotion;
}

// Un demi-coup joué, tel que l'historique et l'animation le veulent. Les clés absentes ne valent « rien » : on les omet plutôt que de les mettre à `undefined`.
export interface ChessPly {
  from: Square;
  to: Square;
  promotion?: Promotion;
  // La notation algébrique abrégée anglaise standard : « Nf3 », « exf6 », « O-O », « a8=Q+ », « Qxf7# ». Le client la met en français pour l'écran.
  san: string;
  // La pièce qui a bougé (le pion, pour une promotion).
  piece: PieceType;
  captured?: PieceType;
  castle?: 'k' | 'q';
  enPassant?: true;
  // Le roi adverse est en échec. Un mat est aussi un échec : `check` et `mate` sont alors tous deux vrais.
  check?: true;
  mate?: true;
}

// Combien de demi-coups l'état garde au plus : les derniers. L'état part à tout le bureau à chaque coup et doit rester sous 50 ko de JSON (R8) ; un demi-coup en pèse
// une cinquantaine, donc 600 d'entre eux (300 coups, plus que la plus longue partie jouée, 269 coups) tiennent en 35 ko avec le reste de l'état. Sans cette borne,
// environ une partie au hasard sur dix mille dépasse 50 ko (la plus longue d'un essai de dix mille : 952 demi-coups, 50 148 octets), et le document demande à la
// fois tout l'historique et ces 50 ko, ce que seule une borne concilie. Passé 600, le plus ancien est oublié : le numéro d'un demi-coup se déduit alors du compteur
// de coups du FEN, pas de sa place dans la liste, et les pièces prises se lisent sur le plateau (matériel manquant), pas dans `captured`.
export const MAX_PLIES_KEPT = 600;

export interface ChessState {
  // La position, en FEN complète (six champs). La case de prise en passant y figure après toute avance de deux cases, même quand aucune prise n'est possible.
  fen: string;
  // Le siège qui a les Blancs (= setup.first) : les sièges ne sont pas des couleurs (R12).
  white: number;
  // Les demi-coups joués depuis le début de la partie, les MAX_PLIES_KEPT derniers au plus.
  plies: ChessPly[];
  // Clé de répétition → nombre d'apparitions, depuis le dernier coup irréversible : au plus 101 entrées.
  positions: Record<string, number>;
  result: GameResult | null;
}

export type ChessEvent =
  | { type: 'move'; seat: number; ply: ChessPly }
  | { type: 'end'; reason: string; winner: number | null }
  | { type: 'forfeit'; seat: number; reason: ForfeitReason }
  | { type: 'draw' };
