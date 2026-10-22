import type { GameObjects, Scene, Textures } from 'phaser';
import { snapToPixels } from '../pixel-snap';
import { prefersReducedMotion } from '../reduced-motion';

// La tasse de café : une petite tasse de pixel art à droite de l'étiquette de celui qui a un café, avec de la vapeur qui monte, pour qu'on voie de loin
// qui court. Elle est tracée en code (un pixel par caractère de CUP_PIXELS : X le contour, w la porcelaine, b le café, . le vide), sans fichier d'image,
// comme la bulle de parole (SpeechBubble). L'image est une texture ; les trois nuages de vapeur sont de petits carrés par-dessus, que `tick` fait monter
// en s'effaçant. Ce fichier n'importe de Phaser que des types : la scène lui donne de quoi dessiner.
export const CUP_WIDTH = 9;
export const CUP_HEIGHT = 7;
export const CUP_TEXTURE = 'steam-cup';
// De loin, la tasse ne descend jamais sous cette largeur à l'écran : sa taille (en pixels du dessin, un entier) grossit quand la caméra s'éloigne.
export const CUP_MIN_SCREEN_PX = 12;

// Le contour (la couleur de la pastille du nom et de la bulle), la porcelaine (celle de la bulle), le café.
const OUTLINE = 0x1d2030;
const PORCELAIN = 0xfbf9f2;
const COFFEE = 0x6b4226;
const STEAM_COLOR = 0xffffff;
const CELL_COLORS: Readonly<Record<string, number>> = { X: OUTLINE, w: PORCELAIN, b: COFFEE };

// Le dessin : une tasse de 6 px de large, son anse à droite, sa surface de café sous le bord.
export const CUP_PIXELS: readonly string[] = [
  '.XXXXXX..',
  '.XbbbbX..',
  '.XwwwwXX.',
  '.XwwwwX.X',
  '.XwwwwXX.',
  '..XwwX...',
  '...XX....',
];

// La vapeur : trois nuages de PUFF_SIZE px, aux colonnes 2, 4 et 6 du dessin. Chacun monte de STEAM_RISE_PX pixels du dessin en STEAM_PERIOD_MS en s'effaçant,
// puis repart d'en bas ; ils sont décalés d'un tiers de période l'un de l'autre. Le plus bas est à STEAM_GAP px au-dessus du bord de la tasse.
export const PUFF_SIZE = 2;
export const STEAM_GAP = 1;
export const STEAM_PERIOD_MS = 1200;
export const STEAM_RISE_PX = 6;
const STEAM_COLUMNS = [2, 4, 6] as const;
const STEAM_ALPHA = 0.9;
// En mouvement réduit, la vapeur ne monte pas : trois nuages figés, à ces hauteurs.
const STILL_STEAM = [{ lift: 1, alpha: 0.7 }, { lift: 3, alpha: 0.7 }, { lift: 2, alpha: 0.7 }] as const;

// La taille de la tasse, en pixels du dessin (un entier, pour garder le grain du pixel art) : 1 de près, plus de loin, juste ce qu'il faut pour que sa
// largeur à l'écran (largeur × taille × zoom) fasse au moins CUP_MIN_SCREEN_PX.
export const cupScale = (zoom: number): number => Math.max(1, Math.ceil(CUP_MIN_SCREEN_PX / (CUP_WIDTH * zoom)));

// Où en est le nuage `index` à cet instant : sa hauteur au-dessus de sa place de départ (de 0 à STEAM_RISE_PX − 1 pixels du dessin) et son opacité, de plus
// en plus faible en montant.
export function steamAt(now: number, index: number): { lift: number; alpha: number } {
  const offset = (index * STEAM_PERIOD_MS) / STEAM_COLUMNS.length;
  const phase = ((((now + offset) % STEAM_PERIOD_MS) + STEAM_PERIOD_MS) % STEAM_PERIOD_MS) / STEAM_PERIOD_MS;
  return { lift: Math.floor(phase * STEAM_RISE_PX), alpha: Math.round((1 - phase) * STEAM_ALPHA * 100) / 100 };
}

type MakeCanvas = () => HTMLCanvasElement;

