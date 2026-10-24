import type { GameObjects, Scene } from 'phaser';
import { DEPTH } from './map-layers';
import { TAG_TEXT_STYLE } from './objects/NameTag';
import { snapToPixels } from './pixel-snap';
import { prefersReducedMotion } from './reduced-motion';
import { textResolution } from './zoom';

// Les effets de la progression, au-dessus des avatars :
// - un gain d'XP (le sien) : « +500 XP » qui monte de FLOAT_RISE_PX en FLOAT_LIFE_MS, et s'efface ;
// - une montée de niveau (la sienne, et celle des autres qu'on voit) : une gerbe de STARS étoiles dorées qui jaillit au-dessus de la tête et retombe, et « NIV. 12 »
//   qui monte comme un gain.
// Une petite réserve de chaque, réutilisée : rien ne s'accumule. Avec prefers-reduced-motion, rien ne bouge : le texte paraît puis s'efface, sans étoiles. Ce fichier
// n'importe de Phaser que des types : la scène lui donne de quoi dessiner.
export const FLOAT_LIFE_MS = 1600;
export const FLOAT_RISE_PX = 22;
export const BURST_LIFE_MS = 1100;
export const STARS = 12;
const FLOAT_POOL = 4;
const BURST_POOL = 3;
// La vitesse de départ des étoiles (px/s), leur chute (px/s²), et leurs couleurs : l'or, et le blanc d'une étincelle.
const STAR_SPEED = 70;
const STAR_GRAVITY = 140;
const STAR_COLORS = [0xffd54a, 0xffffff, 0xffb02e] as const;
const GAIN_STYLE = { ...TAG_TEXT_STYLE, fontSize: '9px', fontStyle: 'bold', color: '#ffe08a', stroke: '#1d2030', strokeThickness: 3 };
const LEVEL_STYLE = { ...GAIN_STYLE, fontSize: '11px', color: '#ffd54a' };

// Où en est un texte qui monte, à cet âge (ms) : de combien il est monté et son opacité ; null s'il n'est pas né, ou s'il a fini. Il paraît vite, tient, puis s'efface
// sur le dernier tiers. En mouvement réduit, il ne monte pas.
export function floatAt(age: number, reduced = false): { dy: number; alpha: number } | null {
  if (age < 0 || age >= FLOAT_LIFE_MS) return null;
  const progress = age / FLOAT_LIFE_MS;
  const rise = 1 - (1 - progress) ** 3;
  const alpha = progress < 0.1 ? progress / 0.1 : progress > 2 / 3 ? (1 - progress) * 3 : 1;
  return { dy: reduced ? 0 : -FLOAT_RISE_PX * rise, alpha };
}

// Où est l'étoile n° `index` de la gerbe à cet âge (ms) : son décalage depuis le point de départ et son opacité ; null hors de sa vie. Les étoiles partent en éventail
// vers le haut (de -160° à -20°), chacune un peu plus ou moins vite, puis retombent. En mouvement réduit : aucune.
export function starAt(age: number, index: number, reduced = false): { dx: number; dy: number; alpha: number } | null {
  if (reduced || age < 0 || age >= BURST_LIFE_MS) return null;
  const angle = ((-160 + (140 * index) / (STARS - 1)) * Math.PI) / 180;
  const speed = STAR_SPEED * (0.75 + 0.5 * (((index * 7) % STARS) / STARS));
  const s = age / 1000;
  return { dx: Math.cos(angle) * speed * s, dy: Math.sin(angle) * speed * s + (STAR_GRAVITY * s * s) / 2, alpha: 1 - age / BURST_LIFE_MS };
}

interface Floating {
  text: GameObjects.Text;
  at: { x: number; y: number };
  bornAt: number;
}

interface Burst {
  stars: GameObjects.Rectangle[];
  at: { x: number; y: number };
  bornAt: number;
}

