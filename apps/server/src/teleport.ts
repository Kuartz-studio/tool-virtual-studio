import type { TypedSocket } from './realtime/io';
import type { World } from './realtime/world';

// Pose une personne ailleurs (hors d'une pièce, chez elle, dans une salle) : le monde la déplace (World.teleport : les autres la voient sauter, `tp` du tick), et chacune de ses
// sockets entrées reçoit `move:correct`, qui replace son navigateur. `reason: 'teleport'` : un voyage voulu (un mode), que le jeu souligne d'un anneau de lumière et d'un son ;
// sans raison, une simple correction (on exclut quelqu'un d'un bureau, on le ramène chez lui). Faux si la case n'est pas praticable ou si la personne n'est pas au monde : rien
// ne change alors, et personne n'est prévenu.
export type Teleport = (userId: string, point: { x: number; y: number }, reason?: 'teleport') => boolean;

export interface TeleportDeps {
  world: Pick<World, 'teleport'>;
  /** Les sockets de cette personne qui ont reçu leur init : les seules à qui l'on écrit. */
  socketsOf: (userId: string) => TypedSocket[];
}

export function createTeleport(d: TeleportDeps): Teleport {
  return (userId, point, reason) => {
    const [x, y] = [Math.round(point.x), Math.round(point.y)];
    if (!d.world.teleport(userId, x, y)) return false;
    for (const socket of d.socketsOf(userId)) socket.emit('move:correct', reason === undefined ? { x, y } : { x, y, reason });
    return true;
  };
}
