import type { GameObjects, Scene } from 'phaser';
import { DEPTH } from './map-layers';
import { prefersReducedMotion } from './reduced-motion';

// La marque d'une course (un double-clic sur le jeu, ou sur la carte du bureau) : sur la case où l'avatar va, deux anneaux qui pulsent au sol, l'un après
// l'autre, et une petite gemme qui tourne sur elle-même en flottant au-dessus, avec son ombre. Elle reste jusqu'à l'arrivée (ou l'arrêt de la course), puis
// disparaît. Par-dessus la nuit, comme l'anneau d'un voyage (TeleportEffect) : on la voit lumière éteinte. Ce fichier n'importe de Phaser que des types.
export const PULSE_MS = 1000;
export const SPIN_MS = 1400;
export const BOB_MS = 1200;
const PULSE_START_RADIUS = 5;
const PULSE_END_RADIUS = 20;
// Un anneau au sol, vu de biais : deux fois plus large que haut.
const FLOOR_RATIO = 0.5;
// La gemme : sa largeur et la hauteur de sa couronne et de sa pointe, en pixels de carte ; elle flotte entre GEM_LIFT et GEM_LIFT + GEM_BOB au-dessus du sol.
const GEM_WIDTH = 14;
const GEM_CROWN = 5;
const GEM_POINT = 11;
const GEM_LIFT = 16;
const GEM_BOB = 4;
const LIGHT = 0xb9f0ff;
const MID = 0x52c7f0;
const DARK = 0x2a86c9;
const OUTLINE = 0x173f6e;

// Un anneau `elapsed` ms après le début de la marque, décalé de `phase` (0 ou ½) : son rayon et son opacité. Il s'ouvre et s'efface en PULSE_MS, puis recommence. En
// mouvement réduit, il ne s'ouvre pas : un anneau fixe, à moitié transparent.
export function pulseAt(elapsed: number, phase: number, reduced = false): { radius: number; alpha: number } {
  if (reduced) return { radius: (PULSE_START_RADIUS + PULSE_END_RADIUS) / 2, alpha: phase === 0 ? 0.6 : 0 };
  const progress = (((elapsed / PULSE_MS + phase) % 1) + 1) % 1;
  const open = 1 - (1 - progress) ** 2;
  return { radius: PULSE_START_RADIUS + (PULSE_END_RADIUS - PULSE_START_RADIUS) * open, alpha: 0.85 * (1 - progress) };
}

// La gemme `elapsed` ms après le début : sa largeur apparente (le cosinus de sa rotation : 1 de face, 0 de profil), le côté qu'elle montre (`front` : la face
// claire), et sa hauteur au-dessus du sol. En mouvement réduit, elle ne tourne ni ne flotte.
export function gemAt(elapsed: number, reduced = false): { width: number; front: boolean; lift: number } {
  if (reduced) return { width: 1, front: true, lift: GEM_LIFT };
  const turn = Math.cos((2 * Math.PI * elapsed) / SPIN_MS);
  const bob = (1 - Math.cos((2 * Math.PI * elapsed) / BOB_MS)) / 2;
  return { width: Math.max(0.15, Math.abs(turn)), front: turn >= 0, lift: GEM_LIFT + GEM_BOB * bob };
}

// Trace ce polygone (des points [x, y]) comme chemin de `g`, fermé : à remplir (fillPath) ou à border (strokePath).
function trace(g: GameObjects.Graphics, points: ReadonlyArray<readonly [number, number]>): GameObjects.Graphics {
  g.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  g.closePath();
  return g;
}

export class WalkMarker {
  private readonly graphics: GameObjects.Graphics;
  private readonly reducedMotion: () => boolean;
  private at: { x: number; y: number } | null = null;
  private startedAt = 0;

  constructor(scene: Scene, reducedMotion: () => boolean = prefersReducedMotion) {
    this.reducedMotion = reducedMotion;
    this.graphics = scene.add.graphics().setDepth(DEPTH.nameTags - 1).setVisible(false);
  }

  // La marque se pose sur ce point (le centre de la case d'arrivée, en pixels de carte) et repart de zéro.
  show(point: { x: number; y: number }, now: number): void {
    this.at = { x: point.x, y: point.y };
    this.startedAt = now;
    this.graphics.setPosition(Math.round(point.x), Math.round(point.y)).setVisible(true);
    this.draw(now);
  }

  hide(): void {
    this.at = null;
    this.graphics.clear().setVisible(false);
  }

  // Est-elle posée ? (les tests de bout en bout le lisent.)
  get shown(): boolean {
    return this.at !== null;
  }

  // À chaque image : les anneaux s'ouvrent, la gemme tourne.
  tick(now: number): void {
    if (this.at !== null) this.draw(now);
  }

  destroy(): void {
    this.graphics.destroy();
  }

  private draw(now: number): void {
    const g = this.graphics.clear();
    const elapsed = now - this.startedAt;
    const reduced = this.reducedMotion();
    for (const phase of [0, 0.5]) {
      const ring = pulseAt(elapsed, phase, reduced);
      if (ring.alpha <= 0) continue;
      g.lineStyle(2, LIGHT, ring.alpha).strokeEllipse(0, 0, ring.radius * 2, ring.radius * 2 * FLOOR_RATIO);
    }
    const gem = gemAt(elapsed, reduced);
    // L'ombre au sol, plus petite quand la gemme monte.
    const shadow = 1 - (gem.lift - GEM_LIFT) / (GEM_BOB * 2);
    g.fillStyle(0x000000, 0.22).fillEllipse(0, 0, GEM_WIDTH * shadow, GEM_WIDTH * shadow * FLOOR_RATIO);
    // La gemme : une couronne (un trapèze) sur une pointe (un triangle), coupées en deux faces, claire et foncée, qui s'échangent quand elle se retourne.
    const half = (GEM_WIDTH / 2) * gem.width;
    const top = -gem.lift - GEM_POINT - GEM_CROWN;
    const girdle = -gem.lift - GEM_POINT;
    const tip = -gem.lift;
    const [left, right] = gem.front ? [LIGHT, MID] : [MID, DARK];
    trace(g.fillStyle(left, 1), [[-half * 0.55, top], [0, top], [0, girdle], [-half, girdle]]).fillPath();
    trace(g.fillStyle(right, 1), [[0, top], [half * 0.55, top], [half, girdle], [0, girdle]]).fillPath();
    g.fillStyle(gem.front ? MID : DARK, 1).fillTriangle(-half, girdle, 0, girdle, 0, tip);
    g.fillStyle(gem.front ? DARK : MID, 1).fillTriangle(0, girdle, half, girdle, 0, tip);
    trace(g.lineStyle(1, OUTLINE, 0.9), [[-half * 0.55, top], [half * 0.55, top], [half, girdle], [0, tip], [-half, girdle]]).strokePath();
    // Un éclat sur la couronne, de face seulement.
    if (gem.front && gem.width > 0.5) g.fillStyle(0xffffff, 0.9).fillRect(Math.round(-half * 0.35), top + 1, 1, 2);
  }
}
