import { FLOOR_LOOKS, FLOOR_THEMES, SHOP_WALL_THEMES, THEME_COLORS, THEME_MATERIALS, WALL_LOOKS, WALL_THEMES, type ThemeColor, type ThemeLook, type ThemeMaterial } from '@bureau/shared';

// Les thèmes de l'onglet « Murs et sol » (DecorThemes) : les sols, puis les murs, rangés par couleur et filtrés par matière (la couleur et la matière de
// chaque thème : decor/theme-looks.ts). Les murs de la boutique sont rangés avec les autres, à leur couleur, avec leur prix.

export interface FloorEntry {
  id: string;
  label: string;
  gid: number;
  look: ThemeLook;
}

// Un mur : le haut et le bas de sa face ; son prix en kuartzons s'il vient de la boutique.
export interface WallEntry {
  id: string;
  label: string;
  top: number;
  bottom: number;
  price?: number;
  look: ThemeLook;
}

export const FLOOR_ENTRIES: readonly FloorEntry[] = FLOOR_THEMES.map(({ id, label, gid }) => ({ id, label, gid, look: FLOOR_LOOKS[id] }));

// Les murs libres, puis ceux de la boutique, du moins cher au plus cher : dans une couleur et une matière, ils gardent cet ordre.
export const WALL_ENTRIES: readonly WallEntry[] = [
  ...WALL_THEMES.map(({ id, label, top, bottom }) => ({ id, label, top, bottom, look: WALL_LOOKS[id] })),
  ...SHOP_WALL_THEMES.map(({ id, label, top, bottom, price }) => ({ id, label, top, bottom, price, look: WALL_LOOKS[id] })),
];

// Ce que montre le sélecteur : toutes les matières, ou une seule.
export type MaterialFilter = ThemeMaterial | 'all';

// Une couleur, et ses thèmes.
export interface ColorShelf<T> {
  color: ThemeColor;
  themes: T[];
}

// Les thèmes rangés par couleur, dans l'ordre des couleurs ; dans une couleur, par matière (dans l'ordre du sélecteur), puis dans l'ordre de la liste. Une
// matière choisie ne garde que ses thèmes : une couleur qui n'en a aucun n'apparaît pas.
export function shelvesByColor<T extends { look: ThemeLook }>(themes: readonly T[], filter: MaterialFilter): ColorShelf<T>[] {
  const rank = (theme: T) => THEME_MATERIALS.indexOf(theme.look.material);
  const kept = themes.filter((theme) => filter === 'all' || theme.look.material === filter);
  return THEME_COLORS.map((color) => ({ color, themes: kept.filter((theme) => theme.look.color === color).sort((a, b) => rank(a) - rank(b)) })).filter(
    (shelf) => shelf.themes.length > 0,
  );
}

// Les matières du sélecteur : celles que portent ces thèmes, dans l'ordre de la liste partagée.
export function materialsOf(...lists: ReadonlyArray<readonly { look: ThemeLook }[]>): ThemeMaterial[] {
  return THEME_MATERIALS.filter((material) => lists.some((themes) => themes.some((theme) => theme.look.material === material)));
}

// La pastille d'une couleur, devant son nom : une valeur CSS (le multicolore est un dégradé).
export const COLOR_DOTS: Readonly<Record<ThemeColor, string>> = {
  blanc: '#f6f5f1',
  creme: '#efe4cc',
  beige: '#d4bc93',
  gris: '#9b9fa8',
  noir: '#1f2026',
  brun: '#8b5e3f',
  rouge: '#cf4a4f',
  rose: '#e9a3b4',
  orange: '#e58a3a',
  vert: '#6aa77a',
  bleu: '#4c84c8',
  violet: '#8b67c4',
  multicolore: 'conic-gradient(#e5484d, #f2b200, #6aa77a, #4c84c8, #8b67c4, #e5484d)',
};
