import { describe, expect, test } from 'vitest';
import {
  MAP_MARGIN_TILES,
  WheelZoom,
  ZOOM_BASE_FACTOR,
  ZOOM_BUTTON_STEP,
  ZOOM_DEFAULT_PERCENT,
  ZOOM_GLIDE_MS,
  ZOOM_MAX_PERCENT,
  ZOOM_MIN_PERCENT,
  ZOOM_WHEEL_STEP,
  boundZoomPercent,
  cameraZoom,
  ceilToQuarter,
  chooseZoom,
  clampFreeCenter,
  clampZoomFloor,
  clampZoomPercent,
  displayZoomPercent,
  easeZoom,
  freeCameraReach,
  stepZoomPercent,
  textResolution,
  zoomFloorPercent,
  type ZoomGlide,
} from './zoom';

test.each([[1920, 1080, 2], [1280, 720, 2], [1279, 800, 1], [1440, 700, 1]])('chooseZoom(%i, %i) = %i', (w, h, z) => expect(chooseZoom(w, h)).toBe(z));

// La carte de développement : 24 × 16 cases de 32 px. La vraie carte : 81 × 46 cases. La marge : cinq cases, 160 px de carte.
const map = { width: 768, height: 512 };
const office = { width: 2592, height: 1472 };
const MARGIN = MAP_MARGIN_TILES * 32;

// La caméra qui suit l'avatar n'a pas de bornes (Office.ts) : Phaser la centre sur le milieu de l'avatar et zoome autour de ce centre, à tout
// zoom, au bord de la carte comme au milieu (e2e/camera.spec.ts le relève à chaque image). La seule règle qui reste à la caméra est celle de la
// caméra libre, qu'on fait glisser à la souris : son centre va au plus à la marge au-delà de chaque bord de la carte, et moins quand la vue au
// plus près (200 %) en perdrait la carte.
const TILE = 32;
const FULL = { x: MARGIN, y: MARGIN };

describe('freeCameraReach', () => {
  test('la marge de la carte : cinq cases', () => {
    expect(MAP_MARGIN_TILES).toBe(5);
  });

  // [canevas, limite attendue en pixels de carte]. Au plus près, la vue est à ×3 à partir de 1280 × 720, à ×1,5 en dessous : la limite est
  // la moitié de la vue moins une case, jamais plus que la marge (160 px).
  test.each([
    [{ width: 1280, height: 720 }, { x: 160, y: 88 }],
    [{ width: 1440, height: 900 }, { x: 160, y: 118 }],
    [{ width: 1920, height: 1080 }, { x: 160, y: 148 }],
    [{ width: 2560, height: 1440 }, FULL],
    [{ width: 390, height: 844 }, { x: 98, y: 160 }],
    [{ width: 1080, height: 1920 }, { x: 160, y: 160 }],
  ])('dans un canevas de %o : %o', (canvas, reach) => {
    expect(freeCameraReach(canvas, MARGIN, TILE)).toEqual(reach);
  });

  // Le défaut relevé le 29 octobre : sur 1280 × 720, le centre allait à 160 px sous la carte, et à 200 % (une vue de 240 px de carte de haut),
  // l'écran ne montrait que le fond. La limite tient au plus près : à tout zoom, du plancher à 200 %, la vue centrée sur un coin de la limite
  // garde au moins une case de carte sur chaque axe.
  test('à tout zoom, la vue centrée à la limite garde au moins une case de la carte, sur chaque axe', () => {
    for (const canvas of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }, { width: 800, height: 600 }]) {
      const reach = freeCameraReach(canvas, MARGIN, TILE);
      for (const percent of [ZOOM_MIN_PERCENT, 50, ZOOM_DEFAULT_PERCENT, 150, 187.5, ZOOM_MAX_PERCENT]) {
        const zoom = cameraZoom(canvas.width, canvas.height, percent);
        const view = { width: canvas.width / zoom, height: canvas.height / zoom };
        // Au-delà du coin sud-est de la vraie carte : ce qui reste de carte entre le bord gauche (haut) de la vue et le bord est (sud) de la carte.
        const center = clampFreeCenter({ x: 1e6, y: 1e6 }, office, reach);
        expect(office.width - (center.x - view.width / 2), `${canvas.width} × ${canvas.height} à ${percent} %, en largeur`).toBeGreaterThanOrEqual(TILE - 1e-9);
        expect(office.height - (center.y - view.height / 2), `${canvas.width} × ${canvas.height} à ${percent} %, en hauteur`).toBeGreaterThanOrEqual(TILE - 1e-9);
        // Au-delà du coin nord-ouest, de même.
        const north = clampFreeCenter({ x: -1e6, y: -1e6 }, office, reach);
        expect(north.x + view.width / 2).toBeGreaterThanOrEqual(TILE - 1e-9);
        expect(north.y + view.height / 2).toBeGreaterThanOrEqual(TILE - 1e-9);
      }
    }
  });

  test('un canevas minuscule met la limite dans la carte ; un canevas illisible (NaN), au bord de la carte', () => {
    // 120 × 90 : au plus près (×1,5), la vue fait 80 × 60 px de carte, moins de deux cases de haut.
    expect(freeCameraReach({ width: 120, height: 90 }, MARGIN, TILE)).toEqual({ x: 40 - TILE, y: 30 - TILE });
    expect(freeCameraReach({ width: Number.NaN, height: Number.NaN }, MARGIN, TILE)).toEqual({ x: 0, y: 0 });
  });
});

