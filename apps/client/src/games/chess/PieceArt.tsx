import type { PieceType } from '@bureau/shared/games/chess';
import type { PieceColor } from './fr';
import { SPRITE_SIZE, toneLayers, type Tone } from './pieces';

// Une pièce, dessinée en code (§ 9.5.6) : le croquis de `pieces.ts` en trois tracés SVG (le contour, le corps, l'ombre) à l'échelle entière, sans lissage. Les couleurs viennent de la
// feuille du jeu (`--chess-*`) par la couleur de la pièce : ce sont celles de l'illustration, jour comme nuit. La pièce est décorative : le nom de la case dit déjà ce qu'elle porte.
const layers = new Map<PieceType, Record<Tone, string>>();

function layersOf(type: PieceType): Record<Tone, string> {
  let found = layers.get(type);
  if (!found) {
    found = toneLayers(type);
    layers.set(type, found);
  }
  return found;
}

export function PieceArt({ type, color, scale }: { type: PieceType; color: PieceColor; scale: number }) {
  const paths = layersOf(type);
  const size = SPRITE_SIZE * scale;
  return (
    <svg className="game-chess-art" data-type={type} data-color={color} width={size} height={size} viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <path className="game-chess-tone-edge" d={paths['#']} />
      <path className="game-chess-tone-body" d={paths.o} />
      <path className="game-chess-tone-shade" d={paths.s} />
    </svg>
  );
}
