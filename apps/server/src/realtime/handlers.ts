import { MOVE_RATE, OFFICE_ROOM, mediaStateSchema, moveSchema, statusSchema } from '@bureau/shared';
import type { Env } from '../env';
import { createRateLimiter } from '../rate-limit';
import type { TypedServer, TypedSocket } from './io';
import type { World } from './world';

export interface HandlerDeps {
  world: World;
  env: Env;
  /** L'horloge de la limite de débit des `move`, en ms : celle du monde (performance.now par défaut). */
  now?: () => number;
}

// Où `debug:teleport` pose le joueur : les mêmes entiers que `move`, sans direction ni état.
const teleportSchema = moveSchema.pick({ x: true, y: true });

// Les messages d'une socket une fois connectée. Chaque charge utile passe par son schéma zod avant qu'on la lise ; ce qui ne le
// passe pas est ignoré sans réponse, comme ce qui vient d'une socket dont le joueur n'est pas (encore) dans le monde : son arrivée
// lit la base avant `init`, et un message envoyé entre-temps ne doit rien changer. Rien ici ne lève : l'exception d'un écouteur de
// Socket.io n'est attrapée par personne et ferait tomber le processus.
export function registerHandlers(io: TypedServer, socket: TypedSocket, d: HandlerDeps): void {
  const { userId } = socket.data;
  // Une limite par socket : elle repart de zéro avec elle. La clé est son identifiant.
  const moveLimiter = createRateLimiter({ ...MOVE_RATE, now: d.now });

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
    const status = statusSchema.safeParse(payload);
    if (!status.success || !d.world.get(userId)) return;
    d.world.setStatus(userId, status.data);
    io.to(OFFICE_ROOM).emit('status:changed', { id: userId, status: status.data });
  });

  // Micro, caméra et partage d'écran, pour l'affichage chez les autres : à tout le monde, émetteur compris. Le monde le garde,
  // pour ceux qui arrivent ensuite (init, player:joined). Seuls les trois champs du schéma sont diffusés.
  socket.on('media:state', (payload) => {
    const media = mediaStateSchema.safeParse(payload);
    if (!media.success || !d.world.get(userId)) return;
    d.world.setMedia(userId, media.data);
    io.to(OFFICE_ROOM).emit('media:changed', { id: userId, media: media.data });
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

// Toutes les `tickMs`, les mouvements acceptés depuis le tick précédent partent d'un coup vers tout le bureau : au plus un par
// joueur, le dernier (World.drainMoves). Sans mouvement, rien n'est envoyé. Le tick est `volatile` : un client dont la connexion
// n'est pas prête le manque, et le suivant le recale ; Socket.io ne garde pas de paquet volatile pour le lui renvoyer.
//
// `t` est l'heure du tick, en ms entières, sur l'horloge `now` du serveur (monotone par défaut, comme celle du monde) : elle sert à
// ordonner les ticks, pas à dire l'heure. Le minuteur ne retient pas le processus ; la fonction rendue l'arrête.
export function startWorldTicks(io: TypedServer, world: World, tickMs: number, now: () => number = () => performance.now()): () => void {
  const timer = setInterval(() => {
    const moves = world.drainMoves();
    if (moves.length === 0) return;
    io.to(OFFICE_ROOM).volatile.emit('world:tick', { t: Math.round(now()), moves });
  }, tickMs);
  timer.unref();
  return () => clearInterval(timer);
}
