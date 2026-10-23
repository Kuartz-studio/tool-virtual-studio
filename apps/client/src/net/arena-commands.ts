import type { ArenaAck, ArenaCommand } from '@bureau/shared';
import type { OfficeSocket } from './socket';

// Le serveur répond à chaque commande de l'octogone (`arena:do`) ; sans réponse en ARENA_ACK_TIMEOUT_MS (connexion qui tombe), c'est un échec.
export const ARENA_ACK_TIMEOUT_MS = 5000;

// Envoie la commande et rend la réponse du serveur. Une socket absente ou coupée, ou une réponse qui tarde : `invalid`.
export function sendArenaCommand(socket: OfficeSocket | null, command: ArenaCommand): Promise<ArenaAck> {
  if (!socket || !socket.connected) return Promise.resolve({ ok: false, error: 'invalid' });
  return new Promise((resolve) => {
    socket.timeout(ARENA_ACK_TIMEOUT_MS).emit('arena:do', command, (timedOut, ack) => {
      resolve(timedOut || !ack ? { ok: false, error: 'invalid' } : ack);
    });
  });
}
