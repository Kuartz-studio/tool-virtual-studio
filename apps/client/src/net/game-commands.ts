import type { GameAck, GameCommand, GameId, LadderAck } from '@bureau/shared';
import type { OfficeSocket } from './socket';

// Le serveur répond à chaque commande de jeu (`game:do`) et à chaque demande de classement ; sans réponse en GAME_ACK_TIMEOUT_MS (connexion qui tombe), c'est un échec,
// jamais une attente sans fin.
export const GAME_ACK_TIMEOUT_MS = 5000;

// Envoie la commande de jeu et rend la réponse du serveur. Une socket absente ou coupée, ou une réponse qui tarde : `unavailable`.
export function sendGameCommand(socket: OfficeSocket | null, command: GameCommand): Promise<GameAck> {
  if (!socket || !socket.connected) return Promise.resolve({ ok: false, error: 'unavailable' });
  return new Promise((resolve) => {
    socket.timeout(GAME_ACK_TIMEOUT_MS).emit('game:do', command, (timedOut, ack) => {
      resolve(timedOut || !ack ? { ok: false, error: 'unavailable' } : ack);
    });
  });
}

// Demande le classement de ce jeu : les meilleurs, et son propre rang. Une socket absente ou coupée, ou une réponse qui tarde : `unavailable`.
export function fetchLadder(socket: OfficeSocket | null, game: GameId): Promise<LadderAck> {
  if (!socket || !socket.connected) return Promise.resolve({ ok: false, error: 'unavailable' });
  return new Promise((resolve) => {
    socket.timeout(GAME_ACK_TIMEOUT_MS).emit('game:ladder', { game }, (timedOut, ack) => {
      resolve(timedOut || !ack ? { ok: false, error: 'unavailable' } : ack);
    });
  });
}
