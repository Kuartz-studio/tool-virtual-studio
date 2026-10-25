import { randomUUID } from 'node:crypto';
import {
  DESK_INVITE_COOLDOWN_MS,
  DESK_INVITE_TTL_MS,
  DESK_KNOCK_COOLDOWN_MS,
  JOIN_SEARCH_TILES,
  OFFICE_ROOM,
  deskKey,
  furnitureTiles,
  isWalkablePoint,
  refusesGameInvites,
  spotNear,
  zoneAt,
  type AvatarKey,
  type DeskAck,
  type DeskBan,
  type DeskCommand,
  type DeskInfo,
  type DeskInvite,
  type DeskInviteNotice,
  type OfficeMap,
  type Point,
} from '@bureau/shared';
import type { Logger } from 'pino';
import { logServerError } from '../logger';
import type { TypedServer, TypedSocket } from '../realtime/io';
import type { World } from '../realtime/world';
import type { Teleport } from '../teleport';
import { ARRIVAL_APART_PX } from '../join/join-person';
import type { DeskResult, DeskService, DeskSlot } from './desk-service';

export interface DeskControllerDeps {
  io: TypedServer;
  world: World;
  desks: DeskService;
  map: OfficeMap;
  /** Les personnes qui ont une socket entrée au bureau. */
  connectedUsers: () => string[];
  /** Les sockets de cette personne qui ont reçu leur init : les seules à qui l'on écrit. */
  socketsOf: (userId: string) => TypedSocket[];
  /** Pose quelqu'un ailleurs et dit à son navigateur de s'y replacer : celui qu'on exclut, celui qui rentre chez lui. */
  teleport: Teleport;
  /** L'horloge du temps réel (ms). */
  now: () => number;
  /** Parmi ces éléments de décor et ce mur, ceux de la boutique que la personne n'a pas achetés : elle ne peut pas les poser. Absent : tout est libre. */
  unowned?: (userId: string, itemIds: string[]) => Promise<string[]>;
  /** Acheter d'un coup ces éléments de la boutique (ceux qu'une déco pose sans qu'elle les ait) : tout, ou rien (`too_poor` : le total dépasse ses kuartzons).
   * Absent : on n'achète pas en enregistrant, il faut passer par la boutique. */
  buyAll?: (userId: string, itemIds: string[]) => Promise<{ ok: true } | { ok: false; error: 'unknown_item' | 'too_poor' }>;
  /** L'identifiant d'une nouvelle invitation : un uuid par défaut (les tests en passent de lisibles). */
  newId?: () => string;
  logger: Logger;
}

// Une invitation dans un bureau qui attend la réponse de l'invitée (`to`) : le bureau, qui invite, et jusqu'à quand (ms, horloge du temps réel).
interface PendingInvite {
  id: string;
  key: string;
  from: { id: string; name: string; avatarKey: AvatarKey | null };
  to: string;
  expiresAt: number;
}

