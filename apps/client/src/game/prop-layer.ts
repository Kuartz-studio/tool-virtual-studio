import { propByKey, type Prop } from '@bureau/shared';
import type { GameObjects, Tilemaps } from 'phaser';
import { DECOR_DEPTH } from './decor-layout';
import { prefersReducedMotion } from './reduced-motion';
import { snapToPixels } from './pixel-snap';
import { propAnimationKey, propTextureKey } from './prop-textures';

// Les objets animés de la carte (calque `props`) : la machine à café, la cheminée, les enceintes, le sport, les bougies, l'aquarium. Chacun se dessine
// comme un meuble : le bas de son image est le bas de son empreinte, et plus il est bas dans la carte, plus il est devant. Un objet sans empreinte
// (une bougie au mur) passe juste au-dessus des murs. Les solides arrêtent déjà l'avatar : leurs cases sont dans les collisions de la carte.

export interface PropPlacement {
  key: string;
  prop: Prop;
  // Le coin bas-gauche de l'image, en pixels de la carte.
  left: number;
  bottom: number;
  depth: number;
}

// Un objet du calque `props`, tel que Phaser le donne : le nom est la clé du prop, la position et la taille celles de son empreinte, en pixels. Un objet
// posé sur un meuble dit sa profondeur d'affichage (propriété `depth`), qui le met devant celui-ci.
interface PropObject {
  name: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  properties?: ReadonlyArray<{ name: string; value?: unknown }> | Readonly<Record<string, unknown>>;
}

export function layoutProps(objects: readonly PropObject[]): PropPlacement[] {
  return objects.flatMap((object) => {
    const prop = propByKey(object.name);
    if (!prop) return [];
    const named = (name: string): unknown =>
      Array.isArray(object.properties) ? object.properties.find((p) => p.name === name)?.value : (object.properties as Record<string, unknown> | undefined)?.[name];
    const offsetY = named('offsetY');
    const bottom = (object.y ?? 0) + (object.height ?? 0) + (typeof offsetY === 'number' ? offsetY : 0);
    const given = named('depth');
    const depth = typeof given === 'number' ? given : prop.claim === 0 ? DECOR_DEPTH.wall : bottom;
    return [{ key: prop.key, prop, left: object.x ?? 0, bottom, depth }];
  });
}

// Le rectangle de l'image de chacun, en pixels de la carte : pour les lumières de la nuit (sourcesFromProps).
export function propImages(placements: readonly PropPlacement[]): Array<{ key: string; x: number; y: number; w: number; h: number }> {
  return placements.map(({ key, prop, left, bottom }) => ({ key, x: left, y: bottom - prop.frameHeight, w: prop.frameWidth, h: prop.frameHeight }));
}

export class PropLayer {
  private readonly placements: PropPlacement[];
  private readonly sprites = new Map<string, GameObjects.Sprite[]>();

  constructor(scene: Phaser.Scene, tilemap: Tilemaps.Tilemap) {
    this.placements = layoutProps(tilemap.getObjectLayer('props')?.objects ?? []);
    const still = prefersReducedMotion();
    for (const { key, prop, left, bottom, depth } of this.placements) {
      // Une planche absente (fichier qui n'a pas chargé) : l'objet ne se dessine pas, le reste du bureau si.
      if (!scene.textures.exists(propTextureKey(key))) continue;
      const sprite = snapToPixels(scene.add.sprite(left, bottom, propTextureKey(key), 0).setOrigin(0, 1).setDepth(depth));
      // En mouvement réduit (prefers-reduced-motion) : la première image, sans animation.
      if (prop.loop && !still && scene.anims.exists(propAnimationKey(key))) sprite.play(propAnimationKey(key));
      this.sprites.set(key, [...(this.sprites.get(key) ?? []), sprite]);
    }
  }

  // Les sprites d'un prop (les portes, la musique et le café les animent), dans l'ordre de la carte.
  byKey(key: string): readonly GameObjects.Sprite[] {
    return this.sprites.get(key) ?? [];
  }

  // Le rectangle de l'image de chaque objet posé, pour les lumières de la nuit.
  images(): Array<{ key: string; x: number; y: number; w: number; h: number }> {
    return propImages(this.placements);
  }

  destroy(): void {
    for (const sprites of this.sprites.values()) for (const sprite of sprites) sprite.destroy();
    this.sprites.clear();
  }
}
