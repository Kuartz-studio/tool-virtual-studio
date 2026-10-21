import { FLOOR_THEMES, WALL_THEMES } from './generated-themes';

// Les thèmes d'une pièce : un sol et des murs, au choix parmi ceux du pack (apps/client/scripts/assets/tileset.ts).
export type FloorThemeId = (typeof FLOOR_THEMES)[number]['id'];
export type WallThemeId = (typeof WALL_THEMES)[number]['id'];

// Ce qu'une pièce de bureau a tant que son occupant n'a rien choisi.
export const DEFAULT_FLOOR_THEME = 'parquet-clair';
export const DEFAULT_WALL_THEME = 'creme';

export function floorTheme(id: string): (typeof FLOOR_THEMES)[number] | undefined {
  return FLOOR_THEMES.find((theme) => theme.id === id);
}

export function wallTheme(id: string): (typeof WALL_THEMES)[number] | undefined {
  return WALL_THEMES.find((theme) => theme.id === id);
}

export function isFloorTheme(id: string): boolean {
  return floorTheme(id) !== undefined;
}

export function isWallTheme(id: string): boolean {
  return wallTheme(id) !== undefined;
}