// Ce que le serveur fait des bureaux (DeskService) : il applique les commandes d'une personne (`desk:do`), dit à tout le monde ce qui
// change, dit à chacune les portes qui lui sont fermées, et garde l'entrée des bureaux fermés (le monde refuse un pas qui y entre).
// Rien ici ne lève : une commande qui échoue répond une erreur.
export function createDeskController(d: DeskControllerDeps) {
  // Les portes fermées que chaque socket connaît : un `desk:access` ne part que s'il change.
  const sentAccess = new WeakMap<TypedSocket, string>();
  // Le dernier « toc toc » de chaque personne à chaque porte (ms).
  const lastKnock = new Map<string, number>();
  // Les invitations dans un bureau qui attendent leur réponse, par identifiant ; la dernière invitation de chaque personne à chaque autre (ms).
  const invites = new Map<string, PendingInvite>();
  const lastInvite = new Map<string, number>();
  const newId = d.newId ?? randomUUID;

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

  // Les portes fermées de chacun, relues : après tout changement qui peut en ouvrir ou en fermer une. Ceux qui se tiennent dans le cadre d'une porte qui vient
  // de se fermer pour eux sont repoussés dans la rue (evictFromThresholds).
  function pushAccess(): void {
    for (const userId of d.connectedUsers()) for (const socket of d.socketsOf(userId)) sendAccess(socket);
    evictFromThresholds();
  }

  // Une porte qui se ferme ne coince personne : qui est dans son cadre et ne peut plus y passer est posé devant elle, côté rue, comme celui qu'on exclut. La
  // pièce, elle, garde ceux qui y sont (ils y restent libres de leurs pas).
  function evictFromThresholds(): void {
    for (const slot of d.desks.slots) {
      const { door } = slot;
      if (!door) continue;
      for (const userId of d.connectedUsers()) {
        const player = d.world.get(userId);
        if (!player || d.desks.canEnter(userId, slot.key)) continue;
        const inDoorway = player.x >= door.x && player.x < door.x + door.width && player.y >= door.y && player.y < door.y + door.height;
        if (inDoorway) moveTo(userId, slot.exit);
      }
    }
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
  const moveTo = (userId: string, point: { x: number; y: number }): boolean => d.teleport(userId, point);

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
        return applied(await d.desks.claim(userId, me.name, command.key, me.timezone), userId);
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
      case 'invite':
        return invite(userId, command.userId);
      case 'answer':
        return answer(userId, command.invite, command.accept);
      case 'goto':
        return goto(userId);
      case 'decor':
        return decor(userId, command);
    }
  }

  // Enregistrer la déco de son bureau. Un élément ou un mur de la boutique qu'on n'a pas acheté ne se pose pas (`not_owned`), sauf à l'acheter en enregistrant :
  // tout ce qui manque doit être dans `buy`, et s'achète d'un coup (`too_poor` s'il manque des kuartzons : rien n'est acheté ni enregistré). La déco est validée
  // avant tout achat : on ne paie jamais pour une déco refusée. Le service revérifie tout (checkDecor) : un refus répond `bad_decor` avec sa raison, et rien n'est
  // diffusé. (Si l'enregistrement lui-même échoue après l'achat, la base ne répondant plus, ce qui est acheté le reste : on réenregistre sans repayer.)
  async function decor(userId: string, command: Extract<DeskCommand, { type: 'decor' }>): Promise<DeskAck> {
    const next = { floor: command.floor, wall: command.wall, items: command.items };
    const missing = d.unowned ? await d.unowned(userId, [...command.items.map((item) => item.id), command.wall]) : [];
    if (missing.length > 0) {
      const buying = new Set(command.buy ?? []);
      if (!d.buyAll || missing.some((id) => !buying.has(id))) return { ok: false, error: 'bad_decor', reason: 'not_owned' };
      const refused = d.desks.decorRefusal(userId, next);
      if (refused) return refused;
      const bought = await d.buyAll(userId, missing);
      if (!bought.ok) return bought.error === 'too_poor' ? { ok: false, error: 'too_poor' } : { ok: false, error: 'bad_decor', reason: 'not_owned' };
    }
    return applied(await d.desks.setDecor(userId, next));
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

  // Les invitations dont le temps est passé, et les délais entre deux invitations qui ne comptent plus : oubliés.
  function dropExpired(now: number): void {
    for (const pending of [...invites.values()]) if (pending.expiresAt <= now) invites.delete(pending.id);
    for (const [key, at] of [...lastInvite]) if (now - at >= DESK_INVITE_COOLDOWN_MS) lastInvite.delete(key);
  }

  // Ce que l'invitée voit d'une invitation : ce qu'il lui reste à vivre plutôt que son échéance (les horloges du serveur et du navigateur ne sont pas les mêmes),
  // en millisecondes entières : l'horloge du serveur (performance.now) a des décimales, et (now + 60000) - now peut donner 60000,00000000001.
  const viewOf = (pending: PendingInvite, now: number): DeskInvite => ({ id: pending.id, key: pending.key, from: pending.from, ttlMs: Math.max(0, Math.round(pending.expiresAt - now)) });

  function tell(userId: string, notice: DeskInviteNotice): void {
    for (const socket of d.socketsOf(userId)) socket.emit('desk:notice', notice);
  }

  // Inviter quelqu'un dans son bureau, quand on y est : il le voit (`desk:invite`) et a DESK_INVITE_TTL_MS pour répondre. Qui ne veut pas être dérangé (Ne pas
  // déranger, un mode qui ferme sa porte ou qui le conduit ailleurs : la règle des invitations aux tables) ne l'est pas : `dnd`. Réinviter la même personne
  // remplace l'invitation (son délai repart), sauf moins de DESK_INVITE_COOLDOWN_MS après la précédente : rien ne repart, et la réponse est la même, ok.
  function invite(ownerId: string, targetId: string): DeskAck {
    const mine = d.desks.deskOf(ownerId);
    const slot = mine && d.desks.slot(mine.key);
    if (!mine || !slot) return { ok: false, error: 'no_desk' };
    if (targetId === ownerId) return { ok: false, error: 'self' };
    const inMine = (p: Point) => zoneAt(d.map, p.x, p.y, ['desk'])?.id === slot.zone.id;
    const me = d.world.get(ownerId);
    if (!me || !inMine(me)) return { ok: false, error: 'not_home' };
    const target = d.world.get(targetId);
    if (!target) return { ok: false, error: 'offline' };
    if (inMine(target)) return { ok: false, error: 'already_inside' };
    if (refusesGameInvites(target)) return { ok: false, error: 'dnd' };
    const now = d.now();
    dropExpired(now);
    const pair = `${ownerId}\u0000${targetId}`;
    if (lastInvite.has(pair)) return { ok: true };
    lastInvite.set(pair, now);
    for (const earlier of [...invites.values()]) {
      if (earlier.from.id !== ownerId || earlier.to !== targetId) continue;
      invites.delete(earlier.id);
      for (const socket of d.socketsOf(targetId)) socket.emit('desk:invite:gone', { id: earlier.id });
    }
    const pending: PendingInvite = { id: newId(), key: mine.key, from: { id: ownerId, name: me.name, avatarKey: me.avatarKey }, to: targetId, expiresAt: now + DESK_INVITE_TTL_MS };
    invites.set(pending.id, pending);
    for (const socket of d.socketsOf(targetId)) socket.emit('desk:invite', viewOf(pending, now));
    return { ok: true };
  }

  // Où poser l'invitée qui arrive : près de la personne qui invite si elle est dans sa pièce, sinon près du milieu de la pièce ; jamais hors de la pièce, ni dans
  // un meuble, ni sur quelqu'un (spotNear).
  function arrivalSpot(userId: string, slot: DeskSlot, ownerId: string): Point | null {
    const { zone } = slot;
    const inside = (x: number, y: number) => x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height;
    const owner = d.world.get(ownerId);
    const near = owner && inside(owner.x, owner.y) ? owner : null;
    const furniture = furnitureTiles(d.map, d.desks.list());
    return spotNear(d.map, near ?? { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 }, {
      blocked: (tx, ty) => furniture.has(ty * d.map.widthTiles + tx),
      canStand: inside,
      taken: d.world.list().filter((p) => p.id !== userId),
      apartPx: ARRIVAL_APART_PX,
      maxSteps: JOIN_SEARCH_TILES,
      includeStart: near === null,
    });
  }

  // Répondre à une invitation. La refuser le dit à qui invitait. L'accepter fait entrer dans son bureau même porte fermée (admise jusqu'à la prochaine fermeture, et
  // plus exclue : c'est lui qui l'a voulu), à une case libre près de lui, par un voyage voulu (l'anneau de lumière), et le lui dit. Une invitation qui n'existe plus
  // (expirée, ou celle qui invitait est partie ou n'a plus ce bureau) répond `expired`, et rien ne change ; le bureau plein, `no_spot`.
  function answer(userId: string, inviteId: string, accept: boolean): DeskAck {
    const pending = invites.get(inviteId);
    if (!pending || pending.to !== userId) return { ok: false, error: 'expired' };
    invites.delete(inviteId);
    for (const socket of d.socketsOf(userId)) socket.emit('desk:invite:gone', { id: inviteId });
    const ownerId = pending.from.id;
    const slot = d.desks.deskOf(ownerId)?.key === pending.key ? d.desks.slot(pending.key) : undefined;
    if (pending.expiresAt <= d.now() || !d.world.get(ownerId) || !slot) return { ok: false, error: 'expired' };
    const who = { id: userId, name: d.world.get(userId)?.name ?? '' };
    if (!accept) {
      tell(ownerId, { kind: 'declined', user: who });
      return { ok: true };
    }
    const spot = arrivalSpot(userId, slot, ownerId);
    if (spot === null) return { ok: false, error: 'no_spot' };
    applied(d.desks.admit(ownerId, userId), ownerId);
    d.teleport(userId, spot, 'teleport');
    tell(ownerId, { kind: 'accepted', user: who });
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

    // Une place pour qui arrive pour la première fois (ou n'en a plus) ; les autres l'apprennent. Ne rejette jamais. `timezone` : le sien, pour
    // les horloges de la pièce.
    async assign(userId: string, name: string, timezone?: string): Promise<void> {
      try {
        await d.desks.ready;
        applied(await d.desks.autoAssign(userId, name, timezone));
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

    // Son nom affiché change, ou son fuseau horaire : celui de son bureau aussi (le nom sur la porte, l'heure de ses horloges).
    updateOwner(userId: string, owner: { name: string; timezone?: string }): void {
      applied(d.desks.updateOwner(userId, owner));
    },

    // Son état d'activité change : sa porte s'ouvre ou se ferme peut-être d'elle-même.
    refreshOwner(userId: string): void {
      applied(d.desks.refreshOwner(userId));
    },

    // Ce que l'init de cette socket dit des bureaux, et les invitations qui attendent la réponse de la personne (un rechargement ne les perd pas).
    initFor(socket: TypedSocket): { desks: DeskInfo[]; closedDesks: string[]; deskBans: DeskBan[]; deskInvites?: DeskInvite[] } {
      const { userId } = socket.data;
      const closedDesks = d.desks.closedFor(userId);
      sentAccess.set(socket, closedDesks.join(','));
      const now = d.now();
      const deskInvites = [...invites.values()].filter((pending) => pending.to === userId && pending.expiresAt > now).map((pending) => viewOf(pending, now));
      return { desks: d.desks.list(), closedDesks, deskBans: d.desks.bansOf(userId), ...(deskInvites.length > 0 ? { deskInvites } : {}) };
    },

    // Un point où cette personne peut se tenir : pas dans un bureau dont la porte lui est fermée.
    canStandAt(userId: string, x: number, y: number): boolean {
      const room = zoneAt(d.map, x, y, ['desk']);
      return room === null || d.desks.canEnter(userId, deskKey(room));
    },
  };
}

export type DeskController = ReturnType<typeof createDeskController>;
