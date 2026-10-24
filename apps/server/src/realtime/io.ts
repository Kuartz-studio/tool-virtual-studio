import { readFileSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { join } from 'node:path';
import {
  CHAT_RATE,
  COFFEE_RATE_MS,
  DISCONNECT_GRACE_MS,
  GROUPS_TICK_MS,
  LIGHTS_RATE_MS,
  MISSION_RATE,
  MUSIC_RATE_MS,
  OFFICE_ROOM,
  POSITION_SAVE_INTERVAL_MS,
  SOCKET_CONNECT_RATE,
  WORLD_TICK_MS,
  busyZoneIds,
  levelOf,
  parseOfficeMap,
  type AnyGameDefinition,
  type ClientToServerEvents,
  type GameId,
  type GroupConfig,
  type MyProgress,
  type OfficeMap,
  type Role,
  type ServerToClientEvents,
  type TaskView,
  type TiledMapJson,
} from '@bureau/shared';
import type { Logger } from 'pino';
import { Server, type Socket } from 'socket.io';
import type { Auth } from '../auth/auth';
import { createChatService } from '../chat/chat-service';
import { createActivityController } from '../activity/activity-controller';
import { createActivityService, type ActivityService } from '../activity/activity-service';
import { createArenaController, type ArenaController } from '../arena/arena-controller';
import { createDeskController } from '../desks/desk-controller';
import { createModeTravel } from '../modes/mode-travel';
import { createTeleport } from '../teleport';
import { DeskService } from '../desks/desk-service';
import { createGamesController, type GamesController } from '../games/games-controller';
import { LadderService } from '../games/ladder-service';
import type { Db } from '../db/client';
import type { Env } from '../env';
import { LightsService } from '../lights/lights-service';
import { createLogger, logServerError } from '../logger';
import { LIVEKIT_VARIABLES, createLiveKitBackend, type MediaBackend } from '../media/livekit';
import { MediaCoordinator, newBootId, type MediaEvent } from '../media/media-coordinator';
import { MusicService } from '../music/music-service';
import { ProgressService, outcomeOf } from '../progress/progress-service';
import { createRateLimiter } from '../rate-limit';
import type { ServerEvents } from '../server-events';
import type { SimHost } from '../sim/sim-host';
import { simOrigins } from '../sim/sim-origins';
import { registerHandlers, startGroupTicks, startWorldTicks } from './handlers';
import { createPresence } from './presence';
import { socketAuth } from './socket-auth';
import { World } from './world';

// Le compte d'une socket, posé par le middleware d'authentification (socket-auth.ts) à chaque connexion. `timezone` : son fuseau horaire à la
// connexion ; ensuite, c'est le monde qui le tient à jour (`profile:changed`).
export interface SocketData {
  userId: string;
  name: string;
  avatarKey: string | null;
  role: Role;
  timezone: string;
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
  /**
   * L'horloge du temps réel, en ms : celle du monde (l'heure de réception des mouvements), de la limite de débit des `move`, de
   * l'heure `t` des ticks et des délais du calcul des groupes. Monotone (performance.now par défaut), jamais Date.now, qui peut sauter.
   */
  now?: () => number;
  /** Le délai de grâce à la déconnexion : DISCONNECT_GRACE_MS par défaut. */
  graceMs?: number;
  /** La période de world:tick : WORLD_TICK_MS par défaut. */
  tickMs?: number;
  /** La période du calcul des groupes de conversation : GROUPS_TICK_MS par défaut. */
  groupsMs?: number;
  /** Les distances des espaces ouverts pour les groupes de conversation : OPEN_SPACE_GROUPING par défaut. */
  grouping?: GroupConfig;
  /** La période d'enregistrement des positions : POSITION_SAVE_INTERVAL_MS par défaut. */
  saveMs?: number;
  /**
   * Les zones où une conversation a lieu : on n'y fait pas réapparaître quelqu'un. Par défaut, celles des groupes du dernier calcul
   * (busyZoneIds).
   */
  busyZones?: () => ReadonlySet<string>;
  /**
   * L'audio et la vidéo. Par défaut, LiveKit d'après les variables LIVEKIT_* (createLiveKitBackend), ou rien s'il en manque une ;
   * null : désactivés. Les tests passent un faux.
   */
  media?: MediaBackend | null;
  /**
   * Le faux live (SIM=1) : son faux LiveKit remplace le vrai (`media` a alors la priorité, pour les tests), et ses personnes fictives
   * entrent dans le monde. Absent : rien de cela.
   */
  sim?: SimHost;
  /** Les états d'activité des personnes. Par défaut, ceux de la base (createActivityService). */
  activities?: ActivityService;
  /** Les bureaux. Par défaut, ceux de la base (DeskService) pour cette carte ; les tests peuvent en passer un réglé à leur main. */
  desks?: DeskService;
  /** La lumière du bureau. Par défaut, celle de la base (LightsService) ; les tests peuvent en passer une réglée à leur main. */
  lights?: LightsService;
  /** La musique de chaque pièce. Par défaut, celle de la base (MusicService) ; les tests peuvent en passer une réglée à leur main. */
  music?: MusicService;
  /** Les notes et les parties des jeux. Par défaut, celles de la base (LadderService) ; les tests peuvent en passer une réglée à leur main. */
  ladder?: LadderService;
  /** La progression de chacun (XP, écus, tâches, missions, boutique). Par défaut, celle de la base (ProgressService) : la même instance que les routes REST, si on la leur donne. */
  progress?: ProgressService;
  /** Le pointage du jour à l'arrivée (de l'XP, la première fois de la journée) : oui par défaut. Le serveur des tests l'éteint, sauf pour ceux qui l'éprouvent. */
  checkIn?: boolean;
  /** Les jeux que le registre connaît : ceux de GAMES par défaut ; les tests y mettent le morpion. */
  gameDefinitions?: Partial<Record<GameId, AnyGameDefinition>>;
  /** La période du balayage des délais des jeux : GAME_SWEEP_MS par défaut. */
  gamesSweepMs?: number;
  /** L'intervalle des pings du serveur : PING_INTERVAL_MS par défaut. */
  pingIntervalMs?: number;
  /** Le délai de réponse à un ping, au-delà duquel la connexion est coupée : PING_TIMEOUT_MS par défaut. */
  pingTimeoutMs?: number;
  /** Le journal des erreurs du temps réel. Par défaut, celui de createLogger(env). */
  logger?: Logger;
}

export interface Realtime {
  io: TypedServer;
  world: World;
  /** Les identifiants des sockets connectées de ce compte (au plus une : un nouvel onglet remplace l'ancien). */
  socketsOf(userId: string): string[];
  /** Les bureaux : qui occupe quelle place, et qui peut y entrer. */
  desks: DeskService;
  /** La lumière du bureau : allumée ou éteinte pour tout le monde, gardée d'un redémarrage à l'autre. */
  lights: LightsService;
  /** La musique de chaque pièce, réglée par ceux qui y sont, gardée d'un redémarrage à l'autre. */
  music: MusicService;
  /** Les tables de jeu : leurs chaises, leurs parties, les invitations ; le classement est en base. */
  games: GamesController;
  /** L'octogone : ses combattants, ses spectateurs, son combat (en mémoire). */
  arena: ArenaController;
  /** La progression de chacun : le temps réel annonce ses gains, ses niveaux et ses missions. */
  progress: ProgressService;
  /** Les groupes de conversation et leurs rooms LiveKit : groupMembersOf sert au chat « À proximité ». */
  coordinator: MediaCoordinator;
  /**
   * L'arrêt, pour un redémarrage ou un déploiement : arrête les ticks et le calcul des groupes, enregistre la position de chaque
   * joueur du monde, y compris en délai de grâce, puis ferme les sockets (les clients se reconnecteront seuls, à la nouvelle instance,
   * et y liront cette position) et le serveur HTTP auquel Socket.io est attaché. Appelée plusieurs fois, elle renvoie la même promesse.
   */
  stop(): Promise<void>;
}

// Le serveur envoie un ping toutes les PING_INTERVAL_MS et coupe une connexion qui n'y a pas répondu en PING_TIMEOUT_MS : un
// client muet (ordinateur mis en veille, réseau tombé sans fermer la connexion) est vu parti en 15 s au plus, puis le délai de
// grâce s'applique. Les valeurs par défaut de Socket.io (25 s + 20 s) l'éloigneraient trop des 10 s de la spec. Un onglet en
// arrière-plan répond quand même : ce sont des messages reçus, que les navigateurs ne ralentissent pas comme les minuteurs.
export const PING_INTERVAL_MS = 10_000;
export const PING_TIMEOUT_MS = 5_000;

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
  const now = d.now ?? (() => performance.now());
  const world = new World(d.map, now);

  // L'audio et la vidéo : LiveKit, s'il est configuré. Sans lui, les groupes sont calculés quand même (chat « À proximité », zones
  // occupées), mais aucun événement média ne part.
  const media = d.media !== undefined ? d.media : d.sim ? d.sim.backend : createLiveKitBackend(d.env);
  if (d.sim) logger.warn('Faux live (SIM=1) : audio et vidéo simulés, LiveKit n\'est pas utilisé');
  if (media === null) {
    logger.warn({ missing: LIVEKIT_VARIABLES.filter((name) => !d.env[name]) }, 'LiveKit non configuré : audio et vidéo désactivés');
  }
  // Un état d'activité où l'on n'est pas entendu (heard faux) retire le micro du jeton : le serveur ne laisse rien publier.
  const coordinator = new MediaCoordinator(media, newBootId(), logger, { canSpeak: (userId) => world.get(userId)?.activity?.heard !== false });

  // Pas de récupération de connexion (connectionStateRecovery) : Socket.io renverrait à une socket revenue les diffusions qu'elle a
  // manquées avant même de repasser les middlewares, si bien qu'un membre retiré pendant sa coupure en recevrait jusqu'à 10 s.
  // Le délai de grâce garde l'avatar en place, et chaque reconnexion reçoit un init neuf, qui dit tout l'état du moment.
  const io: TypedServer = new Server(server, {
    pingInterval: d.pingIntervalMs ?? PING_INTERVAL_MS,
    pingTimeout: d.pingTimeoutMs ?? PING_TIMEOUT_MS,
    // Le client vient du paquet npm (Vite) : pas de /socket.io/socket.io.js.
    serveClient: false,
  });
  io.use(
    socketAuth({
      auth: d.auth,
      appOrigin: new URL(d.env.APP_URL).origin,
      alsoOrigins: simOrigins(d.env),
      limiter: createRateLimiter(SOCKET_CONNECT_RATE),
      logger,
    }),
  );

  // Le chat « Tout le monde » (enregistré, relu dans chaque init) et la limite de débit du chat : par compte, commune à toutes ses
  // sockets, sur l'horloge du temps réel.
  const chat = createChatService(d.db);
  const chatLimiter = createRateLimiter({ ...CHAT_RATE, now });

  // La porte d'un bureau se ferme d'elle-même quand son propriétaire, présent, est dans un état d'activité qui ne laisse pas entrer.
  const desks = d.desks ?? new DeskService(d.db, d.map, { ownerAllowsEntry: (ownerId) => world.get(ownerId)?.activity?.allowEntry !== false, logger });
  // Poser quelqu'un ailleurs (celui qu'on exclut d'un bureau, celui que son mode conduit à la salle de sport) : le monde le déplace, son navigateur s'y replace.
  const teleport = createTeleport({ world, socketsOf: (userId) => enteredSockets(userId) });
  const deskController = createDeskController({
    io,
    world,
    desks,
    map: d.map,
    connectedUsers: () => presence.connectedUsers(),
    socketsOf: (userId) => enteredSockets(userId),
    teleport,
    now,
    unowned: (userId, itemIds) => progress.unowned(userId, itemIds),
    logger,
  });

  // Un mode qui a un emplacement conduit à ce lieu (la salle de sport), et en sortir ramène au bureau.
  const modeTravel = createModeTravel({ world, map: d.map, desks, teleport });
  const activityController = createActivityController({
    io,
    world,
    activities: d.activities ?? createActivityService(d.db),
    desks: deskController,
    travel: modeTravel,
    logger,
  });

  // La lumière du bureau (lue en base au démarrage, relue dans chaque init), et la limite de débit de ses changements : par compte, commune
  // à toutes ses sockets, sur l'horloge du temps réel.
  const lights = d.lights ?? new LightsService(d.db);
  const lightsLimiter = createRateLimiter({ max: 1, windowMs: LIGHTS_RATE_MS, now });
  // La musique de chaque pièce (lue en base au démarrage, relue dans chaque init), et la limite de débit de ses réglages : par compte, commune à toutes ses
  // sockets, sur l'horloge du temps réel.
  const music = d.music ?? new MusicService(d.db);
  const musicLimiter = createRateLimiter({ max: 1, windowMs: MUSIC_RATE_MS, now });
  // La limite de débit des cafés : une prise par COFFEE_RATE_MS et par compte, comme les changements de lumière.
  const coffeeLimiter = createRateLimiter({ max: 1, windowMs: COFFEE_RATE_MS, now });

  // Les tables de jeu (en mémoire), leur classement (en base) et le balayage de leurs délais. Celui qui accepte une invitation est posé près de la table (teleport).
  // Une partie classée finie rapporte de l'XP à chacun de ses joueurs (victoire, nulle ou défaite, dans le plafond du jour).
  const games = createGamesController({
    onMatchEnded: (match) => {
      if (!match.ranked) return;
      match.players.forEach((userId, seat) => {
        announced(userId, 'XP de la partie impossible', progress.gamePlayed(userId, match.game, outcomeOf(match.ranking, seat, match.players.length)));
      });
    },
    io,
    world,
    map: d.map,
    ladder: d.ladder ?? new LadderService(d.db),
    definitions: d.gameDefinitions,
    isOnline: (userId) => presence.socketsOf(userId).length > 0,
    socketsOf: (userId) => enteredSockets(userId),
    teleport,
    now,
    sweepMs: d.gamesSweepMs,
    logger,
  });

  // L'octogone (en mémoire) : les combattants posés dans le ring au début d'un combat (teleport).
  const arena = createArenaController({ io, world, map: d.map, teleport, now, logger });

  // La progression (en base) : chacun apprend ses gains (`progress:mine`), tout le bureau ses niveaux (`progress:level`, que le monde retient pour ceux qui arrivent).
  const progress = d.progress ?? new ProgressService(d.db);
  const missionLimiter = createRateLimiter({ ...MISSION_RATE, now });
  function announceProgress(userId: string, mine: MyProgress): void {
    for (const socket of enteredSockets(userId)) socket.emit('progress:mine', mine);
    const level = levelOf(mine.xp);
    if (world.setLevel(userId, level)) io.to(OFFICE_ROOM).emit('progress:level', { id: userId, level });
  }
  // Une mission, à celles qu'elle concerne : `task:assigned` à celle qui la reçoit, `task:changed` quand elle change d'état.
  function tellTask(userId: string, event: 'task:assigned' | 'task:changed', task: TaskView): void {
    for (const socket of enteredSockets(userId)) socket.emit(event, task);
  }
  // Une promesse de la progression qui rejette (la base) ne doit pas rester sans réponse : journalisée, rien ne part.
  const announced = (userId: string, what: string, task: Promise<MyProgress | null>): void => {
    task.then(
      (mine) => {
        if (mine) announceProgress(userId, mine);
      },
      (err: unknown) => logServerError(logger, { err, userId }, what),
    );
  };

  const presence = createPresence({
    io,
    world,
    db: d.db,
    map: d.map,
    mapKey: d.mapKey,
    busyZones: d.busyZones ?? (() => busyZoneIds(groups.state())),
    graceMs,
    logger,
    chat,
    desks: deskController,
    lights,
    music,
    games,
    arena,
    progress,
    onWelcome: (socket) => {
      resyncMedia(socket);
      games.onWelcome(socket.data.userId);
      // La première arrivée du jour : le pointage.
      if (d.checkIn !== false) announced(socket.data.userId, 'Pointage impossible', progress.checkIn(socket.data.userId));
    },
  });

  // Ce que chaque socket sait de sa room LiveKit : la room de son dernier media:join, null après un media:leave. La même consigne
  // n'est jamais envoyée deux fois de suite à une socket : le join de son retour (resyncMedia) et celui d'un changement de groupe
  // (apply) peuvent se croiser, et un second join pour la même room ferait quitter puis rejoindre la room au client.
  const told = new WeakMap<TypedSocket, string | null>();
  function tell(socket: TypedSocket, e: MediaEvent): void {
    const room = e.type === 'join' ? e.p.room : null;
    if (told.has(socket) && told.get(socket) === room) return;
    told.set(socket, room);
    if (e.type === 'join') socket.emit('media:join', e.p);
    else socket.emit('media:leave');
  }

  // Les sockets de cette personne qui ont reçu leur init (welcome les fait entrer dans la salle du bureau juste avant) : les seules
  // à qui l'on écrit, jamais avant init.
  function enteredSockets(userId: string): TypedSocket[] {
    return presence.socketsOf(userId).flatMap((id) => {
      const socket = io.sockets.sockets.get(id);
      return socket?.rooms.has(OFFICE_ROOM) ? [socket] : [];
    });
  }

  // Un événement média, à chacune des sockets de la personne qui ont reçu leur init : jamais avant. Une socket qui attend encore son
  // init apprend sa room juste après (resyncMedia).
  function sendMedia(userId: string, e: MediaEvent): void {
    for (const socket of enteredSockets(userId)) tell(socket, e);
  }

  // Après chaque init (arrivée, retour pendant le délai de grâce, nouvel onglet) : la room du groupe de la personne, avec un jeton
  // neuf, ou media:leave hors groupe. Un client resté dans une room pendant une coupure, ou dans celle d'avant un redémarrage (un autre
  // bootId), en sort ainsi. Sans LiveKit, rien.
  function resyncMedia(socket: TypedSocket): void {
    if (!media) return;
    const { userId } = socket.data;
    if (coordinator.groupMembersOf(userId).length === 0) {
      tell(socket, { type: 'leave' });
      return;
    }
    coordinator
      .currentJoin(userId)
      .then((p) => {
        if (p && socket.connected) tell(socket, { type: 'join', p });
      })
      .catch((err: unknown) => logServerError(logger, { err, userId }, 'media:join impossible'));
  }

  io.on('connection', (socket) => {
    presence.connect(socket);
    registerHandlers(io, socket, {
      world,
      env: d.env,
      now,
      logger,
      chat,
      chatLimiter,
      groupMembersOf: (userId) => coordinator.groupMembersOf(userId),
      socketsOf: enteredSockets,
      desks: deskController,
      activity: activityController,
      lights,
      lightsLimiter,
      switches: d.map.switches,
      music,
      musicLimiter,
      games,
      map: d.map,
      deskOwnerOf: (key) => desks.get(key)?.ownerId ?? null,
      coffeeLimiter,
      coffees: d.map.coffees,
      arena,
      progress,
      clerks: d.map.clerks,
      missionLimiter,
      onAssigned: (task) => tellTask(task.owner.id, 'task:assigned', task),
      onProgress: announceProgress,
    });
  });
  // Un membre retiré : sa place est libre pour les autres.
  const offMemberRemoved = d.events.on('member:removed', (userId) => {
    presence.removeMember(userId);
    void deskController.release(userId);
  });
  // Un mot de passe réinitialisé : ses sessions sont fermées, ses connexions au bureau aussi (le compte, lui, reste actif).
  const offSessionsRevoked = d.events.on('sessions:revoked', (userId) => presence.disconnectUser(userId));
  // Un de ses états d'activité est modifié ou supprimé (REST) : celui qu'elle porte suit.
  const offActivityEdited = d.events.on('activity:edited', (change) => activityController.edited(change));
  // La progression d'une personne a changé par une route (une tâche cochée, un achat) : elle l'apprend, et son niveau va au bureau. Une mission qui change d'état
  // (faite, rendue, retirée) : celle qu'elle concerne l'apprend.
  const offProgressChanged = d.events.on('progress:changed', ({ userId, progress: mine }) => announceProgress(userId, mine));
  const offTaskChanged = d.events.on('task:changed', ({ task, notify }) => {
    for (const userId of notify) tellTask(userId, 'task:changed', task);
  });
  // Un profil change (PATCH /api/me) : le monde le retient pour ceux qui arrivent ensuite, et tout le bureau l'apprend, même si la
  // personne n'est pas là (la liste des membres d'un autre onglet peut la suivre). Son bureau suit son nom et son fuseau (ses horloges).
  const offProfileChanged = d.events.on('profile:changed', (profile) => {
    world.setProfile(profile.id, { name: profile.name, avatarKey: profile.avatarKey, timezone: profile.timezone });
    deskController.updateOwner(profile.id, { name: profile.name, timezone: profile.timezone });
    games.profileChanged(profile.id, profile.name, profile.avatarKey);
    arena.profileChanged(profile.id);
    io.to(OFFICE_ROOM).emit('profile:changed', { id: profile.id, name: profile.name, avatarKey: profile.avatarKey, timezone: profile.timezone });
  });
  const stopTicks = startWorldTicks(io, world, d.tickMs ?? WORLD_TICK_MS, now, logger);
  const groups = startGroupTicks({
    world,
    map: d.map,
    coordinator,
    send: sendMedia,
    nameOf: (id) => world.get(id)?.name ?? id,
    groupsMs: d.groupsMs ?? GROUPS_TICK_MS,
    grouping: d.grouping,
    onGroups: d.sim ? (state) => d.sim!.onGroups(state) : undefined,
    now,
    logger,
  });

  d.sim?.start({ world, io, map: d.map, now, logger, roomFor: (groupId) => coordinator.roomFor(groupId), enteredSockets, arena });

  const saveTimer = setInterval(() => presence.savePeriodically(), saveMs);
  saveTimer.unref();

  let stopped: Promise<void> | undefined;
  function stop(): Promise<void> {
    stopped ??= (async () => {
      offMemberRemoved();
      offSessionsRevoked();
      offProfileChanged();
      offActivityEdited();
      offProgressChanged();
      offTaskChanged();
      // Les jeux d'abord : plus de balayage, plus de commande, plus rien d'écrit.
      games.stop();
      arena.stop();
      clearInterval(saveTimer);
      d.sim?.stop();
      stopTicks();
      groups.stop();
      presence.halt();
      // Les positions d'abord, les sockets ensuite : un client dont la connexion tombe se reconnecte aussitôt, peut-être à la nouvelle
      // instance d'un déploiement, et y lit sa position en base. Elle doit y être déjà, même si l'écriture est lente. Un `move` reçu
      // pendant l'écriture n'est pas enregistré : au plus quelques millisecondes de marche.
      try {
        await presence.saveAll();
      } finally {
        await closeSocketServer(io);
      }
    })();
    return stopped;
  }

  return {
    io,
    world,
    socketsOf: (userId) => presence.socketsOf(userId),
    desks,
    lights,
    music,
    games,
    arena,
    coordinator,
    progress,
    stop,
  };
}
