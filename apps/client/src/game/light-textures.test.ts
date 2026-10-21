import { describe, expect, test } from 'vitest';
import { bandAlpha, createLightTextures, glowAlpha, LIGHT_TEXTURE_SIZE, LIGHT_TEXTURES, softAlpha } from './light-textures';

describe('les profils de lumière', () => {
  test('bandAlpha : des paliers nets (plein, 0,7, 0,4, rien), pour garder le grain du pixel art', () => {
    expect(bandAlpha(0)).toBe(1);
    expect(bandAlpha(0.5)).toBe(1);
    expect(bandAlpha(0.6)).toBe(0.7);
    expect(bandAlpha(0.8)).toBe(0.4);
    expect(bandAlpha(0.9)).toBe(0);
    expect(bandAlpha(1)).toBe(0);
    expect(bandAlpha(1.4)).toBe(0);
  });

  test('softAlpha : plein jusqu\'à 35 % du rayon, puis un fondu doux jusqu\'au bord', () => {
    expect(softAlpha(0)).toBe(1);
    expect(softAlpha(0.35)).toBe(1);
    expect(softAlpha(0.675)).toBeCloseTo(0.5);
    expect(softAlpha(1)).toBe(0);
    expect(softAlpha(1.2)).toBe(0);
    for (let d = 0; d < 1; d += 0.05) expect(softAlpha(d + 0.05)).toBeLessThanOrEqual(softAlpha(d));
  });

  test('glowAlpha : le halo d\'une lampe, le plus fort au centre, nul au bord, en paliers', () => {
    expect(glowAlpha(0)).toBe(1);
    expect(glowAlpha(1)).toBe(0);
    const levels = new Set<number>();
    for (let d = 0; d <= 1; d += 0.01) {
      expect(glowAlpha(d + 0.01)).toBeLessThanOrEqual(glowAlpha(d));
      levels.add(glowAlpha(d));
    }
    expect(levels.size).toBeLessThanOrEqual(5);
  });
});

describe('createLightTextures', () => {
  // Un canevas qui garde les pixels qu'on y pose, et un gestionnaire de textures de poche.
  function fakeTextures() {
    const added = new Map<string, { width: number; height: number; pixels: Uint8ClampedArray }>();
    const makeCanvas = () => {
      const canvas = {
        width: 0,
        height: 0,
        pixels: new Uint8ClampedArray(0) as Uint8ClampedArray,
        getContext: () => ({
          createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
          putImageData: (image: { data: Uint8ClampedArray }) => {
            canvas.pixels = image.data;
          },
        }),
      };
      return canvas as unknown as HTMLCanvasElement;
    };
    const textures = {
      exists: (key: string) => added.has(key),
      addCanvas: (key: string, canvas: HTMLCanvasElement & { pixels: Uint8ClampedArray }) => {
        added.set(key, { width: canvas.width, height: canvas.height, pixels: canvas.pixels });
      },
    } as unknown as Phaser.Textures.TextureManager;
    return { textures, makeCanvas, added };
  }
  const alphaAt = (texture: { width: number; pixels: Uint8ClampedArray }, x: number, y: number) => texture.pixels[(y * texture.width + x) * 4 + 3]!;

  test('trois disques blancs de 128 px, créés une seule fois', () => {
    const game = fakeTextures();
    createLightTextures(game.textures, game.makeCanvas);
    createLightTextures(game.textures, game.makeCanvas);
    expect([...game.added.keys()]).toEqual([LIGHT_TEXTURES.banded, LIGHT_TEXTURES.soft, LIGHT_TEXTURES.glow]);
    for (const texture of game.added.values()) {
      expect([texture.width, texture.height]).toEqual([LIGHT_TEXTURE_SIZE, LIGHT_TEXTURE_SIZE]);
      const center = LIGHT_TEXTURE_SIZE / 2;
      // Plein au centre, rien dans les coins ; tout est blanc (la couleur vient de la teinte).
      expect(alphaAt(texture, center, center)).toBe(255);
      expect(alphaAt(texture, 0, 0)).toBe(0);
      expect(texture.pixels[(center * texture.width + center) * 4]).toBe(255);
    }
  });

  test('le disque en paliers n\'a que quatre opacités : la lumière tombe par marches nettes', () => {
    const game = fakeTextures();
    createLightTextures(game.textures, game.makeCanvas);
    const banded = game.added.get(LIGHT_TEXTURES.banded)!;
    const alphas = new Set<number>();
    for (let i = 3; i < banded.pixels.length; i += 4) alphas.add(banded.pixels[i]!);
    expect([...alphas].sort((a, b) => a - b)).toEqual([0, 102, 179, 255]);
  });
});