describe('clampFreeCenter', () => {
  test('un centre dans la carte élargie de la limite reste exactement où il est, au bord de cette limite comme au milieu', () => {
    for (const center of [{ x: 384, y: 256 }, { x: 0, y: 0 }, { x: -160, y: -160 }, { x: 768 + 160, y: 512 + 160 }, { x: -159.75, y: 671.5 }, { x: 12.3456, y: 400.001 }]) {
      expect(clampFreeCenter(center, map, FULL)).toEqual(center);
    }
  });

  test('au-delà, il est ramené à la limite, chaque axe à part, et à la sienne', () => {
    // La carte de développement (768 × 512) et toute la marge (160 px) : le centre va de −160 à 928 en largeur, de −160 à 672 en hauteur.
    expect(clampFreeCenter({ x: -500, y: 256 }, map, FULL)).toEqual({ x: -160, y: 256 });
    expect(clampFreeCenter({ x: 2000, y: 256 }, map, FULL)).toEqual({ x: 928, y: 256 });
    expect(clampFreeCenter({ x: 384, y: -1000 }, map, FULL)).toEqual({ x: 384, y: -160 });
    expect(clampFreeCenter({ x: 384, y: 900 }, map, FULL)).toEqual({ x: 384, y: 672 });
    // Dans un coin, les deux axes à la fois ; la vraie carte (2592 × 1472) sur 1280 × 720, où la limite est de 88 px en hauteur.
    expect(clampFreeCenter({ x: -999, y: 9999 }, map, FULL)).toEqual({ x: -160, y: 672 });
    expect(clampFreeCenter({ x: 5000, y: 5000 }, office, { x: 160, y: 88 })).toEqual({ x: 2752, y: 1560 });
    expect(clampFreeCenter({ x: -5000, y: -5000 }, office, { x: 160, y: 88 })).toEqual({ x: -160, y: -88 });
  });

  test('sans marge, la carte elle-même ; une limite négative, dans la carte ; un centre illisible (NaN), ou sans place, au milieu de la carte', () => {
    expect(clampFreeCenter({ x: -10, y: 600 }, map, { x: 0, y: 0 })).toEqual({ x: 0, y: 512 });
    expect(Object.is(clampFreeCenter({ x: -10, y: 256 }, map, { x: 0, y: 0 }).x, -0)).toBe(false);
    expect(clampFreeCenter({ x: -10, y: 600 }, map, { x: -8, y: -12 })).toEqual({ x: 8, y: 500 });
    expect(clampFreeCenter({ x: Number.NaN, y: 100 }, map, FULL)).toEqual({ x: 384, y: 100 });
    expect(clampFreeCenter({ x: 100, y: Number.NaN }, office, FULL)).toEqual({ x: 100, y: 736 });
    expect(clampFreeCenter({ x: 0, y: 0 }, map, { x: -400, y: 0 })).toEqual({ x: 384, y: 0 });
  });
});

