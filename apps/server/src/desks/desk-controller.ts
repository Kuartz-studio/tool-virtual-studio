import {
  DESK_KNOCK_COOLDOWN_MS,
  OFFICE_ROOM,
  deskKey,
  isWalkablePoint,
  zoneAt,
  type DeskAck,
  type DeskBan,
  type DeskCommand,
  type DeskInfo,
  type OfficeMap,
} from '@bureau/shared';
import type { Logger } from 'pino';
import { logServerError } from '../logger';
import type { TypedServer, TypedSocket } from '../realtime/io';
import type { World } from '../realtime/world';
import type { DeskResult, DeskService } from './desk-service';

export interface DeskControllerDeps {
  io: TypedServer;
  world: World;
  desks: DeskService;
  map: OfficeMap;
  /** Les personnes qui ont une socket entrée au bureau. */
  connectedUsers: () => string[];
  /** Les sockets de cette personne qui ont reçu leur init : les seules à qui l'on écrit. */
  socketsOf: (userId: string) => TypedSocket[];
  /** L'horloge du temps réel (ms). */
  now: () => number;
  logger: Logger;
}

// Ce que le serveur fait des bureaux (DeskService) : il applique les commandes d'une personne (`desk:do`), dit à tout le monde ce qui
// change, dit à chacune les portes qui lui sont fermées, et garde l'entrée des bureaux fermés (le monde refuse un pas qui y entre).
// Rien ici ne lève : une commande qui échoue répond une erreur.
export function createDeskController(d: DeskControllerDeps) {
  // Les portes fermées que chaque socket connaît : un `desk:access` ne part que s'il change.
  const sentAccess = new WeakMap<TypedSocket, string>();
  // Le dernier « toc toc » de chaque personne à chaque porte (ms).
  const lastKnock = new Map<string, number>();

  // Entrer dans un bureau dont on ne peut pas franchir la porte est refusé comme un mur. Qui est déjà dans la pièce y reste libre de ses
  // pas, même si la porte vient de se fermer.
  d.world.setEntryGuard((id, from, to) => {
    const room = zoneAt(d.map, to.x, to.y, ['desk']);
    if (room === null) return true;
    if (zoneAt(d.map, from.x, from.y, ['desk'])?.id === room.id) return true;
    return d.desks.canEnter(id, deskKey(room));
  });

  function broadcast(changed: DeskInfo[]): void {
    for (const info of changed) d.io.to(OFFICE_ROOM).emit('desk:changed', info);
  }

  function sendAccess(socket: TypedSocket): void {
    const closed = d.desks.closedFor(socket.data.userId);
    const signature = closed.join(',');
    if (sentAccess.get(socket) === signature) return;
    sentAccess.set(socket, signature);
    socket.emit('desk:access', { closed });
  }

  // Les portes fermées de chacun, relues : après tout changement qui peut en ouvrir ou en fermer une.
  function pushAccess(): void {
    for (const userId of d.connectedUsers()) for (const socket of d.socketsOf(userId)) sendAccess(socket);
  }

  function pushBans(userId: string): void {
    const bans = d.desks.bansOf(userId);
    for (const socket of d.socketsOf(userId)) socket.emit('desk:bans', bans);
  }

  function applied(result: DeskResult, ...owners: string[]): DeskAck {
    if (!result.ok) return result;
    broadcast(result.changed);
    if (result.access) pushAccess();
    for (const owner of owners) pushBans(owner);
    return { ok: true };
  }

  // Pose la personne là (un pas hors de la pièce, ou chez elle), et dit à son navigateur de s'y replacer.
  function moveTo(userId: string, point: { x: number; y: number }): boolean {
    const [x, y] = [Math.round(point.x), Math.round(point.y)];
    if (!d.world.teleport(userId, x, y)) return false;
    for (const socket of d.socketsOf(userId)) socket.emit('move:correct', { x, y });
    return true;
  }

  async function run(userId: string, command: DeskCommand): Promise<DeskAck> {
    const me = d.world.get(userId);
    if (!me) return { ok: false, error: 'invalid' };
    try {
      await d.desks.ready;
    } catch {
      return { ok: false, error: 'unavailable' };
    }

    switch (command.type) {
      case 'claim':
        return applied(await d.desks.claim(userId, me.name, command.key), userId);
      case 'release':
        return applied(await d.desks.release(userId), userId);
      case 'rename':
        return applied(await d.desks.rename(userId, command.name));
      case 'lock':
        return applied(await d.desks.setLocked(userId, command.locked));
      case 'unban':
        return applied(d.desks.unban(userId, command.userId), userId);
      case 'admit':
        return applied(d.desks.admit(userId, command.userId), userId);
      case 'kick':
        return kick(userId, command.userId);
      case 'knock':
        return knock(userId, me.name, command.key);
      case 'goto':
        return goto(userId);
      case 'decor':
        // Le service revérifie tout (checkDecor) : un refus répond `bad_decor` avec sa raison, et rien n'est diffusé.
        return applied(await d.desks.setDecor(userId, { floor: command.floor, wall: command.wall, items: command.items }));
    }
  }

  function kick(ownerId: string, targetId: string): DeskAck {
    const mine = d.desks.deskOf(ownerId);
    const slot = mine && d.desks.slot(mine.key);
    if (!mine || !slot) return { ok: false, error: 'no_desk' };
    if (targetId === ownerId) return { ok: false, error: 'self' };
    const target = d.world.get(targetId);
    const inside = target && zoneAt(d.map, target.x, target.y, ['desk'])?.id === slot.zone.id;
    if (!target || !inside) return { ok: false, error: 'not_inside' };
    const result = d.desks.kick(ownerId, targetId, target.name);
    moveTo(targetId, slot.exit);
    return applied(result, ownerId);
  }

  // Toquer à une porte fermée : le propriétaire, s'il est au bureau, voit qui toque. Un exclu qui toque n'est pas entendu, et personne ne
  // toque deux fois de suite à la même porte en moins de DESK_KNOCK_COOLDOWN_MS. Dans les deux cas, la réponse est la même : ok.
  function knock(userId: string, name: string, key: string): DeskAck {
    const target = d.desks.get(key);
    if (!target) return { ok: false, error: 'unknown_desk' };
    if (target.ownerId === null) return { ok: false, error: 'not_locked' };
    if (target.ownerId === userId) return { ok: false, error: 'self' };
    if (d.desks.canEnter(userId, key)) return { ok: false, error: 'not_locked' };
    const bannedHere = d.desks.bansOf(target.ownerId).some((ban) => ban.id === userId);
    const now = d.now();
    const cooldownKey = `${userId}\u0000${key}`;
    const last = lastKnock.get(cooldownKey);
    if (bannedHere || (last !== undefined && now - last < DESK_KNOCK_COOLDOWN_MS)) return { ok: true };
    lastKnock.set(cooldownKey, now);
    for (const socket of d.socketsOf(target.ownerId)) socket.emit('desk:knock', { key, userId, name });
    return { ok: true };
  }

  function goto(userId: string): DeskAck {
    const mine = d.desks.deskOf(userId);
    const slot = mine && d.desks.slot(mine.key);
    if (!mine || !slot) return { ok: false, error: 'no_desk' };
    const center = { x: slot.zone.x + slot.zone.width / 2, y: slot.zone.y + slot.zone.height / 2 };
    moveTo(userId, isWalkablePoint(d.map, Math.round(center.x), Math.round(center.y)) ? center : slot.exit);
    return { ok: true };
  }

  return {
    run,

    // Une place pour qui arrive pour la première fois (ou n'en a plus) ; les autres l'apprennent. Ne rejette jamais.
    async assign(userId: string, name: string): Promise<void> {
      try {
        await d.desks.ready;
        applied(await d.desks.autoAssign(userId, name));
      } catch (err) {
        logServerError(d.logger, { err, userId }, 'Attribution d\'un bureau impossible');
      }
    },

    // Un membre retiré : son bureau est libre.
    async release(userId: string): Promise<void> {
      try {
        await d.desks.ready;
        applied(await d.desks.release(userId));
      } catch (err) {
        logServerError(d.logger, { err, userId }, 'Libération d\'un bureau impossible');
      }
    },

    // Son nom affiché change : celui de son bureau aussi.
    renameOwner(userId: string, name: string): void {
      applied(d.desks.renameOwner(userId, name));
    },

    // Son état d'activité change : sa porte s'ouvre ou se ferme peut-être d'elle-même.
    refreshOwner(userId: string): void {
      applied(d.desks.refreshOwner(userId));
    },

    // Ce que l'init de cette socket dit des bureaux.
    initFor(socket: TypedSocket): { desks: DeskInfo[]; closedDesks: string[]; deskBans: DeskBan[] } {
      const { userId } = socket.data;
      const closedDesks = d.desks.closedFor(userId);
      sentAccess.set(socket, closedDesks.join(','));
      return { desks: d.desks.list(), closedDesks, deskBans: d.desks.bansOf(userId) };
    },

    // Un point où cette personne peut se tenir : pas dans un bureau dont la porte lui est fermée.
    canStandAt(userId: string, x: number, y: number): boolean {
      const room = zoneAt(d.map, x, y, ['desk']);
      return room === null || d.desks.canEnter(userId, deskKey(room));
    },
  };
}

export type DeskController = ReturnType<typeof createDeskController>;
