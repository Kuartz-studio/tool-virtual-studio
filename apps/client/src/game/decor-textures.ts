import { CLOCK_ATLAS, DECOR_CATALOG, TILE_SIZE, decorAtlasNames, decorAtlasOf, decorAtlasUrl, isClockId, type DecorItem } from '@bureau/shared';
import type { Textures } from 'phaser';

// Les atlas de la banque d'éléments (public/assets/decor/<atlas>.png : un par catégorie, et celui des horloges murales) : le Preloader charge chacun
// comme une image ; chaque élément en est une image nommée de sa clé (`of-7-28`), que les scènes dessinent avec
// scene.add.image(x, y, decorTextureKey(decorAtlasOf(item)), id).
export function decorTextureKey(atlas: string): string {
  return `decor:${atlas}`;
}

export function decorAtlasImages(): Array<{ key: string; url: string }> {
  return decorAtlasNames().map((atlas) => ({ key: decorTextureKey(atlas), url: decorAtlasUrl(atlas) }));
}

// Le nom du cadran nu d'une horloge murale dans l'atlas des horloges : la même image sans aiguilles ni chiffres allumés, que le jeu recopie avant
// d'y peindre l'heure (wall-clocks.ts).
export const bareFrameOf = (id: string): string => `${id}:cadran`;

// Découpe les images des éléments dans les atlas chargés, et les cadrans nus des horloges. Un atlas absent (image qui n'a pas chargé) est laissé de
// côté : ses éléments ne se dessinent pas, le reste du bureau si.
export function registerDecorFrames(textures: Textures.TextureManager): void {
  for (const item of DECOR_CATALOG) {
    const key = decorTextureKey(decorAtlasOf(item));
    const texture = textures.exists(key) ? textures.get(key) : null;
    if (!texture) continue;
    const [width, height] = [item.w * TILE_SIZE, item.h * TILE_SIZE];
    if (!texture.has(item.id)) texture.add(item.id, 0, item.fx, item.fy, width, height);
    if (isClockId(item.id) && !texture.has(bareFrameOf(item.id))) texture.add(bareFrameOf(item.id), 0, item.fx, item.fy + CLOCK_ATLAS.bareRowOffset, width, height);
  }
}

export function decorAtlasesLoaded(textures: Textures.TextureManager): boolean {
  return decorAtlasImages().every(({ key }) => textures.exists(key));
}

// L'image d'un élément, pour l'interface (une vignette de la banque) : sa position dans son atlas.
export function decorSprite(item: DecorItem): { url: string; x: number; y: number; width: number; height: number } {
  return { url: decorAtlasUrl(decorAtlasOf(item)), x: item.fx, y: item.fy, width: item.w * TILE_SIZE, height: item.h * TILE_SIZE };
}
