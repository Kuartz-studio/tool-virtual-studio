import { OFFICE_ROOM, levelOf, type ChatMessage, type Direction, type MyProgress, type OfficeMap, type PublicPlayer } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { ChatService } from '../chat/chat-service';
import type { Db } from '../db/client';
import { user } from '../db/schema';
import { logServerError } from '../logger';
import type { TypedServer, TypedSocket } from './io';
import { loadPosition, savePositions } from './positions';
import type { DeskController } from '../desks/desk-controller';
import type { ArenaController } from '../arena/arena-controller';
import type { GamesController } from '../games/games-controller';
import type { LightsService } from '../lights/lights-service';
import type { MusicService } from '../music/music-service';
import type { ProgressService } from '../progress/progress-service';
import { chooseSpawn } from './spawn';
import type { World } from './world';

export interface PresenceDeps {
  io: TypedServer;
  world: World;
  db: Db;
  map: OfficeMap;
  mapKey: string;
  /** Les zones où une conversation a lieu : on n'y fait pas réapparaître quelqu'un (chooseSpawn). */
  busyZones: () => ReadonlySet<string>;
  graceMs: number;
  logger: Logger;
  /** Le chat « Tout le monde » : ses derniers messages sont l'historique de chaque init. */
  chat: Pick<ChatService, 'recent'>;
  /** Les bureaux : une place pour qui arrive, et ce que dit chaque init à leur sujet. */
  desks: Pick<DeskController, 'assign' | 'initFor' | 'canStandAt'>;
  /** La lumière du bureau : chaque init la dit, une fois lue en base. */
  lights: Pick<LightsService, 'ready' | 'get'>;
  /** La musique des pièces : chaque init la dit, une fois lue en base. */
  music: Pick<MusicService, 'ready' | 'all'>;
  /** Les tables de jeu : chaque init les dit ; la présence les prévient quand la dernière socket d'une personne tombe, qu'elle quitte le monde ou qu'un membre est retiré. */
  games?: Pick<GamesController, 'initFor' | 'onSocketsGone' | 'onDepart' | 'onRemoved'>;
  /** L'octogone : chaque init le dit (ses départs, il les voit seul à son balayage). */
  arena?: Pick<ArenaController, 'initFor'>;
  /** La progression de chacun : son niveau entre au monde avec lui, et chaque init dit la sienne à la personne. Absente : niveau 0, rien dans l'init. */
  progress?: Pick<ProgressService, 'mine'>;
  /** Juste après chaque init (arrivée, retour pendant le délai de grâce, nouvel onglet) : ce que la socket doit encore apprendre. Ne lève pas. */
  onWelcome?: (socket: TypedSocket) => void;
}

// La direction d'un avatar qui apparaît ailleurs qu'à sa position enregistrée : face à l'écran.
const DEFAULT_DIR: Direction = 'down';

const rowOf = (p: PublicPlayer) => ({ id: p.id, x: p.x, y: p.y, dir: p.dir });

// Un compte désactivé (ou disparu) depuis la lecture de sa session par le middleware.
async function isDisabled(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ disabledAt: user.disabledAt }).from(user).where(eq(user.id, userId));
  return !row || row.disabledAt !== null;
}

