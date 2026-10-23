import { z } from 'zod';
import { MUSIC_SCENES, type MusicScene } from './audio/scenes';
import type { AvatarKey } from './avatars';
import { ACTIVITY_LABEL_MAX_LENGTH, CHAT_MAX_LENGTH, DESK_NAME_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH } from './constants';
import type { DecorError } from './decor/placement';
import { MAX_DECOR_ITEMS } from './decor/placement';
import type { PlacedItem } from './decor/types';
import type { DebugGamePayload, GameAck, GameCommand, GameInvite, GameNotice, GameTableView, LadderAck } from './games/protocol';
import type { GameId } from './games/types';
import type { ArenaAck, ArenaAction, ArenaCommand, ArenaState } from './arena/arena';
import type { SimRoomPayload } from './sim';

export const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const STATUSES = ['available', 'busy', 'away', 'dnd'] as const;
export type Status = (typeof STATUSES)[number];
export type Role = 'admin' | 'member';
export type ChatChannel = 'all' | 'nearby';

export const directionSchema = z.enum(DIRECTIONS);
export const statusSchema = z.enum(STATUSES);
export const moveSchema = z.object({ x: z.number().int(), y: z.number().int(), dir: directionSchema, moving: z.boolean() });
export const mediaStateSchema = z.object({ mic: z.boolean(), cam: z.boolean(), screen: z.boolean() });
// « Je parle » (vrai) ou « je me tais » (faux) : l'événement `speaking:set`.
export const speakingSchema = z.boolean();
export const chatSendSchema = z.object({ channel: z.enum(['all', 'nearby']), text: z.string().trim().min(1).max(CHAT_MAX_LENGTH) });
export const displayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH);

// Les commandes d'un bureau (événement `desk:do`), toutes de la personne qui les envoie :
// - claim : prendre cette place (clé de la zone desk) ; si elle a déjà un bureau, il déménage (nom et verrou suivent) ;
// - release : rendre son bureau ; rename : lui donner un nom (vide : le nom par défaut) ; lock : fermer ou rouvrir la porte ;
// - kick : exclure quelqu'un qui est dans son bureau (il en est sorti, et n'y rentre plus tant qu'on ne l'a pas réadmis) ; unban : le
//   réadmettre ;
// - knock : toquer à la porte d'un bureau fermé (le propriétaire est prévenu) ; admit : laisser entrer quelqu'un qui a toqué ;
// - goto : aller à son bureau ;
// - decor : régler la pièce de son bureau (sol, murs et éléments posés, d'un seul bloc : checkDecor, côté serveur, le valide en entier ; les
//   positions sont en cases au dixième près, et checkDecor refuse celles qui ne tombent pas sur un dixième).
const deskKeySchema = z.string().min(1).max(64);
const userIdSchema = z.string().min(1).max(128);
export const deskCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('claim'), key: deskKeySchema }),
  z.object({ type: z.literal('release') }),
  z.object({ type: z.literal('rename'), name: z.string().trim().max(DESK_NAME_MAX_LENGTH) }),
  z.object({ type: z.literal('lock'), locked: z.boolean() }),
  z.object({ type: z.literal('kick'), userId: userIdSchema }),
  z.object({ type: z.literal('unban'), userId: userIdSchema }),
  z.object({ type: z.literal('knock'), key: deskKeySchema }),
  z.object({ type: z.literal('admit'), userId: userIdSchema }),
  z.object({ type: z.literal('goto') }),
  z.object({
    type: z.literal('decor'),
    floor: z.string().min(1).max(40),
    wall: z.string().min(1).max(40),
    items: z.array(z.object({ id: z.string().min(1).max(40), x: z.number().min(-100).max(100), y: z.number().min(-100).max(100) })).max(MAX_DECOR_ITEMS),
  }),
]);

// Les icônes qu'un état d'activité peut porter, sous le nom qu'elles ont chez Lucide (le client les dessine : office/activity-icons.ts). Dans
// cet ordre, qui est celui de la grille du formulaire.
export const ACTIVITY_ICONS = ['headphones', 'users', 'coffee', 'utensils', 'phone', 'pen-tool', 'code', 'book-open', 'moon', 'plane', 'dumbbell', 'music', 'check', 'waves', 'gamepad-2'] as const;
export type ActivityIcon = (typeof ACTIVITY_ICONS)[number];
export const activityIconSchema = z.enum(ACTIVITY_ICONS);

