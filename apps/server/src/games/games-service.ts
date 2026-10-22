import { randomUUID } from 'node:crypto';
import {
  GAME_CHAIR_IDLE_MS,
  GAME_DRAW_OFFER_MIN_MOVES,
  GAME_INVITES_PER_USER,
  GAME_INVITE_TTL_MS,
  GAME_MIN_RANKED_MOVES,
  GAME_RECONNECT_MS,
  GAME_TURN_TIMEOUT_MS,
  pickIndex,
  placeAt,
  recordingRng,
  refusesGameInvites,
  rngFromDice,
  roomOfTable,
  type ActivityState,
  type AnyGameDefinition,
  type ForfeitReason,
  type GameAck,
  type GameCommand,
  type GameError,
  type GameId,
  type GameInvite,
  type GameMatchView,
  type GameNotice,
  type GameResult,
  type GameTableView,
  type MatchLogEntry,
  type OfficeMap,
  type Rng,
  type Status,
} from '@bureau/shared';
import type { Logger } from 'pino';
import { logServerError } from '../logger';
import { oneAtATimePerKey } from '../one-at-a-time';
import { cryptoRng } from './crypto-rng';
import type { LadderEntry, LadderRecord } from './ladder-service';

// Ce que le service sait d'une personne du monde : son nom, son avatar, où elle est (pour savoir si elle est dans la salle de jeu), son statut et son mode (pour ne pas inviter
// qui ne veut pas être dérangé).
export interface GamesPlayer {
  name: string;
  avatarKey: string | null;
  x: number;
  y: number;
  status: Status;
  activity?: ActivityState | null;
}

// Ce que le service dit au bureau, et à qui.
export interface GamesOutput {
  // La table entière, à tout le bureau, à chaque changement.
  table(view: GameTableView): void;
  // Une invitation, à l'invitée.
  invite(userId: string, invite: GameInvite): void;
  // L'invitation n'est plus à montrer, à l'invitée.
  inviteGone(userId: string, gone: { id: string; reason: 'expired' | 'cancelled' | 'answered' }): void;
  // Un avis, à l'invitante : la réponse, le silence ou le départ de l'invitée.
  notice(userId: string, notice: GameNotice): void;
}

export interface GamesDeps {
  map: OfficeMap;
  // Les jeux que le registre connaît : une table dont le jeu n'y est pas reste fermée (on s'y assoit, la partie ne commence pas).
  games: Partial<Record<GameId, AnyGameDefinition>>;
  ladder: { record(entry: LadderEntry): Promise<LadderRecord | null> };
  players: { get(userId: string): GamesPlayer | undefined };
  // La personne a au moins une socket entrée au bureau : elle peut recevoir une invitation.
  isOnline(userId: string): boolean;
  // Pose quelqu'un près de la table qu'il rejoint en acceptant une invitation (sa chaise, ou une case autour ; null : il regarde).
  arrive(userId: string, game: GameId, chair: number | null): void;
  // Prend un jeton de la limite d'invitations de ce compte (GAME_INVITE_RATE) ; faux : trop d'invitations.
  inviteAllowed(userId: string): boolean;
  out: GamesOutput;
  // L'horloge monotone du monde, en ms : tous les délais y courent.
  now(): number;
  // L'heure du mur, en ms depuis 1970 : le début et la fin d'une partie, pour la base. Date.now par défaut.
  clock?(): number;
  // Le hasard : crypto par défaut. Les tests passent le leur.
  rng?: Rng;
  newId?(): string;
  logger: Logger;
}

interface Chair {
  userId: string;
  name: string;
  avatarKey: string | null;
  ready: boolean;
  connected: boolean;
  // Le dernier geste de cette personne à cette chaise (s'asseoir, « prêt », la fin d'une partie), en ms de l'horloge monotone : de quoi libérer une chaise oubliée.
  since: number;
}

interface Match {
  id: string;
  status: 'playing' | 'ended';
  def: AnyGameDefinition;
  // Les joueurs par siège, tels qu'ils étaient à la chaise au début (le nom et l'avatar suivent un changement de profil).
  players: Array<{ userId: string; name: string; avatarKey: string | null }>;
  first: number;
  state: unknown;
  events: unknown[];
  log: MatchLogEntry[];
  // Le début de la partie : sur l'horloge du mur (pour la base), et sur celle du monde (pour la durée des entrées du journal).
  startedAt: number;
  startedMono: number;
  // Quand le siège qui doit agir perd faute d'avoir joué (horloge monotone) ; null si la partie est finie.
  deadline: number | null;
  drawOffer: number | null;
  // Par siège : a-t-il le droit de proposer la nulle ? Faux après une offre, jusqu'à son prochain coup.
  canOffer: boolean[];
  // Par siège : est-il sorti de la partie (abandon, délai, départ) ?
  out: boolean[];
  // Par siège : depuis quand n'a-t-il plus de connexion (horloge monotone) ; null s'il est là.
  disconnectedSince: Array<number | null>;
  result: GameResult | null;
  ranked: boolean | null;
  ratings: Array<{ userId: string; before: number; after: number }> | null;
  // Des dés imposés aux prochains tirages de cette partie (débogage des tests de bout en bout seulement).
  forcedRolls: number[];
  // La version de la table au dernier changement de l'état du jeu (la partie qui commence, un coup, une sortie, la nulle acceptée, un état fabriqué). Un coup envoyé sur une version
  // plus ancienne a été pensé sur un état périmé ; les autres changements de la table (un spectateur, un nom, une connexion, une offre de nulle) ne le périment pas.
  stateVersion: number;
}