// Le plancher du zoom : au plus loin, la vue fait la carte et sa marge (cinq cases au-delà de chaque bord) sur l'axe qui limite, pas plus. Une
// mesure de la vue, la référence du dézoom maximal, et non une limite de ce qu'elle montre : la caméra, qui suit l'avatar sans bornes, montre
// au bord de la carte autant de fond qu'il faut.
describe('zoomFloorPercent', () => {
  // [canevas, plancher attendu (en %), l'axe qui limite]. La vraie carte avec ses marges fait 2912 × 1792 px ; celle de développement,
  // 1088 × 832. Le zoom de départ est ×1,5 à 100 % à partir de 1280 × 720, ×0,75 en dessous (le téléphone).
  const CASES: Record<string, Array<[canvas: { width: number; height: number }, percent: number, axis: 'width' | 'height']>> = {
    office: [
      [{ width: 1440, height: 900 }, 33.482, 'height'],
      [{ width: 1920, height: 1080 }, 43.956, 'width'],
      [{ width: 2560, height: 1440 }, 58.608, 'width'],
      [{ width: 390, height: 844 }, 62.798, 'height'],
    ],
    développement: [
      [{ width: 1440, height: 900 }, 88.235, 'width'],
      [{ width: 1920, height: 1080 }, 117.647, 'width'],
      [{ width: 2560, height: 1440 }, 156.863, 'width'],
      [{ width: 390, height: 844 }, 135.256, 'height'],
    ],
  };
  const SIZES = { office, développement: map };

  test.each(Object.keys(CASES))('carte %s : la formule, et au plancher, une vue de la taille de la carte et de ses deux marges sur l\'axe qui limite, plus petite sur l\'autre', (name) => {
    const mapSize = SIZES[name as keyof typeof SIZES];
    for (const [canvas, percent, axis] of CASES[name]!) {
      const where = `${canvas.width} × ${canvas.height}`;
      const floor = zoomFloorPercent(mapSize, canvas, MARGIN);
      expect(floor, where).toBeCloseTo(percent, 3);
      // La vue au plancher : la carte et ses deux marges sur l'axe qui limite, pas plus sur l'autre.
      const zoom = cameraZoom(canvas.width, canvas.height, floor);
      const other = axis === 'width' ? 'height' : 'width';
      expect(canvas[axis] / zoom, where).toBeCloseTo(mapSize[axis] + 2 * MARGIN, 6);
      expect(canvas[other] / zoom, where).toBeLessThanOrEqual(mapSize[other] + 2 * MARGIN + 1e-6);
    }
  });

  test('plus près que le plancher, la vue est plus petite que la carte et ses deux marges, sur les deux axes, sur les deux cartes et ces écrans', () => {
    for (const mapSize of [office, map]) {
      for (const canvas of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 390, height: 844 }]) {
        const floor = zoomFloorPercent(mapSize, canvas, MARGIN);
        for (let percent = floor; percent <= ZOOM_MAX_PERCENT; percent = stepZoomPercent(percent, 1, ZOOM_WHEEL_STEP, floor)) {
          const zoom = cameraZoom(canvas.width, canvas.height, percent);
          const where = `${mapSize.width} px, ${canvas.width} × ${canvas.height} à ${percent} %`;
          expect(canvas.width / zoom, where).toBeLessThanOrEqual(mapSize.width + 2 * MARGIN + 1e-6);
          expect(canvas.height / zoom, where).toBeLessThanOrEqual(mapSize.height + 2 * MARGIN + 1e-6);
          if (percent === ZOOM_MAX_PERCENT) break;
        }
      }
    }
  });

  test('jamais sous 25 % (le plancher absolu), jamais au-dessus de 200 % ; une carte et un canevas vides : 25 %', () => {
    // Un petit canevas verrait la vraie carte et sa marge de plus loin que 25 % : 11 % sur 200 × 150.
    expect(zoomFloorPercent(office, { width: 200, height: 150 }, MARGIN)).toBe(ZOOM_MIN_PERCENT);
    // Une carte de 4 × 4 cases sur 2560 × 1440 ne s'en approche qu'à 381 %.
    expect(zoomFloorPercent({ width: 128, height: 128 }, { width: 2560, height: 1440 }, MARGIN)).toBe(ZOOM_MAX_PERCENT);
    expect(zoomFloorPercent({ width: 0, height: 0 }, { width: 0, height: 0 }, 0)).toBe(ZOOM_MIN_PERCENT);
    expect([clampZoomFloor(10), clampZoomFloor(33.5), clampZoomFloor(500), clampZoomFloor(Number.NaN)]).toEqual([25, 33.5, 200, 25]);
  });

  test('le plancher exact s\'écrit arrondi au pour-cent', () => {
    expect([displayZoomPercent(33.482), displayZoomPercent(43.956), displayZoomPercent(62.798), displayZoomPercent(100), displayZoomPercent(117.647)]).toEqual([33, 44, 63, 100, 118]);
  });
});

