import { CHARACTER_PARTS, TILE_ANIMATIONS, TILE_SIZE, TILESET, cycleOf, decorAtlasOf, decorAtlasUrl, tileAnimation, type DecorItem, type TileAnimation } from '@bureau/shared';
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

// La place d'une case dans l'image du jeu de tuiles.
function tilePosition(gid: number): string {
  const index = gid - 1;
  return `-${(index % TILESET.columns) * TILE_SIZE}px -${Math.floor(index / TILESET.columns) * TILE_SIZE}px`;
}

// Les sols et les murs qui bougent dans le jeu bougent aussi ici : une animation CSS par tuile (des sauts d'une image à l'autre, comme dans le jeu), écrite une
// fois dans une feuille de style à part. Elle ne joue que là où la feuille principale le dit (au survol d'une pastille, sur celle qu'on a choisie, dans
// l'aperçu de son bureau), et jamais pour qui demande moins de mouvement.
let keyframesWritten = false;
function writeKeyframes(): void {
  if (keyframesWritten || typeof document === 'undefined') return;
  keyframesWritten = true;
  const style = document.createElement('style');
  style.dataset.tileAnimations = '';
  style.textContent = TILE_ANIMATIONS.map(keyframesOf).join('\n');
  document.head.append(style);
}

function keyframesOf(animation: TileAnimation): string {
  const cycle = cycleOf(animation);
  let at = 0;
  const steps = animation.frames.map((gid, index) => {
    const step = `${((at / cycle) * 100).toFixed(4)}% { background-position: ${tilePosition(gid)}; }`;
    at += animation.durations[index]!;
    return step;
  });
  const last = animation.frames[animation.frames.length - 1]!;
  return `@keyframes tile-${animation.gid} { ${steps.join(' ')} 100% { background-position: ${tilePosition(last)}; } }`;
}

// Un reflet passe peu après qu'on survole la pastille : l'animation part à cette avance sur la fin de son repos.
const PREVIEW_LEAD_MS = 250;

// Le mouvement d'une case, s'il y en a un : son animation, sa durée, et son départ. `column` : son rang dans un aperçu de plusieurs cases (un reflet qui
// traverse prend son retard d'une colonne à l'autre) ; `restOf` : la case dont le repos fixe le départ (la même pour le haut et le bas d'un mur, qui bougent
// ensemble).
function motionStyle(gid: number, column: number, restOf: number): CSSProperties {
  const animation = tileAnimation(gid);
  if (!animation) return {};
  writeKeyframes();
  const lag = animation.phase === 'x' || animation.phase === 'xy' ? column * animation.step : 0;
  const rest = (tileAnimation(restOf) ?? animation).durations[0]!;
  return { '--tile-animation': `tile-${gid}`, '--tile-cycle': `${cycleOf(animation)}ms`, '--tile-delay': `${lag - Math.max(0, rest - PREVIEW_LEAD_MS)}ms` } as CSSProperties;
}

// Une case du jeu de tuiles (un sol), vue comme une pastille.
function TileSprite({ gid, column = 0, restOf = gid }: { gid: number; column?: number; restOf?: number }) {
  const style: CSSProperties = { width: TILE_SIZE, height: TILE_SIZE, backgroundImage: `url(${TILESET_URL})`, backgroundPosition: tilePosition(gid), ...motionStyle(gid, column, restOf) };
  return <span className="swatch-tile" style={style} data-animated={tileAnimation(gid) ? '' : undefined} aria-hidden="true" />;
}

export function FloorSwatch({ gid, column = 0 }: { gid: number; column?: number }) {
  return <TileSprite gid={gid} column={column} />;
}

// Un mur : le haut et le bas de sa face, l'un sur l'autre.
export function WallSwatch({ top, bottom, column = 0 }: { top: number; bottom: number; column?: number }) {
  const restOf = tileAnimation(top) ? top : bottom;
  return (
    <span className="swatch-wall" aria-hidden="true">
      <TileSprite gid={top} column={column} restOf={restOf} />
      <TileSprite gid={bottom} column={column} restOf={restOf} />
    </span>
  );
}

// L'aperçu d'un mur (la boutique) : sa face, sur `columns` cases de large.
export function WallPreview({ top, bottom, columns = 2 }: { top: number; bottom: number; columns?: number }) {
  return (
    <span className="wall-preview" aria-hidden="true">
      {Array.from({ length: columns }, (_, column) => (
        <WallSwatch key={column} top={top} bottom={bottom} column={column} />
      ))}
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
