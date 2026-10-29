import { api } from '../lib/api';

// La fenêtre « Quoi de neuf ? » fermée : le serveur enregistre sur le compte la version en cours comme vue (la sienne, pas un numéro du client), et
// répond avec ce que le compte garde. Idempotent : rappelé, il ne change rien.
export const markReleaseSeen = (): Promise<{ lastReleaseSeen: string | null }> =>
  api<{ lastReleaseSeen: string | null }>('/api/me/release-seen', { method: 'POST' });