describe('pourcentages de zoom avec un plancher', () => {
  // Le plancher de la vraie carte sur 1440 × 900.
  const FLOOR = zoomFloorPercent(office, { width: 1440, height: 900 }, MARGIN);

  test('un pourcentage sous le plancher y remonte, exactement ; le plancher reste lui-même, et non le cran voisin', () => {
    expect([clampZoomPercent(20, FLOOR), clampZoomPercent(30, FLOOR), clampZoomPercent(FLOOR, FLOOR)]).toEqual([FLOOR, FLOOR, FLOOR]);
    // Au-dessus, le cran de 5 % le plus proche, comme sans plancher.
    expect([clampZoomPercent(34, FLOOR), clampZoomPercent(37, FLOOR), clampZoomPercent(999, FLOOR)]).toEqual([35, 35, 200]);
    // Sans l'arrondir : de quoi poser la caméra au plancher exact.
    expect([boundZoomPercent(20, FLOOR), boundZoomPercent(43.96, FLOOR), boundZoomPercent(Number.NaN, FLOOR)]).toEqual([FLOOR, 43.96, 100]);
  });

  test('un plancher au-dessus de 100 % (une petite carte, un grand écran) : la vue de départ est le plancher', () => {
    const high = zoomFloorPercent(map, { width: 1920, height: 1080 }, MARGIN);
    expect(high).toBeGreaterThan(ZOOM_DEFAULT_PERCENT);
    expect([boundZoomPercent(ZOOM_DEFAULT_PERCENT, high), clampZoomPercent(Number.NaN, high), clampZoomPercent(ZOOM_DEFAULT_PERCENT, high)]).toEqual([high, high, high]);
  });

  test('la vraie carte aussi, sur un écran en portrait ou très large : la vue de départ n\'y est pas 100 %', () => {
    // Un moniteur en portrait (sous 1280 de large : zoom de départ ×1) : la hauteur limite, 1920 / 1792 = ×1,071, soit 142,9 % de ×0,75.
    // Une grande tablette en portrait, 1366 / 1792 = ×0,762 : 101,6 %. Un écran très large (×2), 5120 / 2912 = ×1,758 : 117,2 % de ×1,5.
    const floors = [{ width: 1080, height: 1920 }, { width: 1024, height: 1366 }, { width: 5120, height: 1440 }].map((canvas) => zoomFloorPercent(office, canvas, MARGIN));
    floors.forEach((floor, i) => expect(floor).toBeCloseTo([142.857, 101.637, 117.216][i]!, 3));
    for (const floor of floors) expect(boundZoomPercent(Number.NaN, floor)).toBe(floor);
  });

  test('au plancher, plus loin ne bouge plus ; plus près va au cran suivant de la grille, et l\'on rejoint 100 % en remontant', () => {
    expect([stepZoomPercent(FLOOR, -1, ZOOM_WHEEL_STEP, FLOOR), stepZoomPercent(FLOOR, -1, ZOOM_BUTTON_STEP, FLOOR), stepZoomPercent(100, -1000, ZOOM_WHEEL_STEP, FLOOR)]).toEqual([FLOOR, FLOOR, FLOOR]);
    expect([stepZoomPercent(FLOOR, 1, ZOOM_WHEEL_STEP, FLOOR), stepZoomPercent(FLOOR, 1, ZOOM_BUTTON_STEP, FLOOR), stepZoomPercent(35, -1, ZOOM_WHEEL_STEP, FLOOR)]).toEqual([35, 40, FLOOR]);
    let percent = FLOOR;
    const climb: number[] = [];
    while (percent < ZOOM_DEFAULT_PERCENT) {
      percent = stepZoomPercent(percent, 1, ZOOM_BUTTON_STEP, FLOOR);
      climb.push(percent);
    }
    expect(climb).toEqual([40, 50, 60, 70, 80, 90, 100]);
  });

  test('un pourcentage hors de la grille (un ancien plancher) n\'est pas arrondi avant le cran : 43,96 % + 5 % = 45 %', () => {
    expect([stepZoomPercent(43.96, 1), stepZoomPercent(43.96, -1), stepZoomPercent(43.96, 0)]).toEqual([45, 40, 43.96]);
  });

  test('au plancher, le zoom de la caméra est exactement celui de la carte et de ses marges', () => {
    expect(cameraZoom(1440, 900, FLOOR)).toBeCloseTo(900 / (office.height + 2 * MARGIN), 12);
  });
});

