import { randomUUID } from 'node:crypto';
import {
  EMPTY_GROUPING,
  MEDIA_STATE_RATE,
  MOVE_RATE,
  OFFICE_ROOM,
  STATUS_RATE,
  chatSendSchema,
  computeGroups,
  mediaStateSchema,
  moveSchema,
  statusSchema,
  type ChatAck,
  type ChatMessage,
  type GroupingState,
  type OfficeMap,
} from '@bureau/shared';
import type { Logger } from 'pino';
import type { ChatService } from '../chat/chat-service';
import type { Env } from '../env';
import { logServerError } from '../logger';
import type { MediaCoordinator, MediaEvent } from '../media/media-coordinator';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import type { TypedServer, TypedSocket } from './io';
import type { World } from './world';

export interface HandlerDeps {
  world: World;
  env: Env;
  /** L'horloge des limites de débit de `move`, `status:set` et `media:state`, en ms : celle du monde (performance.now par défaut). */
  now?: () => number;
  logger: Logger;
  /** Le chat « Tout le monde » : c'est lui qui enregistre ses messages. */
  chat: Pick<ChatService, 'post'>;
  /** La limite de débit du chat (CHAT_RATE), par compte : une seule pour toutes les sockets d'une personne, celles à venir comprises. */
  chatLimiter: RateLimiter;
  /** Les membres du groupe de conversation de cette personne, elle comprise ; [] hors groupe (MediaCoordinator.groupMembersOf). */
  groupMembersOf: (userId: string) => string[];
  /** Les sockets de cette personne qui ont reçu leur init : les seules à qui l'on écrit, jamais avant. */
  socketsOf: (userId: string) => TypedSocket[];
}

// Où `debug:teleport` pose le joueur : les mêmes entiers que `move`, sans direction ni état.
const teleportSchema = moveSchema.pick({ x: true, y: true });

