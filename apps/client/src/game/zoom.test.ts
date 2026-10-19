import { describe, expect, test } from 'vitest';
import { cameraBounds, chooseZoom } from './zoom';

test.each([[1920, 1080, 2], [1280, 720, 2], [1279, 800, 1], [1440, 700, 1]])('chooseZoom(%i, %i) = %i', (w, h, z) => expect(chooseZoom(w, h)).toBe(z));

// La carte de développement : 24 × 16 cases de 32 px.
const map = { width: 768, height: 512 };

describe('cameraBounds', () => {
  test('carte plus grande que la vue : la caméra peut parcourir exactement la carte', () => {
    // 600 × 400 au zoom ×1 : la vue montre 600 × 400 px de carte, sur 768 × 512.
    expect(cameraBounds(map, { width: 600, height: 400 }, 1)).toEqual({ x: 0, y: 0, width: 768, height: 512 });
    // 1280 × 720 au zoom ×2 : la vue montre 640 × 360 px de carte.
    expect(cameraBounds(map, { width: 1280, height: 720 }, 2)).toEqual({ x: 0, y: 0, width: 768, height: 512 });
  });

  test('carte plus petite que la vue : une zone de la taille de la vue, la carte au milieu', () => {
    // ×1 sur 1100 × 760 : 166 px de marge à gauche et 166 à droite (1100 − 768 = 332), 124 en haut et en bas.
    expect(cameraBounds(map, { width: 1100, height: 760 }, 1)).toEqual({ x: -166, y: -124, width: 1100, height: 760 });
    // ×2 sur 1600 × 1100 : la carte fait 1536 × 1024 à l'écran, 32 px de marge de chaque côté et 38 en haut et en bas, soit
    // 16 et 19 px de carte.
    expect(cameraBounds(map, { width: 1600, height: 1100 }, 2)).toEqual({ x: -16, y: -19, width: 800, height: 550 });
  });

  test('chaque axe est traité à part', () => {
    // Large mais pas haute : centrée en largeur, bornée à la carte en hauteur.
    expect(cameraBounds(map, { width: 1600, height: 600 }, 2)).toEqual({ x: -16, y: 0, width: 800, height: 512 });
    // Haute mais pas large.
    expect(cameraBounds(map, { width: 700, height: 1200 }, 1)).toEqual({ x: 0, y: -344, width: 768, height: 1200 });
  });

  test('la vue exactement de la taille de la carte : les bornes sont la carte', () => {
    expect(cameraBounds(map, { width: 768, height: 512 }, 1)).toEqual({ x: 0, y: 0, width: 768, height: 512 });
    expect(cameraBounds(map, { width: 1536, height: 1024 }, 2)).toEqual({ x: 0, y: 0, width: 768, height: 512 });
  });

  test('un reste impair de pixels : le bord de la carte tombe quand même sur un pixel entier de l\'écran', () => {
    const cases: Array<[canvas: { width: number; height: number }, zoom: number]> = [
      [{ width: 1301, height: 801 }, 1],
      [{ width: 999, height: 777 }, 1],
      [{ width: 1537, height: 1025 }, 2],
      [{ width: 1999, height: 1333 }, 2],
    ];
    for (const [canvas, zoom] of cases) {
      const bounds = cameraBounds(map, canvas, zoom);
      // La carte (x = 0) est à −x × zoom pixels du bord gauche de la vue : un entier, sans demi-pixel qui flouterait les tuiles.
      const left = -bounds.x * zoom;
      const top = -bounds.y * zoom;
      expect(Number.isInteger(left), `${canvas.width} × ${canvas.height} ×${zoom} : marge à gauche ${left}`).toBe(true);
      expect(Number.isInteger(top), `${canvas.width} × ${canvas.height} ×${zoom} : marge en haut ${top}`).toBe(true);
      // Et la carte reste au milieu, à un pixel près.
      const right = bounds.width * zoom - left - map.width * zoom;
      const bottom = bounds.height * zoom - top - map.height * zoom;
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
      expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
    }
  });
});
