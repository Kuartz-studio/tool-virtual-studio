import type { MediaJoinPayload, MediaLeavePayload, MediaState } from '@bureau/shared';

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
// - error : permission_denied quand le navigateur a refusé le micro ou la caméra, ou qu'ils sont absents ou inutilisables (on reste
//   dans la room, en réception seule) ; connection_failed quand la room n'a pas pu être rejointe, ou que la connexion est perdue ;
// - audioBlocked : dans une room, le navigateur bloque la lecture du son des autres faute d'un geste de la personne (Safari, quand on
//   n'a pas de micro). startAudio(), appelé dans un clic (« Activer le son »), la lance.
export interface MediaSnapshot {
  room: string | null;
  participants: MediaParticipant[];
  local: MediaState;
  error: 'permission_denied' | 'connection_failed' | null;
  audioBlocked: boolean;
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
  // cette tentative-là échoue, ce join réessaie). Parquée (quittée avec `park` il y a moins de MEDIA_PARK_MS), et le join porte `resume` :
  // la connexion parquée reprend, sans se reconnecter ; si elle ne peut pas, le client se connecte avec le jeton, comme d'habitude.
  join(p: MediaJoinPayload): Promise<void>;
  // Quitte la room : l'audio des autres se tait, rien n'y est plus publié (le partage d'écran et la caméra s'arrêtent). Avec `park`, la
  // connexion reste ouverte, muette, MEDIA_PARK_MS (le micro gardé, sans être publié), pour y revenir en un instant ; sans lui, elle se ferme et
  // les pistes locales s'arrêtent (une room parquée aussi). Hors room : rien, sinon effacer connection_failed (la room qui n'a pas pu être
  // rejointe n'est plus attendue).
  // join (d'une autre room) et leave quittent la room en cours dès l'appel, sans attendre ce qu'elle fait encore : une connexion qui
  // se fait est annulée, et un micro ou une caméra qui s'allument n'y sont jamais publiés.
  leave(p?: MediaLeavePayload): Promise<void>;
  // Micro et caméra : dans une room, allumés ou éteints tout de suite (rallumer redemande l'accès s'il avait été refusé) ; hors room,
  // retenus pour la prochaine.
  setMic(on: boolean): Promise<void>;
  setCam(on: boolean): Promise<void>;
  // Le partage d'écran : seulement dans une room (le navigateur demande quoi partager ; fermer ce choix ne change rien).
  setScreenShare(on: boolean): Promise<void>;
  // Les périphériques (pris tout de suite dans une room) et le micro et la caméra voulus.
  setPrefs(p: MediaPrefs): Promise<void>;
  // Lance la lecture du son des autres. Les navigateurs ne la permettent qu'après un geste de la personne : à appeler dans un clic
  // (« Entrer », « Activer le son »). Elle part tout de suite, hors de la file des opérations, pour rester dans ce geste. Hors room :
  // rien. Refusée, audioBlocked le dit.
  startAudio(): Promise<void>;
  // Le volume de chaque autre personne de la conversation, de 0 (on ne l'entend plus) à 1 (plein volume), par identifiant ; une personne
  // sans entrée est à 1. Il vaut pour la room en cours et les suivantes, jusqu'au prochain appel : le jeu le recalcule en marchant (le son
  // baisse avec la distance, spatial-audio.ts). Facultatif : sans effet pour un client qui ne règle pas le volume.
  setVolumes?(volumes: Readonly<Record<string, number>>): void;
  // Prépare une première connexion sans rien demander à personne : charge ce que le transport doit télécharger (livekit-client), pour
  // que le premier join n'attende pas son téléchargement. Ni room, ni périphérique. Facultatif : sans effet pour un client qui n'a rien à charger.
  warmUp?(): void;
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
  // Le navigateur permet (true) ou bloque (false) la lecture du son des autres, dans cette room.
  audioPlayback(allowed: boolean): void;
}

// La room elle-même, sans logique : le client média (MediaSession) décide quand se connecter, quoi allumer, et que faire d'un échec.
export interface MediaTransport {
  // Se connecte à la room, avec ces périphériques pour les pistes à venir ; rejette si la connexion échoue (et ne laisse rien derrière).
  // Une room parquée est fermée d'abord ; son micro gardé reste, et sera publié dans celle-ci s'il a les mêmes périphériques.
  connect(p: MediaJoinPayload, devices: MediaDevices, events: TransportEvents): Promise<void>;
  // Quitte la room : pistes locales arrêtées, audio des autres retiré, plus aucun événement ; la room parquée et le micro gardé aussi. Peut
  // venir pendant connect (qui est alors annulée), pendant resume (qui échoue alors), ou pendant setSource et useDevices (qui finissent
  // alors tout de suite, sans attendre LiveKit ni le navigateur).
  disconnect(): Promise<void>;
  // Allume ou éteint une source locale ; rejette si le périphérique ne peut pas s'allumer (refusé, absent, inutilisable, choix de
  // l'écran annulé) ou si la piste ne peut pas être publiée. L'erreur est rendue telle quelle (celle de getUserMedia pour un refus).
  // Allumer le micro publie le micro gardé, s'il y en a un (sans redemander l'accès) ; hors room, éteindre le micro arrête le micro gardé.
  setSource(source: LocalSource, on: boolean): Promise<void>;
  // Passe à ces périphériques (ceux qui sont choisis), dans la room.
  useDevices(devices: MediaDevices): Promise<void>;
  // Lance la lecture du son des autres dans la room (dans le geste de la personne) ; rejette si le navigateur la refuse. Hors room :
  // rien.
  startAudio(): Promise<void>;
  // Charge à l'avance ce que la première connexion télécharge (MediaClient.warmUp). Un échec n'est pas une erreur : connect() réessaie.
  warmUp?(): void;
  // Règle le volume des autres (MediaClient.setVolumes) : il s'applique à ceux qui sont là, et à ceux qui arrivent ensuite.
  setVolumes?(volumes: Readonly<Record<string, number>>): void;
  // Les participants de la room, soi-même d'abord ; [] hors connexion. Ceux que le serveur a parqués dans la room (ils l'ont quittée) n'y
  // sont pas.
  participants(): MediaParticipant[];
  attach(el: HTMLVideoElement, participantId: string, source: VideoSource): () => void;
  // Parquer : quitte la room en cours sans s'en déconnecter. Elle reste ouverte, muette : plus de son des autres, plus rien de publié (le
  // micro est gardé, dépublié, pour la reprise ; la caméra et le partage d'écran s'arrêtent), plus aucun de ses événements. Facultatif : sans
  // lui, le client média se déconnecte.
  park?(): Promise<void>;
  // Reprend la room parquée pour ce join : la même room, avec `resume`, et les mêmes périphériques. Résolue à vrai une fois la room de nouveau
  // en cours (avec ces événements), dès que LiveKit confirme que le serveur a rendu les droits ; à faux sinon (plus de room parquée, une autre,
  // pas de confirmation à temps, une déconnexion pendant l'attente) : le client média se connecte alors avec le jeton, ce qui ferme la parquée.
  resume?(p: MediaJoinPayload, devices: MediaDevices, events: TransportEvents): Promise<boolean>;
  // Ferme la room parquée et arrête le micro gardé (la fin du délai, une sortie pour de bon). Facultatif.
  unpark?(): Promise<void>;
}