interface Table {
  game: GameId;
  // La clé du lieu qui contient la table (la salle de jeu) : il faut y être pour regarder ou s'asseoir.
  roomKey: string | null;
  version: number;
  chairs: Array<Chair | null>;
  spectators: Map<string, string>;
  match: Match | null;
  // Les joueurs et celui qui a commencé la partie d'avant : de quoi alterner à la revanche.
  previous: { userIds: string[]; first: number } | null;
}

interface PendingInvite {
  id: string;
  game: GameId;
  from: { id: string; name: string; avatarKey: string | null };
  to: { id: string; name: string };
  expiresAt: number;
}

const ok: GameAck = { ok: true };
const refuse = (error: GameError): GameAck => ({ ok: false, error });

// Les tables de jeu du bureau, en mémoire : une par jeu de la carte, avec ses chaises, ses spectateurs et sa partie. Une seule instance de serveur : rien n'est écrit en
// base avant la fin d'une partie (LadderService).
//
// Toutes les commandes d'une table, et le balayage de ses délais, passent l'une après l'autre (une file par table) : deux coups simultanés sont jugés à la suite, le second
// sur l'état que le premier a laissé. Le service ne tient aucun minuteur : le contrôleur appelle `sweep` toutes les GAME_SWEEP_MS, ce qui fait tomber les délais (le coup
// qu'on n'a pas joué, la connexion qui n'est pas revenue, l'invitation sans réponse, la chaise oubliée) ; les tests l'appellent eux-mêmes, sur une horloge qu'ils règlent.
export class GamesService {
  private readonly tables = new Map<GameId, Table>();
  private readonly invites = new Map<string, PendingInvite>();
  private readonly serial = oneAtATimePerKey();
  private readonly rng: Rng;
  private readonly clock: () => number;
  private readonly newId: () => string;
  private halted = false;

  constructor(private readonly d: GamesDeps) {
    this.rng = d.rng ?? cryptoRng;
    this.clock = d.clock ?? Date.now;
    this.newId = d.newId ?? randomUUID;
    for (const table of d.map.tables) {
      this.tables.set(table.game, {
        game: table.game,
        roomKey: roomOfTable(d.map, table)?.key ?? null,
        version: 0,
        chairs: table.seats.map(() => null),
        spectators: new Map(),
        match: null,
        previous: null,
      });
    }
  }

  // L'arrêt du serveur : plus de balayage, plus de commande, plus rien d'écrit. Les parties en cours sont perdues (elles ne sont pas conservées).
  stop(): void {
    this.halted = true;
  }

  // ---- Ce que le bureau voit -----------------------------------------------------------------------------------------------------------

  // Les tables de la carte, chacune telle que tout le bureau la voit (l'init les donne).
  views(): GameTableView[] {
    return [...this.tables.values()].map((table) => this.viewOf(table));
  }

  // Les invitations qui attendent la réponse de cette personne, avec ce qu'il leur reste à vivre.
  invitesFor(userId: string): GameInvite[] {
    const now = this.d.now();
    return [...this.invites.values()]
      .filter((invite) => invite.to.id === userId && invite.expiresAt > now)
      .map((invite) => ({ id: invite.id, game: invite.game, from: invite.from, ttlMs: Math.max(0, invite.expiresAt - now) }));
  }

  private viewOf(table: Table): GameTableView {
    return {
      game: table.game,
      version: table.version,
      chairs: table.chairs.map((chair) => chair && { userId: chair.userId, name: chair.name, avatarKey: chair.avatarKey, ready: chair.ready, connected: chair.connected }),
      spectators: [...table.spectators].map(([id, name]) => ({ id, name })),
      match: table.match && this.matchView(table, table.match),
    };
  }

  private matchView(table: Table, match: Match): GameMatchView {
    const now = this.d.now();
    const playing = match.status === 'playing';
    return {
      id: match.id,
      status: match.status,
      players: match.players.map((player, seat) => {
        const since = match.disconnectedSince[seat] ?? null;
        const chair = table.chairs.find((candidate) => candidate?.userId === player.userId);
        return {
          userId: player.userId,
          name: player.name,
          avatarKey: player.avatarKey,
          connected: playing ? since === null : chair?.connected === true,
          reconnectMs: playing && since !== null && !match.out[seat] ? Math.max(0, GAME_RECONNECT_MS - (now - since)) : null,
          out: match.out[seat] === true,
        };
      }),
      first: match.first,
      state: match.state,
      events: match.events,
      turnMs: playing && match.deadline !== null ? Math.max(0, match.deadline - now) : null,
      drawOffer: match.drawOffer,
      startedAt: match.startedAt,
      result: match.result,
      ranked: match.ranked,
      ratings: match.ratings,
    };
  }

