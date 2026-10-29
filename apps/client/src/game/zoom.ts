// Le zoom de départ de la caméra est entier : un pixel de la carte devient 1 ou 2 pixels carrés de l'écran (chooseZoom). La personne le règle
// ensuite en pourcentage, du plancher à 200 % : 100 %, la vue de départ, est l'ancienne vue de départ aux trois quarts (ZOOM_BASE_FACTOR), soit
// ×1,5 à partir de 1280 × 720 et ×0,75 en dessous ; le plancher, le plus loin, est la vue où la carte entourée de sa marge de cinq cases tient
// dans le canevas (zoomFloorPercent), et jamais moins de 25 %. Un cran de molette fait 5 %, et la caméra glisse d'un pourcentage à l'autre
// (easeZoom) au lieu de sauter. Elle zoome autour de ce qu'elle suit : l'avatar reste au centre de l'écran, sans bouger d'un pixel (Office.ts).

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

// La marge de référence autour de la carte : cinq cases de chaque côté (dix jusqu'au 29 octobre : Andrea trouvait le vide autour de la carte
// trop grand). Elle ne borne plus la caméra qui suit l'avatar (depuis le 29 octobre, celle-ci n'a plus de bornes : l'avatar reste au centre de
// l'écran partout, et l'on voit au bord autant de fond qu'il faut). Elle ne sert plus qu'à deux choses : le dézoom maximal, où la carte et cette
// marge tiennent dans le canevas (zoomFloorPercent), et la caméra libre, qu'on fait glisser à la souris : son centre va au plus à cette marge
// au-delà de chaque bord de la carte (freeCameraReach, clampFreeCenter). Elle s'appelait CAMERA_MARGIN_TILES quand elle bornait la caméra.
export const MAP_MARGIN_TILES = 5;

export interface Point {
  x: number;
  y: number;
}

// Jusqu'où le centre de la caméra libre (la carte glissée à la souris) va au-delà de chaque bord de la carte, en pixels de carte, sur chaque
// axe, dans un canevas de `canvas` pixels : la marge `margin` (MAP_MARGIN_TILES), sauf si la vue au plus près (200 %, ZOOM_MAX_PERCENT), centrée
// à cette distance, ne montrait plus assez de carte ; la limite s'arrête alors là où il en reste `keep` pixels (une case) dans cette vue. On ne
// perd ainsi jamais la carte de vue, à aucun zoom.
//
// Pourquoi au plus près, et non au zoom du moment : la caméra libre zoome autour du centre de l'écran, sans bouger. Une limite qui suivrait le
// zoom laisserait la carte quitter l'écran quand on zoome après l'avoir glissée au bord (relevé le 29 octobre : à 200 % sur 1280 × 720, la vue
// fait 240 px de carte de haut, et un centre à 160 px sous la carte ne montrait que le fond), ou devrait la tirer vers la carte en zoomant. La
// marge entière tient en largeur sur un écran en paysage ; en hauteur, souvent pas : 88 px de carte (2,75 cases) sur 1280 × 720, 118 sur
// 1440 × 900, 148 sur 1920 × 1080, la marge entière sur 2560 × 1440 ; sur un téléphone de 390 × 844, 98 px en largeur. Une vue au plus près
// de moins de deux cases (un canevas minuscule) met la limite dans la carte (négative) ; un canevas illisible (NaN), au bord de la carte.
export function freeCameraReach(canvas: Size, margin: number, keep: number): Point {
  const zoom = cameraZoom(canvas.width, canvas.height, ZOOM_MAX_PERCENT);
  const axis = (length: number): number => {
    const reach = Math.min(margin, length / 2 / zoom - keep);
    return Number.isNaN(reach) ? 0 : reach;
  };
  return { x: axis(canvas.width), y: axis(canvas.height) };
}

