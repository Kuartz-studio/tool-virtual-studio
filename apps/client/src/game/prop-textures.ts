import { PROPS } from '@bureau/shared';
import type { Animations, Textures } from 'phaser';

// Les planches des objets animés (public/assets/props/<clé>.png) : le Preloader charge chacune comme une planche d'images de la taille d'une
// image du prop ; la scène en tire un sprite (PropLayer), animé en boucle quand le prop tourne.
export const propTextureKey = (key: string): string => `prop:${key}`;
export const propAnimationKey = (key: string): string => `prop:${key}:loop`;

export function propSheets(): Array<{ key: string; url: string; frameWidth: number; frameHeight: number }> {
  return PROPS.map((prop) => ({ key: propTextureKey(prop.key), url: prop.sheet, frameWidth: prop.frameWidth, frameHeight: prop.frameHeight }));
}

// Une animation en boucle par prop qui tourne (pas la porte : elle s'arrête sur l'image qu'on lui demande). Une planche absente (qui n'a pas chargé) est
// laissée de côté : son objet ne se dessine pas, le reste du bureau si. Une animation déjà créée (la scène redémarre) ne l'est pas deux fois.
export function registerPropAnimations(anims: Animations.AnimationManager, textures: Textures.TextureManager): void {
  for (const prop of PROPS) {
    if (!prop.loop || !textures.exists(propTextureKey(prop.key)) || anims.exists(propAnimationKey(prop.key))) continue;
    anims.create({
      key: propAnimationKey(prop.key),
      frames: anims.generateFrameNumbers(propTextureKey(prop.key), { start: 0, end: prop.frames - 1 }),
      frameRate: prop.fps,
      repeat: -1,
    });
  }
}
