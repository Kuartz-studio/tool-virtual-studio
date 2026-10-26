// Le zoom de départ de la caméra est entier : un pixel de la carte devient 1 ou 2 pixels carrés de l'écran (chooseZoom). La personne le règle
// ensuite en pourcentage, de 25 % à 200 % : 100 %, la vue de départ, est l'ancienne vue de départ aux trois quarts (ZOOM_BASE_FACTOR), soit ×1,5
// à partir de 1280 × 720 et ×0,75 en dessous. Un cran de molette fait 5 %, et la caméra glisse d'un pourcentage à l'autre (easeZoom) au lieu de
// sauter.

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

// La caméra peut sortir de la carte de CAMERA_MARGIN_TILES cases de chaque côté : au bord du monde, elle suit encore l'avatar, qui reste au
// milieu de l'écran au lieu de glisser sous l'interface (la puce du lieu en haut, les barres d'outils en bas) ; au-delà de la carte, on voit le
// fond du jeu.
export const CAMERA_MARGIN_TILES = 10;

// Les bornes de la caméra (camera.setBounds), en pixels de la carte, pour une carte de `map` pixels vue dans un canevas de
// `canvas` pixels, à ce zoom, avec `margin` pixels de carte de débord de chaque côté.
//
// Sur chaque axe, une carte plus grande que la vue se parcourt en entier, et la caméra peut en sortir de `margin` : les bornes sont la
// carte, élargie de la marge. Une carte plus petite que la vue n'a rien à parcourir (elle est tout entière à l'écran : la marge n'y sert
// pas), mais Phaser la collerait alors en haut à gauche : on donne à la caméra des bornes de la taille de la vue, placées pour que la carte
// soit au milieu.
//
// Le décalage qui la centre est un nombre entier de pixels de l'écran (le reste impair va du côté droit ou bas) : le bord de la carte tombe
// sur un pixel de l'écran, pas entre deux.
export function cameraBounds(map: Size, canvas: Size, zoom: number, margin = 0): Bounds {
  const axis = (mapLength: number, canvasLength: number): [start: number, length: number] => {
    // `|| 0` : sans marge, −0 vaut −0, qu'on ne veut pas voir dans les bornes.
    if (canvasLength < mapLength * zoom) return [-margin || 0, mapLength + 2 * margin];
    const offset = Math.floor((canvasLength - mapLength * zoom) / 2);
    return [-offset / zoom || 0, canvasLength / zoom];
  };
  const [x, width] = axis(map.width, canvas.width);
  const [y, height] = axis(map.height, canvas.height);
  return { x, y, width, height };
}

// Les pourcentages de zoom : de 25 % (de loin, au plus) à 200 % (de près, au plus), pas davantage (un zoom abusif perd la carte ou la rend
// illisible). 100 % est la vue de départ : l'ancienne, aux trois quarts. Un cran de molette (ou de pincement) fait 5 %, un clic sur un bouton ou
// une touche + - 10 %.
export const ZOOM_BASE_FACTOR = 0.75;
export const ZOOM_MIN_PERCENT = 25;
export const ZOOM_MAX_PERCENT = 200;
export const ZOOM_DEFAULT_PERCENT = 100;
export const ZOOM_WHEEL_STEP = 5;
export const ZOOM_BUTTON_STEP = 10;

// Un pourcentage hors bornes est ramené aux bornes, un pourcentage entre deux crans au cran de 5 % le plus proche, un pourcentage illisible
// (NaN) à la vue de départ.
export const clampZoomPercent = (percent: number): number =>
  Number.isNaN(percent) ? ZOOM_DEFAULT_PERCENT : Math.min(ZOOM_MAX_PERCENT, Math.max(ZOOM_MIN_PERCENT, Math.round(percent / ZOOM_WHEEL_STEP) * ZOOM_WHEEL_STEP));

// `steps` crans de plus près (positif) ou de plus loin (négatif), chacun de `size` %. Un cran va au pourcentage voisin de la grille de `size`
// dans le sens demandé : 10 % depuis 105 % donne 110 %, depuis 25 % donne 30 %, ce qui ramène à 100 % en remontant du minimum (25, 35, 45
// n'y passeraient jamais). Jamais au-delà des bornes.
export function stepZoomPercent(percent: number, steps: number, size: number = ZOOM_WHEEL_STEP): number {
  const current = clampZoomPercent(percent);
  const count = Math.trunc(steps);
  if (count === 0 || Number.isNaN(count)) return current;
  const next = count > 0 ? (Math.floor(current / size) + count) * size : (Math.ceil(current / size) + count) * size;
  return clampZoomPercent(next);
}

// Le zoom de la caméra : celui de départ du canevas, aux trois quarts, multiplié par le pourcentage choisi.
export const cameraZoom = (width: number, height: number, percent: number): number => (chooseZoom(width, height) * ZOOM_BASE_FACTOR * clampZoomPercent(percent)) / 100;

