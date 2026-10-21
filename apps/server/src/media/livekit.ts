import { LIVEKIT_TOKEN_TTL_S } from '@bureau/shared';
import { AccessToken, RoomServiceClient, ServerError, TrackSource } from 'livekit-server-sdk';
import type { Env } from '../env';

// Ce que le serveur demande à l'audio/vidéo : l'adresse que les clients rejoignent, un jeton pour une room, et le retrait d'un
// participant d'une room. LiveKit Cloud en production (createLiveKitBackend) ; un faux dans les tests.
export interface MediaBackend {
  url: string;
  // canSpeak faux : le jeton ne permet pas de publier le micro (la caméra et le partage d'écran restent permis). Absent : permis.
  mintToken(i: { room: string; identity: string; name: string; canSpeak?: boolean }): Promise<string>;
  removeParticipant(room: string, identity: string): Promise<void>;
}

// Les trois variables sans lesquelles l'audio et la vidéo sont désactivés.
export const LIVEKIT_VARIABLES = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const;

type LiveKitEnv = Partial<Pick<Env, (typeof LIVEKIT_VARIABLES)[number]>>;

// Le délai d'une requête à l'API de LiveKit (un retrait), en secondes. Un retrait qui traîne peut arriver après le retour de la personne
// dans la même room, et l'en chasser : il a peu de temps. livekit-server-sdk attend 10 s par défaut, et sur LiveKit Cloud réessaie dans
// d'autres régions ; sous 5 s (MIN_FAILOVER_TIMEOUT_SECONDS), il ne fait qu'un essai.
const ROOM_SERVICE_TIMEOUT_S = 3;

// L'API de LiveKit (RoomService) se joint en HTTP, à l'origine de l'adresse WebSocket que les clients rejoignent : wss:// → https://,
// ws:// → http://. Une adresse déjà en http(s) garde son schéma. Toute autre valeur est une erreur de configuration : elle arrête le
// démarrage plutôt que de laisser chaque client échouer à se connecter.
export function roomServiceUrl(url: string): string {
  const schemes: Record<string, string> = { 'wss:': 'https:', 'ws:': 'http:', 'https:': 'https:', 'http:': 'http:' };
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    // traitée juste après
  }
  const scheme = parsed && Object.hasOwn(schemes, parsed.protocol) ? schemes[parsed.protocol] : undefined;
  if (!parsed || !scheme || !parsed.host) {
    throw new Error(`LIVEKIT_URL invalide : « ${url} » (attendue sous la forme wss://mon-projet.livekit.cloud)`);
  }
  return `${scheme}//${parsed.host}`;
}

// LiveKit d'après les variables LIVEKIT_*, ou null s'il en manque une : l'audio et la vidéo sont alors désactivés (attachRealtime le
// dit dans le journal au démarrage).
//
// Un jeton ne vaut que pour une room (rejoindre, publier, recevoir ; pas de données), pendant LIVEKIT_TOKEN_TTL_S, au nom de la
// personne : identité = son id, nom = son nom affiché. Une personne qui sort d'un groupe est retirée de la room de ce groupe : son
// client la quitte de lui-même en recevant media:leave, et ce retrait l'impose à un client qui ne le ferait pas.
export function createLiveKitBackend(env: LiveKitEnv): MediaBackend | null {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = env;
  if (!url || !apiKey || !apiSecret) return null;
  const rooms = new RoomServiceClient(roomServiceUrl(url), apiKey, apiSecret, { requestTimeout: ROOM_SERVICE_TIMEOUT_S });
  return {
    url,
    mintToken({ room, identity, name, canSpeak = true }) {
      const token = new AccessToken(apiKey, apiSecret, { identity, name, ttl: LIVEKIT_TOKEN_TTL_S });
      token.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
        // Sans droit de parler : tout ce qui se publie, sauf le micro.
        ...(canSpeak ? {} : { canPublishSources: [TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] }),
      });
      return token.toJwt();
    },
    async removeParticipant(room, identity) {
      try {
        await rooms.removeParticipant(room, identity);
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },
  };
}

// « Introuvable » : la personne a déjà quitté la room (en recevant media:leave), ou ne l'avait pas encore rejointe, ou la room
// n'existe plus. Le retrait n'a plus d'objet. LiveKit répond alors 404, code Twirp not_found.
function isNotFound(err: unknown): boolean {
  return err instanceof ServerError && (err.code === 'not_found' || err.status === 404);
}