// Un état d'activité (un « mode ») qu'une personne crée : un nom, la couleur de son point, une icône (facultative : sans elle, on montre le point
// de sa couleur), et trois interrupteurs, ceux de ce qu'il change pour elle :
// - allowEntry : on peut entrer dans son bureau (sinon la porte est fermée, comme verrouillée) ;
// - hear : elle entend les autres (sinon elle n'entend rien) ;
// - heard : les autres l'entendent (sinon son micro ne publie rien).
// Sans entendre ni être entendue, elle est hors de toute conversation, comme en Ne pas déranger.
// Un mode peut aussi avoir un emplacement (`place`, la clé d'un lieu de la carte qui est une destination : la salle de sport, la salle de jeu) : le prendre
// conduit à ce lieu, en sortir ramène au bureau ; sans emplacement, on ne bouge pas. Le serveur refuse une clé qui n'est pas une destination de la carte.
export const activityInputSchema = z.object({
  label: z.string().trim().min(1).max(ACTIVITY_LABEL_MAX_LENGTH),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .transform((color) => color.toLowerCase()),
  icon: activityIconSchema.optional(),
  allowEntry: z.boolean(),
  hear: z.boolean(),
  heard: z.boolean(),
  place: z.string().min(1).max(64).optional(),
});
// L'identifiant d'un état d'activité à prendre (`state:set`), ou null pour revenir à un statut ordinaire.
export const activityIdSchema = z.string().min(1).max(64).nullable();

// La demande d'allumer ou d'éteindre la lumière du bureau (`lights:set`) : l'état voulu, et non une bascule. Une demande répétée, ou qui
// croise celle d'un autre, ne change donc rien : le serveur fait foi, et tout le monde finit dans le même état.
export const lightsSetSchema = z.object({ on: z.boolean() });

// Réservé aux tests de bout en bout (`debug:boost`, seulement avec E2E=1) : donne du café pendant `ms` ms (0 : le retire), comme la machine.
export const debugBoostSchema = z.object({ ms: z.number().int().min(0).max(3_600_000) });

// La demande de régler la musique d'une pièce (`music:set`) : la clé du lieu (celle de la carte : `game`, `desk:A1` pour un bureau) et l'état voulu, `on`
// (allumée ou éteinte) et/ou `scene` (l'ambiance ; null : celle par défaut de la pièce). Ce qui n'est pas dit ne change pas. Un état voulu, non une
// bascule : une demande répétée, ou qui croise celle d'un autre, ne change rien. Une demande qui ne dit rien n'en est pas une.
export const musicSetSchema = z
  .object({ place: z.string().min(1).max(64), on: z.boolean().optional(), scene: z.enum(MUSIC_SCENES).nullable().optional() })
  .refine((request) => request.on !== undefined || request.scene !== undefined);

export type MovePayload = z.infer<typeof moveSchema>;
export type ActivityInput = z.infer<typeof activityInputSchema>;
export type DeskCommand = z.infer<typeof deskCommandSchema>;
export type MediaState = z.infer<typeof mediaStateSchema>;
export type ChatSendPayload = z.infer<typeof chatSendSchema>;
export type LightsSetPayload = z.infer<typeof lightsSetSchema>;
export type MusicSetPayload = z.infer<typeof musicSetSchema>;

