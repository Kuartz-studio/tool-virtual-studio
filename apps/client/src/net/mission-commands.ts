import type { MissionAck, MissionGivePayload } from '@bureau/shared';
import type { OfficeSocket } from './socket';

// Le serveur répond à chaque mission confiée (`mission:give`) ; sans réponse en MISSION_ACK_TIMEOUT_MS (connexion qui tombe), c'est un échec, jamais une attente sans
// fin.
export const MISSION_ACK_TIMEOUT_MS = 5000;

// Confie la mission (auprès d'une administratrice : le serveur vérifie qu'on est à l'accueil) et rend la réponse du serveur. Une socket absente ou coupée, ou une
// réponse qui tarde : `unavailable`.
export function sendMission(socket: OfficeSocket | null, mission: MissionGivePayload): Promise<MissionAck> {
  if (!socket || !socket.connected) return Promise.resolve({ ok: false, error: 'unavailable' });
  return new Promise((resolve) => {
    socket.timeout(MISSION_ACK_TIMEOUT_MS).emit('mission:give', mission, (timedOut, ack) => {
      resolve(timedOut || !ack ? { ok: false, error: 'unavailable' } : ack);
    });
  });
}
