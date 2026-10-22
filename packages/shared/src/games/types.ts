import type { z } from 'zod';
import { GAME_IDS, type GameId } from '../map/parse-map';

// Les quatre jeux : les noms des zones `game` de la carte (parse-map.ts, qui en tient la liste). Une seule liste : on la reprend ici.
export { GAME_IDS };
export type { GameId };

// Un nombre dans [0, 1). Côté serveur : crypto (cryptoRng). Dans les tests : une graine ou une suite écrite. Jamais Math.random dans des règles.
export type Rng = () => number;

// La partie à créer : le nombre de joueurs (sièges 0 … seats − 1) et le siège qui commence (aux échecs, celui qui a les Blancs).
export interface GameSetup {
  seats: number;
  first: number;
}

// Ce qu'une action a provoqué : le client l'anime et en tire les sons. Chaque jeu définit son union ; `type` est toujours là.
export interface GameEventBase {
  type: string;
}

// Pourquoi un siège sort d'une partie qu'il n'a pas finie. C'est la plateforme qui le décide, jamais le jeu.
export const FORFEIT_REASONS = ['resign', 'timeout', 'disconnect'] as const;
export type ForfeitReason = (typeof FORFEIT_REASONS)[number];

// Les raisons de fin que la plateforme connaît et sait écrire. Chaque jeu ajoute les siennes (« checkmate », « four »…) et les écrit lui-même.
export const PLATFORM_END_REASONS = ['resign', 'timeout', 'disconnect', 'agreement'] as const;

export interface GameResult {
  // Les sièges, du meilleur au moins bon ; un groupe = des ex æquo. Chaque siège y figure une fois. Nulle à deux : [[0, 1]].
  ranking: number[][];
  // Une raison de PLATFORM_END_REASONS, ou une raison propre au jeu (listée dans sa partie).
  reason: string;
  // Pour l'affichage seulement (gammon, cases gagnantes…) ; le classement ne le lit jamais. Du JSON.
  detail?: Record<string, unknown>;
}

export type ApplyResult<S, E extends GameEventBase> =
  | { ok: true; state: S; events: E[] }
  // Un code court en anglais (« illegal », « wrong_phase »…) : journalisé, jamais montré tel quel.
  | { ok: false; error: string };

// Un jeu. Tout est pur : aucune fonction ne modifie ses arguments, ne lit l'heure ni Math.random, ne lève (sauf bogue).
// Les fonctions sont écrites en méthodes (`create(…): …`, pas `create: (…) => …`) : c'est ce qui permet de ranger un
// GameDefinition<ChessState, ChessMove, ChessEvent> dans le registre, typé GameDefinition<unknown, unknown> (bivariance des méthodes).
export interface GameDefinition<S, M, E extends GameEventBase = GameEventBase> {
  id: GameId;
  // « Échecs », « Backgammon », « Puissance 4 », « Petits chevaux » : le seul texte visible de ce paquet.
  label: string;
  minPlayers: number;
  maxPlayers: number;
  // La nulle par accord existe (échecs seulement).
  drawOffers: boolean;
  // La forme d'un coup (pas sa légalité) ; tableaux bornés (.max).
  moveSchema: z.ZodType<M>;
  create(setup: GameSetup, rng: Rng): { state: S; events: E[] };
  // Le siège qui doit agir ; null : partie finie.
  turn(state: S): number | null;
  // [] si ce n'est pas à `seat`, ou si la partie est finie.
  legalMoves(state: S, seat: number): M[];
  apply(state: S, seat: number, move: M, rng: Rng): ApplyResult<S, E>;
  forfeit(state: S, seat: number, reason: ForfeitReason): { state: S; events: E[] };
  // Obligatoire quand drawOffers est vrai.
  agreeDraw?(state: S): { state: S; events: E[] };
  result(state: S): GameResult | null;
  // Les coups qui comptent pour GAME_MIN_RANKED_MOVES : jamais un lancer de dés, jamais un tour passé.
  countedMoves(state: S): number;
  // [] : l'état est légal ; sinon une phrase par violation.
  invariants(state: S): string[];
}

export type AnyGameDefinition = GameDefinition<unknown, unknown, GameEventBase>;
