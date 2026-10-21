import { z } from 'zod';
import type { AvatarKey } from './avatars';
import { CHAT_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH } from './constants';
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

export type MovePayload = z.infer<typeof moveSchema>;
export type MediaState = z.infer<typeof mediaStateSchema>;
export type ChatSendPayload = z.infer<typeof chatSendSchema>;

export interface PublicPlayer { id: string; name: string; avatarKey: AvatarKey | null; x: number; y: number; dir: Direction; moving: boolean; status: Status; media: MediaState }
export interface ProximityPlayer { id: string; x: number; y: number; moving: boolean; status: Status }   // entrée du calcul des groupes
export interface ChatMessage { id: string; channel: ChatChannel; userId: string; name: string; text: string; sentAt: string }
export interface InitPayload { self: PublicPlayer; players: PublicPlayer[]; mapKey: string; chatHistory: ChatMessage[] }
export interface WorldTick { t: number; moves: Array<{ id: string } & MovePayload> }
export interface MediaJoinPayload { url: string; room: string; token: string }
// La réponse du serveur à `chat:send` : `invalid` (charge utile refusée), `rate_limited` (trop de messages), `no_group` (« À proximité »
// sans personne autour), `unavailable` (le serveur n'a pas pu enregistrer le message : la base est en panne ; le message n'est pas parti).
export type ChatAck = { ok: true } | { ok: false; error: 'invalid' | 'rate_limited' | 'no_group' | 'unavailable' };

export interface ServerToClientEvents {
  init: (p: InitPayload) => void;
  'world:tick': (p: WorldTick) => void;
  'move:correct': (p: { x: number; y: number }) => void;
  'player:joined': (p: PublicPlayer) => void;
  'player:left': (p: { id: string }) => void;
  'status:changed': (p: { id: string; status: Status }) => void;
  'media:changed': (p: { id: string; media: MediaState }) => void;
  'profile:changed': (p: { id: string; name: string; avatarKey: AvatarKey | null }) => void;
  'chat:message': (p: ChatMessage) => void;
  'media:join': (p: MediaJoinPayload) => void;
  'media:leave': () => void;
  'session:replaced': () => void;
  'sim:room': (p: SimRoomPayload) => void;   // seulement avec SIM=1 (le faux live, sim.ts)
}

export interface ClientToServerEvents {
  move: (p: MovePayload) => void;
  'status:set': (s: Status) => void;
  'media:state': (m: MediaState) => void;
  'chat:send': (p: ChatSendPayload, ack: (r: ChatAck) => void) => void;
  'debug:teleport': (p: { x: number; y: number }) => void;   // accepté seulement si E2E=1
}
