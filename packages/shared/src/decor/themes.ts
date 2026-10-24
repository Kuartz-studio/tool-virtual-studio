import { FLOOR_THEMES, SHOP_WALL_THEMES, WALL_THEMES } from './generated-themes';

// Les thèmes d'une pièce : un sol et des murs, au choix parmi ceux du pack (apps/client/scripts/assets/tileset.ts), et les murs de la boutique
// (SHOP_WALL_THEMES : shop-walls.ts), qu'il faut avoir achetés pour les poser.
export type FloorThemeId = (typeof FLOOR_THEMES)[number]['id'];
export type WallThemeId = (typeof WALL_THEMES)[number]['id'] | (typeof SHOP_WALL_THEMES)[number]['id'];
export type WallTheme = (typeof WALL_THEMES)[number] | (typeof SHOP_WALL_THEMES)[number];

// Ce qu'une pièce de bureau a tant que son occupant n'a rien choisi.
export const DEFAULT_FLOOR_THEME = 'parquet-clair';
export const DEFAULT_WALL_THEME = 'creme';

export function floorTheme(id: string): (typeof FLOOR_THEMES)[number] | undefined {
  return FLOOR_THEMES.find((theme) => theme.id === id);
}

// Un mur, libre ou de la boutique.
export function wallTheme(id: string): WallTheme | undefined {
  return WALL_THEMES.find((theme) => theme.id === id) ?? SHOP_WALL_THEMES.find((theme) => theme.id === id);
}

// Le prix d'un mur de la boutique, en kuartzons ; undefined pour un mur libre (ou inconnu).
export function wallPrice(id: string): number | undefined {
  return SHOP_WALL_THEMES.find((theme) => theme.id === id)?.price;
}

export function isFloorTheme(id: string): boolean {
  return floorTheme(id) !== undefined;
}

export function isWallTheme(id: string): boolean {
  return wallTheme(id) !== undefined;
}
