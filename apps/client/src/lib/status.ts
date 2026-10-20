import type { Status } from '@bureau/shared';

// La couleur de chaque statut (spec §10 : vert, orange, gris, rouge), à un seul endroit : le point de l'étiquette au-dessus d'un
// avatar (NameTag, dessiné par Phaser, qui veut un nombre) et ceux du menu des statuts et du panneau Personnes (HTML, qui veut du
// CSS : statusCssColor) sont ainsi toujours de la même couleur.
export const STATUS_COLORS: Record<Status, number> = {
  available: 0x22c55e,
  busy: 0xf59e0b,
  away: 0x9ca3af,
  dnd: 0xef4444,
};

// Un nombre 0xrrggbb en CSS : « #rrggbb », avec ses six chiffres (un nombre sous 0x100000 en a moins sans les zéros de tête).
export function cssColor(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

// La couleur d'un statut en CSS.
export function statusCssColor(status: Status): string {
  return cssColor(STATUS_COLORS[status]);
}
