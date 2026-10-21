// Découpe une planche d'objets (celles de LimeZu : des meubles posés sur une grille de cases de 32 px, séparés par un peu de vide) en
// objets entiers. Un objet est un groupe de pixels non transparents qui se touchent (8 voisins, ombre portée comprise). Son
// rectangle est arrondi à la case vers l'extérieur ; ses pixels sont gardés à part (`mask`), car deux objets voisins peuvent partager
// une case : on ne recopie que ceux de l'objet.
import { Img } from './image';

export interface TileRect {
  tx: number;
  ty: number;
  tw: number;
  th: number;
}

export interface Component extends TileRect {
  // Les pixels de l'objet, en coordonnées de la planche (y × largeur + x).
  pixels: number[];
}

export function segmentSheet(sheet: Img, tile = 32, alphaMin = 1): Component[] {
  const { width, height } = sheet;
  const label = new Int32Array(width * height).fill(-1);
  const components: Component[] = [];
  const stack: number[] = [];
  for (let y0 = 0; y0 < height; y0++) {
    for (let x0 = 0; x0 < width; x0++) {
      if (label[y0 * width + x0] !== -1 || sheet.alphaAt(x0, y0) < alphaMin) continue;
      const id = components.length;
      const pixels: number[] = [];
      let [minX, maxX, minY, maxY] = [x0, x0, y0, y0];
      label[y0 * width + x0] = id;
      stack.push(x0, y0);
      while (stack.length > 0) {
        const y = stack.pop()!;
        const x = stack.pop()!;
        pixels.push(y * width + x);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (label[ny * width + nx] !== -1 || sheet.alphaAt(nx, ny) < alphaMin) continue;
            label[ny * width + nx] = id;
            stack.push(nx, ny);
          }
        }
      }
      components.push({
        tx: Math.floor(minX / tile),
        ty: Math.floor(minY / tile),
        tw: Math.floor(maxX / tile) - Math.floor(minX / tile) + 1,
        th: Math.floor(maxY / tile) - Math.floor(minY / tile) + 1,
        pixels,
      });
    }
  }
  return components.sort((p, q) => p.ty - q.ty || p.tx - q.tx);
}

// L'image d'un objet : son rectangle de cases, avec ses seuls pixels.
export function extract(sheet: Img, c: Component, tile = 32): Img {
  const out = new Img(c.tw * tile, c.th * tile);
  for (const index of c.pixels) {
    const x = index % sheet.width;
    const y = Math.floor(index / sheet.width);
    out.set(x - c.tx * tile, y - c.ty * tile, sheet.get(x, y));
  }
  return out;
}
