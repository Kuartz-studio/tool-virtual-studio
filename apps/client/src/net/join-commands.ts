import type { JoinAck } from '@bureau/shared';
import type { OfficeSocket } from './socket';

// Le serveur répond à chaque demande de rejoindre quelqu'un (`person:join`) ; sans réponse en JOIN_ACK_TIMEOUT_MS (connexion qui tombe), c'est un échec, jamais une
// attente sans fin.
export const JOIN_ACK_TIMEOUT_MS = 5000;

// Demande au serveur de poser l'avatar à côté de cette personne, et rend sa réponse. Une socket absente ou coupée, ou une réponse qui tarde : `unavailable`.
export function sendJoin(socket: OfficeSocket | null, userId: string): Promise<JoinAck> {
  if (!socket || !socket.connected) return Promise.resolve({ ok: false, error: 'unavailable' });
  return new Promise((resolve) => {
    socket.timeout(JOIN_ACK_TIMEOUT_MS).emit('person:join', { userId }, (timedOut, ack) => {
      resolve(timedOut || !ack ? { ok: false, error: 'unavailable' } : ack);
    });
  });
}
