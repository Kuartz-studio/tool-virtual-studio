import { TILE_ANIMATIONS } from './generated-themes';

// Les sols et les murs qui bougent. Le jeu de tuiles (apps/client/scripts/assets/tile-motion.ts) donne à une tuile de base (le numéro d'un thème) des images
// d'animation ; generated-themes.ts les liste (TILE_ANIMATIONS) : les images (la base d'abord), la durée de chacune, et comment le mouvement se décale d'une
// case à l'autre (`phase`) :
// - x : de colonne en colonne (un reflet qui traverse le mur de gauche à droite), `step` ms par colonne ;
// - y : de rangée en rangée (le long d'un pan vertical, de haut en bas), `step` ms par rangée ;
// - xy : en diagonale (un reflet qui traverse le sol), `step` ms par case de diagonale ;
// - scatter : au hasard, mais toujours le même pour une case (des étincelles, des bougies qui ne vacillent pas ensemble) ;
// - sync : toutes ensemble (un motif qui se raccorde d'une case à l'autre, comme l'eau).
// Le haut et le bas d'une face de mur ont la même durée de cycle et le même décalage : ils bougent ensemble. L'heure est celle du mur (Date.now) : tout le
// monde voit le même reflet au même moment.
export type TilePhase = 'x' | 'y' | 'xy' | 'scatter' | 'sync';

export interface TileAnimation {
  gid: number;
  frames: readonly number[];
  durations: readonly number[];
  phase: TilePhase;
  step: number;
}

const BY_GID: ReadonlyMap<number, TileAnimation> = new Map(TILE_ANIMATIONS.map((animation) => [animation.gid, animation]));

// L'animation de cette tuile, si elle en a une.
export function tileAnimation(gid: number): TileAnimation | undefined {
  return BY_GID.get(gid);
}

// La durée d'un tour de l'animation (ms), comptée une fois par animation.
const CYCLES = new WeakMap<TileAnimation, number>();
export function cycleOf(animation: TileAnimation): number {
  let cycle = CYCLES.get(animation);
  if (cycle === undefined) {
    cycle = animation.durations.reduce((sum, duration) => sum + duration, 0);
    CYCLES.set(animation, cycle);
  }
  return cycle;
}

// Un nombre de 0 à 1, toujours le même pour une case, sans motif visible d'une case à la voisine.
function scatterOf(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
}

// Le retard de cette case sur l'animation, en ms (un reflet qui traverse arrive plus tard à droite).
function delayOf(animation: TileAnimation, x: number, y: number): number {
  switch (animation.phase) {
    case 'x':
      return x * animation.step;
    case 'y':
      return y * animation.step;
    case 'xy':
      return (x + y) * animation.step;
    case 'scatter':
      return scatterOf(x, y) * cycleOf(animation);
    case 'sync':
      return 0;
  }
}

// L'image que montre la case (x, y) à l'instant `now` (ms) : le numéro de sa tuile.
export function frameAt(animation: TileAnimation, now: number, x: number, y: number): number {
  const cycle = cycleOf(animation);
  let t = (((now - delayOf(animation, x, y)) % cycle) + cycle) % cycle;
  for (let i = 0; i < animation.frames.length; i++) {
    t -= animation.durations[i]!;
    if (t < 0) return animation.frames[i]!;
  }
  return animation.frames[animation.frames.length - 1]!;
}