// Crée la texture de la tasse, sauf si elle existe déjà (le jeu relance la scène à chaque connexion à une autre carte, et chaque étiquette en a une).
export function createCupTexture(textures: Textures.TextureManager, makeCanvas: MakeCanvas = () => document.createElement('canvas')): void {
  if (textures.exists(CUP_TEXTURE)) return;
  const canvas = makeCanvas();
  canvas.width = CUP_WIDTH;
  canvas.height = CUP_HEIGHT;
  const context = canvas.getContext('2d');
  if (context) {
    const image = context.createImageData(CUP_WIDTH, CUP_HEIGHT);
    CUP_PIXELS.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        const color = CELL_COLORS[cell];
        if (color === undefined) return;
        const i = (y * CUP_WIDTH + x) * 4;
        image.data[i] = (color >> 16) & 255;
        image.data[i + 1] = (color >> 8) & 255;
        image.data[i + 2] = color & 255;
        image.data[i + 3] = 255;
      });
    });
    context.putImageData(image, 0, 0);
  }
  textures.addCanvas(CUP_TEXTURE, canvas);
}

export interface SteamCupOptions {
  // La personne demande moins de mouvement : la vapeur ne monte pas (prefers-reduced-motion par défaut).
  reducedMotion?: () => boolean;
}

export class SteamCup {
  private readonly image: GameObjects.Image;
  private readonly puffs: GameObjects.Rectangle[];
  private readonly reducedMotion: () => boolean;
  private shown = false;
  private scale = 1;
  // Le coin bas-gauche de la tasse, dans le repère de l'étiquette (pixels de la carte).
  private anchor = { left: 0, bottom: 0 };
  // Où en est chaque nuage, tel que les objets le montrent.
  private steam: Array<{ lift: number; alpha: number }> = STEAM_COLUMNS.map((_, index) => steamAt(0, index));

  constructor(scene: Scene, options: SteamCupOptions = {}) {
    createCupTexture(scene.textures);
    this.reducedMotion = options.reducedMotion ?? prefersReducedMotion;
    this.image = snapToPixels(scene.add.image(0, 0, CUP_TEXTURE).setOrigin(0, 1)).setVisible(false);
    this.puffs = STEAM_COLUMNS.map(() => snapToPixels(scene.add.rectangle(0, 0, PUFF_SIZE, PUFF_SIZE, STEAM_COLOR).setOrigin(0, 0)).setVisible(false));
    this.layout();
  }

  // Les objets de la tasse, que l'étiquette range dans son conteneur.
  get objects(): GameObjects.GameObject[] {
    return [this.image, ...this.puffs];
  }

  get visible(): boolean {
    return this.shown;
  }

  setActive(on: boolean): void {
    this.shown = on;
    this.image.setVisible(on);
    for (const puff of this.puffs) puff.setVisible(on);
  }

  // Le zoom de la caméra a changé : la tasse grossit de loin, pour ne jamais descendre sous CUP_MIN_SCREEN_PX à l'écran.
  setZoom(zoom: number): void {
    const scale = cupScale(zoom);
    if (scale === this.scale) return;
    this.scale = scale;
    this.layout();
  }

  // Pose la tasse : son coin bas-gauche en (left, bottom), dans le repère de l'étiquette.
  placeAt(left: number, bottom: number): void {
    this.anchor = { left, bottom };
    this.layout();
  }

  // À chaque image : la vapeur monte et s'efface. Rien tant que la tasse est cachée ; en mouvement réduit, elle reste figée.
  tick(now: number): void {
    if (!this.shown) return;
    const steam = this.reducedMotion() ? [...STILL_STEAM] : STEAM_COLUMNS.map((_, index) => steamAt(now, index));
    if (steam.every((puff, index) => puff.lift === this.steam[index]!.lift && puff.alpha === this.steam[index]!.alpha)) return;
    this.steam = steam;
    this.layout();
  }

  destroy(): void {
    this.image.destroy();
    for (const puff of this.puffs) puff.destroy();
  }

  // L'image, puis les nuages au-dessus de son bord : à la taille et à la place du moment.
  private layout(): void {
    const { left, bottom } = this.anchor;
    const { scale } = this;
    this.image.setPosition(left, bottom).setScale(scale);
    this.puffs.forEach((puff, index) => {
      const { lift, alpha } = this.steam[index]!;
      puff.setScale(scale).setAlpha(alpha).setPosition(left + STEAM_COLUMNS[index]! * scale, bottom - (CUP_HEIGHT + STEAM_GAP + PUFF_SIZE + lift) * scale);
    });
  }
}
