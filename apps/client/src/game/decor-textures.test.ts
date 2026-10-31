import { CLOCK_ATLAS, CLOCK_ITEMS, DECOR_CATALOG, DECOR_CATEGORIES, DECOR_ITEMS, decorAtlasOf, decorItem } from '@bureau/shared';
import { expect, test, vi } from 'vitest';
import { bareFrameOf, decorAtlasImages, decorAtlasesLoaded, decorSprite, decorTextureKey, registerDecorFrames } from './decor-textures';

test('un atlas par catégorie, à l\'adresse où le serveur les sert, celui des horloges murales et celui de la carte seule', () => {
  const images = decorAtlasImages();
  expect(images).toHaveLength(DECOR_CATEGORIES.length + 2);
  expect(images[0]).toEqual({ key: 'decor:ecrans', url: '/assets/decor/ecrans.png' });
  expect(images.slice(-2)).toEqual([
    { key: 'decor:horloges', url: '/assets/decor/horloges.png' },
    { key: 'decor:plan', url: '/assets/decor/plan.png' },
  ]);
});

test('chaque élément devient une image nommée de sa clé dans l\'atlas de sa catégorie ; un atlas absent est laissé de côté', () => {
  const added: Array<[string, string]> = [];
  const textures = {
    exists: (key: string) => key !== decorTextureKey('plantes'),
    get: (key: string) => ({ has: () => false, add: (name: string) => added.push([key, name]) }),
  };
  registerDecorFrames(textures as never);
  // Les horloges ont, en plus, leur cadran nu.
  expect(added).toHaveLength(DECOR_CATALOG.filter((item) => decorAtlasOf(item) !== 'plantes').length + CLOCK_ITEMS.length);
  expect(added.some(([key]) => key === 'decor:plantes')).toBe(false);
  expect(decorAtlasesLoaded(textures as never)).toBe(false);
});

test('les horloges sont découpées dans leur atlas : leur image de la banque, et leur cadran nu une rangée plus bas', () => {
  const added: Array<[string, string, number, number]> = [];
  const textures = {
    exists: () => true,
    get: (key: string) => ({ has: () => false, add: (name: string, _source: number, x: number, y: number) => added.push([key, name, x, y]) }),
  };
  registerDecorFrames(textures as never);
  const gare = decorItem('horloge-gare')!;
  expect(added).toContainEqual(['decor:horloges', 'horloge-gare', gare.fx, gare.fy]);
  expect(added).toContainEqual(['decor:horloges', bareFrameOf('horloge-gare'), gare.fx, gare.fy + CLOCK_ATLAS.bareRowOffset]);
});

test('une image déjà découpée ne l\'est pas deux fois', () => {
  const add = vi.fn();
  registerDecorFrames({ exists: () => true, get: () => ({ has: () => true, add }) } as never);
  expect(add).not.toHaveBeenCalled();
});

test('decorSprite : où est l\'image d\'un élément pour l\'interface', () => {
  const item = DECOR_ITEMS[0]!;
  expect(decorSprite(item)).toEqual({ url: `/assets/decor/${item.cat}.png`, x: item.fx, y: item.fy, width: item.w * 32, height: item.h * 32 });
  const clock = decorItem('horloge-led')!;
  expect(decorSprite(clock)).toEqual({ url: '/assets/decor/horloges.png', x: clock.fx, y: clock.fy, width: 64, height: 32 });
});