export interface ActivityState extends ActivityInput { id: string }
// `activity` : l'état d'activité qu'elle a choisi (absent ou null : un statut ordinaire, `status`). Il passe avant `status` pour le point
// de couleur et le texte. `speaking` : elle parle en ce moment (absent : non), pour la bulle au-dessus de son avatar. `boost` : ce qu'il lui reste
// de café, en ms (absent : pas de café), pour ceux qui arrivent pendant qu'elle en a un.
export interface PublicPlayer { id: string; name: string; avatarKey: AvatarKey | null; x: number; y: number; dir: Direction; moving: boolean; status: Status; media: MediaState; activity?: ActivityState | null; speaking?: boolean; boost?: number }
// Entrée du calcul des groupes. `excluded` : hors de toute conversation (un état d'activité sans entendre ni être entendu), comme en Ne pas déranger.
export interface ProximityPlayer { id: string; x: number; y: number; moving: boolean; status: Status; excluded?: boolean }
export interface ChatMessage { id: string; channel: ChatChannel; userId: string; name: string; text: string; sentAt: string }
// Une place de bureau, telle que tout le monde la voit : sa clé (le nom de la zone desk de la carte), qui l'occupe (id et nom affiché),
// le nom qu'elle lui a donné (null : le nom par défaut), si son propriétaire a verrouillé la porte (`locked`) ou si elle est fermée parce que
// son état d'activité ne laisse entrer personne (`closedByState`). Fermée par l'un ou l'autre, on n'y entre qu'admis. `floor`, `wall` et `items` sont la
// pièce telle que son occupant l'a réglée (le poste de travail par défaut tant qu'il n'a rien changé, et pour une place libre).
export interface DeskInfo {
  key: string;
  ownerId: string | null;
  ownerName: string | null;
  name: string | null;
  locked: boolean;
  closedByState: boolean;
  floor: string;
  wall: string;
  items: PlacedItem[];
  // Sa déco enregistrée ne tient plus dans la pièce (la carte a changé : plus petite, porte de l'autre côté) : `items` est alors le poste par défaut, et la déco reste en base, que
  // l'enregistrement d'une nouvelle remplacerait. Absent sinon.
  decorUnfit?: true;
}
// Quelqu'un que le propriétaire a exclu de son bureau.
export interface DeskBan { id: string; name: string }
// Quelqu'un qui toque à la porte d'un bureau.
export interface DeskKnock { key: string; userId: string; name: string }
// La lumière du bureau, la même pour tout le monde. `by` : qui l'a changée en dernier (null : personne n'y a touché, ou son compte n'existe
// plus), `at` : quand, en ms depuis 1970 (0 : jamais).
export interface LightsState { on: boolean; by: { id: string; name: string } | null; at: number }
// La musique d'une pièce, la même pour tous ceux qui y sont : allumée ou éteinte (`on`), son ambiance (`scene` ; null : celle par défaut de la pièce, que la carte
// donne), qui l'a réglée en dernier (null : personne n'y a touché, ou son compte n'existe plus) et quand (ms depuis 1970 ; 0 : jamais).
export interface RoomMusic { on: boolean; scene: MusicScene | null; by: { id: string; name: string } | null; at: number }
// Une pièce que personne n'a touchée : allumée, son ambiance par défaut.
export const DEFAULT_ROOM_MUSIC: Readonly<RoomMusic> = { on: true, scene: null, by: null, at: 0 };
export interface InitPayload {
  self: PublicPlayer;
  players: PublicPlayer[];
  mapKey: string;
  chatHistory: ChatMessage[];
  // Les 6 places, et celles dont la porte est fermée pour cette personne (bureau verrouillé dont elle n'a pas l'accès, ou dont elle est
  // exclue) : son avatar n'y entre pas.
  desks: DeskInfo[];
  closedDesks: string[];
  // Ceux qu'elle a exclus de son bureau (vide sans bureau).
  deskBans: DeskBan[];
  // La lumière du bureau. Absente : allumée.
  lights?: LightsState;
  // La musique des pièces que quelqu'un a réglées, par clé de lieu. Absente (ou une pièce qui n'y est pas) : allumée, son ambiance par défaut.
  music?: Record<string, RoomMusic>;
  // Les tables de jeu de la carte, chacune telle que le bureau la voit. Absent ou vide : la carte n'en a pas (la petite carte de développement).
  games?: GameTableView[];
  // Les invitations à une table qui attendent la réponse de cette personne.
  gameInvites?: GameInvite[];
  // L'octogone : qui s'y bat, qui regarde, où en est le combat. Absent : la carte n'en a pas.
  arena?: ArenaState;
}
// Les positions acceptées depuis le tick précédent, une par joueur. `tp` : le serveur l'a téléporté (un mode, une table de jeu…) : les autres
// le voient sauter à sa nouvelle place au lieu de glisser jusqu'à elle à travers les murs.
export interface WorldTick { t: number; moves: Array<{ id: string; tp?: true } & MovePayload> }
export interface MediaJoinPayload { url: string; room: string; token: string }
// La réponse du serveur à `chat:send` : `invalid` (charge utile refusée), `rate_limited` (trop de messages), `no_group` (« À proximité »
// sans personne autour), `unavailable` (le serveur n'a pas pu enregistrer le message : la base est en panne ; le message n'est pas parti).
export type ChatAck = { ok: true } | { ok: false; error: 'invalid' | 'rate_limited' | 'no_group' | 'unavailable' };
// La réponse du serveur à `desk:do` : `invalid` (commande refusée), `rate_limited`, `unknown_desk` (aucune place de cette clé),
// `taken` (déjà occupée par quelqu'un d'autre), `no_desk` (la commande suppose un bureau, et la personne n'en a pas), `not_inside`
// (exclure quelqu'un qui n'est pas dans son bureau), `not_locked` (toquer à une porte ouverte), `unavailable` (la base n'a pas pris le
// changement : rien n'a changé), `self` (exclure ou admettre soi-même), `bad_decor` (la déco est refusée : `reason` dit pourquoi, checkDecor).
export type DeskAck =
  | { ok: true }
  | { ok: false; error: 'invalid' | 'rate_limited' | 'unknown_desk' | 'taken' | 'no_desk' | 'not_inside' | 'not_locked' | 'unavailable' | 'self'; reason?: undefined }
  | { ok: false; error: 'bad_decor'; reason: DecorError };

