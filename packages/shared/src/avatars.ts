export const DEV_AVATAR_KEYS = ['dev-red', 'dev-blue', 'dev-green', 'dev-yellow'] as const;
export const GALLERY_AVATAR_KEYS: readonly string[] = [];   // rempli à la tâche 23
export const DEFAULT_AVATAR_KEY = 'dev-red';
export type AvatarKey = string;

export function isAvatarKey(k: string): boolean {
  return (DEV_AVATAR_KEYS as readonly string[]).includes(k) || GALLERY_AVATAR_KEYS.includes(k);
}
