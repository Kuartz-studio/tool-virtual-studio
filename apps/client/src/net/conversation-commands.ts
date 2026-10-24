import type { ConversationAck, ConversationCommand } from '@bureau/shared';
import type { OfficeSocket } from './socket';

// Le serveur répond à chaque commande de conversation (`conversation:do` : la verrouiller, la déverrouiller, en sortir) ; sans réponse en
// CONVERSATION_ACK_TIMEOUT_MS (connexion qui tombe), c'est un échec, jamais une attente sans fin.
export const CONVERSATION_ACK_TIMEOUT_MS = 5000;

// Envoie la commande et rend la réponse du serveur. Une socket absente ou coupée, ou une réponse qui tarde : `unavailable`. Ce qui a changé
// arrive à part, à tous les membres (`conversation:lock`) : l'interface suit cette annonce, pas la réponse.
export function sendConversationCommand(socket: OfficeSocket | null, command: ConversationCommand): Promise<ConversationAck> {
  if (!socket || !socket.connected) return Promise.resolve({ ok: false, error: 'unavailable' });
  return new Promise((resolve) => {
    socket.timeout(CONVERSATION_ACK_TIMEOUT_MS).emit('conversation:do', command, (timedOut, ack) => {
      resolve(timedOut || !ack ? { ok: false, error: 'unavailable' } : ack);
    });
  });
}