// Les messages d'une socket une fois connectée. Chaque charge utile passe par son schéma zod avant qu'on la lise ; ce qui ne le
// passe pas est ignoré sans réponse (sauf `chat:send`, qui répond `invalid`), comme ce qui vient d'une socket dont le joueur n'est
// pas (encore) dans le monde : son arrivée lit la base avant `init`, et un message envoyé entre-temps ne doit rien changer. Rien ici
// ne lève : l'exception d'un écouteur de Socket.io n'est attrapée par personne et ferait tomber le processus.
export function registerHandlers(io: TypedServer, socket: TypedSocket, d: HandlerDeps): void {
  const { userId } = socket.data;
  // Une limite par socket : elle repart de zéro avec elle. La clé est son identifiant.
  const moveLimiter = createRateLimiter({ ...MOVE_RATE, now: d.now });
  // De même pour le statut et les médias, que chaque message fait diffuser à tout le bureau : au-delà de STATUS_RATE.max (ou
  // MEDIA_STATE_RATE.max) par fenêtre, il est ignoré sans réponse, comme un `move` en trop. Le client n'en envoie qu'au clic, à
  // chaque init et à chaque changement de micro, caméra ou partage.
  const statusLimiter = createRateLimiter({ ...STATUS_RATE, now: d.now });
  const mediaLimiter = createRateLimiter({ ...MEDIA_STATE_RATE, now: d.now });

  // Au-delà de MOVE_RATE.max par fenêtre, un `move` est ignoré, valide ou non : la limite passe avant le schéma, pour que même un
  // flot de messages invalides ne coûte presque rien. Refusé par le monde (trop vite, case bloquante, hors carte), il renvoie à
  // l'émetteur, et à lui seul, sa dernière position acceptée : il se recale. Accepté, il part aux autres au prochain tick.
  socket.on('move', (payload) => {
    if (!moveLimiter.take(socket.id)) return;
    const move = moveSchema.safeParse(payload);
    if (!move.success) return;
    // applyMove prend un joueur inconnu pour un mouvement refusé et répondrait par le point d'apparition : pas de correction pour
    // qui n'est pas dans le monde.
    if (!d.world.get(userId)) return;
    const result = d.world.applyMove(userId, move.data);
    if (!result.ok) socket.emit('move:correct', result.correct);
  });

  // Le statut, à tout le monde, émetteur compris : c'est sa confirmation. Le monde le retient pour le retour de cette personne.
  socket.on('status:set', (payload) => {
    if (!statusLimiter.take(socket.id)) return;
    const status = statusSchema.safeParse(payload);
    if (!status.success || !d.world.get(userId)) return;
    d.world.setStatus(userId, status.data);
    io.to(OFFICE_ROOM).emit('status:changed', { id: userId, status: status.data });
  });

  // Micro, caméra et partage d'écran, pour l'affichage chez les autres : à tout le monde, émetteur compris. Le monde le garde,
  // pour ceux qui arrivent ensuite (init, player:joined). Seuls les trois champs du schéma sont diffusés.
  socket.on('media:state', (payload) => {
    if (!mediaLimiter.take(socket.id)) return;
    const media = mediaStateSchema.safeParse(payload);
    if (!media.success || !d.world.get(userId)) return;
    d.world.setMedia(userId, media.data);
    io.to(OFFICE_ROOM).emit('media:changed', { id: userId, media: media.data });
  });

  // Le chat, avec accusé de réception. Une socket dont le joueur n'est pas (encore, ou plus) au monde est ignorée sans réponse, comme
  // pour les messages ci-dessus : un membre retiré n'écrit plus. Il en va de même d'une socket qui n'a pas reçu son init (le retour
  // d'une socket lit encore la base) : elle ne reçoit pas non plus. Puis, dans cet ordre :
  // 1. charge utile invalide (chatSendSchema : 1 à 500 caractères une fois coupés) : `invalid` ;
  // 2. débit dépassé (CHAT_RATE) : `rate_limited`. La limite est celle du compte, pas de la socket : se reconnecter ne la remet pas à
  //    zéro. Elle est commune aux deux canaux, et passe avant leurs règles ;
  // 3. canal `all` : enregistré, puis envoyé à tout le bureau, émetteur compris (c'est sa confirmation) ; `unavailable` si la base ne
  //    l'enregistre pas ;
  // 4. canal `nearby` : envoyé à chaque socket de chaque membre du groupe actuel de l'émetteur, lui compris, sans rien enregistrer ;
  //    `no_group` s'il n'est dans aucun groupe. Jamais vers le bureau entier : le groupe vient de l'émetteur, personne d'autre n'y entre.
  // Le texte part tel que le schéma l'a rendu (coupé), sans traitement HTML : le client l'affiche comme du texte. L'auteur, le nom,
  // l'identifiant et l'heure sont ceux du serveur, jamais ceux du message.
  async function sendChat(payload: unknown, ack: unknown): Promise<void> {
    // Un client peut ne pas donner de rappel, ou autre chose à sa place : personne ne reçoit alors de réponse.
    const reply = (r: ChatAck): void => {
      if (typeof ack === 'function') ack(r);
    };
    const sender = d.world.get(userId);
    if (!sender || !socket.rooms.has(OFFICE_ROOM)) return;
    const message = chatSendSchema.safeParse(payload);
    if (!message.success) return reply({ ok: false, error: 'invalid' });
    if (!d.chatLimiter.take(userId)) return reply({ ok: false, error: 'rate_limited' });
    const { channel, text } = message.data;

    if (channel === 'nearby') {
      const members = d.groupMembersOf(userId);
      if (members.length === 0) return reply({ ok: false, error: 'no_group' });
      const nearby: ChatMessage = { id: randomUUID(), channel, userId, name: sender.name, text, sentAt: new Date().toISOString() };
      for (const member of members) {
        for (const target of d.socketsOf(member)) target.emit('chat:message', nearby);
      }
      return reply({ ok: true });
    }

    let stored: ChatMessage;
    try {
      stored = await d.chat.post(userId, text);
    } catch (err) {
      logServerError(d.logger, { err, userId }, 'Enregistrement du message impossible');
      // Une panne du serveur, pas un défaut du message : `unavailable` (le message n'est pas parti ; le client peut réessayer).
      return reply({ ok: false, error: 'unavailable' });
    }
    // Retiré (member:removed) pendant l'écriture : plus rien ne part en son nom.
    if (!d.world.get(userId)) return;
    io.to(OFFICE_ROOM).emit('chat:message', stored);
    reply({ ok: true });
  }

  socket.on('chat:send', (payload, ack) => {
    sendChat(payload, ack).catch((err: unknown) => logServerError(d.logger, { err, userId }, 'Message du chat impossible'));
  });

  // Réservé aux tests de bout en bout : sans E2E=1 (que loadEnv refuse en production), l'événement n'existe pas. Le joueur est posé
  // là, à l'arrêt, si la case est praticable (World.teleport) ; les autres l'apprennent au prochain tick, comme pour un mouvement.
  if (d.env.E2E === '1') {
    socket.on('debug:teleport', (payload) => {
      const point = teleportSchema.safeParse(payload);
      if (point.success) d.world.teleport(userId, point.data.x, point.data.y);
    });
  }
}

