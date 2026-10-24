import { CLOCK_ATLAS, TILE_SIZE, decorItem, timezoneOrDefault } from '@bureau/shared';
import type { Textures } from 'phaser';
import { wallTime } from '../lib/zoned-time';
import { CLOCK_FACES, clockStateKey, paintClock } from './clock-faces';
import { bareFrameOf, decorTextureKey } from './decor-textures';

// Les horloges murales vivantes : chacune est une texture à elle (un canevas de la taille de son image), où le jeu recopie son cadran nu (la seconde
// rangée de l'atlas des horloges) puis peint l'heure de son fuseau, aiguilles, chiffres ou balancier (clock-faces.ts). L'image posée dans la pièce
// (DecorLayer) montre cette texture au lieu de celle de la banque : elle est au pixel près celle des autres éléments, zoom compris, et la nuit
// l'assombrit comme le reste.
//
// L'heure vient de l'horloge du navigateur à chaque image (Date.now) et du fuseau de l'occupant du bureau : rien ne s'accumule, rien ne dérive, et un
// onglet qui revient d'arrière-plan est à l'heure dès sa première image. Une texture n'est repeinte que quand ce qu'elle montre change (une fois par
// seconde pour les aiguilles, deux pour les deux points qui clignotent, à chaque pixel de course du balancier). Deux horloges du même modèle à la même
// heure (le même fuseau) partagent leur texture : elle n'est peinte qu'une fois.

interface LiveClock {
  id: string;
  zone: string;
  texture: Textures.CanvasTexture;
  // Combien d'images de la pièce la montrent : à zéro, la texture est détruite.
  users: number;
  // Ce qu'elle montre (clockStateKey) : rien à repeindre tant qu'il ne change pas.
  state: string;
}

export class WallClocks {
  private readonly live = new Map<string, LiveClock>();

  constructor(private readonly textures: Textures.TextureManager) {}

  // La texture de cette horloge à l'heure de ce fuseau, à montrer par une image de plus : créée et peinte à la première demande, partagée ensuite.
  // Rend sa clé, ou null quand on ne peut pas la peindre (pas d'atlas des horloges : l'image de la banque fera l'affaire).
  acquire(id: string, zone: string, now: number): string | null {
    const known = timezoneOrDefault(zone);
    const key = `horloge:${id}:${known}`;
    let clock = this.live.get(key);
    if (!clock) {
      const item = decorItem(id);
      if (!item || !CLOCK_FACES[id] || !this.textures.exists(decorTextureKey(CLOCK_ATLAS.name))) return null;
      const texture = this.textures.createCanvas(key, item.w * TILE_SIZE, item.h * TILE_SIZE);
      if (!texture) return null;
      clock = { id, zone: known, texture, users: 0, state: '' };
      this.live.set(key, clock);
      this.paint(clock, now);
    }
    clock.users++;
    return key;
  }

  // Une image ne la montre plus.
  release(key: string): void {
    const clock = this.live.get(key);
    if (!clock || --clock.users > 0) return;
    this.live.delete(key);
    clock.texture.destroy();
  }

  // À chaque image : chaque horloge montre l'heure de cet instant (`now`, Date.now()).
  tick(now: number): void {
    for (const clock of this.live.values()) this.paint(clock, now);
  }

  // Les textures vivantes (pour les tests et le débogage) : leur clé.
  keys(): string[] {
    return [...this.live.keys()];
  }

  destroy(): void {
    for (const clock of this.live.values()) clock.texture.destroy();
    this.live.clear();
  }

  private paint(clock: LiveClock, now: number): void {
    const face = CLOCK_FACES[clock.id]!;
    const time = wallTime(clock.zone, now);
    const state = clockStateKey(face, time);
    if (state === clock.state) return;
    clock.state = state;
    const { texture } = clock;
    texture.clear(0, 0, texture.width, texture.height, false);
    texture.drawFrame(decorTextureKey(CLOCK_ATLAS.name), bareFrameOf(clock.id), 0, 0, false);
    const context = texture.context;
    paintClock(face, time, (x, y, color) => {
      context.fillStyle = color;
      context.fillRect(x, y, 1, 1);
    });
    texture.refresh();
  }
}
