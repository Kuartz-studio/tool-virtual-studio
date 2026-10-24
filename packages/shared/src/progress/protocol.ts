import { z } from 'zod';
import { isMissionTier, type MissionTier } from './rules';

// Ce que le client et le serveur s'échangent sur la liste des tâches de chacun, les missions qu'on se confie, la progression et la boutique.

export const TASK_TITLE_MAX_LENGTH = 120;
export const TASK_NOTES_MAX_LENGTH = 1000;
// Au plus tant de tâches ouvertes par personne (les siennes et celles qu'on lui confie) : de quoi arrêter un emballement, pas de quoi gêner.
export const MAX_OPEN_TASKS = 200;

const titleSchema = z.string().trim().min(1).max(TASK_TITLE_MAX_LENGTH);
const notesSchema = z.string().trim().max(TASK_NOTES_MAX_LENGTH);

// Une tâche de sa propre liste (POST /api/me/tasks) : un intitulé, et des notes facultatives (une chaîne vide n'en est pas).
export const todoInputSchema = z.object({ title: titleSchema, notes: notesSchema.optional() });
// La modifier (PATCH /api/me/tasks/:id) : ce qui n'est pas dit ne change pas ; des notes vides les retirent.
export const todoPatchSchema = z.object({ title: titleSchema.optional(), notes: notesSchema.optional() }).refine((patch) => patch.title !== undefined || patch.notes !== undefined);

// Confier une mission à quelqu'un (l'événement `mission:give`, auprès d'une administratrice de l'accueil) : à qui, quoi, et sa difficulté de 1 à 10.
export const missionGiveSchema = z.object({
  to: z.string().min(1).max(128),
  title: titleSchema,
  notes: notesSchema.optional(),
  tier: z.custom<MissionTier>((value) => isMissionTier(value)),
});

// Acheter un élément de la boutique (POST /api/shop/buy).
export const shopBuySchema = z.object({ itemId: z.string().min(1).max(40) });

export type TodoInput = z.infer<typeof todoInputSchema>;
export type TodoPatch = z.infer<typeof todoPatchSchema>;
export type MissionGivePayload = z.infer<typeof missionGiveSchema>;

// Une personne, telle qu'une tâche la nomme : son identifiant et son nom affiché du moment.
export interface PersonRef {
  id: string;
  name: string;
}

// Une tâche :
// - `kind` : `todo`, une tâche de sa propre liste ; `mission`, confiée par quelqu'un d'autre (`giver`) auprès d'une administratrice ;
// - `tier` : la difficulté d'une mission (1 à 10) ; null pour une tâche à soi ;
// - `xp` : ce qu'elle rapporte (une mission : selon sa difficulté, fixé quand on la confie) ; une fois faite, ce qu'elle a rapporté (une tâche à soi au-delà
//   du plafond du jour : 0) ;
// - `status` : `open` (à faire), `done` (faite), `declined` (rendue par celle qui l'avait reçue), `cancelled` (retirée par celle qui l'avait confiée) ;
// - `seen` : celle qui l'a reçue l'a vue (une mission non vue est « nouvelle ») ; une tâche à soi l'est toujours.
// Les dates sont en ISO 8601.
export interface TaskView {
  id: string;
  kind: 'todo' | 'mission';
  title: string;
  notes: string | null;
  tier: MissionTier | null;
  xp: number;
  status: 'open' | 'done' | 'declined' | 'cancelled';
  createdAt: string;
  doneAt: string | null;
  owner: PersonRef;
  giver: PersonRef | null;
  seen: boolean;
}

// D'où vient une XP gagnée : une mission, une tâche à soi, le pointage du jour, une partie de jeu.
export type XpSource = 'mission' | 'todo' | 'checkin' | 'game';

// Un gain d'XP, tel que le journal le garde : quand, combien, d'où, et de quoi il s'agit (l'intitulé de la tâche, le jeu…).
export interface XpEntry {
  at: string;
  amount: number;
  source: XpSource;
  label: string;
}

// Ce qu'une XP vient de rapporter, que le serveur dit à la personne pour l'annoncer : le gain, le niveau d'avant et d'après, et les kuartzons gagnés en route.
export interface XpGain {
  amount: number;
  source: XpSource;
  label: string;
  levelBefore: number;
  levelAfter: number;
  kuartzons: number;
}

// Sa propre progression (GET /api/me/progress, et `progress:mine` à chaque changement) : son XP totale, ses kuartzons, sa série de pointage, ce qu'elle possède
// de la boutique (des identifiants d'éléments), et, quand il y en a un, le gain qui vient de l'amener là (pour l'annoncer).
export interface MyProgress {
  xp: number;
  kuartzons: number;
  streak: number;
  owned: string[];
  gain?: XpGain;
}

// Les caractéristiques d'une personne (GET /api/people/:id/stats). Tout le monde voit celles de tout le monde, sauf deux lignes qui ne regardent qu'elle :
// ses kuartzons et son journal (`kuartzons` et `history`, absents pour les autres).
export interface CharacterStats {
  id: string;
  name: string;
  avatarKey: string | null;
  memberSince: string;
  // Son fuseau horaire (un nom IANA) : l'heure qu'il est chez elle, sur sa fiche.
  timezone: string;
  xp: number;
  missionsDone: number;
  // Les missions faites, par difficulté : missionsByTier[0] pour la difficulté 1… [9] pour la 10.
  missionsByTier: number[];
  missionsGiven: number;
  todosDone: number;
  streak: number;
  gamesPlayed: number;
  gamesWon: number;
  kuartzons?: number;
  history?: XpEntry[];
}

// La réponse à `mission:give` : la mission confiée, ou pourquoi elle ne l'a pas été — `invalid` (charge refusée), `rate_limited`, `too_far` (aucune
// administratrice à portée), `unknown_member` (personne de ce nom parmi les membres actifs), `self` (on ne se confie pas de mission), `limit` (sa liste
// est pleine), `unavailable` (la base n'a pas pris la mission).
export type MissionAck =
  | { ok: true; task: TaskView }
  | { ok: false; error: 'invalid' | 'rate_limited' | 'too_far' | 'unknown_member' | 'self' | 'limit' | 'unavailable' };
