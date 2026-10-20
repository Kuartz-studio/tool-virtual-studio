import type { MediaJoinPayload, MediaState } from '@bureau/shared';

// L'audio et la vidéo de proximité : une room LiveKit par groupe de conversation. Le serveur dit quand en rejoindre une et quand la
// quitter (media:join, media:leave) ; le client média s'y connecte, publie le micro, la caméra et le partage d'écran, et reçoit ceux des
// autres. use-media.ts le relie à la socket ; l'interface (tâche 20) le lit et le commande.

// Une personne de la room où l'on est, soi-même compris :
// - id : l'identifiant de son compte (l'identité de son jeton LiveKit, que fabrique le serveur), name : son nom affiché ;
// - mic, cam, screen : ce qu'elle publie en ce moment (allumé) ;
// - speaking : elle parle (LiveKit le détecte).
export interface MediaParticipant {
  id: string;
  name: string;
  isLocal: boolean;
  mic: boolean;
  cam: boolean;
  screen: boolean;
  speaking: boolean;
}

// L'état de l'audio et de la vidéo :
// - room : la room où l'on est, ou que l'on est en train de rejoindre ; null hors conversation (et après un échec) ;
// - participants : ceux de la room, soi-même d'abord, puis les autres dans leur ordre d'arrivée ; [] tant que la connexion n'est pas
//   faite ;
// - local : micro et caméra voulus (hors room aussi : ils s'allument en entrant), et le partage d'écran en cours. C'est ce que le
//   serveur apprend (media:state) et montre aux autres ;
// - error : permission_denied quand le micro ou la caméra n'ont pas pu s'allumer (refusés, absents ou inutilisables : on reste dans
//   la room, en réception seule) ; connection_failed quand la room n'a pas pu être rejointe, ou que la connexion est perdue.
export interface MediaSnapshot {
  room: string | null;
  participants: MediaParticipant[];
  local: MediaState;
  error: 'permission_denied' | 'connection_failed' | null;
}

// Les préférences, enregistrées dans le navigateur (prefs.ts) : les périphériques choisis (absents : ceux du système), et le micro et
// la caméra allumés ou non en entrant.
export interface MediaPrefs {
  audioInput?: string;
  videoInput?: string;
  audioOutput?: string;
  mic: boolean;
  cam: boolean;
}

export type VideoSource = 'camera' | 'screen';

// Le client média. Aucune demande aux périphériques (getUserMedia) avant le premier join : micro, caméra et préférences changés hors
// room ne font que retenir ce qui servira en entrant. Les opérations passent l'une après l'autre, dans l'ordre des appels ; la promesse
// rendue se résout quand la sienne est faite, et ne rejette jamais (un échec se lit dans `error`).
export interface MediaClient {
  // Rejoint la room. Déjà dans une autre : leave() d'abord, dans l'ordre. Déjà dans celle-ci, ou en train de la rejoindre : rien (si
  // cette tentative-là échoue, ce join réessaie).
  join(p: MediaJoinPayload): Promise<void>;
  // Quitte la room : les pistes locales s'arrêtent (le partage d'écran aussi), l'audio des autres se tait. Hors room : rien, sinon
  // effacer connection_failed (la room qui n'a pas pu être rejointe n'est plus attendue).
  leave(): Promise<void>;
  // Micro et caméra : dans une room, allumés ou éteints tout de suite (rallumer redemande l'accès s'il avait été refusé) ; hors room,
  // retenus pour la prochaine.
  setMic(on: boolean): Promise<void>;
  setCam(on: boolean): Promise<void>;
  // Le partage d'écran : seulement dans une room (le navigateur demande quoi partager ; fermer ce choix ne change rien).
  setScreenShare(on: boolean): Promise<void>;
  // Les périphériques (pris tout de suite dans une room) et le micro et la caméra voulus.
  setPrefs(p: MediaPrefs): Promise<void>;
  // Montre dans cet élément la caméra ou le partage d'écran de cette personne, et le suit (piste qui arrive, change ou part, room qui
  // change) jusqu'à l'appel de la fonction rendue.
  attach(el: HTMLVideoElement, participantId: string, source: VideoSource): () => void;
  // Appelle cb tout de suite avec l'état du moment, puis à chaque changement. Rend la fonction qui arrête.
  subscribe(cb: (s: MediaSnapshot) => void): () => void;
  // L'état du moment : le même objet tant que rien ne change (useSyncExternalStore).
  getSnapshot(): MediaSnapshot;
}

// ---- Ce que le client média demande à LiveKit (livekit-media-client.ts), ou à son faux (fake-media-client.ts) ----

export type LocalSource = 'mic' | 'cam' | 'screen';

export interface MediaDevices {
  audioInput?: string;
  videoInput?: string;
  audioOutput?: string;
}

// Ce que le transport signale au client média, pendant une connexion.
export interface TransportEvents {
  // Les participants, leurs publications, ce qu'on reçoit ou qui parle ont changé : participants() est à relire.
  changed(): void;
  // La room s'est terminée sans qu'on la quitte, et le transport a déjà tout arrêté et nettoyé, comme pour disconnect() :
  // - removed : exprès. Le serveur nous a retirés (il le fait à chaque changement de groupe, en même temps que media:leave, qui peut
  //   arriver après), la room est fermée, ou le même compte l'a rejointe ailleurs (un autre onglet). La socket dira la suite ;
  // - lost : la connexion est perdue (LiveKit a renoncé à la reprendre), ou le serveur LiveKit s'arrête.
  disconnected(reason: 'removed' | 'lost'): void;
  // Le partage d'écran s'est arrêté sans nous (le bouton « Arrêter le partage » du navigateur).
  screenShareEnded(): void;
}

// La room elle-même, sans logique : le client média (MediaSession) décide quand se connecter, quoi allumer, et que faire d'un échec.
export interface MediaTransport {
  // Se connecte à la room, avec ces périphériques pour les pistes à venir ; rejette si la connexion échoue (et ne laisse rien derrière).
  connect(p: MediaJoinPayload, devices: MediaDevices, events: TransportEvents): Promise<void>;
  // Quitte la room : pistes locales arrêtées, audio des autres retiré, plus aucun événement.
  disconnect(): Promise<void>;
  // Allume ou éteint une source locale ; rejette si le périphérique ne peut pas s'allumer (refusé, absent, inutilisable, choix de
  // l'écran annulé).
  setSource(source: LocalSource, on: boolean): Promise<void>;
  // Passe à ces périphériques (ceux qui sont choisis), dans la room.
  useDevices(devices: MediaDevices): Promise<void>;
  // Les participants de la room, soi-même d'abord ; [] hors connexion.
  participants(): MediaParticipant[];
  attach(el: HTMLVideoElement, participantId: string, source: VideoSource): () => void;
}
