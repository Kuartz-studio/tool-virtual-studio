import type { GameObjects, Scene } from 'phaser';
import { DEPTH } from './map-layers';
import { snapToPixels } from './pixel-snap';
import { prefersReducedMotion } from './reduced-motion';

// L'anneau de lumière d'un voyage voulu (un mode qui conduit à la salle de sport, puis ramène au bureau) : un trait clair qui s'ouvre et s'efface en RING_LIFE_MS, au point
// que la personne quitte et à celui où elle arrive, pour soi comme pour ceux qui la voient sauter. Une petite réserve de RING_POOL anneaux qu'on réutilise : rien ne s'accumule.
// Ce fichier n'importe de Phaser que des types : la scène lui donne de quoi dessiner.
export const RING_LIFE_MS = 500;
export const RING_START_RADIUS = 6;
export const RING_END_RADIUS = 34;
// Un départ et une arrivée, pour trois voyages à la fois.
export const RING_POOL = 6;
const RING_COLOR = 0xfff3c4;
const RING_START_ALPHA = 0.9;

// Comment est un anneau de cet âge (ms) : son rayon et son opacité ; null s'il n'est pas né, ou s'il a fini. En mouvement réduit, il ne s'ouvre pas (le rayon du milieu) : il
// s'efface seulement.
export function ringAt(age: number, reduced = false): { radius: number; alpha: number } | null {
  if (age < 0 || age >= RING_LIFE_MS) return null;
  const progress = age / RING_LIFE_MS;
  const open = 1 - (1 - progress) ** 2;
  return { radius: reduced ? (RING_START_RADIUS + RING_END_RADIUS) / 2 : RING_START_RADIUS + (RING_END_RADIUS - RING_START_RADIUS) * open, alpha: RING_START_ALPHA * (1 - progress) };
}

export class TeleportEffect {
  private readonly rings: Array<{ circle: GameObjects.Arc; bornAt: number }>;
  private readonly reducedMotion: () => boolean;
  private next = 0;

  constructor(scene: Scene, reducedMotion: () => boolean = prefersReducedMotion) {
    this.reducedMotion = reducedMotion;
    this.rings = Array.from({ length: RING_POOL }, () => ({
      circle: snapToPixels(scene.add.circle(0, 0, RING_START_RADIUS)).setFillStyle().setStrokeStyle(2, RING_COLOR).setDepth(DEPTH.nameTags - 1).setVisible(false),
      bornAt: Number.NEGATIVE_INFINITY,
    }));
  }

  // Un anneau naît à ce point (en pixels de la carte), dans l'anneau le plus ancien de la réserve.
  play(point: { x: number; y: number }, now: number): void {
    const ring = this.rings[this.next]!;
    this.next = (this.next + 1) % this.rings.length;
    ring.bornAt = now;
    const shape = ringAt(0, this.reducedMotion())!;
    ring.circle.setPosition(point.x, point.y).setRadius(shape.radius).setAlpha(shape.alpha).setVisible(true);
  }

  // Combien d'anneaux sont en vie à cet instant (les tests de bout en bout le lisent).
  count(now: number): number {
    return this.rings.filter((ring) => ringAt(now - ring.bornAt) !== null).length;
  }

  // À chaque image : les anneaux nés s'ouvrent et s'effacent, puis se cachent.
  tick(now: number): void {
    const reduced = this.reducedMotion();
    for (const ring of this.rings) {
      const shape = ringAt(now - ring.bornAt, reduced);
      if (shape === null) {
        if (ring.circle.visible) ring.circle.setVisible(false);
        continue;
      }
      ring.circle.setRadius(shape.radius).setAlpha(shape.alpha);
    }
  }

  destroy(): void {
    for (const { circle } of this.rings) circle.destroy();
  }
}
