import { api } from './api';

// Le profil de la personne connectée (PATCH /api/me) : l'avatar qu'elle vient de composer. Le serveur le valide (isAvatarKey), l'enregistre et
// le diffuse à tout le bureau (`profile:changed`) : personne n'a besoin de recharger.
export const saveAvatarKey = (avatarKey: string): Promise<{ id: string; name: string; avatarKey: string | null }> =>
  api('/api/me', { method: 'PATCH', body: JSON.stringify({ avatarKey }) });
