// Qui est sous le pointeur, dans le jeu : la carte de l'heure locale d'une personne s'ouvre aussi au survol de son avatar (AvatarTimeCard, dans
// l'interface). Le jeu ne rend pas les avatars cliquables pour cela (un appui sur eux ferait autre chose : glisser la carte, poser un élément de
// déco) : il regarde, à chaque image, quel avatar couvre le point où est la souris, et le dit au bus quand cela change (`avatar:hover`).

// La partie d'un avatar qu'on survole, autour de ses pieds (son origine) : le corps et la tête, sans le vide de son image (32 × 64 px).
export const AVATAR_HOVER_BOX = { halfWidth: 10, height: 46 } as const;
// Au-dessus des pieds, le haut de la tête : la carte se pose juste au-dessus.
export const AVATAR_HEAD_PX = 50;

// L'avatar sous ce point (en pixels de la carte), parmi ceux-là (leurs pieds) ; le plus en avant (le plus bas) quand deux se chevauchent. null : aucun.
export function avatarAt(point: { x: number; y: number }, avatars: Iterable<{ id: string; x: number; y: number }>): string | null {
  let found: { id: string; y: number } | null = null;
  for (const avatar of avatars) {
    const inside = Math.abs(point.x - avatar.x) <= AVATAR_HOVER_BOX.halfWidth && point.y <= avatar.y && point.y >= avatar.y - AVATAR_HOVER_BOX.height;
    if (inside && (found === null || avatar.y > found.y)) found = { id: avatar.id, y: avatar.y };
  }
  return found?.id ?? null;
}