// Le centre de la caméra libre, ramené dans la carte de `map` pixels élargie de `reach` pixels de chaque côté, sur chaque axe (freeCameraReach) :
// on la fait glisser où l'on veut, jusqu'à cette limite. Le zoom ne le change pas (la caméra zoome autour du centre de l'écran), et un point
// déjà dedans reste exactement où il est. Un point illisible (NaN), ou une limite qui ne laisse aucune place (une carte plus petite que ce que
// la limite rentre dedans), va au milieu de la carte.
export function clampFreeCenter(center: Point, map: Size, reach: Point): Point {
  const axis = (value: number, length: number, out: number): number => {
    // `|| 0` : sans marge, −0, qu'on ne veut pas voir dans un centre.
    const low = -out || 0;
    const high = length + out;
    if (Number.isNaN(value) || low > high) return length / 2;
    return Math.min(high, Math.max(low, value));
  };
  return { x: axis(center.x, map.width, reach.x), y: axis(center.y, map.height, reach.y) };
}

// Les pourcentages de zoom : du plancher (de loin, au plus : zoomFloorPercent, jamais sous 25 %) à 200 % (de près, au plus), pas davantage (un
// zoom abusif perd la carte ou la rend illisible). 100 % est la vue de départ : l'ancienne, aux trois quarts. Un cran de molette (ou de
// pincement) fait 5 %, un clic sur un bouton ou une touche + - 10 %.
export const ZOOM_BASE_FACTOR = 0.75;
export const ZOOM_MIN_PERCENT = 25;
export const ZOOM_MAX_PERCENT = 200;
export const ZOOM_DEFAULT_PERCENT = 100;
export const ZOOM_WHEEL_STEP = 5;
export const ZOOM_BUTTON_STEP = 10;

// Le plancher du zoom, en pourcentage, pour une carte de `map` pixels vue dans un canevas de `canvas` pixels, avec `margin` pixels de carte de
// marge (MAP_MARGIN_TILES) : le zoom où la carte et sa marge tiennent tout juste dans le canevas, soit le plus grand des deux rapports
// canevas / (carte + deux marges). Sur l'axe qui limite, la vue y fait exactement la carte et deux marges ; sur l'autre, elle est plus petite.
// C'est une mesure de la vue, et non une règle sur ce qu'elle montre : la caméra suit l'avatar sans bornes, et au bord de la carte, elle montre
// plus de fond que la marge (au plus loin, l'avatar contre le mur est, la moitié de la vue à sa droite).
//
// La vraie carte (81 × 46 cases de 32 px, marge de 5 cases) : 33,5 % sur 1440 × 900, 44 % sur 1920 × 1080, 58,6 % sur 2560 × 1440,
// 62,8 % sur un téléphone de 390 × 844 ; au-dessus de 100 % sur un écran en portrait (142,9 % sur un moniteur de 1 080 × 1 920, 101,6 % sur
// une tablette de 1 024 × 1 366) ou très large (117,2 % sur 5 120 × 1 440) : zoom.test.ts. Jamais sous ZOOM_MIN_PERCENT, qui reste le plancher
// absolu (un petit canevas verrait la carte et sa marge de plus loin encore), ni au-dessus de ZOOM_MAX_PERCENT (une toute petite carte sur un
// grand écran : on ne va pas plus près qu'au plus près). Le plancher exact, et non arrondi à un cran de 5 % : arrondi au-dessus, la vue serait
// plus petite que la carte et sa marge sur l'axe qui limite (3,8 cases de marge à 35 % sur 1440 × 900, au lieu de 5 à 33,5 %), au-dessous,
// plus grande. L'interface l'écrit arrondi au pour-cent (displayZoomPercent).
export function zoomFloorPercent(map: Size, canvas: Size, margin: number): number {
  const zoom = Math.max(canvas.width / (map.width + 2 * margin), canvas.height / (map.height + 2 * margin));
  return clampZoomFloor((100 * zoom) / (chooseZoom(canvas.width, canvas.height) * ZOOM_BASE_FACTOR));
}