// Le quart de zoom au-dessus : la résolution d'un texte. Redessiné à chaque quart, et non à chaque image d'un glissement : changer la
// résolution d'un texte le redessine tout entier.
export const ceilToQuarter = (zoom: number): number => Math.ceil(zoom * 4) / 4;

// La résolution d'un texte du monde (l'étiquette d'un nom, celle de la touche E) à ce zoom : au quart de zoom au-dessus, jamais en dessous de 1
// (de loin, le texte est dessiné à sa taille puis réduit, pas pixellisé d'avance).
export const textResolution = (zoom: number): number => Math.max(1, ceilToQuarter(zoom));

// Le glissement de la caméra d'un zoom à l'autre : exponentiel, de constante de temps ZOOM_GLIDE_MS (en cette durée, elle fait 1 − 1/e du
// chemin ; en trois fois plus, 95 %). Il se fait sur le rapport des zooms, et non sur leur différence : de 25 % à 100 % comme de 100 % à 200 %, la vue
// grandit au même rythme. Il ne dépend pas du rythme des images (deux pas de 8 ms valent un pas de 16 ms), ne dépasse jamais la cible, et s'y
// pose pour de bon à 0,1 % près, que l'image suivante n'ait plus rien à bouger.
export const ZOOM_GLIDE_MS = 80;
const ZOOM_SETTLE_RATIO = 0.001;

// Le zoom d'après, `dtMs` plus tard, quand la caméra va de `current` vers `target`. Sans temps écoulé (zéro, négatif, illisible), elle reste ;
// un zoom de départ nul ou illisible, dont le rapport avec la cible n'existe pas, y va tout de suite.
export function easeZoom(current: number, target: number, dtMs: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target) || current <= 0 || target <= 0) return target;
  if (current === target) return target;
  if (!(dtMs > 0)) return current;
  // La distance qui reste, en rapport de zooms (un logarithme), décroît de moitié tous les ZOOM_GLIDE_MS × ln 2.
  const remaining = Math.log(target / current) * Math.exp(-dtMs / ZOOM_GLIDE_MS);
  return Math.abs(remaining) < ZOOM_SETTLE_RATIO ? target : target * Math.exp(-remaining);
}

// Les crans que fait la molette (ou le pincement sur un pavé tactile) : un événement `wheel` peut venir d'une molette crantée (un cran, d'un
// seul événement : 100 px sous Windows, 53 sous Linux, plus quand on la lance) ou d'un pavé tactile (des dizaines d'événements de quelques
// pixels, plus l'inertie qui suit le geste). Un cran de molette fait un cran de 5 % ; un pavé tactile cumule ses petits deltas, un cran
// tous les 25 px, un pincement tous les 8 px (ses deltas sont plus petits). Le reste d'un cran est gardé pour l'événement suivant, jusqu'à
// ce que le geste s'arrête (GESTURE_GAP_MS) ou change de sens.
const WHEEL_NOTCH_MIN_PX = 40;
const TOUCHPAD_PX_PER_STEP = 25;
const PINCH_PX_PER_STEP = 8;
const GESTURE_GAP_MS = 250;

export class WheelZoom {
  private total = 0;
  private lastAt = Number.NEGATIVE_INFINITY;

  // `deltaY` et `deltaMode` : ceux de l'événement (0 pixels, 1 lignes, 2 pages : les lignes et les pages sont toujours celles d'une molette
  // crantée) ; `pinch` : Ctrl enfoncée (un pincement de pavé tactile, vu comme Ctrl + molette) ; `now` : l'heure, en ms. Renvoie les crans de 5 %
  // à faire : positifs vers le plus près (la molette vers le haut, ou les doigts qui s'écartent), négatifs vers le plus loin, 0 tant que le
  // geste n'a pas fait un cran.
  feed(deltaY: number, deltaMode: number, pinch: boolean, now: number): number {
    if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
    const direction = deltaY < 0 ? 1 : -1;
    // Une molette crantée : un cran par événement, quelle que soit la taille de son delta ; ce qu'un pavé tactile avait cumulé s'efface.
    if (deltaMode !== 0 || Math.abs(deltaY) >= WHEEL_NOTCH_MIN_PX) {
      this.total = 0;
      this.lastAt = now;
      return direction;
    }
    // Un geste fini (une pause) ou dans l'autre sens repart de zéro.
    if (now - this.lastAt > GESTURE_GAP_MS || Math.sign(this.total) === -Math.sign(deltaY)) this.total = 0;
    this.lastAt = now;
    this.total += deltaY;
    const perStep = pinch ? PINCH_PX_PER_STEP : TOUCHPAD_PX_PER_STEP;
    const steps = Math.trunc(Math.abs(this.total) / perStep);
    if (steps === 0) return 0;
    this.total -= Math.sign(this.total) * steps * perStep;
    return direction * steps;
  }

  reset(): void {
    this.total = 0;
    this.lastAt = Number.NEGATIVE_INFINITY;
  }
}
