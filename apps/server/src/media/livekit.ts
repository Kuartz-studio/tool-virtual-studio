import { LIVEKIT_TOKEN_TTL_S, MEDIA_PARKED_ATTRIBUTE, MEDIA_RESUME_ATTRIBUTE } from '@bureau/shared';
import { AccessToken, RoomServiceClient, ServerError, TrackSource } from 'livekit-server-sdk';
import type { Env } from '../env';

// Ce que le serveur demande à l'audio/vidéo : l'adresse que les clients rejoignent, un jeton pour une room, le retrait d'un participant d'une
// room, et, si le backend le sait, parquer un participant et le reprendre. LiveKit Cloud en production (createLiveKitBackend) ; le faux live
// (SIM=1) ; un faux dans les tests.
export interface MediaBackend {
  url: string;
  // canSpeak faux : le jeton ne permet pas de publier le micro (la caméra et le partage d'écran restent permis). Absent : permis.
  mintToken(i: { room: string; identity: string; name: string; canSpeak?: boolean }): Promise<string>;
  removeParticipant(room: string, identity: string): Promise<void>;
  // Parque la personne dans la room, sans la déconnecter : elle n'y reçoit plus rien et n'y publie plus rien (LiveKit dépublie ce qu'elle
  // publiait), et elle porte MEDIA_PARKED_ATTRIBUTE, que les autres clients lisent pour ne plus la montrer. Déjà partie : rien. Facultatif :
  // sans lui, le coordinateur ne parque personne, et quitter un groupe retire de sa room, comme avant.
  park?(room: string, identity: string): Promise<void>;
  // La reprend : les droits de son jeton (canSpeak), et MEDIA_RESUME_ATTRIBUTE à `resume`, que son client attend avant de republier. Déjà
  // partie : rien (son client, qui n'a plus de connexion parquée, se reconnecte avec le jeton du media:join).
  resume?(room: string, identity: string, i: { canSpeak: boolean; resume: string }): Promise<void>;
}

// Les droits d'une personne dans sa room, ceux de son jeton : rejoindre, publier, recevoir ; pas de données. Sans droit de parler : tout ce qui
// se publie, sauf le micro.
function grants(canSpeak: boolean) {
  return {
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    ...(canSpeak ? {} : { canPublishSources: [TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] }),
  };
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
// personne : identité = son id, nom = son nom affiché.
//
// Une personne qui sort d'un groupe est parquée dans sa room (UpdateParticipant) : plus aucun droit d'y recevoir ni d'y publier, ce que LiveKit
// applique tout de suite (il la désabonne de tout et dépublie ses pistes), et l'attribut qui la cache aux autres. Son client garde la connexion
// MEDIA_PARK_MS, pour y revenir en un instant ; ces droits retirés l'imposent à un client qui ne la quitterait pas. La reprendre lui rend les
// droits de son jeton. Qui sort pour de bon (Ne pas déranger, départ du bureau) est retiré de la room, et une connexion parquée l'est aussi,
// MEDIA_PARK_REMOVE_MS après sa sortie (MediaCoordinator).
export function createLiveKitBackend(env: LiveKitEnv): MediaBackend | null {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = env;
  if (!url || !apiKey || !apiSecret) return null;
  const rooms = new RoomServiceClient(roomServiceUrl(url), apiKey, apiSecret, { requestTimeout: ROOM_SERVICE_TIMEOUT_S });
  // « Introuvable » : la personne est déjà partie (ou pas encore arrivée), la room n'existe plus. L'appel n'a plus d'objet.
  const unlessGone = async (call: Promise<unknown>): Promise<void> => {
    try {
      await call;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  };
  return {
    url,
    mintToken({ room, identity, name, canSpeak = true }) {
      const token = new AccessToken(apiKey, apiSecret, { identity, name, ttl: LIVEKIT_TOKEN_TTL_S });
      token.addGrant({ roomJoin: true, room, ...grants(canSpeak) });
      return token.toJwt();
    },
    removeParticipant: (room, identity) => unlessGone(rooms.removeParticipant(room, identity)),
    // Les droits sont remplacés d'un bloc (UpdateParticipant ne garde rien de ceux d'avant) : tous ceux qui comptent sont dits. Les attributs,
    // eux, s'ajoutent ; une valeur vide en retire un.
    park: (room, identity) =>
      unlessGone(
        rooms.updateParticipant(room, identity, {
          permission: { canPublish: false, canSubscribe: false, canPublishData: false },
          attributes: { [MEDIA_PARKED_ATTRIBUTE]: '1' },
        }),
      ),
    resume: (room, identity, { canSpeak, resume }) =>
      unlessGone(
        rooms.updateParticipant(room, identity, {
          permission: grants(canSpeak),
          attributes: { [MEDIA_PARKED_ATTRIBUTE]: '', [MEDIA_RESUME_ATTRIBUTE]: resume },
        }),
      ),
  };
}

// « Introuvable » : la personne a déjà quitté la room (en recevant media:leave), ou ne l'avait pas encore rejointe, ou la room
// n'existe plus. Le retrait n'a plus d'objet. LiveKit répond alors 404, code Twirp not_found.
function isNotFound(err: unknown): boolean {
  return err instanceof ServerError && (err.code === 'not_found' || err.status === 404);
}
