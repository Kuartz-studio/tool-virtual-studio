import type { ActivityInput, ActivityState } from '@bureau/shared';
import { api } from './api';

// Les états d'activité de la personne connectée (/api/me/states) : toujours les siens, jamais ceux d'un autre.
export const listActivityStates = (): Promise<ActivityState[]> => api<ActivityState[]>('/api/me/states');

export const createActivityState = (input: ActivityInput): Promise<ActivityState> =>
  api<ActivityState>('/api/me/states', { method: 'POST', body: JSON.stringify(input) });

export const updateActivityState = (id: string, input: ActivityInput): Promise<ActivityState> =>
  api<ActivityState>(`/api/me/states/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });

export const deleteActivityState = (id: string): Promise<void> =>
  api<void>(`/api/me/states/${encodeURIComponent(id)}`, { method: 'DELETE' });
