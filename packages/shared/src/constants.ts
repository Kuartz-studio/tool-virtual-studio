// Valeurs de la spec : une seule source pour le client et le serveur.
export const TILE_SIZE = 32;
// La zone de collision d'un avatar, aux pieds : 20 × 12 px, centrée sur ses pieds en largeur, son bas un pixel sous les pieds (contre
// un mur au sud, les pieds restent ainsi dans leur case). Seule elle bute contre les murs et les meubles : l'avatar local la reçoit
// de la physique Arcade (feetBody, dans le client), et l'extrapolation des autres avatars ne la fait pas entrer dans un mur
// (avatarBodyFits).
export const AVATAR_BODY = { width: 20, height: 12, belowFeet: 1 } as const;
export const MAX_SPEED_PX_PER_S = 160;
export const MOVE_TOLERANCE = 1.5;
export const MOVE_JITTER_MS = 250;
export const MOVE_SEGMENT_STEP_PX = 8;
export const CLIENT_MOVE_MAX_HZ = 10;
export const WORLD_TICK_MS = 100;
// Le retard avec lequel on dessine les autres avatars (la spec : « environ 100 ms »). Pas 100 ms tout juste, la période des ticks :
// un client envoie au plus 10 `move` par seconde, au rythme de ses images (toutes les 100 ou 117 ms), si bien que certains ticks
// n'ont rien pour lui, et deux positions reçues sont alors à 200 ms l'une de l'autre. Avec 100 ms de retard, l'avatar arrivait au
// bout des positions reçues et s'arrêtait 80 à 100 ms, environ une fois toutes les deux secondes : une marche saccadée, l'un des
// anti-objectifs de la spec. À 150 ms, ces arrêts ne duraient plus que 30 à 60 ms (mesures dans le rapport de la tâche 15) ;
// l'extrapolation courte (EXTRAPOLATION_MAX_MS) couvre ce qui reste.
export const REMOTE_RENDER_DELAY_MS = 150;
// Quand l'heure de rendu dépasse la dernière position reçue d'une personne qui marche, son avatar continue sur sa lancée au plus
// pendant ce temps, puis attend là (jamais pour une personne arrêtée). 60 ms couvrent les 50 ms sans position que laisse encore un
// tick vide avec 150 ms de retard (deux positions à 200 ms d'écart), sans dépasser de plus de 9,6 px (60 ms de marche) le point où
// la personne s'est peut-être arrêtée. WorkAdventure extrapole de même, jusqu'à 100 ms.
export const EXTRAPOLATION_MAX_MS = 60;
export const TELEPORT_SNAP_PX = 3 * TILE_SIZE;
export const GROUPS_TICK_MS = 100;
// Le son des espaces ouverts s'éteint avec la distance : à 100 % dans un grand rayon autour de soi (AUDIO_FULL_DISTANCE_PX), puis de plus
// en plus faible jusqu'au silence (AUDIO_SILENT_DISTANCE_PX). Dans une zone (un bureau, une salle), rien de tel : tout le monde s'entend
// à plein volume, quelle que soit la distance.
export const AUDIO_FULL_DISTANCE_PX = 6 * TILE_SIZE;
export const AUDIO_SILENT_DISTANCE_PX = 14 * TILE_SIZE;
// Dans un espace ouvert, on rejoint la room de ceux qu'on pourrait entendre : à moins de 14 cases (d < JOIN), au moment où leur voix n'est
// encore qu'un souffle ; on y reste tant que d <= LEAVE, une case de plus, pour que la room ne se coupe pas et ne se rétablisse pas en boucle
// à la limite.
export const JOIN_DISTANCE_PX = AUDIO_SILENT_DISTANCE_PX;
export const LEAVE_DISTANCE_PX = AUDIO_SILENT_DISTANCE_PX + TILE_SIZE;
// L'ancienne règle, un cercle serré (« à moins de 3 cases », à l'arrêt ; on reste jusqu'à 4 cases) : CLOSE_RANGE_GROUPING, que les tests
// du calcul des groupes gardent pour des scènes tenant dans la petite carte de développement.
export const CLOSE_JOIN_DISTANCE_PX = 3 * TILE_SIZE;
export const CLOSE_LEAVE_DISTANCE_PX = 4 * TILE_SIZE;
export const GROUP_DEBOUNCE_MS = 500;
// Entrer dans une zone isolante (bureau, salle de réunion) est un geste voulu : on rejoint le groupe de la zone après ce seul délai,
// juste de quoi ne pas former un groupe en effleurant son bord. Le délai de GROUP_DEBOUNCE_MS reste celui des espaces ouverts.
export const ZONE_JOIN_DEBOUNCE_MS = 150;
export const DISCONNECT_GRACE_MS = 10_000;
export const POSITION_SAVE_INTERVAL_MS = 60_000;
export const CHAT_MAX_LENGTH = 500;
export const CHAT_HISTORY_LIMIT = 200;
export const CHAT_RATE = { max: 5, windowMs: 5_000 };
export const SOCKET_CONNECT_RATE = { max: 10, windowMs: 60_000 };
export const MOVE_RATE = { max: 20, windowMs: 1_000 };          // au-delà, les `move` d'une socket sont ignorés
export const STATUS_RATE = { max: 10, windowMs: 1_000 };        // de même pour ses `status:set`, diffusés à tout le bureau
export const MEDIA_STATE_RATE = { max: 10, windowMs: 1_000 };   // et ses `media:state`
export const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;
// Comment les liens d'invitation et de mot de passe parviennent aux gens (MAILER, côté serveur) : resend les envoie par e-mail ; none
// n'envoie rien, l'admin copie les liens depuis l'appli et les transmet lui-même ; memory (développement, tests) les garde en mémoire.
export const MAIL_MODES = ['resend', 'none', 'memory'] as const;
export type MailMode = (typeof MAIL_MODES)[number];
// Ce que GET /api/config répond à qui que ce soit, session ou non : rien d'autre que ce qui change ce que la page affiche.
export interface PublicConfig {
  mail: MailMode;
}
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MAX_LENGTH = 40;
// Les bureaux : la longueur du nom qu'une personne donne au sien, la limite de débit des commandes (`desk:do`) d'une socket, et le délai
// minimal entre deux « toc toc » d'une même personne à la porte d'un même bureau.
export const DESK_NAME_MAX_LENGTH = 40;
// Les états d'activité qu'une personne crée (label, couleur, trois interrupteurs) : la longueur de leur nom et leur nombre au plus.
export const ACTIVITY_LABEL_MAX_LENGTH = 24;
export const ACTIVITY_MAX_PER_USER = 12;
export const DESK_RATE = { max: 10, windowMs: 2_000 };
export const DESK_KNOCK_COOLDOWN_MS = 5_000;
export const SESSION_TTL_S = 30 * 24 * 3600;
export const LIVEKIT_TOKEN_TTL_S = 600;
export const OFFICE_ROOM = 'office';