// Un plancher ramené entre le plancher absolu et le plus près ; illisible (NaN : une carte et un canevas vides), le plancher absolu.
export const clampZoomFloor = (floor: number): number => (Number.isNaN(floor) ? ZOOM_MIN_PERCENT : Math.min(ZOOM_MAX_PERCENT, Math.max(ZOOM_MIN_PERCENT, floor)));

// Un pourcentage ramené entre le plancher `floor` (25 % s'il n'est pas dit) et 200 %, sans l'arrondir ; illisible (NaN), la vue de départ, ou
// le plancher s'il est au-dessus de 100 % (un écran en portrait ou très large, une petite carte sur un grand écran : la vue de départ est
// alors le plancher).
export function boundZoomPercent(percent: number, floor: number = ZOOM_MIN_PERCENT): number {
  const low = clampZoomFloor(floor);
  if (Number.isNaN(percent)) return Math.max(ZOOM_DEFAULT_PERCENT, low);
  return Math.min(ZOOM_MAX_PERCENT, Math.max(low, percent));
}

// Un pourcentage choisi (setZoomPercent) : ramené entre le plancher et 200 %, et entre deux crans, au cran de 5 % le plus proche. Le plancher,
// qui n'est pas sur la grille (33,48 %), reste exact : un pourcentage à lui ou en dessous le donne tel quel, plutôt que le cran voisin (35 %).
export function clampZoomPercent(percent: number, floor: number = ZOOM_MIN_PERCENT): number {
  const bounded = boundZoomPercent(percent, floor);
  if (bounded <= clampZoomFloor(floor)) return bounded;
  return boundZoomPercent(Math.round(bounded / ZOOM_WHEEL_STEP) * ZOOM_WHEEL_STEP, floor);
}

// `steps` crans de plus près (positif) ou de plus loin (négatif), chacun de `size` %, jamais au-delà du plancher `floor` (25 % s'il n'est pas
// dit) ni de 200 %. Un cran va au pourcentage voisin de la grille de `size` dans le sens demandé : 10 % depuis 105 % donne 110 %, depuis 25 %
// donne 30 %, depuis un plancher de 33,48 % donne 40 %, ce qui ramène à 100 % en remontant du plancher (25, 35, 45 n'y passeraient jamais).
// Le pourcentage du moment n'est pas arrondi d'abord : depuis 43,96 % (un ancien plancher), 5 % de plus donne 45 %, pas 50 %.
export function stepZoomPercent(percent: number, steps: number, size: number = ZOOM_WHEEL_STEP, floor: number = ZOOM_MIN_PERCENT): number {
  const current = boundZoomPercent(percent, floor);
  const count = Math.trunc(steps);
  if (count === 0 || Number.isNaN(count)) return current;
  const next = count > 0 ? (Math.floor(current / size) + count) * size : (Math.ceil(current / size) + count) * size;
  return boundZoomPercent(next, floor);
}

// Le pourcentage tel que l'interface l'écrit : arrondi au pour-cent (le plancher exact, 33,48 %, s'écrit 33 %).
export const displayZoomPercent = (percent: number): number => Math.round(percent);

// Le zoom de la caméra : celui de départ du canevas, aux trois quarts, multiplié par le pourcentage choisi (ramené entre 25 % et 200 %, sans
// l'arrondir : le plancher exact donne une vue de la taille exacte de la carte et de sa marge).
export const cameraZoom = (width: number, height: number, percent: number): number => (chooseZoom(width, height) * ZOOM_BASE_FACTOR * boundZoomPercent(percent)) / 100;

// Le quart de zoom au-dessus : la résolution d'un texte. Redessiné à chaque quart, et non à chaque image d'un glissement : changer la
// résolution d'un texte le redessine tout entier.
export const ceilToQuarter = (zoom: number): number => Math.ceil(zoom * 4) / 4;

// La résolution d'un texte du monde (l'étiquette d'un nom, celle de la touche E) à ce zoom : au quart de zoom au-dessus, jamais en dessous de 1
// (de loin, le texte est dessiné à sa taille puis réduit, pas pixellisé d'avance).
export const textResolution = (zoom: number): number => Math.max(1, ceilToQuarter(zoom));

