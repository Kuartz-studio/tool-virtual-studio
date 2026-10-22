import type { Direction } from '@bureau/shared';
import type { GameObjects, Scene } from 'phaser';
import { snapToPixels } from '../pixel-snap';
import { prefersReducedMotion } from '../reduced-motion';

// Les petits nuages de poussière qu'un avatar sous café laisse derrière lui quand il court : de petits ronds clairs qui naissent à ses pieds, grossissent et
// s'effacent en DUST_LIFE_MS. Chaque avatar a sa traînée, une petite réserve de DUST_POOL ronds qu'on réutilise : rien ne s'accumule. Les nuages restent où
// ils sont nés. Ce fichier n'importe de Phaser que des types : la scène lui donne de quoi dessiner.
export const DUST_LIFE_MS = 400;
// Au plus un nuage par ce temps : à 640 px/s, un tous les 26 px environ (38 px à 960 px/s), de quoi former une traînée.
export const DUST_INTERVAL_MS = 40;
// Le nombre de nuages vivants en même temps, plus un : la réserve ne manque jamais d'un rond libre.
export const DUST_POOL = Math.ceil(DUST_LIFE_MS / DUST_INTERVAL_MS) + 1;
// Un nuage est un rond clair cerné d'un trait gris : il se voit sur un sol clair comme sur un sol sombre, et s'efface avec son trait.
const DUST_COLOR = 0xf6f2e8;
const DUST_OUTLINE = 0x9b9486;
const DUST_START_RADIUS = 2;
const DUST_END_RADIUS = 4.5;
const DUST_START_ALPHA = 0.9;
// Un nuage naît à ce nombre de pixels derrière les pieds, et juste sous l'avatar en profondeur : devant le sol, derrière lui.
const BEHIND_PX = 5;
const DEPTH_BELOW = 0.5;

// Comment est un nuage de cet âge (ms) : son rayon et son opacité ; null s'il n'est pas né, ou s'il a fini.
export function dustPuff(age: number): { radius: number; alpha: number } | null {
  if (age < 0 || age >= DUST_LIFE_MS) return null;
  const progress = age / DUST_LIFE_MS;
  return { radius: DUST_START_RADIUS + (DUST_END_RADIUS - DUST_START_RADIUS) * progress, alpha: DUST_START_ALPHA * (1 - progress) };
}

// Le sens, derrière un avatar qui va dans cette direction (y augmente vers le bas) : l'opposé de celui où il va.
const BEHIND: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
};
export const behindFeet = (dir: Direction): { x: number; y: number } => BEHIND[dir];

export interface DustTrailOptions {
  // La personne demande moins de mouvement : aucun nuage (prefers-reduced-motion par défaut).
  reducedMotion?: () => boolean;
}

export class DustTrail {
  private readonly puffs: Array<{ circle: GameObjects.Arc; bornAt: number }>;
  private readonly reducedMotion: () => boolean;
  // Le prochain rond à réutiliser, et l'heure du dernier nuage né.
  private next = 0;
  private lastBorn = Number.NEGATIVE_INFINITY;

  constructor(scene: Scene, reducedMotion: () => boolean = prefersReducedMotion) {
    this.reducedMotion = reducedMotion;
    this.puffs = Array.from({ length: DUST_POOL }, () => ({
      circle: snapToPixels(scene.add.circle(0, 0, DUST_START_RADIUS, DUST_COLOR, DUST_START_ALPHA)).setStrokeStyle(1, DUST_OUTLINE).setVisible(false),
      bornAt: Number.NEGATIVE_INFINITY,
    }));
  }

  // À chaque image : un nuage de plus si l'avatar court sous café (`running`, ses pieds en `feet`, sa direction `dir`), au plus un par DUST_INTERVAL_MS ; et
  // ceux qui sont nés grossissent, s'effacent, puis se cachent.
  update(now: number, feet: { x: number; y: number }, running: boolean, dir: Direction): void {
    if (running && !this.reducedMotion() && now - this.lastBorn >= DUST_INTERVAL_MS) this.spawn(now, feet, dir);
    for (const puff of this.puffs) {
      const shape = dustPuff(now - puff.bornAt);
      if (shape === null) {
        if (puff.circle.visible) puff.circle.setVisible(false);
        continue;
      }
      puff.circle.setRadius(shape.radius).setAlpha(shape.alpha);
    }
  }

  destroy(): void {
    for (const { circle } of this.puffs) circle.destroy();
  }

  // Un nuage naît derrière les pieds, dans le rond le plus ancien de la réserve.
  private spawn(now: number, feet: { x: number; y: number }, dir: Direction): void {
    const puff = this.puffs[this.next]!;
    this.next = (this.next + 1) % this.puffs.length;
    this.lastBorn = now;
    puff.bornAt = now;
    const behind = behindFeet(dir);
    puff.circle.setPosition(feet.x + behind.x * BEHIND_PX, feet.y + behind.y * BEHIND_PX).setDepth(feet.y - DEPTH_BELOW).setVisible(true);
  }
}
