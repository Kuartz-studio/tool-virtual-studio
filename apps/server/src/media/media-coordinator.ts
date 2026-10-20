import { randomInt } from 'node:crypto';
import { EMPTY_GROUPING, type GroupingState, type MediaJoinPayload } from '@bureau/shared';
import type { Logger } from 'pino';
import { logServerError } from '../logger';
import type { MediaBackend } from './livekit';

// Ce que le coordinateur demande d'envoyer à une personne (à chacune de ses sockets) : media:join, ou media:leave.
export type MediaEvent = { type: 'join'; p: MediaJoinPayload } | { type: 'leave' };

const BOOT_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

// L'identifiant de ce démarrage du serveur, préfixe des rooms : 6 caractères aléatoires. Les ids des groupes repartent de g1 à chaque
// démarrage ; sans ce préfixe, un groupe formé après un redémarrage retrouverait la room LiveKit d'un groupe d'avant, où d'autres
// personnes sont peut-être encore.
export function newBootId(): string {
  return Array.from({ length: 6 }, () => BOOT_ID_ALPHABET[randomInt(BOOT_ID_ALPHABET.length)]).join('');
}

// Le groupe de cette personne dans cet état, ou null. Une propriété héritée (un id « constructor ») ne compte pas.
function groupOf(s: GroupingState, userId: string): string | null {
  return Object.hasOwn(s.assignment, userId) ? (s.assignment[userId] ?? null) : null;
}

// Les rooms LiveKit des groupes de conversation : une par groupe, `${bootId}-${groupId}`. À chaque calcul des groupes, apply dit
// à ceux qui changent de room de quitter l'ancienne (media:leave, et retrait du participant) puis de rejoindre la nouvelle (media:join,
// avec un jeton neuf, valable pour cette room seulement). Les autres ne reçoivent rien : quand des groupes fusionnent ou se séparent,
// la partie qui garde l'id du groupe garde sa room.
//
// Sans backend (LiveKit non configuré), les groupes sont tout de même suivis (groupMembersOf, pour le chat « À proximité »), mais
// rien n'est envoyé.
export class MediaCoordinator {
  // L'état du dernier apply : celui que lisent currentJoin et groupMembersOf.
  private state: GroupingState = EMPTY_GROUPING;
  // Le nom affiché de chacun, pour ses jetons : celui que donne le dernier apply (le serveur donne toujours celui du monde).
  private nameOf: (id: string) => string = (id) => id;

  constructor(
    private readonly backend: MediaBackend | null,
    private readonly bootId: string,
    private readonly logger?: Logger,
  ) {}

  roomFor(groupId: string): string {
    return `${this.bootId}-${groupId}`;
  }

  // Passe de prev à next. Pour chaque personne dont le groupe change : media:leave (si elle en avait un) et son retrait de l'ancienne
  // room, puis media:join (si elle en a un nouveau). L'état est retenu tout de suite, avant la fabrication des jetons : un currentJoin
  // lancé pendant ce temps ne rend pas la room d'avant.
  //
  // La promesse se résout quand chaque join est parti. Elle n'attend pas les retraits : un LiveKit lent ou injoignable ne retarde ni
  // les join, ni le calcul suivant. Un retrait « introuvable » est ignoré par le backend ; un autre échec, comme un jeton impossible à
  // fabriquer, est journalisé, et ne touche pas les autres personnes : apply ne rejette pas pour eux.
  async apply(
    prev: GroupingState,
    next: GroupingState,
    send: (userId: string, e: MediaEvent) => void,
    nameOf: (id: string) => string,
  ): Promise<void> {
    this.state = next;
    this.nameOf = nameOf;
    const backend = this.backend;
    if (!backend) return;

    const joins: Array<Promise<void>> = [];
    for (const userId of new Set([...Object.keys(prev.assignment), ...Object.keys(next.assignment)])) {
      const before = groupOf(prev, userId);
      const after = groupOf(next, userId);
      if (before === after) continue;
      if (before !== null) {
        send(userId, { type: 'leave' });
        this.remove(backend, this.roomFor(before), userId);
      }
      if (after !== null) joins.push(this.join(backend, userId, this.roomFor(after), send));
    }
    await Promise.all(joins);
  }

  // Le media:join de la room de son groupe du moment, avec un jeton neuf : pour une socket qui (re)vient, après son init. null hors
  // groupe, sans backend, ou si son groupe change pendant la fabrication du jeton : apply a alors envoyé à ses sockets ce qu'il fallait.
  async currentJoin(userId: string): Promise<MediaJoinPayload | null> {
    const room = this.roomOf(userId);
    if (room === null || !this.backend) return null;
    const token = await this.backend.mintToken({ room, identity: userId, name: this.nameOf(userId) });
    return this.roomOf(userId) === room ? { url: this.backend.url, room, token } : null;
  }

  // Les membres de son groupe, elle comprise (dans l'ordre lexicographique) ; [] hors groupe.
  groupMembersOf(userId: string): string[] {
    const groupId = groupOf(this.state, userId);
    if (groupId === null || !Object.hasOwn(this.state.groups, groupId)) return [];
    return [...this.state.groups[groupId]!.members];
  }

  private roomOf(userId: string): string | null {
    const groupId = groupOf(this.state, userId);
    return groupId === null ? null : this.roomFor(groupId);
  }

  private async join(backend: MediaBackend, userId: string, room: string, send: (userId: string, e: MediaEvent) => void): Promise<void> {
    try {
      const token = await backend.mintToken({ room, identity: userId, name: this.nameOf(userId) });
      // Un apply plus récent l'a fait changer de room pendant ce temps : il a envoyé ce qu'il fallait. Jamais de jeton pour une room
      // qu'elle a quittée.
      if (this.roomOf(userId) !== room) return;
      send(userId, { type: 'join', p: { url: backend.url, room, token } });
    } catch (err) {
      this.report({ err, userId, room }, 'media:join impossible');
    }
  }

  private remove(backend: MediaBackend, room: string, userId: string): void {
    backend.removeParticipant(room, userId).catch((err: unknown) => this.report({ err, userId, room }, 'Retrait d\'un participant LiveKit impossible'));
  }

  private report(fields: Record<string, unknown>, message: string): void {
    if (this.logger) logServerError(this.logger, fields, message);
  }
}
