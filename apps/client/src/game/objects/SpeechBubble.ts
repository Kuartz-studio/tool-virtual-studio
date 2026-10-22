import type { GameObjects, Scene, Textures } from 'phaser';
import { snapToPixels } from '../pixel-snap';
import { prefersReducedMotion } from '../reduced-motion';

// La bulle de parole : une petite bulle de pixel art au-dessus de l'étiquette de celui qui parle, avec trois points qui montent l'un après l'autre,
// pour qu'on voie de loin qu'il parle. Elle est tracée en code (un pixel par caractère de BUBBLE_PIXELS : X le contour, o le remplissage, . le vide), sans
// fichier d'image, comme les pochettes d'ambiance. L'image est une texture ; les trois points sont de petits carrés par-dessus, que `tick` fait monter.
// Ce fichier n'importe de Phaser que des types : la scène lui donne de quoi dessiner.
export const BUBBLE_WIDTH = 14;
export const BUBBLE_HEIGHT = 11;
export const BUBBLE_TEXTURE = 'speech-bubble';
// De loin, la bulle ne descend jamais sous cette largeur à l'écran : sa taille (en pixels du dessin, un entier) grossit quand la caméra s'éloigne.
export const BUBBLE_MIN_SCREEN_PX = 16;
// Un point monte pendant ce temps, puis le suivant ; après le troisième, un temps de repos.
export const DOT_STEP_MS = 200;

// Le contour (la couleur de la pastille du nom, TAG_BACKGROUND), le remplissage, et les points (le gris-bleu du texte des étiquettes de la carte).
const OUTLINE = 0x1d2030;
const FILL = 0xffffff;
const DOT_COLOR = 0x3b4256;

// Le dessin : un corps arrondi de 14 × 9 px, et une queue de 3 px qui pointe au milieu du bas, vers la tête.
export const BUBBLE_PIXELS: readonly string[] = [
  '..XXXXXXXXXX..',
  '.XooooooooooX.',
  'XooooooooooooX',
  'XooooooooooooX',
  'XooooooooooooX',
  'XooooooooooooX',
  'XooooooooooooX',
  '.XooooooooooX.',
  '..XXXXoXXXXX..',
  '.....XoX......',
  '......X.......',
];

// Les trois points : des carrés de 2 px, aux colonnes 3, 6 et 9 du dessin, à la ligne 3 ; celui qui monte est une ligne plus haut.
const DOT_SIZE = 2;
const DOT_COLUMNS = [3, 6, 9] as const;
const DOT_ROW = 3;

// La taille de la bulle, en pixels du dessin (un entier, pour garder le grain du pixel art) : 1 de près, plus de loin, juste ce qu'il faut pour que
// sa largeur à l'écran (largeur × taille × zoom) fasse au moins BUBBLE_MIN_SCREEN_PX.
export const bubbleScale = (zoom: number): number => Math.max(1, Math.ceil(BUBBLE_MIN_SCREEN_PX / (BUBBLE_WIDTH * zoom)));

// De combien de pixels du dessin le point `index` est monté à cet instant (1 ou 0) : les trois points montent à tour de rôle, puis un temps de repos.
export const dotLift = (now: number, index: number): number => (Math.floor(now / DOT_STEP_MS) % (DOT_COLUMNS.length + 1) === index ? 1 : 0);

type MakeCanvas = () => HTMLCanvasElement;

// Crée la texture de la bulle, sauf si elle existe déjà (le jeu relance la scène à chaque connexion à une autre carte, et chaque étiquette en a une).
export function createSpeechBubbleTexture(textures: Textures.TextureManager, makeCanvas: MakeCanvas = () => document.createElement('canvas')): void {
  if (textures.exists(BUBBLE_TEXTURE)) return;
  const canvas = makeCanvas();
  canvas.width = BUBBLE_WIDTH;
  canvas.height = BUBBLE_HEIGHT;
  const context = canvas.getContext('2d');
  if (context) {
    const image = context.createImageData(BUBBLE_WIDTH, BUBBLE_HEIGHT);
    BUBBLE_PIXELS.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        const color = cell === 'X' ? OUTLINE : cell === 'o' ? FILL : null;
        if (color === null) return;
        const i = (y * BUBBLE_WIDTH + x) * 4;
        image.data[i] = (color >> 16) & 255;
        image.data[i + 1] = (color >> 8) & 255;
        image.data[i + 2] = color & 255;
        image.data[i + 3] = 255;
      });
    });
    context.putImageData(image, 0, 0);
  }
  textures.addCanvas(BUBBLE_TEXTURE, canvas);
}