// La présence au bureau : qui est connecté, par quelle socket, et qui est dans le monde.
//
// Une personne a au plus une socket : un nouvel onglet remplace l'ancien (`session:replaced`, puis fermeture), sans que le joueur
// quitte le monde. Une socket qui tombe laisse le joueur dans le monde pendant `graceMs` : revenu à temps, il reprend sa place sans
// que personne ne l'ait vu partir ; sinon il part (`leave`), sa position est enregistrée, puis `player:left` part à tous.
//
// Les positions sont écrites en base l'une après l'autre, dans l'ordre où elles ont été relevées (une file) : la dernière relevée
// est la dernière écrite. Une arrivée attend la file avant de lire la position : qui revient juste après son départ retrouve la
// position qu'il vient de quitter.
export function createPresence(d: PresenceDeps) {
  const socketsByUser = new Map<string, Set<TypedSocket>>();
  const graceTimers = new Map<string, NodeJS.Timeout>();
  let saves: Promise<void> = Promise.resolve();
  let periodicSaveRunning = false;
  let halted = false;

  // `seenAt` : l'heure de dernière présence inscrite avec ces positions (l'heure de l'écriture, sans autre précision).
  function queueSave(rows: Array<{ id: string; x: number; y: number; dir: Direction }>, seenAt?: Date): Promise<void> {
    saves = saves
      .then(() => savePositions(d.db, rows, seenAt))
      .catch((err: unknown) => logServerError(d.logger, { err }, 'Enregistrement des positions impossible'));
    return saves;
  }

  function cancelGrace(userId: string): void {
    clearTimeout(graceTimers.get(userId));
    graceTimers.delete(userId);
  }

  // Les derniers messages du chat « Tout le monde », pour un init. Illisibles (la base est tombée), ils sont journalisés et l'init part
  // avec un historique vide : arriver au bureau ne dépend pas du chat. Ne rejette jamais.
  async function readChatHistory(userId: string): Promise<ChatMessage[]> {
    try {
      return await d.chat.recent();
    } catch (err) {
      logServerError(d.logger, { err, userId }, 'Historique du chat illisible');
      return [];
    }
  }

  // La lumière est lue en base au démarrage : un init n'en part qu'une fois cette lecture finie. Illisible (la base est tombée), elle est
  // journalisée et l'init la dit allumée : arriver au bureau ne dépend pas d'elle. Ne rejette jamais.
  async function lightsLoaded(userId: string): Promise<void> {
    try {
      await d.lights.ready;
    } catch (err) {
      logServerError(d.logger, { err, userId }, 'Lumière du bureau illisible');
    }
  }

  // La musique des pièces est lue en base au démarrage : un init n'en part qu'une fois cette lecture finie. Illisible (la base est tombée), elle est journalisée
  // et l'init la dit allumée partout : arriver au bureau ne dépend pas d'elle. Ne rejette jamais.
  async function musicLoaded(userId: string): Promise<void> {
    try {
      await d.music.ready;
    } catch (err) {
      logServerError(d.logger, { err, userId }, 'Musique des pièces illisible');
    }
  }

  // Sa progression, pour l'init et son niveau. Illisible (la base est tombée), elle est journalisée et l'init part sans elle : arriver au bureau ne dépend pas
  // d'elle (le niveau est alors 0 jusqu'au prochain changement). Ne rejette jamais.
  async function readProgress(userId: string): Promise<MyProgress | undefined> {
    if (!d.progress) return undefined;
    try {
      return await d.progress.mine(userId);
    } catch (err) {
      logServerError(d.logger, { err, userId }, 'Progression illisible');
      return undefined;
    }
  }

  // Envoie l'état de départ à la socket (l'historique du chat et sa progression sont lus avant), puis annonce l'arrivée aux autres si c'en
  // est une (pas pour un onglet de plus ni pour un retour pendant le délai de grâce). La socket n'entre dans la salle du bureau qu'ici :
  // aucune diffusion ne lui parvient avant son init, ni message du chat, ni événement média. Puis onWelcome (sa room LiveKit).
  function welcome(socket: TypedSocket, arrival: boolean, chatHistory: ChatMessage[], progress: MyProgress | undefined): void {
    const { userId } = socket.data;
    const self = d.world.get(userId)!;
    void socket.join(OFFICE_ROOM);
    const music = d.music.all();
    socket.emit('init', {
      self,
      players: d.world.list().filter((p) => p.id !== userId),
      mapKey: d.mapKey,
      chatHistory,
      ...d.desks.initFor(socket),
      ...d.games?.initFor(socket),
      ...d.arena?.initFor(),
      lights: d.lights.get(),
      // Seulement les pièces qu'on a réglées : sans réglage, le champ n'y est pas.
      ...(Object.keys(music).length > 0 ? { music } : {}),
      ...(progress ? { progress } : {}),
    });
    if (arrival) socket.to(OFFICE_ROOM).emit('player:joined', self);
    d.onWelcome?.(socket);
  }

  // Une vraie arrivée : à la position enregistrée (ou à l'apparition, chooseSpawn), avec le statut retenu. Pendant les lectures,
  // la socket peut être remplacée par un autre onglet, coupée par un retrait, ou fermée : elle n'entre alors pas.
  async function arrive(socket: TypedSocket): Promise<void> {
    const { userId, name, avatarKey } = socket.data;
    try {
      await saves;   // un départ de cette personne est peut-être en cours d'écriture
      const [saved, disabled, chatHistory, , , progress] = await Promise.all([
        loadPosition(d.db, userId),
        isDisabled(d.db, userId),
        readChatHistory(userId),
        lightsLoaded(userId),
        musicLoaded(userId),
        readProgress(userId),
      ]);
      if (halted || !socket.connected) return;
      // Retiré entre la lecture de sa session par le middleware et maintenant : member:removed n'a pas pu fermer cette socket,
      // qu'il ne connaissait pas encore.
      if (disabled) {
        socket.disconnect(true);
        return;
      }
      const arrival = !d.world.get(userId);
      if (arrival) {
        // Un bureau d'abord, s'il lui en faut un : son avatar peut apparaître dedans, et les autres le voient dans l'init.
        await d.desks.assign(userId, name);
        if (halted || !socket.connected) return;
        const spot = chooseSpawn(d.map, saved, d.busyZones(), (x, y) => d.desks.canStandAt(userId, x, y));
        const dir = saved && spot.x === saved.x && spot.y === saved.y ? saved.dir : DEFAULT_DIR;
        d.world.join({ id: userId, name, avatarKey, x: spot.x, y: spot.y, dir, status: d.world.rememberedStatus(userId), level: levelOf(progress?.xp ?? 0) });
      }
      welcome(socket, arrival, chatHistory, progress);
    } catch (err) {
      logServerError(d.logger, { err, userId }, 'Arrivée au bureau impossible');
      // Le transport seulement : le client se reconnecte de lui-même, et réessaie.
      if (socket.connected) socket.conn.close();
    }
  }

  // Le retour pendant le délai de grâce, ou un onglet de plus : la personne est déjà au monde, son init n'attend que l'historique du
  // chat. Pendant cette lecture, la socket peut être remplacée par un autre onglet, coupée par un retrait, ou fermée : elle n'entre
  // alors pas.
  async function rejoin(socket: TypedSocket): Promise<void> {
    const { userId } = socket.data;
    try {
      const [chatHistory, , , progress] = await Promise.all([readChatHistory(userId), lightsLoaded(userId), musicLoaded(userId), readProgress(userId)]);
      if (halted || !socket.connected) return;
      // Une socket enregistrée garde sa personne au monde (ni le délai de grâce ni member:removed ne la retirent alors) : ce cas ne
      // devrait pas se produire. Sans personne à montrer, le client se reconnecte et arrive pour de bon, au lieu d'attendre un init.
      if (!d.world.get(userId)) {
        socket.conn.close();
        return;
      }
      welcome(socket, false, chatHistory, progress);
    } catch (err) {
      logServerError(d.logger, { err, userId }, 'Retour au bureau impossible');
      if (socket.connected) socket.conn.close();
    }
  }

  // io.on('connection').
  function onConnection(socket: TypedSocket): void {
    if (halted) return;   // l'arrêt ferme cette socket dans la foulée
    const { userId } = socket.data;
    const replaced = [...(socketsByUser.get(userId) ?? [])];
    const own = socketsByUser.get(userId) ?? new Set<TypedSocket>();
    own.add(socket);
    socketsByUser.set(userId, own);
    socket.on('disconnect', () => disconnected(socket));

    // L'ancien onglet est prévenu puis fermé (sans reconnexion automatique) ; le joueur reste : la nouvelle socket le garde.
    for (const old of replaced) {
      old.emit('session:replaced');
      old.disconnect(true);
    }
    cancelGrace(userId);

    if (d.world.get(userId)) {
      void rejoin(socket);
      return;
    }
    void arrive(socket);
  }

  function disconnected(socket: TypedSocket): void {
    const { userId } = socket.data;
    const own = socketsByUser.get(userId);
    if (own) {
      own.delete(socket);
      if (own.size > 0) return;   // remplacée : la nouvelle socket garde le joueur
      socketsByUser.delete(userId);
    }
    // La dernière socket est tombée : ses parties de jeu comptent à rebours, le temps de revenir.
    if (!halted) d.games?.onSocketsGone(userId);
    // À l'arrêt, stop() enregistre tout le monde. Hors du monde : arrivée interrompue, ou membre retiré.
    if (halted || !d.world.get(userId)) return;
    // Sans connexion, elle ne parle plus à personne : sa bulle s'éteint chez les autres, sans attendre la fin du délai de grâce.
    if (d.world.setSpeaking(userId, false)) d.io.to(OFFICE_ROOM).emit('speaking:changed', { id: userId, speaking: false });
    cancelGrace(userId);
    // Sa dernière présence est la coupure, pas la fin du délai de grâce.
    const leftAt = new Date();
    const timer = setTimeout(() => {
      depart(userId, leftAt).catch((err: unknown) => logServerError(d.logger, { err, userId }, 'Départ du bureau impossible'));
    }, d.graceMs);
    timer.unref();
    graceTimers.set(userId, timer);
  }

  // La fin du délai de grâce : leave, enregistrement de la position (et de l'heure de la coupure, `leftAt`), puis player:left à tous.
  // L'annonce suit l'écriture : qui lit la base après player:left y trouve la position et l'heure.
  async function depart(userId: string, leftAt: Date): Promise<void> {
    graceTimers.delete(userId);
    if (socketsByUser.has(userId)) return;   // revenu (connect annule le minuteur : par précaution)
    const player = d.world.leave(userId);
    if (!player) return;
    // Les chaises où elle attendait sont libres (une partie en cours garde son siège jusqu'à la fin de son délai).
    d.games?.onDepart(userId);
    await queueSave([rowOf(player)], leftAt);
    // Revenu pendant l'écriture : c'est son retour qui a été annoncé (player:joined), pas un départ.
    if (halted || d.world.get(userId)) return;
    d.io.to(OFFICE_ROOM).emit('player:left', { id: userId });
  }

  // member:removed : ses sockets sont coupées (sans reconnexion automatique) et son départ est annoncé tout de suite. La position
  // d'un compte désactivé n'a plus d'usage : elle n'est pas enregistrée.
  function removeMember(userId: string): void {
    cancelGrace(userId);
    const player = d.world.leave(userId);   // d'abord : la déconnexion de ses sockets ne trouve plus de joueur à faire attendre
    for (const socket of [...(socketsByUser.get(userId) ?? [])]) socket.disconnect(true);
    if (player) d.io.to(OFFICE_ROOM).emit('player:left', { id: userId });
    // Il sort tout de suite de sa partie, et ses chaises et invitations tombent.
    d.games?.onRemoved(userId);
  }

  // sessions:revoked (mot de passe réinitialisé) : ses sockets sont coupées, sans reconnexion automatique. Contrairement à un retrait,
  // le compte reste actif : la personne part comme après une coupure (délai de grâce, position enregistrée), et revient à sa
  // prochaine connexion, avec une session neuve.
  function disconnectUser(userId: string): void {
    for (const socket of [...(socketsByUser.get(userId) ?? [])]) socket.disconnect(true);
  }

  // Enregistre la position de chaque joueur du monde, y compris de ceux qui sont en délai de grâce. La promesse se résout quand
  // cette écriture, et toutes celles d'avant, sont faites.
  function saveAll(): Promise<void> {
    const rows = d.world.list().map(rowOf);
    return rows.length > 0 ? queueSave(rows) : saves;
  }

  return {
    connect(socket: TypedSocket): void {
      try {
        onConnection(socket);
      } catch (err) {
        logServerError(d.logger, { err, userId: socket.data.userId }, 'Connexion au bureau impossible');
        socket.disconnect(true);
      }
    },
    removeMember,
    disconnectUser,
    socketsOf(userId: string): string[] {
      return [...(socketsByUser.get(userId) ?? [])].map((socket) => socket.id);
    },
    // Les personnes qui ont au moins une socket.
    connectedUsers(): string[] {
      return [...socketsByUser.keys()];
    },
    saveAll,
    // La sauvegarde périodique : sautée tant que la précédente n'est pas finie (base lente).
    savePeriodically(): void {
      if (halted || periodicSaveRunning) return;
      periodicSaveRunning = true;
      void saveAll().then(() => {
        periodicSaveRunning = false;
      });
    },
    // L'arrêt : plus d'arrivée, de départ ni d'annonce ; les délais de grâce en cours sont abandonnés (leurs joueurs restent
    // dans le monde, que stop() enregistre).
    halt(): void {
      halted = true;
      for (const timer of graceTimers.values()) clearTimeout(timer);
      graceTimers.clear();
    },
  };
}

export type Presence = ReturnType<typeof createPresence>;
