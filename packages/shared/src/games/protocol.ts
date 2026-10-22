import { z } from 'zod';
import { GAME_IDS, type ForfeitReason, type GameId, type GameResult, type GameSetup } from './types';

// Les jeux sur le réseau : les commandes que le client envoie (`game:do`, un seul événement à commandes typées, sur le modèle de `desk:do`), et les vues que
// le serveur renvoie. Les noms d'événements sont dans protocol.ts (ClientToServerEvents, ServerToClientEvents).

export const gameIdSchema = z.enum(GAME_IDS);

export const gameCommandSchema = z.discriminatedUnion('type', [
  // Regarder la table (spectateur), ou cesser.
  z.object({ type: z.literal('watch'), game: gameIdSchema }),
  z.object({ type: z.literal('unwatch'), game: gameIdSchema }),
  // S'asseoir (à la chaise demandée, sinon à la première libre), se lever, se dire prêt (ou non).
  z.object({ type: z.literal('sit'), game: gameIdSchema, chair: z.number().int().min(0).max(3).optional() }),
  z.object({ type: z.literal('stand'), game: gameIdSchema }),
  z.object({ type: z.literal('ready'), game: gameIdSchema, ready: z.boolean() }),
  // Un coup : sa forme est jugée par le schéma du jeu (moveSchema), sa légalité par ses règles. `version` : la version de la table qu'on a vue en le jouant.
  z.object({ type: z.literal('move'), game: gameIdSchema, version: z.number().int().nonnegative(), move: z.unknown() }),
  z.object({ type: z.literal('resign'), game: gameIdSchema }),
  z.object({ type: z.literal('draw'), game: gameIdSchema, action: z.enum(['offer', 'accept', 'decline']) }),
  // Inviter une personne du bureau à sa table, et répondre à une invitation reçue.
  z.object({ type: z.literal('invite'), game: gameIdSchema, userId: z.string().min(1).max(128) }),
  z.object({ type: z.literal('answer'), invite: z.string().min(1).max(64), accept: z.boolean() }),
]);
export type GameCommand = z.infer<typeof gameCommandSchema>;

// Le classement d'un jeu (`game:ladder`).
export const gameLadderSchema = z.object({ game: gameIdSchema });

// Réservé aux tests de bout en bout (`debug:game`, seulement avec E2E=1) : remplace l'état de la partie en cours à cette table, et fixe les dés suivants.
export const debugGameSchema = z.object({
  game: gameIdSchema,
  state: z.unknown(),
  rolls: z.array(z.number().int().min(1).max(6)).max(64).optional(),
});
export type DebugGamePayload = z.infer<typeof debugGameSchema>;

// Pourquoi une commande est refusée (la réponse `{ ok: false, error }` de `game:do`).
export const GAME_ERRORS = [
  'invalid', 'rate_limited', 'unknown_game', 'too_far', 'chair_taken', 'table_full', 'already_here', 'in_progress', 'busy',
  'not_seated', 'no_match', 'stale', 'not_your_turn', 'illegal', 'no_offer', 'already_offered', 'too_early',
  'self', 'offline', 'dnd', 'too_many', 'expired', 'unavailable',
] as const;
export type GameError = (typeof GAME_ERRORS)[number];
export type GameAck = { ok: true } | { ok: false; error: GameError };

// ---- Ce que le serveur dit d'une table ---------------------------------------------------------------------------------------------

// Une chaise occupée : qui, s'il est prêt, s'il est connecté (une personne dont la connexion est tombée garde sa chaise un moment).
export interface GameChairView {
  userId: string;
  name: string;
  avatarKey: string | null;
  ready: boolean;
  connected: boolean;
}

// Un joueur d'une partie. `reconnectMs` : ce qu'il reste avant sa défaite à un joueur déconnecté, sinon null. `out` : il est sorti de la partie (abandon, délai, départ) ; elle continue sans lui
// quand il restait plus de deux joueurs (les petits chevaux), sinon elle est finie.
export interface GameMatchPlayer {
  userId: string;
  name: string;
  avatarKey: string | null;
  connected: boolean;
  reconnectMs: number | null;
  out: boolean;
}

export interface GameMatchView {
  // L'identifiant de la partie, celui de la ligne game_match.
  id: string;
  status: 'playing' | 'ended';
  // Les joueurs, par siège.
  players: GameMatchPlayer[];
  // Le siège qui a commencé.
  first: number;
  // L'état du jeu : le client le type avec le module du jeu.
  state: unknown;
  // Ce qu'a provoqué le dernier changement de la partie (à animer).
  events: unknown[];
  // Ce qu'il reste, en ms, à celui qui doit agir avant l'inactivité ; null si la partie est finie.
  turnMs: number | null;
  // Le siège qui propose la nulle, ou null.
  drawOffer: number | null;
  // Le début de la partie, en ms depuis 1970.
  startedAt: number;
  // = result(state), pour qui n'a pas chargé le module du jeu.
  result: GameResult | null;
  // Classée (assez de coups) ou non ; null tant que la partie n'est pas finie.
  ranked: boolean | null;
  // Les notes avant et après ; null : partie non classée, ou base indisponible.
  ratings: Array<{ userId: string; before: number; after: number }> | null;
}

// La table entière, telle que tout le bureau la voit : le même objet part à tous (ces jeux n'ont rien de caché).
export interface GameTableView {
  game: GameId;
  // + 1 à chaque changement de la table ; jamais remise à zéro.
  version: number;
  // Une case par chaise ; null : libre.
  chairs: Array<GameChairView | null>;
  spectators: Array<{ id: string; name: string }>;
  // La partie en cours, ou la dernière finie, jusqu'au début de la suivante.
  match: GameMatchView | null;
}

// Une invitation reçue. `ttlMs` : ce qu'il lui reste à vivre.
export interface GameInvite {
  id: string;
  game: GameId;
  from: { id: string; name: string; avatarKey: string | null };
  ttlMs: number;
}

// Ce que l'invitante apprend : la réponse, le silence, le départ de l'invitée.
export interface GameNotice {
  kind: 'accepted' | 'declined' | 'expired' | 'gone';
  game: GameId;
  user: { id: string; name: string };
}

export interface LadderRow {
  rank: number;
  userId: string;
  name: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}
export type LadderAck = { ok: true; top: LadderRow[]; me: LadderRow | null } | { ok: false; error: 'invalid' | 'rate_limited' | 'unavailable' };

// Le journal d'une partie (en mémoire, puis la colonne `moves` de game_match) : de quoi la rejouer exactement. `rng` : les valeurs que le générateur a rendues à cet
// appel. `at` : ms depuis le début de la partie (affichage seulement).
export type MatchLogEntry =
  | { kind: 'create'; setup: GameSetup; rng: number[] }
  | { kind: 'move'; seat: number; move: unknown; rng: number[]; at: number }
  | { kind: 'forfeit'; seat: number; reason: ForfeitReason; at: number }
  | { kind: 'draw'; at: number }
  // E2E seulement : l'état est remplacé tel quel.
  | { kind: 'debug'; state: unknown; at: number };
