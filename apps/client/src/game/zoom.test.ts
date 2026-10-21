import { describe, expect, test } from 'vitest';
import { DEFAULT_ZOOM_LEVEL, MAX_ZOOM_LEVEL, WheelZoom, ZOOM_FACTORS, cameraBounds, cameraZoom, chooseZoom, clampZoomLevel, stepZoomLevel, zoomPercent } from './zoom';

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

describe('niveaux de zoom', () => {
  test('au plus ×2 plus près et ×4 plus loin que la vue de départ, qui est le niveau par défaut', () => {
    expect(ZOOM_FACTORS[0]).toBe(1 / 4);
    expect(ZOOM_FACTORS[MAX_ZOOM_LEVEL]).toBe(2);
    expect(ZOOM_FACTORS[DEFAULT_ZOOM_LEVEL]).toBe(1);
  });

  test('chaque cran est une puissance de 2 : les tuiles restent sur des pixels entiers', () => {
    for (const factor of ZOOM_FACTORS) expect(Number.isInteger(Math.log2(factor))).toBe(true);
  });

  test('un cran de plus près ou de plus loin, arrêté aux bornes', () => {
    expect(stepZoomLevel(DEFAULT_ZOOM_LEVEL, 1)).toBe(MAX_ZOOM_LEVEL);
    expect(stepZoomLevel(MAX_ZOOM_LEVEL, 1)).toBe(MAX_ZOOM_LEVEL);
    expect(stepZoomLevel(DEFAULT_ZOOM_LEVEL, -1)).toBe(1);
    expect(stepZoomLevel(0, -1)).toBe(0);
    // Trois crans loin de la vue de départ : ×1/4, pas moins.
    let level: number = DEFAULT_ZOOM_LEVEL;
    for (let i = 0; i < 10; i++) level = stepZoomLevel(level, -1);
    expect(ZOOM_FACTORS[level]).toBe(0.25);
  });

  test('un niveau hors bornes ou fractionnaire est ramené dans les bornes', () => {
    expect([clampZoomLevel(-3), clampZoomLevel(99), clampZoomLevel(1.4), clampZoomLevel(Number.NaN)]).toEqual([0, MAX_ZOOM_LEVEL, 1, DEFAULT_ZOOM_LEVEL]);
  });

  test('le zoom de la caméra : celui de départ du canevas fois le niveau', () => {
    expect(cameraZoom(1920, 1080, DEFAULT_ZOOM_LEVEL)).toBe(2);
    expect(cameraZoom(1920, 1080, MAX_ZOOM_LEVEL)).toBe(4);
    expect(cameraZoom(1920, 1080, 0)).toBe(0.5);
    expect(cameraZoom(1000, 700, DEFAULT_ZOOM_LEVEL)).toBe(1);
    expect(cameraZoom(1000, 700, MAX_ZOOM_LEVEL)).toBe(2);
    expect(cameraZoom(1000, 700, 0)).toBe(0.25);
  });

  test('le pourcentage montré : 100 % au départ', () => {
    expect(ZOOM_FACTORS.map((_, level) => zoomPercent(level))).toEqual([25, 50, 100, 200]);
  });

  test('les bornes de la caméra restent justes à un zoom de moins de 1 : la carte, plus petite que la vue, est au milieu', () => {
    // 768 × 512 à ×0,5 sur 1600 × 1100 : 384 × 256 à l'écran, 608 px de marge de chaque côté et 422 en haut et en bas.
    expect(cameraBounds(map, { width: 1600, height: 1100 }, 0.5)).toEqual({ x: -1216, y: -844, width: 3200, height: 2200 });
  });
});

describe('WheelZoom', () => {
  const NOTCH = 100;

  test('un cran de molette fait un cran de zoom : vers le haut plus près, vers le bas plus loin', () => {
    expect(new WheelZoom().feed(-NOTCH, 0, false, 0)).toBe(1);
    expect(new WheelZoom().feed(NOTCH, 0, false, 0)).toBe(-1);
  });

  test('un petit mouvement de pavé tactile ne suffit pas, la somme du geste si', () => {
    const wheel = new WheelZoom();
    expect(wheel.feed(-20, 0, false, 0)).toBe(0);
    expect(wheel.feed(-20, 0, false, 16)).toBe(0);
    expect(wheel.feed(-30, 0, false, 32)).toBe(1);
  });

  test('le pincement (Ctrl + molette) a un seuil plus bas : ses deltas sont petits', () => {
    expect(new WheelZoom().feed(-30, 0, true, 0)).toBe(1);
    expect(new WheelZoom().feed(-30, 0, false, 0)).toBe(0);
  });

  test('l\'inertie qui suit un geste ne fait pas un second cran tout de suite', () => {
    const wheel = new WheelZoom();
    expect(wheel.feed(-NOTCH, 0, false, 0)).toBe(1);
    for (let t = 16; t < 200; t += 16) expect(wheel.feed(-NOTCH, 0, false, t)).toBe(0);
  });

  test('après l\'attente, un nouveau geste fait un nouveau cran', () => {
    const wheel = new WheelZoom();
    expect(wheel.feed(-NOTCH, 0, false, 0)).toBe(1);
    expect(wheel.feed(-NOTCH, 0, false, 1_000)).toBe(1);
  });

  test('un geste dans l\'autre sens repart de zéro', () => {
    const wheel = new WheelZoom();
    wheel.feed(-50, 0, false, 0);
    expect(wheel.feed(50, 0, false, 10)).toBe(0);
    expect(wheel.feed(20, 0, false, 20)).toBe(-1);
  });

  test('les lignes et les pages comptent comme des pixels : 7 lignes font un cran', () => {
    expect(new WheelZoom().feed(-7, 1, false, 0)).toBe(1);
    expect(new WheelZoom().feed(-1, 2, false, 0)).toBe(1);
  });

  test('un delta nul ou illisible ne fait rien', () => {
    const wheel = new WheelZoom();
    expect([wheel.feed(0, 0, false, 0), wheel.feed(Number.NaN, 0, false, 0), wheel.feed(Number.POSITIVE_INFINITY, 0, false, 0)]).toEqual([0, 0, 0]);
  });
});
