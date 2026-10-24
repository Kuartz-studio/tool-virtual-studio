import type { Point } from './find-path';
import type { OfficeMap } from './parse-map';
import { avatarBodyFits, isWalkableTile } from './queries';

export interface SpotNearOptions {
  // Des cases que la recherche ne traverse pas, en plus des murs : les meubles posés dans les bureaux (furnitureTiles).
  blocked?: (tx: number, ty: number) => boolean;
  // Où la personne a le droit de se tenir (pas dans le bureau fermé d'un autre, pas dans le ring) : la recherche traverse les autres cases, elle ne s'y arrête pas.
  canStand?: (x: number, y: number) => boolean;
  // Les pieds de ceux qui sont déjà là : on ne se pose pas à moins de `apartPx` pixels de l'un d'eux.
  taken?: ReadonlyArray<Point>;
  apartPx?: number;
  // Jusqu'où chercher, en pas d'une case.
  maxSteps?: number;
  // La case du point elle-même peut-elle être la bonne ? Non pour rejoindre quelqu'un : c'est la sienne.
  includeStart?: boolean;
}

const STEPS: ReadonlyArray<readonly [dx: number, dy: number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];

// Où poser quelqu'un tout près d'un point (la personne qu'on rejoint, le propriétaire d'un bureau où l'on arrive invité) : la recherche part de la case du point
// et avance de case en case, en ligne droite seulement, sans traverser un mur (ni une case de `blocked`), comme quelqu'un qui marcherait depuis là : on ne se
// retrouve jamais de l'autre côté d'une cloison. La bonne case est la première où l'on peut se tenir : la plus proche en pas et, à pas égaux, la plus proche du
// point en ligne droite (puis la plus haute, puis la plus à gauche : toujours la même pour les mêmes données). On peut s'y tenir quand le corps de l'avatar y
// tient, que `canStand` l'accepte, et que personne de `taken` n'est à moins de `apartPx` de son centre. Le centre de la case, en pixels ; null : rien à
// `maxSteps` pas ou moins (ou un point hors de la carte).
export function spotNear(map: OfficeMap, from: Point, options: SpotNearOptions = {}): Point | null {
  const { blocked = () => false, canStand = () => true, taken = [], apartPx = 0, maxSteps = 12, includeStart = false } = options;
  const size = map.tileSize;
  const start = { tx: Math.floor(from.x / size), ty: Math.floor(from.y / size) };
  if (start.tx < 0 || start.ty < 0 || start.tx >= map.widthTiles || start.ty >= map.heightTiles) return null;
  const open = (tx: number, ty: number) => isWalkableTile(map, tx, ty) && !blocked(tx, ty);
  const seen = new Set<number>([start.ty * map.widthTiles + start.tx]);
  let frontier = [start];
  for (let step = 0; step <= maxSteps && frontier.length > 0; step++) {
    let best: (Point & { distance: number }) | null = null;
    for (const { tx, ty } of frontier) {
      if (step === 0 && !includeStart) continue;
      const spot = { x: tx * size + size / 2, y: ty * size + size / 2 };
      if (!open(tx, ty) || !avatarBodyFits(map, spot.x, spot.y) || !canStand(spot.x, spot.y)) continue;
      if (taken.some((other) => Math.hypot(other.x - spot.x, other.y - spot.y) < apartPx)) continue;
      const distance = Math.hypot(spot.x - from.x, spot.y - from.y);
      const closer = best === null || distance < best.distance - 1e-9;
      const tie = best !== null && Math.abs(distance - best.distance) <= 1e-9 && (spot.y < best.y || (spot.y === best.y && spot.x < best.x));
      if (closer || tie) best = { ...spot, distance };
    }
    if (best) return { x: best.x, y: best.y };
    const next: Array<{ tx: number; ty: number }> = [];
    for (const { tx, ty } of frontier) {
      for (const [dx, dy] of STEPS) {
        const [nx, ny] = [tx + dx, ty + dy];
        const index = ny * map.widthTiles + nx;
        if (!open(nx, ny) || seen.has(index)) continue;
        seen.add(index);
        next.push({ tx: nx, ty: ny });
      }
    }
    frontier = next;
  }
  return null;
}
