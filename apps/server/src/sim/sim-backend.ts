import { SIM_MEDIA_URL, encodeSimToken } from '@bureau/shared';
import type { MediaBackend } from '../media/livekit';

// Le faux LiveKit du faux live (SIM=1) : le coordinateur des rooms l'utilise comme le vrai, et envoie les mêmes media:join et
// media:leave. L'adresse n'est celle d'aucun serveur (SIM_MEDIA_URL), le jeton dit seulement qui est dans quelle room, et retirer
// quelqu'un d'une room ne fait rien : le client quitte la sienne de lui-même en recevant media:leave. Aucune requête ne part.
export function createSimBackend(): MediaBackend {
  return {
    url: SIM_MEDIA_URL,
    async mintToken({ room, identity, name }) {
      return encodeSimToken({ room, identity, name });
    },
    async removeParticipant() {
      // rien : il n'y a pas de serveur de rooms
    },
  };
}
