import type { Textures } from 'phaser';

// Les textures des lumières de la nuit : des disques blancs dont l'opacité dit la lumière, du centre (d = 0) au bord (d = 1). La couche de nuit
// (LightingLayer) les agrandit à la portée de chaque lumière : `banded` troue l'obscurité autour d'une lampe, `soft` autour d'une personne,
// `glow` est le halo coloré qui brille par-dessus. Créées une fois au chargement (createLightTextures). Ce fichier n'importe de Phaser que des
// types.

export const LIGHT_TEXTURE_SIZE = 128;
export const LIGHT_TEXTURES = { banded: 'light:banded', soft: 'light:soft', glow: 'light:glow' } as const;

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

// La lumière d'une lampe tombe par paliers nets plutôt qu'en dégradé : elle garde le grain du pixel art. Pleine jusqu'à 52 % de la portée,
// puis 0,7, puis 0,4, et rien au-delà de 86 %.
export function bandAlpha(d: number): number {
  if (d < 0.52) return 1;
  if (d < 0.7) return 0.7;
  if (d < 0.86) return 0.4;
  return 0;
}

// Le halo d'une personne, comme dans un Zelda : plein jusqu'à 35 % de la portée, puis un fondu doux jusqu'au bord.
export function softAlpha(d: number): number {
  return 1 - smoothstep(0.35, 1, d);
}

// Le halo coloré d'une lampe : le plus fort au centre (l'ampoule), puis des paliers jusqu'au bord, comme sa lumière.
export function glowAlpha(d: number): number {
  if (d < 0.3) return 1;
  if (d < 0.55) return 0.6;
  if (d < 0.8) return 0.3;
  return 0;
}

const PROFILES: ReadonlyArray<readonly [key: string, alpha: (d: number) => number]> = [
  [LIGHT_TEXTURES.banded, bandAlpha],
  [LIGHT_TEXTURES.soft, softAlpha],
  [LIGHT_TEXTURES.glow, glowAlpha],
];

type MakeCanvas = () => HTMLCanvasElement;

// Crée les trois textures, sauf celles qui existent déjà (le jeu relance la scène à chaque connexion à une autre carte). Chaque pixel est
// blanc ; son opacité est celle du profil à sa distance du centre (prise au milieu du pixel).
export function createLightTextures(textures: Textures.TextureManager, makeCanvas: MakeCanvas = () => document.createElement('canvas')): void {
  const size = LIGHT_TEXTURE_SIZE;
  const half = size / 2;
  for (const [key, alpha] of PROFILES) {
    if (textures.exists(key)) continue;
    const canvas = makeCanvas();
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (context) {
      const image = context.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          image.data[i] = 255;
          image.data[i + 1] = 255;
          image.data[i + 2] = 255;
          image.data[i + 3] = Math.round(alpha(Math.hypot(x + 0.5 - half, y + 0.5 - half) / half) * 255);
        }
      }
      context.putImageData(image, 0, 0);
    }
    textures.addCanvas(key, canvas);
  }
}