// Le glissement de la caméra d'un zoom à l'autre : un ressort amorti juste ce qu'il faut (amortissement critique), de constante de temps
// ZOOM_GLIDE_MS. D'un cran, il fait 95 % du chemin en 250 ms et se pose en 300 ms. Il se fait sur le rapport des zooms, et non sur leur
// différence : de 25 % à 100 % comme de 100 % à 200 %, la vue grandit au même rythme. Il ne dépend pas du rythme des images (deux pas de 8 ms
// valent un pas de 16 ms : chaque pas est la solution exacte du ressort), ne dépasse jamais la cible depuis l'arrêt, ne sort jamais des zooms
// qu'on lui a demandés, et s'y pose pour de bon à 0,1 % près, à l'arrêt, que l'image suivante n'ait plus rien à bouger.
//
// Pourquoi un ressort, et non l'exponentielle d'avant (la distance qui reste, divisée par e toutes les 80 ms) : celle-ci repartait à pleine
// vitesse à chaque cran. Sous une molette crantée qui fait un cran toutes les 100 ms, sa vitesse allait du simple au triple et demi d'un cran
// à l'autre, et doublait d'une image à la suivante à chaque cran : un zoom qui avance par saccades. Le ressort, qui ne change de vitesse
// que progressivement, ne va plus que du simple au double, et sans gagner plus d'un quart de sa vitesse d'une image à l'autre ; il arrive
// en autant de temps (mesuré le 29 octobre, à 60 images par seconde).
export const ZOOM_GLIDE_MS = 50;
const ZOOM_SETTLE_RATIO = 0.001;

// Le zoom que la caméra montre, et sa vitesse : celle de son logarithme, par ms (positive vers le plus près).
export interface ZoomGlide {
  zoom: number;
  speed: number;
}

// Où en est le glissement `dtMs` plus tard, quand la caméra va de `glide` vers `target`. Sans temps écoulé (zéro, négatif, illisible), il reste
// où il est ; un zoom nul ou illisible, dont le rapport avec la cible n'existe pas, et un pas assez long pour que le ressort soit arrivé (un
// onglet resté en arrière-plan), vont à la cible tout de suite, à l'arrêt.
export function easeZoom(glide: ZoomGlide, target: number, dtMs: number): ZoomGlide {
  const { zoom, speed } = glide;
  const settled = { zoom: target, speed: 0 };
  if (!Number.isFinite(zoom) || !Number.isFinite(target) || !Number.isFinite(speed) || zoom <= 0 || target <= 0) return settled;
  if (zoom === target && speed === 0) return settled;
  if (!(dtMs > 0)) return glide;
  // e^−40 : le ressort est arrivé, à bien moins de 0,1 % près, et (k × dt) × e^−ωdt ne deviendrait pas l'∞ × 0 d'un pas infini.
  if (dtMs / ZOOM_GLIDE_MS > 40) return settled;
  // L'écart à la cible y (le logarithme du rapport des zooms) et sa vitesse v suivent y'' = −2ωy' − ω²y : pour une cible fixe pendant dt,
  // y(dt) = (y + (v + ωy)·dt)·e^−ωdt, et v(dt) = (v − ω(v + ωy)·dt)·e^−ωdt.
  const omega = 1 / ZOOM_GLIDE_MS;
  const gap = Math.log(zoom / target);
  const decay = Math.exp(-omega * dtMs);
  const k = speed + omega * gap;
  const nextGap = (gap + k * dtMs) * decay;
  const nextSpeed = (speed - omega * k * dtMs) * decay;
  if (Math.abs(nextGap) < ZOOM_SETTLE_RATIO && Math.abs(nextSpeed) * ZOOM_GLIDE_MS < ZOOM_SETTLE_RATIO) return settled;
  return { zoom: target * Math.exp(nextGap), speed: nextSpeed };
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
