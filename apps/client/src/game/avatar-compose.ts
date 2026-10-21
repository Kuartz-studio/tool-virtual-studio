import { CHARACTER_SHEET, parseAvatarKey, type ParsedAvatar } from '@bureau/shared';

// L'assemblage d'un personnage : les pièces du builder (apps/client/public/assets/characters/) se superposent, dans l'ordre du pack (corps,
// yeux, tenue, coiffure, accessoire), sur une planche de 24 images de 32 × 64 px par ligne : l'immobile, puis la marche. Rien ici ne dépend
// de Phaser : le jeu en fait une texture (avatars.ts), l'aperçu du builder le dessine tel quel.

export const CHARACTERS_URL = '/assets/characters';
export const SHEET_WIDTH = CHARACTER_SHEET.columns * CHARACTER_SHEET.frameWidth;
export const SHEET_HEIGHT = CHARACTER_SHEET.rows * CHARACTER_SHEET.frameHeight;

const pad = (n: number): string => String(n).padStart(2, '0');

// Une couche : le fichier (des variantes empilées, de SHEET_HEIGHT de haut chacune) et la variante à y prendre.
export interface Layer {
  url: string;
  row: number;
}

// Les couches d'un personnage, de la plus basse à la plus haute.
export function layersOf(avatar: ParsedAvatar): Layer[] {
  if (avatar.kind === 'premade') return [{ url: `${CHARACTERS_URL}/premade.png`, row: avatar.number - 1 }];
  const { build } = avatar;
  const layers: Layer[] = [
    { url: `${CHARACTERS_URL}/bodies.png`, row: build.body - 1 },
    { url: `${CHARACTERS_URL}/eyes.png`, row: build.eyes - 1 },
    { url: `${CHARACTERS_URL}/outfits/${pad(build.outfit.style)}.png`, row: build.outfit.color - 1 },
  ];
  if (build.hair) layers.push({ url: `${CHARACTERS_URL}/hair/${pad(build.hair.style)}.png`, row: build.hair.color - 1 });
  if (build.accessory) layers.push({ url: `${CHARACTERS_URL}/accessories/${pad(build.accessory.style)}.png`, row: build.accessory.color - 1 });
  return layers;
}

export type ImageLoader = (url: string) => Promise<CanvasImageSource>;

const cache = new Map<string, Promise<CanvasImageSource>>();

// Charge une image une seule fois pour toute la page (les pièces se partagent : tous les corps sont dans le même fichier). Un échec n'est
// pas gardé : la fois suivante réessaie.
export const loadImage: ImageLoader = (url) => {
  let found = cache.get(url);
  if (!found) {
    found = new Promise<CanvasImageSource>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Image introuvable : ${url}`));
      image.src = url;
    });
    found.catch(() => cache.delete(url));
    cache.set(url, found);
  }
  return found;
};

// Dessine le personnage de cette clé sur un canevas de SHEET_WIDTH × SHEET_HEIGHT ; null si la clé n'est pas celle d'un personnage.
export async function composeAvatar(key: string, load: ImageLoader = loadImage, makeCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')): Promise<HTMLCanvasElement | null> {
  const avatar = parseAvatarKey(key);
  if (!avatar) return null;
  const layers = layersOf(avatar);
  const images = await Promise.all(layers.map((layer) => load(layer.url)));
  const canvas = makeCanvas();
  canvas.width = SHEET_WIDTH;
  canvas.height = SHEET_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return null;
  layers.forEach((layer, index) => {
    context.drawImage(images[index]!, 0, layer.row * SHEET_HEIGHT, SHEET_WIDTH, SHEET_HEIGHT, 0, 0, SHEET_WIDTH, SHEET_HEIGHT);
  });
  return canvas;
}
