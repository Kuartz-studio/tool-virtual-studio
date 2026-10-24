import { randomUUID } from 'node:crypto';
import {
  CHARACTER_PARTS,
  EMPTY_GROUPING,
  OFFICE_ROOM,
  SIM_BOT_PREFIX,
  SIM_BOT_SPEED_PX_PER_S,
  findPath,
  formatPremade,
  isSimBot,
  isWalkableTile,
  type Direction,
  type GroupingState,
  type OfficeMap,
  type Point,
  type SimRoomMember,
  type SimRoomPayload,
} from '@bureau/shared';
import type { Logger } from 'pino';
import type { TypedServer, TypedSocket } from '../realtime/io';
import type { World } from '../realtime/world';
import { audioUrl, type AudioLibrary } from './audio-library';

// La période des pas : plus courte que celle du world:tick (100 ms), pour que chaque tick ait une position fraîche.
export const SIM_STEP_MS = 50;
// Un pas ne compte jamais plus de ce temps : après une pause du serveur, la personne ne saute pas, elle reprend sa marche.
const MAX_STEP_MS = 250;
// Les gens en dessous de cette distance (px) d'une case l'occupent : on n'y fait pas apparaître quelqu'un d'autre. Un personnage fait deux
// cases de haut : deux personnes sur des cases voisines (32 px) se cacheraient le visage et le nom, l'une devant l'autre ; en diagonale
// (45 px), non.
const OCCUPIED_PX = 44;
// Les fuseaux horaires des personnes fictives, l'un après l'autre : de quoi voir, au survol, des heures d'ailleurs (la première est à Paris,
// comme tout le monde par défaut).
export const SIM_BOT_TIMEZONES = ['Europe/Paris', 'America/Montreal', 'Asia/Tokyo', 'America/Sao_Paulo', 'Australia/Sydney', 'Africa/Dakar'] as const;

// Pourquoi une commande est refusée : unknown_bot (cet identifiant n'est pas une personne fictive), unknown_audio (ce fichier n'est pas
// dans le dossier), unreachable (la personne est sur une case bloquante : rien à faire marcher).
export type SimErrorCode = 'unknown_bot' | 'unknown_audio' | 'unreachable';

export class SimError extends Error {
  readonly code: SimErrorCode;

  constructor(code: SimErrorCode) {
    super(code);
    this.name = 'SimError';
    this.code = code;
  }
}

// Une personne fictive, telle que le panneau la montre : où elle est, ce qu'elle « dit » (le nom du fichier audio, null : silence), et où
// elle marche (target, null à l'arrêt).
export interface SimBotInfo {
  id: string;
  name: string;
  avatarKey: string;
  audio: string | null;
  x: number;
  y: number;
  target: Point | null;
}

interface Bot {
  id: string;
  name: string;
  avatarKey: string;
  timezone: string;
  audio: string | null;
  // Sa position exacte (les pieds, en pixels, décimaux) : le monde ne garde que des entiers, et les pas d'un demi-pixel s'y perdraient.
  pos: Point;
  // Les points qui lui restent à atteindre, dans l'ordre, et où elle s'arrête.
  path: Point[];
  target: Point | null;
  // L'heure (horloge du serveur) de son dernier pas.
  stepAt: number;
  // Sa vitesse de marche (px/s) : SIM_BOT_SPEED_PX_PER_S, sauf pour le sparring de l'octogone, plus vif.
  speed: number;
}

export interface SimBotsDeps {
  world: World;
  io: TypedServer;
  map: OfficeMap;
  /** L'horloge du monde, en ms (celle de World : performance.now). */
  now: () => number;
  logger: Logger;
  audio: AudioLibrary;
  /** La room d'un groupe de conversation (MediaCoordinator.roomFor). */
  roomFor(groupId: string): string;
  /** Les sockets de cette personne qui ont reçu leur init : les seules à qui l'on écrit. */
  enteredSockets(userId: string): TypedSocket[];
}

const directionOf = (dx: number, dy: number): Direction => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');

