import { CLOCK_ITEMS } from './clocks';
import { DECOR_ITEMS } from './generated';
import { DECOR_CATEGORIES, type DecorCategoryId, type DecorItem } from './types';

// Toute la banque : les éléments du pack (generated.ts, que `gen:assets` écrit) et les horloges murales, écrites à la main (clocks.ts). Les horloges
// d'abord : elles ouvrent « Déco & murs », où on les trouve sans chercher. Le reste du code passe par ces fonctions, jamais par DECOR_ITEMS seul.
export const DECOR_CATALOG: readonly DecorItem[] = [...CLOCK_ITEMS, ...DECOR_ITEMS];

const BY_ID: ReadonlyMap<string, DecorItem> = new Map(DECOR_CATALOG.map((item) => [item.id, item]));

// L'élément de cette clé, ou undefined si la banque n'en a pas.
export function decorItem(id: string): DecorItem | undefined {
  return BY_ID.get(id);
}

export function isDecorId(id: string): boolean {
  return BY_ID.has(id);
}

// Les éléments d'une catégorie, dans l'ordre de la banque.
export function decorItemsOf(category: DecorCategoryId): DecorItem[] {
  return DECOR_CATALOG.filter((item) => item.cat === category);
}

export function decorCategoryLabel(category: DecorCategoryId): string {
  return DECOR_CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

// L'atlas où est l'image d'un élément : le sien s'il en a un (les horloges), sinon celui de sa catégorie.
export function decorAtlasOf(item: DecorItem): string {
  return item.atlas ?? item.cat;
}

// Les atlas de la banque, chacun une fois : un par catégorie, puis ceux des éléments qui ont le leur.
export function decorAtlasNames(): string[] {
  return [...new Set<string>([...DECOR_CATEGORIES.map(({ id }) => id), ...DECOR_CATALOG.map(decorAtlasOf)])];
}

// L'adresse d'un atlas (une catégorie, ou l'atlas propre d'un élément), tel qu'il est servi : /assets/decor/<atlas>.png.
export function decorAtlasUrl(atlas: string): string {
  return `/assets/decor/${atlas}.png`;
}
