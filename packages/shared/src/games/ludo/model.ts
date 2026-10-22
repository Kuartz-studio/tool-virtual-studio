import { z } from 'zod';
import type { ForfeitReason, GameResult } from '../types';

// L'état, les coups et les événements des petits chevaux (variante « bureau », document des jeux § 16). Tout est du JSON : l'état part à tout le bureau à chaque coup.
// Les avancées des chevaux (voir board.ts) : −1 à l'écurie ; 0 à 50 sur la piste (0 = leur case de départ) ; 51 à 55 dans leur allée ; 56 arrivé.

export type LudoPhase = 'roll' | 'move' | 'over';

// Le dernier cheval déplacé, pour que le plateau le montre. `captured` n'existe (la clé est absente) que s'il y a eu une prise : jamais `undefined` dans un état JSON.
export interface LudoLast {
  seat: number;
  horse: number;
  from: number;
  to: number;
  captured?: { seat: number; horse: number };
}

export interface LudoState {
  // La couleur de chaque siège : 0 rouge, 1 vert, 2 jaune, 3 bleu. Le siège k a la couleur colors[k] (à deux, le siège 1 est jaune : un siège n'est pas une couleur).
  colors: number[];
  // horses[siège][cheval] : l'avancée de chaque cheval.
  horses: number[][];
  // Le siège qui doit agir ; à la fin de la partie, le gagnant.
  turn: number;
  // `roll` : il doit lancer le dé ; `move` : il doit jouer un cheval avec le dé tiré ; `over` : la partie est finie.
  phase: LudoPhase;
  // Le dé à jouer en phase `move` ; null sinon.
  die: number | null;
  // Les 6 déjà tirés dans ce tour (de 0 à 2 : le troisième ne reste pas, il fait passer le tour).
  sixes: number;
  // Les lancers déjà faits dans ce tour sans aucun cheval en jeu (de 0 à 3).
  tries: number;
  // Les sièges sortis (abandon, inactivité, départ), dans l'ordre où ils sont sortis.
  out: Array<{ seat: number; reason: ForfeitReason }>;
  // Les chevaux déplacés : ce sont les coups comptés pour le classement (un lancer, un tour passé n'en sont pas).
  moves: number;
  last: LudoLast | null;
  // Le résultat vit ici, à un seul endroit ; phase `over` si et seulement s'il n'est pas nul.
  result: GameResult | null;
}

export type LudoMove = { type: 'roll' } | { type: 'move'; horse: number };

export type LudoEvent =
  | { type: 'dice'; seat: number; value: number }
  // from = −1 : une sortie de l'écurie.
  | { type: 'move'; seat: number; horse: number; from: number; to: number }
  // `seat` prend le cheval `victim`, qui retourne à l'écurie.
  | { type: 'capture'; seat: number; victim: { seat: number; horse: number } }
  | { type: 'pass'; seat: number; reason: 'no-move' | 'retry' | 'bonus' | 'third-six' }
  | { type: 'turn'; seat: number }
  | { type: 'end'; ranking: number[][] }
  | { type: 'forfeit'; seat: number; reason: ForfeitReason };

// La forme d'un coup, pas sa légalité. Un objet à clé en trop est refusé : le journal d'une partie garde le coup tel que le joueur l'a envoyé.
export const ludoMoveSchema: z.ZodType<LudoMove> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('roll') }),
  z.strictObject({ type: z.literal('move'), horse: z.number().int().min(0).max(3) }),
]);