  // Un changement de la table : sa version avance, et tout le bureau reçoit la table entière. `events` : ce que le changement a provoqué dans la partie (à animer) ; sans
  // eux (un spectateur qui arrive, quelqu'un qui s'assoit), la partie n'a rien de neuf à animer. `matchChanged` : l'état du jeu a changé (une partie qui commence, un coup, une
  // sortie, la nulle acceptée, un état fabriqué) : un coup envoyé sur une version d'avant est périmé, ce que ne fait aucun autre changement (voir `Match.stateVersion`).
  private commit(table: Table, events: unknown[] = [], matchChanged = false): void {
    table.version++;
    if (table.match) {
      table.match.events = events;
      if (matchChanged) table.match.stateVersion = table.version;
    }
    this.d.out.table(this.viewOf(table));
  }

  // ---- Les commandes ---------------------------------------------------------------------------------------------------------------------

  // Une commande de `game:do`. Rejette jamais : une erreur imprévue est journalisée et répond `unavailable`.
  run(userId: string, command: GameCommand): Promise<GameAck> {
    if (this.halted) return Promise.resolve(refuse('unavailable'));
    // Répondre à une invitation passe par la file de la table de cette invitation ; une invitation inconnue n'est plus valable.
    const game = command.type === 'answer' ? this.invites.get(command.invite)?.game : command.game;
    if (game === undefined) return Promise.resolve(refuse('expired'));
    return this.serial(game, async () => {
      try {
        return await this.exec(userId, command);
      } catch (err) {
        logServerError(this.d.logger, { err, userId, command: command.type }, 'Commande de jeu impossible');
        return refuse('unavailable');
      }
    });
  }

  private async exec(userId: string, command: GameCommand): Promise<GameAck> {
    switch (command.type) {
      case 'watch':
        return this.watch(userId, command.game);
      case 'unwatch':
        return this.unwatch(userId, command.game);
      case 'sit':
        return this.sit(userId, command.game, command.chair);
      case 'stand':
        return this.stand(userId, command.game);
      case 'ready':
        return this.ready(userId, command.game, command.ready);
      case 'move':
        return this.move(userId, command.game, command.version, command.move);
      case 'resign':
        return this.resign(userId, command.game);
      case 'draw':
        return this.draw(userId, command.game, command.action);
      case 'invite':
        return this.invite(userId, command.game, command.userId);
      case 'answer':
        return this.answer(userId, command.invite, command.accept);
    }
  }

  private chairIndex(table: Table, userId: string): number {
    return table.chairs.findIndex((chair) => chair?.userId === userId);
  }

  private seatOf(match: Match, userId: string): number {
    return match.players.findIndex((player) => player.userId === userId);
  }

  // Cette personne est dans la salle qui contient la table, là où le monde la voit.
  private inRoom(userId: string, table: Table): boolean {
    const me = this.d.players.get(userId);
    if (!me || table.roomKey === null) return false;
    return placeAt(this.d.map, me.x, me.y)?.key === table.roomKey;
  }

  // La partie en cours (pas finie) où cette personne joue encore, s'il y en a une.
  private playingTableOf(userId: string): Table | null {
    for (const table of this.tables.values()) {
      const match = table.match;
      if (match?.status !== 'playing') continue;
      const seat = this.seatOf(match, userId);
      if (seat !== -1 && !match.out[seat]) return table;
    }
    return null;
  }

  // Retire cette personne des spectateurs des tables (sauf celle-ci) et de leurs chaises d'attente (une chaise sans partie en cours), et rediffuse celles qui changent.
  private leaveOtherTables(userId: string, keep: Table): void {
    for (const table of this.tables.values()) {
      if (table === keep) continue;
      let changed = table.spectators.delete(userId);
      const index = this.chairIndex(table, userId);
      if (index !== -1 && table.match?.status !== 'playing') {
        table.chairs[index] = null;
        this.dropInvitesFrom(userId, table.game);
        changed = true;
      }
      if (changed) this.commit(table);
    }
  }

  private watch(userId: string, game: GameId): GameAck {
    const table = this.tables.get(game);
    if (!table) return refuse('unknown_game');
    const seated = this.chairIndex(table, userId) !== -1;
    if (!seated && !this.inRoom(userId, table)) return refuse('too_far');
    // Quelqu'un d'assis regarde déjà : il n'est pas spectateur de sa propre table.
    if (seated || table.spectators.has(userId)) return ok;
    const me = this.d.players.get(userId)!;
    for (const other of this.tables.values()) {
      if (other !== table && other.spectators.delete(userId)) this.commit(other);
    }
    table.spectators.set(userId, me.name);
    this.commit(table);
    return ok;
  }

