import type { CharacterStats, MyProgress, TaskView, TodoInput, TodoPatch } from '@bureau/shared';
import { api } from './api';

// La progression de la personne connectée, ses tâches, les missions qu'elle a confiées, les caractéristiques de chacun et la boutique (apps/server/src/progress).
// On confie une mission par le temps réel (`mission:give`, net/mission-commands.ts) : il faut être auprès d'une administratrice.

export const fetchMyProgress = (): Promise<MyProgress> => api<MyProgress>('/api/me/progress');

export const listMyTasks = (): Promise<TaskView[]> => api<TaskView[]>('/api/me/tasks');

export const createTodo = (input: TodoInput): Promise<TaskView> => api<TaskView>('/api/me/tasks', { method: 'POST', body: JSON.stringify(input) });

export const updateTodo = (id: string, patch: TodoPatch): Promise<TaskView> =>
  api<TaskView>(`/api/me/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteTodo = (id: string): Promise<void> => api<void>(`/api/me/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });

// Cocher une tâche : la tâche faite, et sa progression avec le gain (`progress.gain`) ; le temps réel le redit (`progress:mine`).
export const completeTask = (id: string): Promise<{ task: TaskView; progress: MyProgress }> =>
  api<{ task: TaskView; progress: MyProgress }>(`/api/me/tasks/${encodeURIComponent(id)}/done`, { method: 'POST' });

export const declineMission = (id: string): Promise<TaskView> => api<TaskView>(`/api/me/tasks/${encodeURIComponent(id)}/decline`, { method: 'POST' });

export const markMissionsSeen = (): Promise<void> => api<void>('/api/me/tasks/seen', { method: 'POST' });

export const listGivenMissions = (): Promise<TaskView[]> => api<TaskView[]>('/api/me/missions');

export const cancelMission = (id: string): Promise<TaskView> => api<TaskView>(`/api/me/missions/${encodeURIComponent(id)}/cancel`, { method: 'POST' });

export const fetchStats = (userId: string): Promise<CharacterStats> => api<CharacterStats>(`/api/people/${encodeURIComponent(userId)}/stats`);

// Acheter un élément de la boutique : sa progression du moment (kuartzons baissés, l'élément possédé). Refus : ApiError `owned`, `too_poor` ou `unknown_item`.
export const buyItem = (itemId: string): Promise<MyProgress> => api<MyProgress>('/api/shop/buy', { method: 'POST', body: JSON.stringify({ itemId }) });
