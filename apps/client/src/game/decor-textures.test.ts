import { DECOR_CATEGORIES, DECOR_ITEMS } from '@bureau/shared';
import { expect, test, vi } from 'vitest';
import { decorAtlasImages, decorAtlasesLoaded, decorSprite, decorTextureKey, registerDecorFrames } from './decor-textures';

test('un atlas par catégorie, à l\'adresse où le serveur les sert', () => {
  const images = decorAtlasImages();
  expect(images).toHaveLength(DECOR_CATEGORIES.length);
  expect(images[0]).toEqual({ key: 'decor:ecrans', url: '/assets/decor/ecrans.png' });
});

test('chaque élément devient une image nommée de sa clé dans l\'atlas de sa catégorie ; un atlas absent est laissé de côté', () => {
  const added: Array<[string, string]> = [];
  const textures = {
    exists: (key: string) => key !== decorTextureKey('plantes'),
    get: (key: string) => ({ has: () => false, add: (name: string) => added.push([key, name]) }),
  };
  registerDecorFrames(textures as never);
  expect(added).toHaveLength(DECOR_ITEMS.filter((item) => item.cat !== 'plantes').length);
  expect(added.some(([key]) => key === 'decor:plantes')).toBe(false);
  expect(decorAtlasesLoaded(textures as never)).toBe(false);
});

test('une image déjà découpée ne l\'est pas deux fois', () => {
  const add = vi.fn();
  registerDecorFrames({ exists: () => true, get: () => ({ has: () => true, add }) } as never);
  expect(add).not.toHaveBeenCalled();
});

test('decorSprite : où est l\'image d\'un élément pour l\'interface', () => {
  const item = DECOR_ITEMS[0]!;
  expect(decorSprite(item)).toEqual({ url: `/assets/decor/${item.cat}.png`, x: item.fx, y: item.fy, width: item.w * 32, height: item.h * 32 });
});