  private unwatch(userId: string, game: GameId): GameAck {
    const table = this.tables.get(game);
    if (!table) return refuse('unknown_game');
    if (table.spectators.delete(userId)) this.commit(table);
    return ok;
  }

  // Assoit cette personne à cette chaise : elle quitte les spectateurs et les chaises d'attente des autres tables.
  private seat(table: Table, userId: string, index: number): void {
    const me = this.d.players.get(userId);
    this.leaveOtherTables(userId, table);
    table.spectators.delete(userId);
    table.chairs[index] = { userId, name: me?.name ?? userId, avatarKey: me?.avatarKey ?? null, ready: false, connected: true, since: this.d.now() };
    this.commit(table);
  }

  private sit(userId: string, game: GameId, wanted: number | undefined): GameAck {
    const table = this.tables.get(game);
    if (!table) return refuse('unknown_game');
    if (!this.inRoom(userId, table)) return refuse('too_far');
    if (this.chairIndex(table, userId) !== -1) return refuse('already_here');
    if (table.match?.status === 'playing') return refuse('in_progress');
    if (this.playingTableOf(userId) !== null) return refuse('busy');
    let index: number;
    if (wanted !== undefined) {
      if (wanted >= table.chairs.length) return refuse('invalid');
      if (table.chairs[wanted]) return refuse('chair_taken');
      index = wanted;
    } else {
      index = table.chairs.findIndex((chair) => chair === null);
      if (index === -1) return refuse('table_full');
    }
    this.seat(table, userId, index);
    return ok;
  }

  private stand(userId: string, game: GameId): GameAck {
    const table = this.tables.get(game);
    if (!table) return refuse('unknown_game');
    const index = this.chairIndex(table, userId);
    if (index === -1) return refuse('not_seated');
    const match = table.match;
    if (match?.status === 'playing') {
      const seat = this.seatOf(match, userId);
      if (seat !== -1 && !match.out[seat]) return refuse('in_progress');
    }
    const name = table.chairs[index]!.name;
    table.chairs[index] = null;
    table.spectators.set(userId, name);
    // Qui se lève n'invite plus personne à cette table.
    this.dropInvitesFrom(userId, game);
    this.commit(table);
    return ok;
  }

  private ready(userId: string, game: GameId, isReady: boolean): GameAck {
    const table = this.tables.get(game);
    if (!table) return refuse('unknown_game');
    const index = this.chairIndex(table, userId);
    if (index === -1) return refuse('not_seated');
    if (table.match?.status === 'playing') return refuse('in_progress');
    const chair = table.chairs[index]!;
    chair.ready = isReady;
    chair.since = this.d.now();
    if (isReady && this.startIfAllReady(table)) return ok;
    this.commit(table);
    return ok;
  }

  // Toutes les personnes assises sont prêtes et connectées, et assez nombreuses : la partie commence. Faux (sans rien changer) si le jeu n'est pas au registre ou si les
  // conditions ne sont pas réunies ; sinon la table est rediffusée et la fonction rend vrai.
  private startIfAllReady(table: Table): boolean {
    const def = this.d.games[table.game];
    if (!def) return false;
    const seated = table.chairs.flatMap((chair) => (chair ? [chair] : []));
    if (seated.length < def.minPlayers || seated.length > def.maxPlayers) return false;
    if (!seated.every((chair) => chair.ready && chair.connected)) return false;

    const userIds = seated.map((chair) => chair.userId);
    const seats = seated.length;
    const previous = table.previous;
    // Les mêmes joueurs, aux mêmes sièges, qu'à la partie d'avant : celui qui commence passe au suivant. Sinon, le sort.
    const first = previous && previous.userIds.length === seats && previous.userIds.every((id, i) => id === userIds[i]) ? (previous.first + 1) % seats : pickIndex(this.rng, seats);
    const drawn = recordingRng(this.rng);
    const made = def.create({ seats, first }, drawn.rng);
    const now = this.d.now();
    table.previous = { userIds, first };
    for (const chair of seated) chair.ready = false;
    table.match = {
      id: this.newId(),
      status: 'playing',
      def,
      players: seated.map((chair) => ({ userId: chair.userId, name: chair.name, avatarKey: chair.avatarKey })),
      first,
      state: made.state,
      events: [],
      log: [{ kind: 'create', setup: { seats, first }, rng: drawn.take() }],
      startedAt: this.clock(),
      startedMono: now,
      deadline: null,
      drawOffer: null,
      canOffer: seated.map(() => true),
      out: seated.map(() => false),
      disconnectedSince: seated.map(() => null),
      result: null,
      ranked: null,
      ratings: null,
      forcedRolls: [],
      stateVersion: 0,
    };
    this.armDeadline(table.match);
    this.commit(table, made.events, true);
    return true;
  }

  // Le délai du coup repart pour celui qui doit agir (même si c'est encore le même siège : un bonus, des dés lancés).
  private armDeadline(match: Match): void {
    match.deadline = match.def.turn(match.state) === null ? null : this.d.now() + GAME_TURN_TIMEOUT_MS;
  }

