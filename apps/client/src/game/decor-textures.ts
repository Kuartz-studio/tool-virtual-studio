import { DECOR_CATEGORIES, DECOR_ITEMS, TILE_SIZE, decorAtlasUrl, type DecorCategoryId, type DecorItem } from '@bureau/shared';
import type { Textures } from 'phaser';

// Les atlas de la banque d'éléments (public/assets/decor/<catégorie>.png) : le Preloader charge chacun comme une image ; chaque élément en est
// une image nommée de sa clé (`of-7-28`), que les scènes dessinent avec scene.add.image(x, y, decorTextureKey(cat), id).
export function decorTextureKey(category: DecorCategoryId): string {
  return `decor:${category}`;
}

export function decorAtlasImages(): Array<{ key: string; url: string }> {
  return DECOR_CATEGORIES.map(({ id }) => ({ key: decorTextureKey(id), url: decorAtlasUrl(id) }));
}

// Découpe les images des éléments dans les atlas chargés. Un atlas absent (image qui n'a pas chargé) est laissé de côté : ses éléments ne se
// dessinent pas, le reste du bureau si.
export function registerDecorFrames(textures: Textures.TextureManager): void {
  for (const item of DECOR_ITEMS) {
    const texture = textures.exists(decorTextureKey(item.cat)) ? textures.get(decorTextureKey(item.cat)) : null;
    if (texture && !texture.has(item.id)) texture.add(item.id, 0, item.fx, item.fy, item.w * TILE_SIZE, item.h * TILE_SIZE);
  }
}

export function decorAtlasesLoaded(textures: Textures.TextureManager): boolean {
  return decorAtlasImages().every(({ key }) => textures.exists(key));
}

// L'image d'un élément, pour l'interface (une vignette de la banque) : sa position dans son atlas.
export function decorSprite(item: DecorItem): { url: string; x: number; y: number; width: number; height: number } {
  return { url: decorAtlasUrl(item.cat), x: item.fx, y: item.fy, width: item.w * TILE_SIZE, height: item.h * TILE_SIZE };
}
