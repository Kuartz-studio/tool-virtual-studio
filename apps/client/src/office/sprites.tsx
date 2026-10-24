import { CHARACTER_PARTS, TILE_SIZE, TILESET, decorAtlasOf, decorAtlasUrl, type DecorItem } from '@bureau/shared';
import type { CSSProperties } from 'react';

// Les images du pack dans l'interface : on ne charge jamais une image par élément, on montre un morceau de l'atlas (background-position), à
// l'échelle entière qui fait tenir l'élément dans sa vignette (le pixel art ne se redimensionne que par nombres entiers, sans flou).

const TILESET_URL = '/assets/tiles/office.png';
const THUMBS_URL = '/assets/characters/thumbs.png';

// L'échelle d'un élément dans une vignette carrée de `box` pixels : celle qui le garde dans la vignette, au plus ×2, et au moins ×0,5.
function fit(width: number, height: number, box: number): number {
  const raw = box / Math.max(width, height);
  if (raw >= 2) return 2;
  if (raw >= 1) return 1;
  return raw >= 0.5 ? 0.5 : raw;
}

// La vignette d'un élément de la banque.
export function DecorThumb({ item, box = 56 }: { item: DecorItem; box?: number }) {
  const [w, h] = [item.w * TILE_SIZE, item.h * TILE_SIZE];
  const style: CSSProperties = {
    width: w,
    height: h,
    backgroundImage: `url(${decorAtlasUrl(decorAtlasOf(item))})`,
    backgroundPosition: `-${item.fx}px -${item.fy}px`,
    transform: `scale(${fit(w, h, box)})`,
  };
  return (
    <span className="sprite-box" style={{ width: box, height: box }} aria-hidden="true">
      <span className="sprite-image" style={style} />
    </span>
  );
}

// Une case du jeu de tuiles (un sol), vue comme une pastille.
function tileStyle(gid: number): CSSProperties {
  const index = gid - 1;
  return {
    width: TILE_SIZE,
    height: TILE_SIZE,
    backgroundImage: `url(${TILESET_URL})`,
    backgroundPosition: `-${(index % TILESET.columns) * TILE_SIZE}px -${Math.floor(index / TILESET.columns) * TILE_SIZE}px`,
  };
}

export function FloorSwatch({ gid }: { gid: number }) {
  return <span className="swatch-tile" style={tileStyle(gid)} aria-hidden="true" />;
}

// Un mur : le haut et le bas de sa face, l'un sur l'autre.
export function WallSwatch({ top, bottom }: { top: number; bottom: number }) {
  return (
    <span className="swatch-wall" aria-hidden="true">
      <span className="swatch-tile" style={tileStyle(top)} />
      <span className="swatch-tile" style={tileStyle(bottom)} />
    </span>
  );
}

// L'imagette d'une pièce du personnage (characters/thumbs.png, en grille de 32 × 64 px) : le personnage de face, sans le vide au-dessus de sa tête.
const THUMB_TOP = 14;
export function PartThumb({ index }: { index: number }) {
  const { columns } = CHARACTER_PARTS.thumbs;
  const style: CSSProperties = {
    width: TILE_SIZE,
    height: 64 - THUMB_TOP,
    backgroundImage: `url(${THUMBS_URL})`,
    backgroundPosition: `-${(index % columns) * 32}px -${Math.floor(index / columns) * 64 + THUMB_TOP}px`,
  };
  return <span className="part-thumb" style={style} aria-hidden="true" />;
}