describe('pourcentages de zoom', () => {
  test('les bornes : de 25 % à 200 %, 100 % au départ, 5 % à chaque cran de molette et 10 % à chaque bouton', () => {
    expect([ZOOM_MIN_PERCENT, ZOOM_MAX_PERCENT, ZOOM_DEFAULT_PERCENT, ZOOM_WHEEL_STEP, ZOOM_BUTTON_STEP]).toEqual([25, 200, 100, 5, 10]);
  });

  test('un pourcentage hors bornes est ramené aux bornes, un pourcentage entre deux crans au cran de 5 % le plus proche', () => {
    expect([clampZoomPercent(-3), clampZoomPercent(0), clampZoomPercent(999), clampZoomPercent(Number.POSITIVE_INFINITY), clampZoomPercent(Number.NEGATIVE_INFINITY)]).toEqual([25, 25, 200, 200, 25]);
    expect([clampZoomPercent(103), clampZoomPercent(101), clampZoomPercent(107.6), clampZoomPercent(100)]).toEqual([105, 100, 110, 100]);
  });

  test('un pourcentage illisible (NaN) est la vue de départ', () => {
    expect(clampZoomPercent(Number.NaN)).toBe(ZOOM_DEFAULT_PERCENT);
  });

  test('la vue de départ : 100 % est l\'ancienne vue de départ aux trois quarts', () => {
    expect(ZOOM_BASE_FACTOR).toBe(0.75);
    // 1280 × 720 et plus : l'ancienne vue était au zoom ×2, la nouvelle est à ×1,5. Dessous : de ×1 à ×0,75.
    expect(cameraZoom(1280, 720, 100)).toBe(1.5);
    expect(cameraZoom(1920, 1080, 100)).toBe(1.5);
    expect(cameraZoom(1000, 600, 100)).toBe(0.75);
    expect(cameraZoom(1279, 800, 100)).toBe(0.75);
  });

  test('le zoom de la caméra : celui de départ du canevas, fois les trois quarts, fois le pourcentage', () => {
    expect(cameraZoom(1280, 720, 200)).toBe(3);
    expect(cameraZoom(1280, 720, 50)).toBe(0.75);
    expect(cameraZoom(1280, 720, 25)).toBe(0.375);
    expect(cameraZoom(1000, 600, 200)).toBe(1.5);
    expect(cameraZoom(1000, 600, 25)).toBe(0.1875);
    expect(cameraZoom(1280, 720, 105)).toBeCloseTo(1.575, 12);
  });

  test('le zoom de la caméra ramène lui aussi le pourcentage dans les bornes', () => {
    expect(cameraZoom(1280, 720, 500)).toBe(3);
    expect(cameraZoom(1280, 720, 0)).toBe(0.375);
    expect(cameraZoom(1280, 720, Number.NaN)).toBe(1.5);
  });

  test('un cran de plus près (+) ou de plus loin (−), de 5 % : arrêté aux bornes', () => {
    expect([stepZoomPercent(100, 1), stepZoomPercent(100, -1), stepZoomPercent(100, 3), stepZoomPercent(100, -3)]).toEqual([105, 95, 115, 85]);
    expect([stepZoomPercent(200, 1), stepZoomPercent(25, -1), stepZoomPercent(195, 4), stepZoomPercent(30, -4)]).toEqual([200, 25, 200, 25]);
    expect(stepZoomPercent(100, 1000)).toBe(200);
    expect(stepZoomPercent(100, -1000)).toBe(25);
  });

  test('zéro cran ne change rien (sauf à ramener le pourcentage dans les bornes)', () => {
    expect([stepZoomPercent(100, 0), stepZoomPercent(35, 0), stepZoomPercent(999, 0)]).toEqual([100, 35, 200]);
  });

  test('un cran plus grand (10 % pour les boutons) va au cran voisin de sa grille : on repasse par 100 % depuis le minimum', () => {
    expect([stepZoomPercent(100, 1, ZOOM_BUTTON_STEP), stepZoomPercent(100, -1, ZOOM_BUTTON_STEP), stepZoomPercent(100, 2, ZOOM_BUTTON_STEP)]).toEqual([110, 90, 120]);
    // Entre deux crans : le suivant dans le sens demandé.
    expect([stepZoomPercent(105, 1, ZOOM_BUTTON_STEP), stepZoomPercent(105, -1, ZOOM_BUTTON_STEP)]).toEqual([110, 100]);
    // Le minimum (25 %) n'est pas sur la grille de 10 : en remontant, on y rejoint 30, 40 … 100.
    let percent = ZOOM_MIN_PERCENT;
    const climb: number[] = [];
    while (percent < ZOOM_DEFAULT_PERCENT) {
      percent = stepZoomPercent(percent, 1, ZOOM_BUTTON_STEP);
      climb.push(percent);
    }
    expect(climb).toEqual([30, 40, 50, 60, 70, 80, 90, 100]);
    // Et en descendant, 30 % est suivi du minimum, pas de 20 %.
    expect(stepZoomPercent(30, -1, ZOOM_BUTTON_STEP)).toBe(ZOOM_MIN_PERCENT);
  });

  test('de cran en cran de 5 %, on reste sur des multiples de 5 entre 25 % et 200 %', () => {
    let percent: number = ZOOM_DEFAULT_PERCENT;
    for (const steps of [3, -7, 11, -2, 40, -90, 1, 1, -1, 13]) {
      percent = stepZoomPercent(percent, steps);
      expect(percent % ZOOM_WHEEL_STEP).toBe(0);
      expect(percent).toBeGreaterThanOrEqual(ZOOM_MIN_PERCENT);
      expect(percent).toBeLessThanOrEqual(ZOOM_MAX_PERCENT);
    }
  });
});

