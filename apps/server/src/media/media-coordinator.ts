import { randomInt } from 'node:crypto';
import { EMPTY_GROUPING, MEDIA_PARK_REMOVE_MS, type GroupingState, type MediaJoinPayload } from '@bureau/shared';
import type { Logger } from 'pino';
import { logServerError } from '../logger';
import type { MediaBackend } from './livekit';

// Ce que le coordinateur demande d'envoyer à une personne (à chacune de ses sockets) : media:join, ou media:leave (`park` : en gardant la
// connexion parquée).
export type MediaEvent = { type: 'join'; p: MediaJoinPayload } | { type: 'leave'; park?: boolean };

export interface MediaCoordinatorOptions {
  /** Cette personne a-t-elle le droit de publier son micro ? Faux : son jeton ne le permet pas (état d'activité où l'on n'est pas entendu). */
  canSpeak?: (userId: string) => boolean;
  /**
   * Cette personne peut-elle garder sa connexion parquée en quittant sa room ? Faux pour qui sort de toute conversation (Ne pas déranger, un
   * état d'activité sans entendre ni être entendu) : rien ne l'y ramènera bientôt, elle la quitte pour de bon. Absent : toutes, tant qu'elles
   * sont au bureau (qui en part la quitte toujours pour de bon).
   */
  canPark?: (userId: string) => boolean;
  /** Le délai du retrait d'une connexion parquée, après la sortie : MEDIA_PARK_REMOVE_MS par défaut (les tests le raccourcissent). */
  parkRemoveMs?: number;
}

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
// à ceux qui changent de room de quitter l'ancienne (media:leave) puis de rejoindre la nouvelle (media:join, avec un jeton neuf, valable
// pour cette room seulement). Les autres ne reçoivent rien : quand des groupes fusionnent ou se séparent, la partie qui garde l'id du groupe
// garde sa room.
//
// Quitter, c'est parquer : la personne garde sa connexion à l'ancienne room, sans plus aucun droit d'y recevoir ni d'y publier (backend.park),
// pendant MEDIA_PARK_MS ; si elle revient dans ce groupe (ou les mêmes gens le reforment, et le calcul leur rend son id), son media:join porte
// `resume` et le backend lui rend ses droits : son client reprend la connexion parquée au lieu d'en ouvrir une. Une connexion parquée est
// retirée de la room `parkRemoveMs` après la sortie, par sûreté (le client la ferme de lui-même avant). Qui sort pour de bon (Ne pas déranger,
// un état hors de toute conversation, le départ du bureau), ou un backend qui ne sait pas parquer : media:leave sans `park`, et le retrait de
// la room tout de suite, comme avant.
//
// Les appels à LiveKit d'une même personne dans une même room passent l'un après l'autre (parquer, reprendre, retirer) : un retrait ou un
// parcage lent ne passe jamais après la reprise qui le suit. Et un media:join vers une room où un appel la concernant est encore en cours
// (le retrait d'une sortie pour de bon, juste avant) attend qu'il ait fini : un retrait en retard ne tombe plus sur la connexion d'après.
//
// Sans backend (LiveKit non configuré), les groupes sont tout de même suivis (groupMembersOf, pour le chat « À proximité »), mais
// rien n'est envoyé.
export class MediaCoordinator {
  // L'état du dernier apply : celui que lisent currentJoin et groupMembersOf.
  private state: GroupingState = EMPTY_GROUPING;
  // Le nom affiché de chacun, pour ses jetons : celui que donne le dernier apply (le serveur donne toujours celui du monde).
  private nameOf: (id: string) => string = (id) => id;
  // Le droit de parler de chacun dans la room où il est, tel que son dernier jeton le dit : s'il change, la personne rejoint la même room
  // avec un jeton neuf.
  private readonly spoke = new Map<string, boolean>();
  private readonly canSpeak: (userId: string) => boolean;
  private readonly canPark: (userId: string) => boolean;
  private readonly parkRemoveMs: number;
  // La room où chacun a laissé sa connexion parquée (la dernière qu'il a quittée en la parquant), tant qu'il n'est dans aucune.
  private readonly parked = new Map<string, string>();
  // Le retrait prévu de chaque connexion parquée, par room et personne (`key`).
  private readonly removals = new Map<string, NodeJS.Timeout>();
  // Le dernier appel à LiveKit de chaque personne dans chaque room (`key`), tant qu'il n'est pas fini : le suivant l'attend.
  private readonly calls = new Map<string, Promise<void>>();
  // Le numéro de la dernière reprise : chaque `resume` est neuf, et le client attend le sien (jamais l'attribut d'une reprise d'avant).
  private resumes = 0;