  // Le générateur d'une partie : celui du service, ou les dés qu'un test de bout en bout a imposés, puis le service.
  private rngOf(match: Match): Rng {
    return () => (match.forcedRolls.length > 0 ? rngFromDice([match.forcedRolls.shift()!])[0]! : this.rng());
  }

  private async move(userId: string, game: GameId, version: number, raw: unknown): Promise<GameAck> {
    const table = this.tables.get(game);
    if (!table) return refuse('unknown_game');
    const match = table.match;
    if (!match || match.status !== 'playing') return refuse('no_match');
    const seat = this.seatOf(match, userId);
    if (seat === -1 || match.out[seat]) return refuse('not_seated');
    // Un coup envoyé deux fois, ou sur un état périmé, ne compte qu'une fois. La version de la table avance aussi pour un spectateur, un nom ou une connexion : un coup que l'un d'eux croise
    // en route porte une version plus ancienne que la table, mais l'état du jeu est le même, et il passe. Une version plus récente que la table (un serveur redémarré) est périmée aussi.
    if (version < match.stateVersion || version > table.version) return refuse('stale');
    const parsed = match.def.moveSchema.safeParse(raw);
    if (!parsed.success) return refuse('invalid');
    if (match.def.turn(match.state) !== seat) return refuse('not_your_turn');

    const drawn = recordingRng(this.rngOf(match));
    const result = match.def.apply(match.state, seat, parsed.data, drawn.rng);
    if (!result.ok) return refuse('illegal');
    match.state = result.state;
    match.log.push({ kind: 'move', seat, move: parsed.data, rng: drawn.take(), at: this.d.now() - match.startedMono });
    // L'offre de nulle de l'autre camp tombe quand on joue ; et on peut de nouveau en proposer une.
    if (match.drawOffer !== null && match.drawOffer !== seat) match.drawOffer = null;
    match.canOffer[seat] = true;
    this.armDeadline(match);
    await this.afterAction(table, result.events);
    return ok;
  }

  // Après un coup, une sortie ou une nulle : la partie est finie (on l'écrit) ou continue (on rediffuse).
  private async afterAction(table: Table, events: unknown[]): Promise<void> {
    const match = table.match!;
    if (match.def.result(match.state) === null) {
      this.commit(table, events, true);
      return;
    }
    await this.finish(table, events);
  }

  // La fin d'une partie, une seule fois : le classement et la partie sont écrits en base (une base en panne n'empêche pas la fin : pas de notes), les joueurs restent assis,
  // pas prêts, et tout le bureau reçoit la table avec le résultat. Ceux qui n'ont plus de connexion perdent leur chaise.
  private async finish(table: Table, events: unknown[]): Promise<void> {
    const match = table.match!;
    const result = match.def.result(match.state)!;
    const counted = match.def.countedMoves(match.state);
    match.status = 'ended';
    match.result = result;
    match.deadline = null;
    match.drawOffer = null;
    match.ranked = counted >= GAME_MIN_RANKED_MOVES;
    try {
      const recorded = await this.d.ladder.record({
        id: match.id,
        game: table.game,
        startedAt: match.startedAt,
        endedAt: this.clock(),
        players: match.players.map((player, seat) => ({ seat, userId: player.userId, name: player.name })),
        result,
        moves: match.log,
        moveCount: counted,
        ranked: match.ranked,
      });
      match.ratings = recorded?.ratings ?? null;
    } catch (err) {
      logServerError(this.d.logger, { err, game: table.game, match: match.id }, 'Écriture de la partie impossible');
      match.ratings = null;
    }
    const now = this.d.now();
    table.chairs.forEach((chair, index) => {
      if (!chair) return;
      // Personne n'était prêt pendant la partie (« prêt » y est refusé) : les joueurs restent assis, pas prêts, sans rien remettre à zéro.
      chair.since = now;
      if (!chair.connected) table.chairs[index] = null;
    });
    // La partie finie n'accepte plus de coup (no_match) : sa version d'état ne sert plus.
    this.commit(table, events);
  }

  // Un siège sort de la partie (abandon, délai, départ) : le jeu en tire la suite, et la partie finit peut-être.
  private async forfeit(table: Table, seat: number, reason: ForfeitReason): Promise<void> {
    const match = table.match!;
    if (match.out[seat]) return;
    const outcome = match.def.forfeit(match.state, seat, reason);
    match.out[seat] = true;
    match.disconnectedSince[seat] = null;
    match.state = outcome.state;
    match.log.push({ kind: 'forfeit', seat, reason, at: this.d.now() - match.startedMono });
    if (match.drawOffer === seat) match.drawOffer = null;
    this.armDeadline(match);
    await this.afterAction(table, outcome.events);
  }

