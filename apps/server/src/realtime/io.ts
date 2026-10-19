import { readFileSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { join } from 'node:path';
import {
  DISCONNECT_GRACE_MS,
  POSITION_SAVE_INTERVAL_MS,
  SOCKET_CONNECT_RATE,
  parseOfficeMap,
  type ClientToServerEvents,
  type OfficeMap,
  type Role,
  type ServerToClientEvents,
  type TiledMapJson,
} from '@bureau/shared';
import type { Logger } from 'pino';
import { Server, type Socket } from 'socket.io';
import type { Auth } from '../auth/auth';
import type { Db } from '../db/client';
import type { Env } from '../env';
import { createLogger } from '../logger';
import { createRateLimiter } from '../rate-limit';
import type { ServerEvents } from '../server-events';
import { createPresence } from './presence';
import { socketAuth } from './socket-auth';
import { World } from './world';

// Le compte d'une socket, posé par le middleware d'authentification (socket-auth.ts) à chaque connexion.
export interface SocketData {
  userId: string;
  name: string;
  avatarKey: string | null;
  role: Role;
}

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface RealtimeDeps {
  auth: Auth;
  db: Db;
  map: OfficeMap;
  mapKey: string;
  events: ServerEvents;
  env: Env;
  /** L'horloge du monde, en ms : monotone (performance.now par défaut), jamais Date.now, qui peut sauter. */
  now?: () => number;
  /** Le délai de grâce à la déconnexion : DISCONNECT_GRACE_MS par défaut. */
  graceMs?: number;
  /** La période de world:tick (tâche 14). */
  tickMs?: number;
  /** La période du calcul des groupes (tâche 18). */
  groupsMs?: number;
  /** La période d'enregistrement des positions : POSITION_SAVE_INTERVAL_MS par défaut. */
  saveMs?: number;
  /** Les zones où une conversation a lieu (tâche 18) : on n'y fait pas réapparaître quelqu'un. Aucune par défaut. */
  busyZones?: () => ReadonlySet<string>;
  /** Le journal des erreurs du temps réel. Par défaut, celui de createLogger(env). */
  logger?: Logger;
}

export interface Realtime {
  io: TypedServer;
  world: World;
  /** Les identifiants des sockets connectées de ce compte (au plus une : un nouvel onglet remplace l'ancien). */
  socketsOf(userId: string): string[];
  /**
   * L'arrêt, pour un redémarrage ou un déploiement : ferme les sockets (les clients se reconnecteront seuls, à la nouvelle
   * instance), enregistre la position de chaque joueur du monde, y compris en délai de grâce, puis ferme le serveur HTTP auquel
   * Socket.io est attaché. Appelée plusieurs fois, elle renvoie la même promesse.
   */
  stop(): Promise<void>;
}

// Au-delà, stop() n'attend plus la fermeture du serveur HTTP : un client injoignable (ordinateur en veille) peut retenir celle
// de sa WebSocket 30 s, et une connexion HTTP gardée ouverte se ferme d'elle-même en 5 s (keepAliveTimeout de Node).
const HTTP_CLOSE_WAIT_MS = 5_000;

// La carte du bureau : MAPS_DIR/<MAP_KEY>.json, lue avec le même code que la commande map:check. Absente ou illisible, elle
// arrête le démarrage avec un message qui donne son chemin.
export function loadOfficeMap(env: Pick<Env, 'MAPS_DIR' | 'MAP_KEY'>): OfficeMap {
  const file = join(env.MAPS_DIR, `${env.MAP_KEY}.json`);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    const reason = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'fichier introuvable' : (err as Error).message;
    throw new Error(`Carte du bureau illisible : ${file} (${reason}). Vérifier MAPS_DIR et MAP_KEY.`, { cause: err });
  }
  try {
    return parseOfficeMap(json as TiledMapJson);
  } catch (err) {
    throw new Error(`Carte du bureau invalide : ${file} (${(err as Error).message}). La commande map:check en dit plus.`, { cause: err });
  }
}

// Ferme Socket.io : les sockets tout de suite, sans paquet de déconnexion (le client y voit une coupure, et se reconnecte), puis
// le moteur et le serveur HTTP. Se résout quand le serveur HTTP est fermé, ou au bout de HTTP_CLOSE_WAIT_MS.
function closeSocketServer(io: TypedServer): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, HTTP_CLOSE_WAIT_MS);
    timer.unref();
    io.close(done).catch(done);
  });
}

// Le temps réel, attaché au serveur HTTP de l'application (même origine : /socket.io). Une seule instance de serveur : le monde vit
// en mémoire (World), seules les dernières positions vont en base.
export function attachRealtime(server: HttpServer, d: RealtimeDeps): Realtime {
  const graceMs = d.graceMs ?? DISCONNECT_GRACE_MS;
  const saveMs = d.saveMs ?? POSITION_SAVE_INTERVAL_MS;
  const logger = d.logger ?? createLogger(d.env);
  const world = new World(d.map, d.now ?? (() => performance.now()));

  const io: TypedServer = new Server(server, {
    // Un client revenu pendant le délai de grâce reprend sa session Socket.io (salles, diffusions manquées) ; au-delà, c'est une
    // nouvelle arrivée. Les middlewares repassent à chaque reprise : un compte retiré entre-temps ne revient pas.
    connectionStateRecovery: { maxDisconnectionDuration: graceMs, skipMiddlewares: false },
    // Le client vient du paquet npm (Vite) : pas de /socket.io/socket.io.js.
    serveClient: false,
  });
  io.use(socketAuth({ auth: d.auth, limiter: createRateLimiter(SOCKET_CONNECT_RATE), logger }));

  const presence = createPresence({
    io,
    world,
    db: d.db,
    map: d.map,
    mapKey: d.mapKey,
    busyZones: d.busyZones ?? (() => new Set<string>()),
    graceMs,
    logger,
  });
  io.on('connection', (socket) => presence.connect(socket));
  const offMemberRemoved = d.events.on('member:removed', (userId) => presence.removeMember(userId));

  const saveTimer = setInterval(() => presence.savePeriodically(), saveMs);
  saveTimer.unref();

  let stopped: Promise<void> | undefined;
  function stop(): Promise<void> {
    stopped ??= (async () => {
      offMemberRemoved();
      clearInterval(saveTimer);
      presence.halt();
      // Les sockets d'abord : plus aucun mouvement n'arrive, les positions enregistrées sont les dernières.
      const closed = closeSocketServer(io);
      await presence.saveAll();
      await closed;
    })();
    return stopped;
  }

  return {
    io,
    world,
    socketsOf: (userId) => presence.socketsOf(userId),
    stop,
  };
}
