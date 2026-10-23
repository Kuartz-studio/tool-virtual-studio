import { api } from './api';

// Le profil de la personne connectée (PATCH /api/me) : l'avatar qu'elle vient de composer. Le serveur le valide (isAvatarKey), l'enregistre et
// le diffuse à tout le bureau (`profile:changed`) : personne n'a besoin de recharger.
export const saveAvatarKey = (avatarKey: string): Promise<{ id: string; name: string; avatarKey: string | null }> =>
  api('/api/me', { method: 'PATCH', body: JSON.stringify({ avatarKey }) });

// Le nom affiché de la personne connectée : le serveur le valide (displayNameSchema : 1 à 40 caractères, espaces de bord retirés), l'enregistre et le diffuse
// à tout le bureau (`profile:changed`).
export const saveDisplayName = (name: string): Promise<{ id: string; name: string; avatarKey: string | null }> =>
  api('/api/me', { method: 'PATCH', body: JSON.stringify({ name }) });