describe('ceilToQuarter', () => {
  test('arrondit au quart au-dessus : un texte n\'est redessiné qu\'à chaque quart de zoom, pas à chaque image d\'un glissement', () => {
    expect([ceilToQuarter(1.5), ceilToQuarter(1.51), ceilToQuarter(1.0001), ceilToQuarter(1), ceilToQuarter(3)]).toEqual([1.5, 1.75, 1.25, 1, 3]);
    expect([ceilToQuarter(0.1875), ceilToQuarter(0.375), ceilToQuarter(0.76)]).toEqual([0.25, 0.5, 1]);
  });

  test('un glissement de 1,5 à 1,575 ne passe que par deux résolutions', () => {
    const resolutions = new Set<number>();
    for (let zoom = 1.5; zoom <= 1.575; zoom += 0.005) resolutions.add(ceilToQuarter(zoom));
    expect([...resolutions]).toEqual([1.5, 1.75]);
  });
});

describe('textResolution', () => {
  test('la résolution d\'un texte du monde : au quart de zoom au-dessus, jamais en dessous de 1 (de loin, il est dessiné à sa taille puis réduit)', () => {
    expect([textResolution(1.5), textResolution(1.51), textResolution(3), textResolution(0.75), textResolution(0.1875), textResolution(1)]).toEqual([1.5, 1.75, 3, 1, 1, 1]);
  });
});

