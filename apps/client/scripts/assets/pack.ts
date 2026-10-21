// Range des images dans un atlas : des rangées de gauche à droite, chacune aussi haute que sa plus haute image, avec une marge de 2 px
// entre les images (sans elle, le filtrage laisserait voir un liseré de l'image voisine). Les images les plus hautes passent d'abord :
// les rangées sont ainsi pleines, et l'atlas reste petit.
import { Img } from './image';

export interface PackInput {
  key: string;
  image: Img;
}

export interface Packed {
  atlas: Img;
  frames: Map<string, { x: number; y: number; w: number; h: number }>;
}

export const ATLAS_MARGIN = 2;

export function packImages(inputs: PackInput[], width = 1024): Packed {
  const sorted = [...inputs].sort((a, b) => b.image.height - a.image.height || a.key.localeCompare(b.key));
  const frames = new Map<string, { x: number; y: number; w: number; h: number }>();
  let x = ATLAS_MARGIN;
  let y = ATLAS_MARGIN;
  let rowHeight = 0;
  for (const { key, image } of sorted) {
    if (image.width + 2 * ATLAS_MARGIN > width) throw new Error(`L'image « ${key} » (${image.width} px) ne tient pas dans un atlas de ${width} px.`);
    if (x + image.width + ATLAS_MARGIN > width) {
      x = ATLAS_MARGIN;
      y += rowHeight + ATLAS_MARGIN;
      rowHeight = 0;
    }
    frames.set(key, { x, y, w: image.width, h: image.height });
    x += image.width + ATLAS_MARGIN;
    rowHeight = Math.max(rowHeight, image.height);
  }
  const atlas = new Img(width, y + rowHeight + ATLAS_MARGIN);
  for (const { key, image } of sorted) {
    const f = frames.get(key)!;
    atlas.paste(image, f.x, f.y, false);
  }
  return { atlas, frames };
}