export class ProgressEffects {
  private readonly floats: Floating[];
  private readonly bursts: Burst[];
  private nextFloat = 0;
  private nextBurst = 0;

  constructor(
    scene: Scene,
    zoom: number,
    private readonly reducedMotion: () => boolean = prefersReducedMotion,
  ) {
    this.floats = Array.from({ length: FLOAT_POOL }, () => ({
      text: snapToPixels(scene.add.text(0, 0, '', { ...GAIN_STYLE, resolution: textResolution(zoom) }).setOrigin(0.5, 1)).setDepth(DEPTH.nameTags + 1).setVisible(false),
      at: { x: 0, y: 0 },
      bornAt: Number.NEGATIVE_INFINITY,
    }));
    this.bursts = Array.from({ length: BURST_POOL }, () => ({
      stars: Array.from({ length: STARS }, (_, index) =>
        snapToPixels(scene.add.rectangle(0, 0, index % 3 === 0 ? 3 : 2, index % 3 === 0 ? 3 : 2, STAR_COLORS[index % STAR_COLORS.length]))
          .setDepth(DEPTH.nameTags + 1)
          .setVisible(false),
      ),
      at: { x: 0, y: 0 },
      bornAt: Number.NEGATIVE_INFINITY,
    }));
  }

  // Un texte qui monte de ce point (en pixels de la carte : au-dessus de la tête d'un avatar).
  float(point: { x: number; y: number }, text: string, now: number, style: 'gain' | 'level' = 'gain'): void {
    const floating = this.floats[this.nextFloat]!;
    this.nextFloat = (this.nextFloat + 1) % this.floats.length;
    floating.at = { ...point };
    floating.bornAt = now;
    floating.text.setStyle(style === 'level' ? LEVEL_STYLE : GAIN_STYLE).setText(text).setPosition(point.x, point.y).setAlpha(0).setVisible(true);
  }

  // Une montée de niveau : la gerbe d'étoiles depuis ce point, et le niveau qui monte.
  levelUp(point: { x: number; y: number }, label: string, now: number): void {
    const burst = this.bursts[this.nextBurst]!;
    this.nextBurst = (this.nextBurst + 1) % this.bursts.length;
    burst.at = { ...point };
    burst.bornAt = now;
    this.float({ x: point.x, y: point.y - 10 }, label, now, 'level');
  }

  // Combien d'effets sont en vie à cet instant (les tests de bout en bout le lisent).
  count(now: number): number {
    return this.floats.filter((f) => floatAt(now - f.bornAt) !== null).length + this.bursts.filter((b) => now - b.bornAt >= 0 && now - b.bornAt < BURST_LIFE_MS).length;
  }

  // À chaque image : les textes montent et s'effacent, les étoiles jaillissent et retombent ; ce qui a fini se cache.
  tick(now: number): void {
    const reduced = this.reducedMotion();
    for (const floating of this.floats) {
      const shape = floatAt(now - floating.bornAt, reduced);
      if (shape === null) {
        if (floating.text.visible) floating.text.setVisible(false);
        continue;
      }
      floating.text.setPosition(floating.at.x, floating.at.y + shape.dy).setAlpha(shape.alpha);
    }
    for (const burst of this.bursts) {
      burst.stars.forEach((star, index) => {
        const shape = starAt(now - burst.bornAt, index, reduced);
        if (shape === null) {
          if (star.visible) star.setVisible(false);
          return;
        }
        star.setPosition(burst.at.x + shape.dx, burst.at.y + shape.dy).setAlpha(shape.alpha).setVisible(true);
      });
    }
  }

  // Le zoom de la caméra a changé : les textes se dessinent à la taille où on les voit, nets.
  setZoom(zoom: number): void {
    for (const { text } of this.floats) text.setResolution(textResolution(zoom));
  }

  destroy(): void {
    for (const { text } of this.floats) text.destroy();
    for (const { stars } of this.bursts) for (const star of stars) star.destroy();
  }
}
