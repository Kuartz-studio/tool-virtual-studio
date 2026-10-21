import { z } from 'zod';
import type { AvatarKey } from './avatars';
import { ACTIVITY_LABEL_MAX_LENGTH, CHAT_MAX_LENGTH, DESK_NAME_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH } from './constants';
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
export const chatSendSchema = z.object({ channel: z.enum(['all', 'nearby']), text: z.string().trim().min(1).max(CHAT_MAX_LENGTH) });
export const displayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH);

// Les commandes d'un bureau (événement `desk:do`), toutes de la personne qui les envoie :
// - claim : prendre cette place (clé de la zone desk) ; si elle a déjà un bureau, il déménage (nom et verrou suivent) ;
// - release : rendre son bureau ; rename : lui donner un nom (vide : le nom par défaut) ; lock : fermer ou rouvrir la porte ;
// - kick : exclure quelqu'un qui est dans son bureau (il en est sorti, et n'y rentre plus tant qu'on ne l'a pas réadmis) ; unban : le
//   réadmettre ;
// - knock : toquer à la porte d'un bureau fermé (le propriétaire est prévenu) ; admit : laisser entrer quelqu'un qui a toqué ;
// - goto : aller à son bureau.
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
]);

// Un état d'activité qu'une personne crée : un nom, la couleur de son point, et trois interrupteurs, ceux de ce qu'il change pour elle :
// - allowEntry : on peut entrer dans son bureau (sinon la porte est fermée, comme verrouillée) ;
// - hear : elle entend les autres (sinon elle n'entend rien) ;
// - heard : les autres l'entendent (sinon son micro ne publie rien).
// Sans entendre ni être entendue, elle est hors de toute conversation, comme en Ne pas déranger.
export const activityInputSchema = z.object({
  label: z.string().trim().min(1).max(ACTIVITY_LABEL_MAX_LENGTH),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .transform((color) => color.toLowerCase()),
  allowEntry: z.boolean(),
  hear: z.boolean(),
  heard: z.boolean(),
});
// L'identifiant d'un état d'activité à prendre (`state:set`), ou null pour revenir à un statut ordinaire.
export const activityIdSchema = z.string().min(1).max(64).nullable();

export type MovePayload = z.infer<typeof moveSchema>;
export type ActivityInput = z.infer<typeof activityInputSchema>;
export type DeskCommand = z.infer<typeof deskCommandSchema>;
export type MediaState = z.infer<typeof mediaStateSchema>;
export type ChatSendPayload = z.infer<typeof chatSendSchema>;

export interface ActivityState extends ActivityInput { id: string }
// `activity` : l'état d'activité qu'elle a choisi (absent ou null : un statut ordinaire, `status`). Il passe avant `status` pour le point
// de couleur et le texte.
export interface PublicPlayer { id: string; name: string; avatarKey: AvatarKey | null; x: number; y: number; dir: Direction; moving: boolean; status: Status; media: MediaState; activity?: ActivityState | null }
// Entrée du calcul des groupes. `excluded` : hors de toute conversation (un état d'activité sans entendre ni être entendu), comme en Ne pas déranger.
export interface ProximityPlayer { id: string; x: number; y: number; moving: boolean; status: Status; excluded?: boolean }
export interface ChatMessage { id: string; channel: ChatChannel; userId: string; name: string; text: string; sentAt: string }
// Une place de bureau, telle que tout le monde la voit : sa clé (le nom de la zone desk de la carte), qui l'occupe (id et nom affiché),
// le nom qu'elle lui a donné (null : le nom par défaut), si son propriétaire a verrouillé la porte (`locked`) ou si elle est fermée parce que
// son état d'activité ne laisse entrer personne (`closedByState`). Fermée par l'un ou l'autre, on n'y entre qu'admis.
export interface DeskInfo { key: string; ownerId: string | null; ownerName: string | null; name: string | null; locked: boolean; closedByState: boolean }
// Quelqu'un que le propriétaire a exclu de son bureau.
export interface DeskBan { id: string; name: string }
// Quelqu'un qui toque à la porte d'un bureau.
export interface DeskKnock { key: string; userId: string; name: string }
export interface InitPayload {
  self: PublicPlayer;
  players: PublicPlayer[];
  mapKey: string;
  chatHistory: ChatMessage[];
  // Les 20 places, et celles dont la porte est fermée pour cette personne (bureau verrouillé dont elle n'a pas l'accès, ou dont elle est
  // exclue) : son avatar n'y entre pas.
  desks: DeskInfo[];
  closedDesks: string[];
  // Ceux qu'elle a exclus de son bureau (vide sans bureau).
  deskBans: DeskBan[];
}
export interface WorldTick { t: number; moves: Array<{ id: string } & MovePayload> }
export interface MediaJoinPayload { url: string; room: string; token: string }
// La réponse du serveur à `chat:send` : `invalid` (charge utile refusée), `rate_limited` (trop de messages), `no_group` (« À proximité »
// sans personne autour), `unavailable` (le serveur n'a pas pu enregistrer le message : la base est en panne ; le message n'est pas parti).
export type ChatAck = { ok: true } | { ok: false; error: 'invalid' | 'rate_limited' | 'no_group' | 'unavailable' };
// La réponse du serveur à `desk:do` : `invalid` (commande refusée), `rate_limited`, `unknown_desk` (aucune place de cette clé),
// `taken` (déjà occupée par quelqu'un d'autre), `no_desk` (la commande suppose un bureau, et la personne n'en a pas), `not_inside`
// (exclure quelqu'un qui n'est pas dans son bureau), `not_locked` (toquer à une porte ouverte), `unavailable` (la base n'a pas pris le
// changement : rien n'a changé), `self` (exclure ou admettre soi-même).
export type DeskAck = { ok: true } | { ok: false; error: 'invalid' | 'rate_limited' | 'unknown_desk' | 'taken' | 'no_desk' | 'not_inside' | 'not_locked' | 'unavailable' | 'self' };

export interface ServerToClientEvents {
  init: (p: InitPayload) => void;
  'world:tick': (p: WorldTick) => void;
  'move:correct': (p: { x: number; y: number }) => void;
  'player:joined': (p: PublicPlayer) => void;
  'player:left': (p: { id: string }) => void;
  'status:changed': (p: { id: string; status: Status }) => void;
  'activity:changed': (p: { id: string; activity: ActivityState | null }) => void;
  'media:changed': (p: { id: string; media: MediaState }) => void;
  'profile:changed': (p: { id: string; name: string; avatarKey: AvatarKey | null }) => void;
  'chat:message': (p: ChatMessage) => void;
  'desk:changed': (p: DeskInfo) => void;                  // à tout le bureau : une place a changé de main, de nom ou de verrou
  'desk:access': (p: { closed: string[] }) => void;       // à une personne : les places dont la porte lui est fermée
  'desk:bans': (p: DeskBan[]) => void;                    // à un propriétaire : ceux qu'il a exclus
  'desk:knock': (p: DeskKnock) => void;                   // à un propriétaire : quelqu'un toque à sa porte
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
  'chat:send': (p: ChatSendPayload, ack: (r: ChatAck) => void) => void;
  'desk:do': (p: DeskCommand, ack: (r: DeskAck) => void) => void;
  'debug:teleport': (p: { x: number; y: number }) => void;   // accepté seulement si E2E=1
}