describe('easeZoom', () => {
  const FRAME_MS = 1000 / 60;
  const at = (zoom: number, speed = 0): ZoomGlide => ({ zoom, speed });

  // Un glissement image par image vers `target`, depuis `from` à l'arrêt : les zooms de chaque image, jusqu'à ce qu'elle s'y pose.
  function glideFrames(from: number, target: number): number[] {
    let glide = at(from);
    const zooms: number[] = [];
    while ((glide.zoom !== target || glide.speed !== 0) && zooms.length < 200) {
      glide = easeZoom(glide, target, FRAME_MS);
      zooms.push(glide.zoom);
    }
    return zooms;
  }

  test('un ressort amorti juste ce qu\'il faut, de constante de temps ZOOM_GLIDE_MS (50 ms) : au rythme du zoom (le rapport, pas la différence)', () => {
    expect(ZOOM_GLIDE_MS).toBe(50);
    // Depuis l'arrêt, après t : la part du chemin faite est 1 − (1 + t/τ) e^(−t/τ), soit 1 − 2/e à t = τ.
    expect(Math.log(easeZoom(at(1), 2, ZOOM_GLIDE_MS).zoom) / Math.log(2)).toBeCloseTo(1 - 2 * Math.exp(-1), 9);
    // Dans l'autre sens, de 2 à 1 : la part du chemin est celle du rapport (zoom d'arrivée sur zoom de départ), pas celle de la différence.
    expect(Math.log(easeZoom(at(2), 1, ZOOM_GLIDE_MS).zoom / 2) / Math.log(1 / 2)).toBeCloseTo(1 - 2 * Math.exp(-1), 9);
  });

  test('d\'un cran de 5 %, comme l\'exponentielle d\'avant : 95 % du chemin en 250 ms, posé en 300 ms', () => {
    const zooms = glideFrames(1.5, 1.575);
    const done = (zoom: number) => Math.log(zoom / 1.5) / Math.log(1.575 / 1.5);
    const t95 = (zooms.findIndex((zoom) => done(zoom) >= 0.95) + 1) * FRAME_MS;
    expect(t95).toBeGreaterThan(230);
    expect(t95).toBeLessThan(270);
    expect(zooms.length * FRAME_MS).toBeLessThan(320);
  });

  test.each([
    [1.5, 1.575],
    [1.575, 1.5],
    [0.375, 3],
    [3, 0.375],
    [0.1875, 0.75],
  ])('de %s à %s, depuis l\'arrêt : converge vers la cible, sans jamais la dépasser ni revenir en arrière, en moins d\'une seconde à 60 images par seconde', (from, to) => {
    const zooms = glideFrames(from, to);
    let previous = from;
    for (const zoom of zooms) {
      expect(zoom).toBeGreaterThanOrEqual(Math.min(previous, to));
      expect(zoom).toBeLessThanOrEqual(Math.max(previous, to));
      // Et la caméra avance à chaque image, jusqu'à la cible.
      if (zoom !== to) expect(zoom).not.toBe(previous);
      previous = zoom;
    }
    expect(zooms.at(-1)).toBe(to);
    expect(zooms.length).toBeLessThan(60);
  });

  test('sous une molette crantée, un cran de plus ne relance pas le glissement : sa vitesse ne gagne jamais plus d\'un quart d\'une image à l\'autre', () => {
    // Un cran de 5 % toutes les 100 ms, depuis 100 % : la vitesse du zoom (en rapport de zooms par image) au régime établi, de la 4e à la 10e
    // période. L'exponentielle d'avant repartait à pleine vitesse à chaque cran : sa vitesse doublait d'une image à la suivante (+105 %), et
    // allait du simple au triple et demi d'un cran à l'autre.
    let glide = at(1.5);
    let target = 1.5;
    const speeds: number[] = [];
    for (let frame = 0; frame < 120; frame++) {
      if (frame % 6 === 0) target *= 1.05;
      const before = glide.zoom;
      glide = easeZoom(glide, target, FRAME_MS);
      speeds.push(Math.log(glide.zoom / before));
    }
    const steady = speeds.slice(18, 60);
    const mean = steady.reduce((sum, speed) => sum + speed, 0) / steady.length;
    for (let i = 1; i < steady.length; i++) expect(Math.abs(steady[i]! - steady[i - 1]!) / mean, `image ${i + 18}`).toBeLessThan(0.25);
    expect(Math.max(...steady) / Math.min(...steady)).toBeLessThan(2);
  });

  test('on change de sens en route : le zoom ne sort jamais des zooms qu\'on lui a demandés', () => {
    let glide = at(1.5);
    const asked = [1.5];
    for (const [target, frames] of [[3, 4], [0.375, 3], [2.4, 2], [0.375, 1], [3, 5], [1.5, 30]] as const) {
      asked.push(target);
      for (let i = 0; i < frames; i++) {
        glide = easeZoom(glide, target, FRAME_MS);
        expect(glide.zoom).toBeGreaterThanOrEqual(Math.min(...asked));
        expect(glide.zoom).toBeLessThanOrEqual(Math.max(...asked));
      }
    }
  });

  test('le glissement ne dépend pas du rythme des images : deux pas de 8 ms valent un pas de 16 ms, vitesse comprise', () => {
    const twice = easeZoom(easeZoom(at(1), 2, 8), 2, 8);
    const once = easeZoom(at(1), 2, 16);
    expect(twice.zoom).toBeCloseTo(once.zoom, 12);
    expect(twice.speed).toBeCloseTo(once.speed, 12);
    // Et depuis un glissement en cours (une vitesse), comme deux pas de 4 et 12 ms.
    const moving = at(1.2, 0.004);
    expect(easeZoom(easeZoom(moving, 2, 8), 2, 8).zoom).toBeCloseTo(easeZoom(easeZoom(moving, 2, 4), 2, 12).zoom, 12);
  });

  test('un onglet resté en arrière-plan (un pas de plusieurs secondes) arrive tout de suite, à l\'arrêt', () => {
    expect(easeZoom(at(1, 0.01), 2, 60_000)).toEqual(at(2));
    expect(easeZoom(at(3), 0.375, Number.POSITIVE_INFINITY)).toEqual(at(0.375));
  });

  test('sans temps écoulé (zéro, négatif, illisible), elle reste où elle est', () => {
    const moving = at(1.5, 0.002);
    expect([easeZoom(moving, 3, 0), easeZoom(moving, 3, -5), easeZoom(moving, 3, Number.NaN)]).toEqual([moving, moving, moving]);
  });

  test('déjà à la cible, à l\'arrêt : elle y reste', () => {
    expect(easeZoom(at(1.5), 1.5, FRAME_MS)).toEqual(at(1.5));
  });

  test('à la cible mais encore en mouvement (on vient de changer de sens) : elle la dépasse un peu, puis y revient', () => {
    let glide = easeZoom(at(1.5, 0.003), 1.5, FRAME_MS);
    expect(glide.zoom).toBeGreaterThan(1.5);
    for (let i = 0; i < 60 && glide.speed !== 0; i++) glide = easeZoom(glide, 1.5, FRAME_MS);
    expect(glide).toEqual(at(1.5));
  });

  test('un zoom ou une vitesse illisibles, un zoom nul n\'ont pas de rapport avec la cible : elle y va tout de suite, jamais un NaN', () => {
    expect([easeZoom(at(Number.NaN), 2, FRAME_MS), easeZoom(at(0), 2, FRAME_MS), easeZoom(at(-1), 2, FRAME_MS), easeZoom(at(1, Number.NaN), 2, FRAME_MS)]).toEqual([at(2), at(2), at(2), at(2)]);
  });
});

