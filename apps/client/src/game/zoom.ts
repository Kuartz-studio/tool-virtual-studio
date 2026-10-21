// Le zoom de départ de la caméra est entier : un pixel de la carte devient 1 ou 2 pixels carrés de l'écran, jamais un pixel et
// demi, qui flouterait les tuiles. Le zoom de la personne (ZOOM_FACTORS) ne fait que le doubler ou le diviser par 2 ou 4, des
// puissances de 2 : les tuiles restent nettes (32 px deviennent 64, 16 ou 8 px de l'écran).

// Le canevas le plus petit qui reçoit le zoom ×2.
const ZOOM_X2_MIN_WIDTH = 1280;
const ZOOM_X2_MIN_HEIGHT = 720;

// ×2 si le canevas fait au moins 1280 × 720 pixels, ×1 en dessous.
export function chooseZoom(width: number, height: number): 1 | 2 {
  return width >= ZOOM_X2_MIN_WIDTH && height >= ZOOM_X2_MIN_HEIGHT ? 2 : 1;
}

export interface Size {
  width: number;
  height: number;
}

export interface Bounds extends Size {
  x: number;
  y: number;
}

// Les bornes de la caméra (camera.setBounds), en pixels de la carte, pour une carte de `map` pixels vue dans un canevas de
// `canvas` pixels, à ce zoom.
//
// Sur chaque axe, une carte plus grande que la vue se parcourt en entier : les bornes sont la carte. Une carte plus petite que
// la vue n'a rien à parcourir, mais Phaser la collerait alors en haut à gauche : on donne à la caméra des bornes de la taille de
// la vue, placées pour que la carte soit au milieu.
//
// La marge est un nombre entier de pixels de l'écran (le reste impair va du côté droit ou bas) : le bord de la carte tombe sur un
// pixel de l'écran, pas entre deux.
export function cameraBounds(map: Size, canvas: Size, zoom: number): Bounds {
  const axis = (mapLength: number, canvasLength: number): [start: number, length: number] => {
    if (canvasLength < mapLength * zoom) return [0, mapLength];
    const margin = Math.floor((canvasLength - mapLength * zoom) / 2);
    // `|| 0` : sans marge, −0 / zoom vaut −0, qu'on ne veut pas voir dans les bornes.
    return [-margin / zoom || 0, canvasLength / zoom];
  };
  const [x, width] = axis(map.width, canvas.width);
  const [y, height] = axis(map.height, canvas.height);
  return { x, y, width, height };
}

// Les niveaux de zoom, comme multiples de la vue de départ (chooseZoom) : au plus ×2 plus près, au plus ×4 plus loin, pas davantage (un
// zoom abusif perd la carte ou la rend illisible). Le niveau de départ est celui de 1 : DEFAULT_ZOOM_LEVEL.
export const ZOOM_FACTORS = [0.25, 0.5, 1, 2] as const;
export const DEFAULT_ZOOM_LEVEL = 2;
export const MAX_ZOOM_LEVEL = ZOOM_FACTORS.length - 1;

// Un niveau illisible (NaN) est la vue de départ.
export const clampZoomLevel = (level: number): number => (Number.isNaN(level) ? DEFAULT_ZOOM_LEVEL : Math.min(MAX_ZOOM_LEVEL, Math.max(0, Math.round(level))));

// Un cran de plus près (+1) ou de plus loin (−1), jamais au-delà des bornes.
export const stepZoomLevel = (level: number, step: 1 | -1): number => clampZoomLevel(level + step);

// Le zoom de la caméra : celui de départ du canevas, multiplié par le niveau choisi.
export const cameraZoom = (width: number, height: number, level: number): number => chooseZoom(width, height) * ZOOM_FACTORS[clampZoomLevel(level)]!;

// Le niveau, tel qu'on le montre : 100 % au départ, 200 % au plus près, 25 % au plus loin.
export const zoomPercent = (level: number): number => ZOOM_FACTORS[clampZoomLevel(level)]! * 100;

// Les crans que fait la molette (ou le pincement sur un pavé tactile) : un événement `wheel` peut venir d'une molette crantée (un cran, de
// l'ordre de 100) ou d'un pavé tactile (des dizaines d'événements, de quelques unités chacun, plus l'inertie qui suit le geste). On somme
// ce qui arrive et on ne fait un cran qu'à partir d'un seuil, puis on attend avant le suivant : un geste fait un cran, pas dix.
const WHEEL_STEP_THRESHOLD = 60;
const PINCH_STEP_THRESHOLD = 24;
const WHEEL_STEP_COOLDOWN_MS = 220;
// deltaMode d'un événement `wheel` : 0 pixels, 1 lignes, 2 pages.
const DELTA_LINE_PX = 16;
const DELTA_PAGE_PX = 100;

export class WheelZoom {
  private total = 0;
  private lastStepAt = Number.NEGATIVE_INFINITY;

  // `deltaY` et `deltaMode` : ceux de l'événement ; `pinch` : Ctrl enfoncée (un pincement de pavé tactile, vu comme Ctrl + molette) ;
  // `now` : l'heure, en ms. Renvoie +1 (plus près : la molette vers le haut, ou les doigts qui s'écartent), −1 (plus loin) ou 0 (pas encore un cran).
  feed(deltaY: number, deltaMode: number, pinch: boolean, now: number): 1 | -1 | 0 {
    const pixels = deltaMode === 1 ? deltaY * DELTA_LINE_PX : deltaMode === 2 ? deltaY * DELTA_PAGE_PX : deltaY;
    if (!Number.isFinite(pixels) || pixels === 0) return 0;
    // Un geste dans l'autre sens repart de zéro.
    if (this.total !== 0 && Math.sign(this.total) !== Math.sign(pixels)) this.total = 0;
    this.total += pixels;
    if (now - this.lastStepAt < WHEEL_STEP_COOLDOWN_MS) {
      // Pendant l'attente, on garde la direction mais pas la somme : l'inertie d'un geste fini ne prépare pas un cran de plus.
      this.total = Math.sign(this.total) * Math.min(Math.abs(this.total), (pinch ? PINCH_STEP_THRESHOLD : WHEEL_STEP_THRESHOLD) / 2);
      return 0;
    }
    if (Math.abs(this.total) < (pinch ? PINCH_STEP_THRESHOLD : WHEEL_STEP_THRESHOLD)) return 0;
    const step = this.total < 0 ? 1 : -1;
    this.total = 0;
    this.lastStepAt = now;
    return step;
  }

  reset(): void {
    this.total = 0;
  }
}
