import { api } from '../lib/api';

// Ce que les routes /api/sim répondent (apps/server/src/sim/sim-routes.ts).
export interface SimBot {
  id: string;
  name: string;
  avatarKey: string;
  audio: string | null;
  x: number;
  y: number;
  target: { x: number; y: number } | null;
}

export interface SimAudioFile {
  file: string;
  url: string;
  size: number;
}

export interface SimState {
  bots: SimBot[];
  audio: SimAudioFile[];
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const simApi = {
  state: () => api<SimState>('/api/sim'),
  addBot: (options: { name?: string; audio?: string | null } = {}) => api<SimBot>('/api/sim/bots', { method: 'POST', ...json(options) }),
  setAudio: (id: string, audio: string | null) => api<SimBot>(`/api/sim/bots/${encodeURIComponent(id)}`, { method: 'PATCH', ...json({ audio }) }),
  removeBot: (id: string) => api<void>(`/api/sim/bots/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  // Fait marcher cette personne vers (x, y) ; rend le point où elle s'arrêtera.
  moveBot: (id: string, x: number, y: number) =>
    api<{ target: { x: number; y: number } }>(`/api/sim/bots/${encodeURIComponent(id)}/move`, { method: 'POST', ...json({ x, y }) }),
  // Envoie un fichier audio dans le dossier du serveur.
  uploadAudio: (file: File) =>
    api<SimAudioFile>(`/api/sim/audio?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    }),
};