describe('WheelZoom', () => {
  // `feed` rend des crans de 5 % : positifs vers le plus près (la molette vers le haut, les doigts qui s'écartent), négatifs vers le plus loin.
  test('un cran de molette (100 px) fait un cran de 5 % : vers le haut plus près, vers le bas plus loin', () => {
    expect(new WheelZoom().feed(-100, 0, false, 0)).toBe(1);
    expect(new WheelZoom().feed(100, 0, false, 0)).toBe(-1);
  });

  test('un cran de molette fait un cran quelle que soit sa taille (53 px sous Linux, 120 ou 300 px d\'une molette lancée)', () => {
    expect([53, 120, 300].map((delta) => new WheelZoom().feed(-delta, 0, false, 0))).toEqual([1, 1, 1]);
    expect([53, 120, 300].map((delta) => new WheelZoom().feed(delta, 0, false, 0))).toEqual([-1, -1, -1]);
  });

  test('une molette crantée à la suite : un cran par événement, sans attente', () => {
    const wheel = new WheelZoom();
    expect([0, 16, 32, 48].map((t) => wheel.feed(-100, 0, false, t))).toEqual([1, 1, 1, 1]);
  });

  test('les lignes et les pages sont des crans de molette : un cran par événement', () => {
    expect(new WheelZoom().feed(-3, 1, false, 0)).toBe(1);
    expect(new WheelZoom().feed(3, 1, false, 0)).toBe(-1);
    expect(new WheelZoom().feed(-1, 2, false, 0)).toBe(1);
  });

  test('un pavé tactile cumule ses petits deltas : un cran de 5 % tous les 25 px', () => {
    const wheel = new WheelZoom();
    expect([0, 10, 20, 30].map((t) => wheel.feed(-5, 0, false, t))).toEqual([0, 0, 0, 0]);
    expect(wheel.feed(-5, 0, false, 40)).toBe(1);
    expect(wheel.feed(-5, 0, false, 50)).toBe(0);
  });

  test('le reste d\'un cran n\'est pas perdu : 20 px puis 20 px font un cran, et 15 px de reste', () => {
    const wheel = new WheelZoom();
    expect(wheel.feed(-20, 0, false, 0)).toBe(0);
    expect(wheel.feed(-20, 0, false, 10)).toBe(1);
    expect(wheel.feed(-10, 0, false, 20)).toBe(1);
    expect(wheel.feed(-24, 0, false, 30)).toBe(0);
    expect(wheel.feed(-1, 0, false, 40)).toBe(1);
  });

  test('un pincement (Ctrl + molette) cumule par 8 px : ses deltas sont petits', () => {
    const wheel = new WheelZoom();
    expect([0, 10, 20].map((t) => wheel.feed(-2, 0, true, t))).toEqual([0, 0, 0]);
    expect(wheel.feed(-2, 0, true, 30)).toBe(1);
    // Les mêmes deltas, sans Ctrl, n'atteignent pas le seuil du pavé tactile.
    const touchpad = new WheelZoom();
    expect([0, 10, 20, 30].map((t) => touchpad.feed(-2, 0, false, t))).toEqual([0, 0, 0, 0]);
  });

  test('un grand pincement fait plusieurs crans à la fois', () => {
    expect(new WheelZoom().feed(-30, 0, true, 0)).toBe(3);
    expect(new WheelZoom().feed(30, 0, true, 0)).toBe(-3);
  });

  test('un cran de molette efface ce qu\'un pavé tactile avait cumulé', () => {
    const wheel = new WheelZoom();
    expect(wheel.feed(-20, 0, false, 0)).toBe(0);
    expect(wheel.feed(-100, 0, false, 10)).toBe(1);
    expect(wheel.feed(-10, 0, false, 20)).toBe(0);
  });

  test('un geste dans l\'autre sens repart de zéro', () => {
    const wheel = new WheelZoom();
    expect(wheel.feed(-20, 0, false, 0)).toBe(0);
    expect(wheel.feed(10, 0, false, 10)).toBe(0);
    expect(wheel.feed(20, 0, false, 20)).toBe(-1);
  });

  test('après une pause, un nouveau geste repart de zéro : le reste d\'un geste fini ne s\'ajoute pas au suivant', () => {
    const wheel = new WheelZoom();
    expect(wheel.feed(-20, 0, false, 0)).toBe(0);
    expect(wheel.feed(-10, 0, false, 1_000)).toBe(0);
    expect(wheel.feed(-15, 0, false, 1_010)).toBe(1);
  });

  test('un delta nul ou illisible ne fait rien, et ne dérègle pas la suite', () => {
    const wheel = new WheelZoom();
    expect([wheel.feed(0, 0, false, 0), wheel.feed(Number.NaN, 0, false, 1), wheel.feed(Number.POSITIVE_INFINITY, 0, false, 2)]).toEqual([0, 0, 0]);
    expect(wheel.feed(-25, 0, false, 3)).toBe(1);
  });

  test('reset() vide la somme', () => {
    const wheel = new WheelZoom();
    wheel.feed(-20, 0, false, 0);
    wheel.reset();
    expect(wheel.feed(-10, 0, false, 10)).toBe(0);
  });
});