export interface SpeechBubbleOptions {
  // La personne demande moins de mouvement : les points ne montent pas (prefers-reduced-motion par défaut).
  reducedMotion?: () => boolean;
}

export class SpeechBubble {
  private readonly image: GameObjects.Image;
  private readonly dots: GameObjects.Rectangle[];
  private readonly reducedMotion: () => boolean;
  private shown = false;
  private scale = 1;
  // Le point où la bulle est posée : le milieu de son bas, dans le repère de l'étiquette (pixels de la carte).
  private anchor = { x: 0, bottom: 0 };
  // Le point qui est monté (0 ou 1 pixel du dessin par point), tel que les objets le montrent.
  private lifts: number[] = DOT_COLUMNS.map(() => 0);

  constructor(scene: Scene, options: SpeechBubbleOptions = {}) {
    createSpeechBubbleTexture(scene.textures);
    this.reducedMotion = options.reducedMotion ?? prefersReducedMotion;
    this.image = snapToPixels(scene.add.image(0, 0, BUBBLE_TEXTURE).setOrigin(0.5, 1)).setVisible(false);
    this.dots = DOT_COLUMNS.map(() => snapToPixels(scene.add.rectangle(0, 0, DOT_SIZE, DOT_SIZE, DOT_COLOR).setOrigin(0, 0)).setVisible(false));
    this.layout();
  }

  // Les objets de la bulle, que l'étiquette range dans son conteneur.
  get objects(): GameObjects.GameObject[] {
    return [this.image, ...this.dots];
  }

  get visible(): boolean {
    return this.shown;
  }

  // Sa hauteur, en pixels de la carte, à la taille du moment.
  get height(): number {
    return BUBBLE_HEIGHT * this.scale;
  }

  setSpeaking(speaking: boolean): void {
    this.shown = speaking;
    this.image.setVisible(speaking);
    for (const dot of this.dots) dot.setVisible(speaking);
  }

  // Le zoom de la caméra a changé : la bulle grossit de loin, pour ne jamais descendre sous BUBBLE_MIN_SCREEN_PX à l'écran.
  setZoom(zoom: number): void {
    const scale = bubbleScale(zoom);
    if (scale === this.scale) return;
    this.scale = scale;
    this.layout();
  }

  // Pose la bulle : le milieu de son bas en (x, bottom), dans le repère de l'étiquette.
  placeAbove(x: number, bottom: number): void {
    this.anchor = { x, bottom };
    this.layout();
  }

  // À chaque image : le point du moment est un pixel du dessin plus haut. Rien tant qu'elle est cachée, ni en mouvement réduit.
  tick(now: number): void {
    if (!this.shown) return;
    const reduced = this.reducedMotion();
    const lifts = DOT_COLUMNS.map((_, index) => (reduced ? 0 : dotLift(now, index)));
    if (lifts.every((lift, index) => lift === this.lifts[index])) return;
    this.lifts = lifts;
    this.layout();
  }

  destroy(): void {
    this.image.destroy();
    for (const dot of this.dots) dot.destroy();
  }

  // L'image, puis les points dans son corps : à la taille et à la place du moment.
  private layout(): void {
    const { x, bottom } = this.anchor;
    const { scale } = this;
    this.image.setPosition(x, bottom).setScale(scale);
    const left = x - (BUBBLE_WIDTH * scale) / 2;
    const top = bottom - BUBBLE_HEIGHT * scale;
    this.dots.forEach((dot, index) => {
      dot.setScale(scale).setPosition(left + DOT_COLUMNS[index]! * scale, top + (DOT_ROW - this.lifts[index]!) * scale);
    });
  }
}
