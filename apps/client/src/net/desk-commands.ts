import type { DeskAck, DeskCommand } from '@bureau/shared';
import type { OfficeSocket } from './socket';

// Le serveur répond à chaque commande de bureau (`desk:do`) ; sans réponse en DESK_ACK_TIMEOUT_MS (connexion qui tombe), c'est un échec,
// jamais une attente sans fin.
export const DESK_ACK_TIMEOUT_MS = 5000;

// Envoie la commande et rend la réponse du serveur. Une socket absente ou coupée, ou une réponse qui tarde : `unavailable`.
export function sendDeskCommand(socket: OfficeSocket | null, command: DeskCommand): Promise<DeskAck> {
  if (!socket || !socket.connected) return Promise.resolve({ ok: false, error: 'unavailable' });
  return new Promise((resolve) => {
    socket.timeout(DESK_ACK_TIMEOUT_MS).emit('desk:do', command, (timedOut, ack) => {
      resolve(timedOut || !ack ? { ok: false, error: 'unavailable' } : ack);
    });
  });
}
