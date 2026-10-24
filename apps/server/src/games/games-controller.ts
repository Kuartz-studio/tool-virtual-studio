import {
  GAMES,
  GAME_INVITE_RATE,
  GAME_SWEEP_MS,
  OFFICE_ROOM,
  arrivalSpot,
  type AnyGameDefinition,
  type GameId,
  type GameInvite,
  type GameTableView,
  type LadderRow,
  type OfficeMap,
  type ServerToClientEvents,
} from '@bureau/shared';
import type { Logger } from 'pino';
import { logServerError } from '../logger';
import { createRateLimiter } from '../rate-limit';
import type { TypedServer, TypedSocket } from '../realtime/io';
import type { World } from '../realtime/world';
import type { Teleport } from '../teleport';
import { GamesService } from './games-service';
import type { LadderService } from './ladder-service';

export interface GamesControllerDeps {
  io: TypedServer;
  world: World;
  map: OfficeMap;
  ladder: Pick<LadderService, 'record' | 'ladder'>;
  /** Les jeux que le registre connaît : GAMES par défaut (les tests y mettent le morpion). */
  definitions?: Partial<Record<GameId, AnyGameDefinition>>;
  /** Cette personne a au moins une socket entrée au bureau. */
  isOnline: (userId: string) => boolean;
  /** Les sockets de cette personne qui ont reçu leur init : les seules à qui l'on écrit. */
  socketsOf: (userId: string) => TypedSocket[];
  /** Pose quelqu'un ailleurs et dit à son navigateur de s'y replacer : celui qui accepte une invitation arrive près de la table. */
  teleport: Teleport;
  /** L'horloge du temps réel (ms) : celle du monde, monotone. */
  now: () => number;
  /** La période du balayage des délais : GAME_SWEEP_MS par défaut. */
  sweepMs?: number;
  /** Une partie vient de finir (ses joueurs dans l'ordre des sièges, son classement, si elle est classée) : la progression en tire l'XP de chacun. */
  onMatchEnded?: (match: { game: GameId; players: string[]; ranking: number[][]; ranked: boolean }) => void;
  logger: Logger;
}

// Ce que le serveur fait des tables de jeu (GamesService) : il donne au service un monde (qui est où, qui est connecté), des sorties (la table à tout le bureau, une invitation ou
// un avis à une seule personne, la téléportation de qui accepte), et le balayage des délais toutes les GAME_SWEEP_MS. Rien ici ne lève : une erreur imprévue est journalisée.
export function createGamesController(d: GamesControllerDeps) {
  // La limite d'invitations par compte, commune à toutes ses sockets, sur l'horloge du temps réel.
  const inviteLimiter = createRateLimiter({ ...GAME_INVITE_RATE, now: d.now });

  // Un message à une seule personne : à chacune de ses sockets entrées.
  const send = <E extends 'game:invite' | 'game:invite:gone' | 'game:notice'>(userId: string, event: E, payload: Parameters<ServerToClientEvents[E]>[0]): void => {
    for (const socket of d.socketsOf(userId)) (socket.emit as (event: string, payload: unknown) => void)(event, payload);
  };

  const service = new GamesService({
    map: d.map,
    games: d.definitions ?? GAMES,
    ladder: d.ladder,
    players: {
      get: (userId) => {
        const player = d.world.get(userId);
        return player && { name: player.name, avatarKey: player.avatarKey, x: player.x, y: player.y, status: player.status, activity: player.activity };
      },
    },
    isOnline: d.isOnline,
    arrive: (userId, game, chair) => {
      const table = d.map.tables.find((candidate) => candidate.game === game);
      if (!table) return;
      // Les pieds de tous les autres : on se pose à deux cases d'eux au moins.
      const taken = d.world.list().filter((player) => player.id !== userId).map((player) => ({ x: player.x, y: player.y }));
      const spot = arrivalSpot(d.map, table, chair, taken);
      if (spot === null) {
        d.logger.warn({ userId, game }, 'Aucune case libre autour de la table : la personne reste où elle est');
        return;
      }
      d.teleport(userId, spot, 'teleport');
    },
    inviteAllowed: (userId) => inviteLimiter.take(userId),
    out: {
      table: (view) => {
        d.io.to(OFFICE_ROOM).emit('game:table', view);
      },
      invite: (userId, invite) => send(userId, 'game:invite', invite),
      inviteGone: (userId, gone) => send(userId, 'game:invite:gone', gone),
      notice: (userId, notice) => send(userId, 'game:notice', notice),
      ended: (match) => {
        try {
          d.onMatchEnded?.(match);
        } catch (err) {
          logServerError(d.logger, { err, game: match.game }, 'Fin de partie : progression impossible');
        }
      },
    },
    now: d.now,
    logger: d.logger,
  });

  // Le balayage : les délais tombent (le coup qu'on n'a pas joué, la connexion qui n'est pas revenue, l'invitation sans réponse, la chaise oubliée). Le minuteur ne retient pas
  // le processus ; stop() l'arrête avant toute chose.
  const timer = setInterval(() => {
    service.sweep().catch((err: unknown) => logServerError(d.logger, { err }, 'Balayage des tables de jeu impossible'));
  }, d.sweepMs ?? GAME_SWEEP_MS);
  timer.unref();

  // Une notification de présence : le service ne lève pas, mais une promesse rejetée que personne n'attrape ferait tomber le processus.
  const guarded = (what: string, task: Promise<void>): void => {
    task.catch((err: unknown) => logServerError(d.logger, { err }, what));
  };

  return {
    // Une commande de `game:do`.
    run: service.run.bind(service),

    // Le classement d'un jeu : les meilleurs, et le rang de cette personne.
    ladder: (game: GameId, userId: string): Promise<{ top: LadderRow[]; me: LadderRow | null }> => d.ladder.ladder(game, userId),

    // Ce que l'init de cette socket dit des jeux : les tables de la carte (rien sur une carte sans table) et les invitations qui attendent sa réponse.
    initFor(socket: TypedSocket): { games?: GameTableView[]; gameInvites?: GameInvite[] } {
      const games = service.views();
      const gameInvites = service.invitesFor(socket.data.userId);
      return { ...(games.length > 0 ? { games } : {}), ...(gameInvites.length > 0 ? { gameInvites } : {}) };
    },

    // La présence (voir createPresence) : la dernière socket tombe, une socket reçoit son init, la personne quitte le monde, un membre est retiré, un profil change.
    onSocketsGone: (userId: string): void => guarded('Départ d\'un joueur des tables impossible', service.onSocketsGone(userId)),
    onWelcome: (userId: string): void => guarded('Retour d\'un joueur aux tables impossible', service.onWelcome(userId)),
    onDepart: (userId: string): void => guarded('Départ du bureau d\'un joueur des tables impossible', service.onDepart(userId)),
    onRemoved: (userId: string): void => guarded('Retrait d\'un membre des tables impossible', service.onRemoved(userId)),
    profileChanged: (userId: string, name: string, avatarKey: string | null): void =>
      guarded('Changement de profil aux tables impossible', service.profileChanged(userId, name, avatarKey)),

    // Réservé aux tests de bout en bout (`debug:game`).
    debugSet: (game: GameId, state: unknown, rolls?: number[]): void => guarded('Débogage d\'une table impossible', service.debugSet(game, state, rolls)),

    // L'arrêt du serveur : le balayage s'arrête, le service ne fait plus rien (les parties en cours sont perdues).
    stop(): void {
      clearInterval(timer);
      service.stop();
    },
  };
}

export type GamesController = ReturnType<typeof createGamesController>;