  private async resign(userId: string, game: GameId): Promise<GameAck> {
    const table = this.tables.get(game);
    if (!table) return refuse('unknown_game');
    const match = table.match;
    if (!match || match.status !== 'playing') return refuse('no_match');
    const seat = this.seatOf(match, userId);
    if (seat === -1 || match.out[seat]) return refuse('not_seated');
    await this.forfeit(table, seat, 'resign');
    return ok;
  }

  private async draw(userId: string, game: GameId, action: 'offer' | 'accept' | 'decline'): Promise<GameAck> {
    const table = this.tables.get(game);
    if (!table) return refuse('unknown_game');
    const match = table.match;
    if (!match || match.status !== 'playing') return refuse('no_match');
    if (!match.def.drawOffers || !match.def.agreeDraw) return refuse('invalid');
    const seat = this.seatOf(match, userId);
    if (seat === -1 || match.out[seat]) return refuse('not_seated');

    if (action === 'offer') {
      if (match.def.countedMoves(match.state) < GAME_DRAW_OFFER_MIN_MOVES) return refuse('too_early');
      if (match.drawOffer !== null) return refuse('already_offered');
      if (!match.canOffer[seat]) return refuse('too_early');
      match.drawOffer = seat;
      match.canOffer[seat] = false;
      this.commit(table);
      return ok;
    }
    if (match.drawOffer === null || match.drawOffer === seat) return refuse('no_offer');
    if (action === 'decline') {
      match.drawOffer = null;
      this.commit(table);
      return ok;
    }
    const outcome = match.def.agreeDraw(match.state);
    match.state = outcome.state;
    match.log.push({ kind: 'draw', at: this.d.now() - match.startedMono });
    await this.afterAction(table, outcome.events);
    return ok;
  }

  // ---- Les invitations -------------------------------------------------------------------------------------------------------------------

  private invite(userId: string, game: GameId, targetId: string): GameAck {
    if (!this.d.inviteAllowed(userId)) return refuse('rate_limited');
    const table = this.tables.get(game);
    if (!table) return refuse('unknown_game');
    const index = this.chairIndex(table, userId);
    if (index === -1) return refuse('not_seated');
    if (targetId === userId) return refuse('self');
    const target = this.d.players.get(targetId);
    if (!target || !this.d.isOnline(targetId)) return refuse('offline');
    // Qui ne veut pas être dérangé (statut, mode qui ferme la porte ou qui conduit ailleurs que dans la salle de la table) n'est pas invité.
    if (refusesGameInvites(target, table.roomKey)) return refuse('dnd');
    if (this.playingTableOf(targetId) !== null) return refuse('busy');
    if (this.chairIndex(table, targetId) !== -1) return refuse('already_here');

    const mine = [...this.invites.values()].filter((invite) => invite.from.id === userId);
    const same = mine.find((invite) => invite.to.id === targetId && invite.game === game);
    if (!same && mine.length >= GAME_INVITES_PER_USER) return refuse('too_many');
    // Inviter de nouveau la même personne à la même table remplace l'ancienne et remet le délai à zéro.
    if (same) {
      this.invites.delete(same.id);
      this.d.out.inviteGone(targetId, { id: same.id, reason: 'cancelled' });
    }
    const chair = table.chairs[index]!;
    const invite: PendingInvite = {
      id: this.newId(),
      game,
      from: { id: userId, name: chair.name, avatarKey: chair.avatarKey },
      to: { id: targetId, name: target.name },
      expiresAt: this.d.now() + GAME_INVITE_TTL_MS,
    };
    this.invites.set(invite.id, invite);
    this.d.out.invite(targetId, { id: invite.id, game, from: invite.from, ttlMs: GAME_INVITE_TTL_MS });
    return ok;
  }

  private answer(userId: string, inviteId: string, accept: boolean): GameAck {
    const invite = this.invites.get(inviteId);
    const now = this.d.now();
    // Une invitation qui n'est pas à elle, ou qui a expiré : plus valable (le balayage l'a peut-être déjà retirée).
    if (!invite || invite.to.id !== userId) return refuse('expired');
    if (invite.expiresAt <= now) {
      this.invites.delete(invite.id);
      this.d.out.inviteGone(userId, { id: invite.id, reason: 'expired' });
      this.d.out.notice(invite.from.id, { kind: 'expired', game: invite.game, user: invite.to });
      return refuse('expired');
    }
    const table = this.tables.get(invite.game)!;
    const me = this.d.players.get(userId);
    const who = { id: userId, name: me?.name ?? invite.to.name };

    if (!accept) {
      this.invites.delete(invite.id);
      this.d.out.inviteGone(userId, { id: invite.id, reason: 'answered' });
      this.d.out.notice(invite.from.id, { kind: 'declined', game: invite.game, user: who });
      return ok;
    }
    // L'invitante a pu se lever depuis : l'invitation ne tient plus.
    if (this.chairIndex(table, invite.from.id) === -1) {
      this.invites.delete(invite.id);
      this.d.out.inviteGone(userId, { id: invite.id, reason: 'cancelled' });
      return refuse('expired');
    }
    if (this.playingTableOf(userId) !== null) return refuse('busy');

    this.invites.delete(invite.id);
    const seatedHere = this.chairIndex(table, userId);
    const free = table.match?.status === 'playing' ? -1 : table.chairs.findIndex((chair) => chair === null);
    // Une chaise libre et pas de partie : il s'assoit. Sinon (table pleine, partie en cours), il regarde.
    const chair = seatedHere !== -1 ? seatedHere : free !== -1 ? free : null;
    this.d.arrive(userId, invite.game, chair);
    if (seatedHere === -1) {
      if (chair !== null) {
        this.seat(table, userId, chair);
      } else if (!table.spectators.has(userId)) {
        for (const other of this.tables.values()) {
          if (other !== table && other.spectators.delete(userId)) this.commit(other);
        }
        table.spectators.set(userId, who.name);
        this.commit(table);
      }
    }
    this.d.out.inviteGone(userId, { id: invite.id, reason: 'answered' });
    this.d.out.notice(invite.from.id, { kind: 'accepted', game: invite.game, user: who });
    return ok;
  }