  constructor(
    private readonly backend: MediaBackend | null,
    private readonly bootId: string,
    private readonly logger?: Logger,
    options: MediaCoordinatorOptions = {},
  ) {
    this.canSpeak = options.canSpeak ?? (() => true);
    this.canPark = options.canPark ?? (() => true);
    this.parkRemoveMs = options.parkRemoveMs ?? MEDIA_PARK_REMOVE_MS;
  }

  roomFor(groupId: string): string {
    return `${this.bootId}-${groupId}`;
  }

  // Passe de prev à next. Pour chaque personne dont le groupe change : media:leave (si elle en avait un), en parquant sa connexion à
  // l'ancienne room ou en l'en retirant, puis media:join (si elle en a un nouveau). L'état est retenu tout de suite, avant la fabrication des
  // jetons : un currentJoin lancé pendant ce temps ne rend pas la room d'avant.
  //
  // La promesse se résout quand chaque join est parti. Elle n'attend ni les parcages, ni les reprises, ni les retraits (sauf le retrait encore
  // en cours d'une personne qui revient dans cette même room) : un LiveKit lent ou injoignable ne retarde ni les autres join, ni le calcul
  // suivant. Un appel « introuvable » est ignoré par le backend ; un autre échec est journalisé, comme un jeton impossible à fabriquer, et ne
  // touche pas les autres personnes : apply ne rejette pas pour eux.
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
      // Même room, mais son droit de parler a changé : elle la quitte et la rejoint avec le jeton qui correspond (en la parquant puis en la
      // reprenant, avec ses nouveaux droits, quand le backend le sait).
      const rejoin = before !== null && before === after && this.spoke.has(userId) && this.spoke.get(userId) !== this.canSpeak(userId);
      if (before === after && !rejoin) continue;
      if (before !== null) this.leave(backend, userId, this.roomFor(before), Object.hasOwn(next.assignment, userId), send);
      if (after === null) this.spoke.delete(userId);
      else joins.push(this.join(backend, userId, this.roomFor(after), send));
    }
    await Promise.all(joins);
  }

  // Le media:join de la room de son groupe du moment, avec un jeton neuf : pour une socket qui (re)vient, après son init. null hors
  // groupe, sans backend, ou si son groupe change pendant la fabrication du jeton : apply a alors envoyé à ses sockets ce qu'il fallait.
  async currentJoin(userId: string): Promise<MediaJoinPayload | null> {
    const room = this.roomOf(userId);
    if (room === null || !this.backend) return null;
    const canSpeak = this.canSpeak(userId);
    const token = await this.backend.mintToken({ room, identity: userId, name: this.nameOf(userId), canSpeak });
    if (this.roomOf(userId) !== room) return null;
    this.spoke.set(userId, canSpeak);
    return { url: this.backend.url, room, token };
  }

  // Les membres de son groupe, elle comprise (dans l'ordre lexicographique) ; [] hors groupe.
  groupMembersOf(userId: string): string[] {
    const groupId = groupOf(this.state, userId);
    if (groupId === null || !Object.hasOwn(this.state.groups, groupId)) return [];
    return [...this.state.groups[groupId]!.members];
  }

  // La room où cette personne a laissé sa connexion parquée, ou null (pour les tests).
  parkedRoomOf(userId: string): string | null {
    return this.parked.get(userId) ?? null;
  }

  private roomOf(userId: string): string | null {
    const groupId = groupOf(this.state, userId);
    return groupId === null ? null : this.roomFor(groupId);
  }

  // La sortie d'une room. Parquée si la personne est encore au bureau et dans les conversations, et si le backend le sait : media:leave avec
  // `park`, ses droits retirés dans la room, et son retrait prévu. Sinon, pour de bon : media:leave, et son retrait de la room tout de suite.
  private leave(backend: MediaBackend, userId: string, room: string, present: boolean, send: (userId: string, e: MediaEvent) => void): void {
    if (present && backend.park && this.canPark(userId)) {
      const parkIn = backend.park.bind(backend);
      send(userId, { type: 'leave', park: true });
      this.parked.set(userId, room);
      this.call(room, userId, () => parkIn(room, userId), 'Parcage d\'un participant LiveKit impossible');
      this.scheduleRemoval(backend, room, userId);
      return;
    }
    send(userId, { type: 'leave' });
    if (this.parked.get(userId) === room) this.parked.delete(userId);
    this.call(room, userId, () => backend.removeParticipant(room, userId), 'Retrait d\'un participant LiveKit impossible');
  }

  private async join(backend: MediaBackend, userId: string, room: string, send: (userId: string, e: MediaEvent) => void): Promise<void> {
    // Elle revient dans la room où sa connexion est parquée : on la reprend. Le retrait prévu de cette connexion n'a plus lieu d'être.
    const resume = this.parked.get(userId) === room && backend.resume ? String(++this.resumes) : undefined;
    this.parked.delete(userId);
    this.cancelRemoval(room, userId);
    try {
      const canSpeak = this.canSpeak(userId);
      if (resume !== undefined) {
        // Ses droits rendus, après le parcage (les appels de la personne dans cette room se suivent) ; son client attend l'attribut de la reprise
        // pour republier, et le media:join part sans attendre LiveKit.
        const resumeIn = backend.resume!.bind(backend);
        this.call(room, userId, () => resumeIn(room, userId, { canSpeak, resume }), 'Reprise d\'un participant LiveKit impossible');
      } else {
        // Un appel la concernant dans cette room est peut-être encore en cours (le retrait d'une sortie pour de bon, juste avant) : on l'attend,
        // pour qu'il ne tombe jamais sur la connexion qu'elle va ouvrir.
        await this.calls.get(key(room, userId));
      }
      const token = await backend.mintToken({ room, identity: userId, name: this.nameOf(userId), canSpeak });
      // Un apply plus récent l'a fait changer de room pendant ce temps : il a envoyé ce qu'il fallait. Jamais de jeton pour une room
      // qu'elle a quittée.
      if (this.roomOf(userId) !== room) return;
      this.spoke.set(userId, canSpeak);
      send(userId, { type: 'join', p: { url: backend.url, room, token, ...(resume !== undefined ? { resume } : {}) } });
    } catch (err) {
      this.report({ err, userId, room }, 'media:join impossible');
    }
  }

  // Lance cet appel à LiveKit après le précédent de la même personne dans la même room. Un échec n'est qu'un avertissement : le client suit
  // media:leave et media:join de lui-même, et l'appel n'est qu'une sûreté (« introuvable », la personne déjà partie, est ignoré par le backend).
  private call(room: string, userId: string, op: () => Promise<void>, failure: string): void {
    const k = key(room, userId);
    const run = (this.calls.get(k) ?? Promise.resolve())
      .then(op)
      .catch((err: unknown) => this.logger?.warn({ err, userId, room }, failure));
    this.calls.set(k, run);
    void run.then(() => {
      if (this.calls.get(k) === run) this.calls.delete(k);
    });
  }

  // Le retrait d'une connexion parquée, parkRemoveMs après la sortie, si la personne n'est pas revenue dans cette room entre-temps. Son client
  // l'a fermée avant (MEDIA_PARK_MS) : LiveKit répond « introuvable », sans rien couper. Le minuteur ne retient pas le processus.
  private scheduleRemoval(backend: MediaBackend, room: string, userId: string): void {
    this.cancelRemoval(room, userId);
    const k = key(room, userId);
    const timer = setTimeout(() => {
      this.removals.delete(k);
      if (this.parked.get(userId) === room) this.parked.delete(userId);
      this.call(room, userId, () => backend.removeParticipant(room, userId), 'Retrait d\'un participant LiveKit impossible');
    }, this.parkRemoveMs);
    timer.unref();
    this.removals.set(k, timer);
  }

  private cancelRemoval(room: string, userId: string): void {
    const k = key(room, userId);
    clearTimeout(this.removals.get(k));
    this.removals.delete(k);
  }

  private report(fields: Record<string, unknown>, message: string): void {
    if (this.logger) logServerError(this.logger, fields, message);
  }
}

// La clé d'une personne dans une room.
function key(room: string, userId: string): string {
  return `${room}\u0000${userId}`;
}
