import { OFFICE_ROOM, type ChatMessage, type Direction, type OfficeMap, type PublicPlayer } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { ChatService } from '../chat/chat-service';
import type { Db } from '../db/client';
import { user } from '../db/schema';
import { logServerError } from '../logger';
import type { TypedServer, TypedSocket } from './io';
import { loadPosition, savePositions } from './positions';
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

  function queueSave(rows: Array<{ id: string; x: number; y: number; dir: Direction }>): Promise<void> {
    saves = saves
      .then(() => savePositions(d.db, rows))
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

  // Envoie l'état de départ à la socket (l'historique du chat est lu avant : `chatHistory`), puis annonce l'arrivée aux autres si c'en
  // est une (pas pour un onglet de plus ni pour un retour pendant le délai de grâce). La socket n'entre dans la salle du bureau qu'ici :
  // aucune diffusion ne lui parvient avant son init, ni message du chat, ni événement média. Puis onWelcome (sa room LiveKit).
  function welcome(socket: TypedSocket, arrival: boolean, chatHistory: ChatMessage[]): void {
    const { userId } = socket.data;
    const self = d.world.get(userId)!;
    void socket.join(OFFICE_ROOM);
    socket.emit('init', {
      self,
      players: d.world.list().filter((p) => p.id !== userId),
      mapKey: d.mapKey,
      chatHistory,
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
      const [saved, disabled, chatHistory] = await Promise.all([
        loadPosition(d.db, userId),
        isDisabled(d.db, userId),
        readChatHistory(userId),
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
        const spot = chooseSpawn(d.map, saved, d.busyZones());
        const dir = saved && spot.x === saved.x && spot.y === saved.y ? saved.dir : DEFAULT_DIR;
        d.world.join({ id: userId, name, avatarKey, x: spot.x, y: spot.y, dir, status: d.world.rememberedStatus(userId) });
      }
      welcome(socket, arrival, chatHistory);
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
      const chatHistory = await readChatHistory(userId);
      if (halted || !socket.connected) return;
      // Une socket enregistrée garde sa personne au monde (ni le délai de grâce ni member:removed ne la retirent alors) : ce cas ne
      // devrait pas se produire. Sans personne à montrer, le client se reconnecte et arrive pour de bon, au lieu d'attendre un init.
      if (!d.world.get(userId)) {
        socket.conn.close();
        return;
      }
      welcome(socket, false, chatHistory);
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
    // À l'arrêt, stop() enregistre tout le monde. Hors du monde : arrivée interrompue, ou membre retiré.
    if (halted || !d.world.get(userId)) return;
    cancelGrace(userId);
    const timer = setTimeout(() => {
      depart(userId).catch((err: unknown) => logServerError(d.logger, { err, userId }, 'Départ du bureau impossible'));
    }, d.graceMs);
    timer.unref();
    graceTimers.set(userId, timer);
  }

  // La fin du délai de grâce : leave, enregistrement de la position, puis player:left à tous. L'annonce suit l'écriture : qui lit
  // la base après player:left y trouve la position.
  async function depart(userId: string): Promise<void> {
    graceTimers.delete(userId);
    if (socketsByUser.has(userId)) return;   // revenu (connect annule le minuteur : par précaution)
    const player = d.world.leave(userId);
    if (!player) return;
    await queueSave([rowOf(player)]);
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
    socketsOf(userId: string): string[] {
      return [...(socketsByUser.get(userId) ?? [])].map((socket) => socket.id);
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
