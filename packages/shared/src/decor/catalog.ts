import { DECOR_ITEMS } from './generated';
import { DECOR_CATEGORIES, type DecorCategoryId, type DecorItem } from './types';

const BY_ID: ReadonlyMap<string, DecorItem> = new Map(DECOR_ITEMS.map((item) => [item.id, item]));

// L'élément de cette clé, ou undefined si la banque n'en a pas.
export function decorItem(id: string): DecorItem | undefined {
  return BY_ID.get(id);
}

export function isDecorId(id: string): boolean {
  return BY_ID.has(id);
}

// Les éléments d'une catégorie, dans l'ordre de la banque.
export function decorItemsOf(category: DecorCategoryId): DecorItem[] {
  return DECOR_ITEMS.filter((item) => item.cat === category);
}

export function decorCategoryLabel(category: DecorCategoryId): string {
  return DECOR_CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

// Le nom de l'atlas d'une catégorie, tel qu'il est servi : /assets/decor/<catégorie>.png.
export function decorAtlasUrl(category: DecorCategoryId): string {
  return `/assets/decor/${category}.png`;
}