// Les personnes fictives du faux live : de vrais joueurs du monde du serveur (World), sans compte ni socket. Elles apparaissent aux
// autres comme n'importe qui (player:joined, world:tick, player:left), et le calcul des groupes les traite comme tout le monde : une
// zone, un cercle de 3 cases, l'arrêt obligatoire, les 500 ms. Elles marchent d'elles-mêmes vers l'endroit qu'on leur donne
// (moveTo), au pas de SIM_BOT_SPEED_PX_PER_S, à travers les cases libres seulement, et le monde vérifie chaque pas comme celui d'un
// client.
//
// Le son : chaque personne réelle d'un groupe apprend qui est dans sa room et quel fichier ces gens « disent » (`sim:room`) ; son
// client le joue en boucle (sim-transport.ts). Ce que LiveKit ferait avec de vrais micros, le serveur le dit ici.
export class SimBots {
  private readonly bots = new Map<string, Bot>();
  private grouping: GroupingState = EMPTY_GROUPING;
  // Le dernier `sim:room` de chaque socket : le même n'est pas redit.
  private readonly told = new WeakMap<TypedSocket, string>();
  private counter = 0;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly d: SimBotsDeps) {}

  // Les pas commencent. Le minuteur ne retient pas le processus.
  start(): void {
    this.timer = setInterval(() => {
      try {
        this.step();
      } catch (err) {
        this.d.logger.error({ err }, 'Pas des personnes fictives impossible');
      }
    }, SIM_STEP_MS);
    this.timer.unref();
  }

  // Les pas s'arrêtent et les personnes fictives s'en vont (le serveur s'arrête : elles ne survivent pas à un redémarrage).
  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const id of [...this.bots.keys()]) this.remove(id);
  }

  list(): SimBotInfo[] {
    return [...this.bots.values()].map((bot) => this.infoOf(bot));
  }

  // Fait apparaître une personne fictive, près de l'apparition de la carte, sur une case libre où personne n'est. Son nom : « Fictif 1 »,
  // « Fictif 2 »… sauf si on lui en donne un. Son fichier audio doit être dans le dossier (unknown_audio sinon).
  // `at` : là où elle apparaît (une case libre), au lieu de près de l'apparition ; `speed` : sa vitesse de marche.
  async spawn(options: { name?: string; audio?: string | null; at?: Point; speed?: number } = {}): Promise<SimBotInfo> {
    const audio = options.audio ?? null;
    if (audio !== null && !(await this.d.audio.has(audio))) throw new SimError('unknown_audio');
    const n = ++this.counter;
    const spot = options.at ?? this.freeSpot();
    const bot: Bot = {
      id: `${SIM_BOT_PREFIX}${randomUUID().slice(0, 8)}`,
      name: options.name ?? `Fictif ${n}`,
      avatarKey: formatPremade(((n - 1) % CHARACTER_PARTS.premade) + 1),   // les personnages prêts à l'emploi, l'un après l'autre
      timezone: SIM_BOT_TIMEZONES[(n - 1) % SIM_BOT_TIMEZONES.length]!,
      audio,
      pos: spot,
      path: [],
      target: null,
      stepAt: this.d.now(),
      speed: options.speed ?? SIM_BOT_SPEED_PX_PER_S,
    };
    this.bots.set(bot.id, bot);
    const player = this.d.world.join({ id: bot.id, name: bot.name, avatarKey: bot.avatarKey, x: spot.x, y: spot.y, dir: 'down', status: 'available', timezone: bot.timezone });
    this.d.world.setMedia(bot.id, { mic: audio !== null, cam: false, screen: false });
    this.d.io.to(OFFICE_ROOM).emit('player:joined', { ...player, media: { mic: audio !== null, cam: false, screen: false } });
    return this.infoOf(bot);
  }

  // La personne s'en va : elle sort du monde, et de son groupe au prochain calcul.
  remove(id: string): void {
    if (!this.bots.delete(id)) throw new SimError('unknown_bot');
    this.d.world.leave(id);
    this.d.io.to(OFFICE_ROOM).emit('player:left', { id });
    this.announce();
  }

  // Change son fichier audio (null : silence). Son micro apparaît allumé chez les autres quand elle a un fichier. Les gens de sa room
  // l'entendent aussitôt.
  async setAudio(id: string, audio: string | null): Promise<SimBotInfo> {
    const bot = this.bots.get(id);
    if (!bot) throw new SimError('unknown_bot');
    if (audio !== null && !(await this.d.audio.has(audio))) throw new SimError('unknown_audio');
    // Retirée pendant la vérification du fichier.
    if (!this.bots.has(id)) throw new SimError('unknown_bot');
    bot.audio = audio;
    const media = { mic: audio !== null, cam: false, screen: false };
    this.d.world.setMedia(id, media);
    this.d.io.to(OFFICE_ROOM).emit('media:changed', { id, media });
    this.announce();
    return this.infoOf(bot);
  }

  // La fait marcher vers ce point (pixels). Elle contourne les murs et les meubles ; si le point est sur une case bloquante ou
  // inaccessible, elle va à la case la plus proche qu'elle peut atteindre. Rend le point où elle s'arrêtera.
  moveTo(id: string, x: number, y: number): Point {
    const bot = this.bots.get(id);
    if (!bot) throw new SimError('unknown_bot');
    this.resync(bot);
    const found = findPath(this.d.map, bot.pos, { x, y });
    if (!found) throw new SimError('unreachable');
    bot.path = found.path;
    bot.target = found.goal;
    bot.stepAt = this.d.now();
    return found.goal;
  }

  // L'arrête là où elle est, tournée vers `dir` (le sparring fait face à son adversaire).
  stopFacing(id: string, dir: Direction): void {
    const bot = this.bots.get(id);
    if (!bot) throw new SimError('unknown_bot');
    this.resync(bot);
    bot.path = [];
    bot.target = null;
    this.d.world.applyMove(id, { x: Math.round(bot.pos.x), y: Math.round(bot.pos.y), dir, moving: false });
  }

  // À l'arrêt, sa position est celle du monde : le serveur a pu la poser ailleurs (l'octogone place ses combattants dans le ring).
  private resync(bot: Bot): void {
    const seen = this.d.world.get(bot.id);
    if (seen && bot.path.length === 0) bot.pos = { x: seen.x, y: seen.y };
  }

  // Les groupes du dernier calcul (startGroupTicks) : ce que chaque personne réelle doit entendre en dépend.
  onGroups(state: GroupingState): void {
    this.grouping = state;
    this.announce();
  }

  private infoOf(bot: Bot): SimBotInfo {
    return {
      id: bot.id,
      name: bot.name,
      avatarKey: bot.avatarKey,
      audio: bot.audio,
      x: Math.round(bot.pos.x),
      y: Math.round(bot.pos.y),
      target: bot.target,
    };
  }

  // Une case libre aussi proche que possible de l'apparition de la carte, où personne n'est ; l'apparition elle-même si la carte est pleine.
  private freeSpot(): Point {
    const { map, world } = this.d;
    const { tileSize } = map;
    const others = world.list();
    const spots: Point[] = [];
    for (let ty = 0; ty < map.heightTiles; ty++) {
      for (let tx = 0; tx < map.widthTiles; tx++) {
        if (isWalkableTile(map, tx, ty)) spots.push({ x: tx * tileSize + tileSize / 2, y: ty * tileSize + tileSize / 2 });
      }
    }
    const away = (a: Point) => Math.hypot(a.x - map.spawn.x, a.y - map.spawn.y);
    spots.sort((a, b) => away(a) - away(b));
    return spots.find((spot) => !others.some((o) => Math.hypot(o.x - spot.x, o.y - spot.y) < OCCUPIED_PX)) ?? { ...map.spawn };
  }

  // Un pas pour chaque personne qui marche : elle avance de ce que sa vitesse permet depuis son dernier pas, de point en point. Le monde
  // vérifie le pas ; refusé, elle s'arrête là où il la voit.
  private step(): void {
    const { world, now } = this.d;
    for (const bot of this.bots.values()) {
      if (bot.path.length === 0) continue;
      const at = now();
      let remaining = (bot.speed * Math.min(at - bot.stepAt, MAX_STEP_MS)) / 1000;
      bot.stepAt = at;
      let dir = world.get(bot.id)?.dir ?? 'down';
      while (remaining > 0 && bot.path.length > 0) {
        const next = bot.path[0]!;
        const dx = next.x - bot.pos.x;
        const dy = next.y - bot.pos.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 0) dir = directionOf(dx, dy);
        if (distance <= remaining) {
          bot.pos = { ...next };
          bot.path.shift();
          remaining -= distance;
        } else {
          bot.pos = { x: bot.pos.x + (dx / distance) * remaining, y: bot.pos.y + (dy / distance) * remaining };
          remaining = 0;
        }
      }
      const arrived = bot.path.length === 0;
      const result = world.applyMove(bot.id, { x: Math.round(bot.pos.x), y: Math.round(bot.pos.y), dir, moving: !arrived });
      if (!result.ok) {
        this.d.logger.warn({ id: bot.id, correct: result.correct }, 'Pas d\'une personne fictive refusé');
        bot.pos = { ...result.correct };
        bot.path = [];
        bot.target = null;
      } else if (arrived) {
        bot.target = null;
      }
    }
  }

  private memberOf(id: string): SimRoomMember {
    const bot = this.bots.get(id);
    if (bot) return { id, name: bot.name, audio: bot.audio === null ? null : audioUrl(bot.audio) };
    return { id, name: this.d.world.get(id)?.name ?? id, audio: null };
  }

  // À chaque personne réelle qui est dans un groupe : qui est dans sa room, et ce que ces gens « disent ». Le même message n'est pas
  // redit à une socket. Hors groupe, la socket oublie le dernier : revenue dans une room, elle l'apprend de nouveau.
  private announce(): void {
    const { assignment, groups } = this.grouping;
    for (const [userId, groupId] of Object.entries(assignment)) {
      if (isSimBot(userId)) continue;
      const sockets = this.d.enteredSockets(userId);
      const group = groupId === null ? undefined : Object.hasOwn(groups, groupId) ? groups[groupId] : undefined;
      if (!group) {
        for (const socket of sockets) this.told.delete(socket);
        continue;
      }
      // Une personne fictive retirée reste dans les groupes jusqu'au prochain calcul : on ne la compte plus.
      const members = group.members.filter((id) => !isSimBot(id) || this.bots.has(id)).map((id) => this.memberOf(id));
      const payload: SimRoomPayload = { room: this.d.roomFor(group.id), members };
      const signature = JSON.stringify(payload);
      for (const socket of sockets) {
        if (this.told.get(socket) === signature) continue;
        this.told.set(socket, signature);
        socket.emit('sim:room', payload);
      }
    }
  }
}