  // Les invitations que cette personne a envoyées tombent (elle s'est levée, a quitté le bureau) : les invitées n'ont plus rien à répondre.
  private dropInvitesFrom(userId: string, tableGame?: GameId): void {
    for (const invite of [...this.invites.values()]) {
      if (invite.from.id !== userId || (tableGame !== undefined && invite.game !== tableGame)) continue;
      this.invites.delete(invite.id);
      this.d.out.inviteGone(invite.to.id, { id: invite.id, reason: 'cancelled' });
    }
  }

  // Les invitations que cette personne a reçues tombent (elle a quitté le bureau) : l'invitante l'apprend.
  private dropInvitesTo(userId: string): void {
    for (const invite of [...this.invites.values()]) {
      if (invite.to.id !== userId) continue;
      this.invites.delete(invite.id);
      this.d.out.notice(invite.from.id, { kind: 'gone', game: invite.game, user: invite.to });
    }
  }

  // ---- Les délais, la présence ----------------------------------------------------------------------------------------------------------

  // Fait tomber ce qui est échu à l'heure `at` (l'horloge du monde par défaut) : l'invitation sans réponse (60 s), le coup qu'on n'a pas joué (5 min), la connexion qui
  // n'est pas revenue (90 s), la chaise oubliée (10 min). Chaque table passe par sa file. Quand le coup et la connexion tombent ensemble, le siège ne sort qu'une fois,
  // pour la première échue.
  async sweep(at: number = this.d.now()): Promise<void> {
    if (this.halted) return;
    await Promise.all(
      [...this.tables.values()].map((table) =>
        this.serial(table.game, async () => {
          try {
            await this.sweepTable(table, at);
          } catch (err) {
            logServerError(this.d.logger, { err, game: table.game }, 'Balayage d\'une table de jeu impossible');
          }
        }),
      ),
    );
  }

  private async sweepTable(table: Table, at: number): Promise<void> {
    if (this.halted) return;
    for (const invite of [...this.invites.values()]) {
      if (invite.game !== table.game || invite.expiresAt > at) continue;
      this.invites.delete(invite.id);
      this.d.out.inviteGone(invite.to.id, { id: invite.id, reason: 'expired' });
      this.d.out.notice(invite.from.id, { kind: 'expired', game: invite.game, user: invite.to });
    }

    const match = table.match;
    if (match?.status === 'playing') {
      // Les sorties échues, dans l'ordre où elles le sont.
      for (;;) {
        const due = this.nextDue(match, at);
        if (due === null) break;
        await this.forfeit(table, due.seat, due.reason);
        if (table.match !== match || match.status !== 'playing') break;
      }
      return;
    }

    let freed = false;
    table.chairs.forEach((chair, index) => {
      if (!chair || at - chair.since < GAME_CHAIR_IDLE_MS) return;
      table.chairs[index] = null;
      table.spectators.set(chair.userId, chair.name);
      this.dropInvitesFrom(chair.userId, table.game);
      freed = true;
    });
    if (freed) this.commit(table);
  }

  // La sortie la plus ancienne qui est échue : le siège qui doit agir et n'a pas joué à temps, ou un siège sans connexion depuis trop longtemps.
  private nextDue(match: Match, at: number): { seat: number; reason: ForfeitReason; when: number } | null {
    const dues: Array<{ seat: number; reason: ForfeitReason; when: number }> = [];
    const actor = match.def.turn(match.state);
    if (actor !== null && match.deadline !== null && match.deadline <= at && !match.out[actor]) dues.push({ seat: actor, reason: 'timeout', when: match.deadline });
    match.disconnectedSince.forEach((since, seat) => {
      if (since !== null && !match.out[seat] && since + GAME_RECONNECT_MS <= at) dues.push({ seat, reason: 'disconnect', when: since + GAME_RECONNECT_MS });
    });
    dues.sort((a, b) => a.when - b.when);
    return dues[0] ?? null;
  }

