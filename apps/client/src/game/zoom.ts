// Le zoom de la caméra est toujours entier : un pixel de la carte devient 1 ou 2 pixels carrés de l'écran, jamais un pixel et
// demi, qui flouterait les tuiles.

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