// Appelle `fn` toutes les `ms`, sans retenir le processus ; la fonction rendue arrête la boucle. Une exception levée dans le rappel
// d'un minuteur n'est attrapée par personne et ferait tomber le processus : elle est journalisée (`failure`), et la boucle continue.
function every(ms: number, logger: Logger, failure: string, fn: () => void): () => void {
  const timer = setInterval(() => {
    try {
      fn();
    } catch (err) {
      logServerError(logger, { err }, failure);
    }
  }, ms);
  timer.unref();
  return () => clearInterval(timer);
}

// Toutes les `tickMs`, les mouvements acceptés depuis le tick précédent partent d'un coup vers tout le bureau : au plus un par
// joueur, le dernier (World.drainMoves). Sans mouvement, rien n'est envoyé. Le tick est `volatile` : un client dont la connexion
// n'est pas prête le manque, et le suivant le recale ; Socket.io ne garde pas de paquet volatile pour le lui renvoyer.
//
// `t` est l'heure du tick, en ms entières, sur l'horloge `now` du serveur (monotone, celle du monde) : elle sert à ordonner les
// ticks, pas à dire l'heure. Le minuteur ne retient pas le processus ; la fonction rendue l'arrête.
export function startWorldTicks(io: TypedServer, world: World, tickMs: number, now: () => number, logger: Logger): () => void {
  return every(tickMs, logger, 'Envoi du world:tick impossible', () => {
    const moves = world.drainMoves();
    if (moves.length === 0) return;
    io.to(OFFICE_ROOM).volatile.emit('world:tick', { t: Math.round(now()), moves });
  });
}

export interface GroupTicksDeps {
  world: World;
  map: OfficeMap;
  coordinator: MediaCoordinator;
  /** L'envoi d'un événement média à une personne (à ses sockets entrées). */
  send: (userId: string, e: MediaEvent) => void;
  /** Le nom affiché d'une personne, pour ses jetons. */
  nameOf: (id: string) => string;
  groupsMs: number;
  /** Appelé avec les groupes à chaque calcul (le faux live, SIM=1, en dépend). Ne doit pas lever : une exception est journalisée. */
  onGroups?: (state: GroupingState) => void;
  /** L'horloge du monde (monotone), celle des délais de computeGroups : jamais Date.now, qui peut sauter. */
  now: () => number;
  logger: Logger;
}

// Toutes les `groupsMs`, les groupes de conversation sont recalculés à partir des joueurs du monde (computeGroups, à l'heure `now`),
// puis le coordinateur dit à ceux qui changent de room de la quitter ou d'en rejoindre une (apply). Un joueur parti du monde (fin du
// délai de grâce, retrait) n'est plus dans le calcul suivant : il sort de son groupe comme les autres.
//
// Chaque calcul part de l'état du précédent, retenu dès l'appel d'apply (le coordinateur le retient aussi à ce moment-là, même si apply
// échoue ensuite). Tant qu'apply n'a pas fini (il attend la fabrication des jetons), les tours suivants sont sautés : deux apply ne se
// chevauchent pas. state() : l'état du dernier calcul (les zones occupées, busyZoneIds, en viennent). Le minuteur ne retient pas le
// processus ; stop() l'arrête.
export function startGroupTicks(d: GroupTicksDeps): { stop(): void; state(): GroupingState } {
  let state: GroupingState = EMPTY_GROUPING;
  let applying = false;
  const stop = every(d.groupsMs, d.logger, 'Calcul des groupes impossible', () => {
    if (applying) return;
    const next = computeGroups(d.world.proximityPlayers(), d.map, state, d.now());
    const applied = d.coordinator.apply(state, next, d.send, d.nameOf);
    state = next;
    applying = true;
    try {
      d.onGroups?.(next);
    } catch (err) {
      logServerError(d.logger, { err }, 'Annonce des groupes impossible');
    }
    applied
      .catch((err: unknown) => logServerError(d.logger, { err }, 'Envoi des rooms LiveKit impossible'))
      .finally(() => {
        applying = false;
      });
  });
  return { stop, state: () => state };
}