  private forEachTable(task: (table: Table) => void | Promise<void>): Promise<void[]> {
    return Promise.all([...this.tables.values()].map((table) => this.serial(table.game, async () => task(table))));
  }

  // La dernière connexion de cette personne tombe : si elle joue, son compte à rebours de reconnexion part (la chaise reste) ; assise sans partie, elle n'est plus prête ;
  // spectatrice, elle est retirée ; ses invitations tombent.
  async onSocketsGone(userId: string): Promise<void> {
    if (this.halted) return;
    await this.forEachTable((table) => {
      let changed = table.spectators.delete(userId);
      const index = this.chairIndex(table, userId);
      if (index !== -1) {
        const chair = table.chairs[index]!;
        const match = table.match;
        if (match?.status === 'playing') {
          const seat = this.seatOf(match, userId);
          if (seat !== -1 && !match.out[seat] && match.disconnectedSince[seat] === null) match.disconnectedSince[seat] = this.d.now();
        } else {
          chair.ready = false;
        }
        chair.connected = false;
        changed = true;
      }
      if (changed) this.commit(table);
    });
    this.dropInvitesFrom(userId);
    this.dropInvitesTo(userId);
  }

  // Une connexion de cette personne reçoit son init : son compte à rebours s'arrête, sa chaise est connectée de nouveau.
  async onWelcome(userId: string): Promise<void> {
    if (this.halted) return;
    await this.forEachTable((table) => {
      const index = this.chairIndex(table, userId);
      if (index === -1) return;
      const chair = table.chairs[index]!;
      let changed = !chair.connected;
      chair.connected = true;
      const match = table.match;
      if (match?.status === 'playing') {
        const seat = this.seatOf(match, userId);
        if (seat !== -1 && match.disconnectedSince[seat] !== null) {
          match.disconnectedSince[seat] = null;
          changed = true;
        }
      }
      if (changed) this.commit(table);
    });
  }

  // Elle quitte le bureau (fin du délai de grâce du monde) : les chaises où elle attendait sont libres. Une partie en cours garde son siège jusqu'à la fin des 90 s.
  async onDepart(userId: string): Promise<void> {
    if (this.halted) return;
    await this.forEachTable((table) => {
      let changed = table.spectators.delete(userId);
      const index = this.chairIndex(table, userId);
      if (index !== -1 && table.match?.status !== 'playing') {
        table.chairs[index] = null;
        changed = true;
      }
      if (changed) this.commit(table);
    });
    this.dropInvitesFrom(userId);
    this.dropInvitesTo(userId);
  }

  // Un membre retiré : il sort tout de suite de sa partie (défaite), sa chaise est libre, il n'est plus spectateur, ses invitations tombent.
  async onRemoved(userId: string): Promise<void> {
    if (this.halted) return;
    await this.forEachTable(async (table) => {
      const spectating = table.spectators.delete(userId);
      const index = this.chairIndex(table, userId);
      const match = table.match;
      const seat = match?.status === 'playing' ? this.seatOf(match, userId) : -1;
      if (index !== -1) table.chairs[index] = null;
      if (match && seat !== -1 && !match.out[seat]) {
        await this.forfeit(table, seat, 'disconnect');
      } else if (spectating || index !== -1) {
        this.commit(table);
      }
    });
    this.dropInvitesFrom(userId);
    this.dropInvitesTo(userId);
  }

  // Son nom ou son avatar change : les chaises, la partie et la liste des spectateurs le suivent, et les tables touchées sont rediffusées.
  async profileChanged(userId: string, name: string, avatarKey: string | null): Promise<void> {
    if (this.halted) return;
    await this.forEachTable((table) => {
      let changed = false;
      table.chairs.forEach((chair) => {
        if (chair?.userId !== userId) return;
        chair.name = name;
        chair.avatarKey = avatarKey;
        changed = true;
      });
      if (table.spectators.has(userId)) {
        table.spectators.set(userId, name);
        changed = true;
      }
      for (const player of table.match?.players ?? []) {
        if (player.userId !== userId) continue;
        player.name = name;
        player.avatarKey = avatarKey;
        changed = true;
      }
      if (changed) this.commit(table);
    });
  }

  // Réservé aux tests de bout en bout (`debug:game`) : remplace l'état de la partie en cours à cette table par un état fabriqué (il doit passer les invariants du jeu et
  // laisser quelqu'un au trait), et impose les prochains dés. Ignoré sinon.
  debugSet(game: GameId, state: unknown, rolls: number[] = []): Promise<void> {
    return this.serial(game, async () => {
      const table = this.tables.get(game);
      const match = table?.match;
      if (!table || !match || match.status !== 'playing') return;
      if (match.def.invariants(state).length > 0 || match.def.turn(state) === null) return;
      match.state = state;
      match.forcedRolls = [...rolls];
      match.log.push({ kind: 'debug', state, at: this.d.now() - match.startedMono });
      this.armDeadline(match);
      this.commit(table, [], true);
    });
  }
}
