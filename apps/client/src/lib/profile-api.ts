import type { PublicProfile } from '@bureau/shared';
import { api } from './api';

// Le profil de la personne connectée (PATCH /api/me) : le serveur valide ce qu'on change, l'enregistre et diffuse le profil entier à tout le bureau
// (`profile:changed`) : personne n'a besoin de recharger. La réponse est ce profil entier (nom, avatar, fuseau horaire).

// L'avatar qu'elle vient de composer : le serveur le valide (isAvatarKey).
export const saveAvatarKey = (avatarKey: string): Promise<PublicProfile> => api('/api/me', { method: 'PATCH', body: JSON.stringify({ avatarKey }) });

// Le nom affiché : le serveur le valide (displayNameSchema : 1 à 40 caractères, espaces de bord retirés).
export const saveDisplayName = (name: string): Promise<PublicProfile> => api('/api/me', { method: 'PATCH', body: JSON.stringify({ name }) });

// Le fuseau horaire (un nom IANA) : le serveur le valide (timezoneSchema). Ses collègues voient l'heure qu'il est chez elle, et les horloges de son
// bureau la donnent.
export const saveTimezone = (timezone: string): Promise<PublicProfile> => api('/api/me', { method: 'PATCH', body: JSON.stringify({ timezone }) });
