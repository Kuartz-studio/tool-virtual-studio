import { describe, expect, test } from 'vitest';
import {
  WheelZoom,
  ZOOM_BASE_FACTOR,
  ZOOM_BUTTON_STEP,
  ZOOM_DEFAULT_PERCENT,
  ZOOM_GLIDE_MS,
  ZOOM_MAX_PERCENT,
  ZOOM_MIN_PERCENT,
  ZOOM_WHEEL_STEP,
  cameraBounds,
  cameraZoom,
  ceilToQuarter,
  chooseZoom,
  clampZoomPercent,
  easeZoom,
  stepZoomPercent,
  textResolution,
} from './zoom';

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

  test('en ZOOM_GLIDE_MS (80 ms), la caméra fait 1 − 1/e du chemin, au rythme du zoom (le rapport, pas la différence)', () => {
    expect(ZOOM_GLIDE_MS).toBe(80);
    expect(Math.log(easeZoom(1, 2, ZOOM_GLIDE_MS)) / Math.log(2)).toBeCloseTo(1 - Math.exp(-1), 9);
    // Dans l'autre sens, de 2 à 1 : la part du chemin faite est celle du rapport (zoom d'arrivée sur zoom de départ), pas celle de la différence.
    expect(Math.log(easeZoom(2, 1, ZOOM_GLIDE_MS) / 2) / Math.log(1 / 2)).toBeCloseTo(1 - Math.exp(-1), 9);
  });

  test.each([
    [1.5, 1.575],
    [1.575, 1.5],
    [0.375, 3],
    [3, 0.375],
    [0.1875, 0.75],
  ])('de %s à %s : converge vers la cible, sans jamais la dépasser, en moins d\'une seconde à 60 images par seconde', (from, to) => {
    let zoom = from;
    let previous = from;
    let frames = 0;
    while (zoom !== to && frames < 200) {
      zoom = easeZoom(zoom, to, FRAME_MS);
      // Toujours entre la valeur d'avant et la cible : ni retour en arrière, ni dépassement.
      expect(zoom).toBeGreaterThanOrEqual(Math.min(previous, to));
      expect(zoom).toBeLessThanOrEqual(Math.max(previous, to));
      // Et la caméra avance à chaque image, jusqu'à la cible.
      if (zoom !== to) expect(zoom).not.toBe(previous);
      previous = zoom;
      frames++;
    }
    expect(zoom).toBe(to);
    expect(frames).toBeLessThan(60);
  });

  test('le glissement ne dépend pas du rythme des images : deux pas de 8 ms valent un pas de 16 ms', () => {
    const twice = easeZoom(easeZoom(1, 2, 8), 2, 8);
    expect(twice).toBeCloseTo(easeZoom(1, 2, 16), 12);
    expect(easeZoom(easeZoom(1, 2, 8), 2, 8)).toBeCloseTo(easeZoom(easeZoom(1, 2, 4), 2, 12), 12);
  });

  test('un onglet resté en arrière-plan (un pas de plusieurs secondes) arrive tout de suite', () => {
    expect(easeZoom(1, 2, 60_000)).toBe(2);
    expect(easeZoom(3, 0.375, Number.POSITIVE_INFINITY)).toBe(0.375);
  });

  test('sans temps écoulé (zéro, négatif, illisible), elle reste où elle est', () => {
    expect([easeZoom(1.5, 3, 0), easeZoom(1.5, 3, -5), easeZoom(1.5, 3, Number.NaN)]).toEqual([1.5, 1.5, 1.5]);
  });

  test('déjà à la cible : la cible', () => {
    expect(easeZoom(1.5, 1.5, FRAME_MS)).toBe(1.5);
  });

  test('un zoom nul ou illisible n\'a pas de rapport avec la cible : elle y va tout de suite, jamais un NaN', () => {
    expect([easeZoom(Number.NaN, 2, FRAME_MS), easeZoom(0, 2, FRAME_MS), easeZoom(-1, 2, FRAME_MS)]).toEqual([2, 2, 2]);
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