export interface ServerToClientEvents {
  init: (p: InitPayload) => void;
  'world:tick': (p: WorldTick) => void;
  'move:correct': (p: { x: number; y: number; reason?: 'teleport' }) => void;
  'player:joined': (p: PublicPlayer) => void;
  'player:left': (p: { id: string }) => void;
  'status:changed': (p: { id: string; status: Status }) => void;
  'activity:changed': (p: { id: string; activity: ActivityState | null }) => void;
  'media:changed': (p: { id: string; media: MediaState }) => void;
  'speaking:changed': (p: { id: string; speaking: boolean }) => void;   // à tout le bureau : quelqu'un se met à parler, ou se tait (la bulle au-dessus de lui)
  'profile:changed': (p: { id: string; name: string; avatarKey: AvatarKey | null }) => void;
  'chat:message': (p: ChatMessage) => void;
  'desk:changed': (p: DeskInfo) => void;                  // à tout le bureau : une place a changé de main, de nom ou de verrou
  'desk:access': (p: { closed: string[] }) => void;       // à une personne : les places dont la porte lui est fermée
  'desk:bans': (p: DeskBan[]) => void;                    // à un propriétaire : ceux qu'il a exclus
  'desk:knock': (p: DeskKnock) => void;                   // à un propriétaire : quelqu'un toque à sa porte
  'lights:changed': (p: LightsState) => void;             // à tout le bureau : la lumière vient d'être allumée ou éteinte
  'music:changed': (p: { place: string; state: RoomMusic }) => void;   // à tout le bureau : la musique d'une pièce vient d'être réglée
  'coffee:changed': (p: { id: string; ms: number }) => void;   // à tout le bureau : quelqu'un prend un café (ms : la durée qui lui reste) ou le sien est fini (0)
  'game:table': (p: GameTableView) => void;               // à tout le bureau : une table de jeu a changé (la table entière : rien n'y est caché)
  'game:invite': (p: GameInvite) => void;                 // à une personne : on l'invite à une table
  'game:invite:gone': (p: { id: string; reason: 'expired' | 'cancelled' | 'answered' }) => void;   // à une personne : l'invitation n'est plus à montrer
  'game:notice': (p: GameNotice) => void;                 // à l'invitante : la réponse, le silence ou le départ de l'invitée
  'arena:state': (p: ArenaState) => void;                 // à tout le bureau : l'octogone a changé (rôles, points de vie, phase)
  'arena:action': (p: ArenaAction) => void;               // à tout le bureau : un coup vient d'être porté (touché ou dans le vide)
  'media:join': (p: MediaJoinPayload) => void;
  'media:leave': () => void;
  'session:replaced': () => void;
  'sim:room': (p: SimRoomPayload) => void;   // seulement avec SIM=1 (le faux live, sim.ts)
}

export interface ClientToServerEvents {
  move: (p: MovePayload) => void;
  'status:set': (s: Status) => void;
  'state:set': (activityId: string | null) => void;   // prendre un de ses états d'activité, ou null : un statut ordinaire
  'media:state': (m: MediaState) => void;
  'speaking:set': (speaking: boolean) => void;   // « je parle » / « je me tais » ; redit toutes les SPEAKING_HEARTBEAT_MS tant qu'on parle ; ignoré micro coupé, ou sans être entendu
  'chat:send': (p: ChatSendPayload, ack: (r: ChatAck) => void) => void;
  'desk:do': (p: DeskCommand, ack: (r: DeskAck) => void) => void;
  'lights:set': (p: LightsSetPayload) => void;   // allumer ou éteindre, de près (3 cases au plus d'un interrupteur) ; sans réponse : `lights:changed` dit ce qui a changé
  'music:set': (p: MusicSetPayload) => void;   // régler la musique de la pièce où l'on est (dans un bureau : le sien) ; sans réponse : `music:changed` dit ce qui a changé
  'coffee:take': () => void;   // prendre un café, de près (2 cases au plus de la machine) ; sans réponse : `coffee:changed` dit ce qui a changé
  'game:do': (p: GameCommand, ack: (r: GameAck) => void) => void;   // une commande de jeu (regarder, s'asseoir, jouer un coup, inviter…) ; `game:table` dit ce qui a changé
  'game:ladder': (p: { game: GameId }, ack: (r: LadderAck) => void) => void;
  'arena:do': (p: ArenaCommand, ack: (r: ArenaAck) => void) => void;   // une commande de l'octogone (rôle, start, coup, garde) ; `arena:state` dit ce qui a changé   // le classement d'un jeu : les meilleurs, et son rang
  'debug:teleport': (p: { x: number; y: number }) => void;   // accepté seulement si E2E=1
  'debug:boost': (p: { ms: number }) => void;   // accepté seulement si E2E=1
  'debug:game': (p: DebugGamePayload) => void;   // accepté seulement si E2E=1 : remplace l'état de la partie en cours à une table
}
