import { TILE_SIZE, type OfficeMap } from '@bureau/shared';
import type { Scene, Textures } from 'phaser';
import { DECOR_DEPTH } from './decor-layout';
import { LABEL_STYLE } from './map-layers';
import { snapToPixels } from './pixel-snap';

// Les panneaux de la carte (zones `sign`) : celui de la salle client, « EN TRAVAUX ». Un panneau de chantier de 24 × 20 pixels, tracé en code comme la plaque
// de l'interrupteur (pas de fichier à charger) : une planche à bandes en biais jaunes et noires dans un cadre sombre, sur deux pieds, avec leur ombre. Posé au
// milieu de la case de sa zone, ses pieds au bas de la case ; son texte est écrit sous lui, comme les inscriptions de la carte.

export const SIGN_TEXTURE = 'sign:works';
export const SIGN = { width: 24, height: 20 } as const;

const PALETTE: Readonly<Record<string, string>> = {
  o: '#2b2433',   // le cadre
  y: '#f7c531',   // une bande jaune
  k: '#2b2433',   // une bande noire
  g: '#6b6477',   // un pied
  s: 'rgba(43, 36, 51, 0.35)',   // l'ombre des pieds, au sol
};

// Le pixel (x, y) du panneau : une lettre de la palette, ou le point (transparent). La planche est de la rangée 0 à la 12, ses bandes de 3 pixels vont en biais
// (jaune quand colonne + rangée vaut moins de 3 modulo 6) ; deux pieds de 3 pixels, de la rangée 13 à la 17 ; leur ombre sur les deux rangées du bas.
function pixelAt(x: number, y: number): string {
  if (y <= 12) {
    const edgeX = x === 0 || x === SIGN.width - 1;
    const edgeY = y === 0 || y === 12;
    if (edgeX && edgeY) return '.';
    if (edgeX || edgeY) return 'o';
    return (x + y) % 6 < 3 ? 'y' : 'k';
  }
  const underBoard = (from: number, to: number) => (x >= from && x <= to) || (x >= SIGN.width - 1 - to && x <= SIGN.width - 1 - from);
  if (y <= 17) return underBoard(4, 6) ? 'g' : '.';
  if (y === 18) return underBoard(3, 7) ? 's' : '.';
  return '.';
}

// Les pixels du panneau, rangée par rangée.
export function signRows(): string[] {
  return Array.from({ length: SIGN.height }, (_, y) => Array.from({ length: SIGN.width }, (__, x) => pixelAt(x, y)).join(''));
}

type MakeCanvas = () => HTMLCanvasElement;

// Crée la texture du panneau, sauf si elle existe déjà (le jeu relance la scène à chaque connexion à une autre carte).
export function addSignTexture(textures: Textures.TextureManager, makeCanvas: MakeCanvas = () => document.createElement('canvas')): void {
  if (textures.exists(SIGN_TEXTURE)) return;
  const canvas = makeCanvas();
  canvas.width = SIGN.width;
  canvas.height = SIGN.height;
  const context = canvas.getContext('2d');
  if (context) {
    signRows().forEach((row, y) => {
      [...row].forEach((pixel, x) => {
        const color = PALETTE[pixel];
        if (color === undefined) return;
        context.fillStyle = color;
        context.fillRect(x, y, 1, 1);
      });
    });
  }
  textures.addCanvas(SIGN_TEXTURE, canvas);
}

// Le texte, sous les pieds du panneau : cet espace, en pixels.
const TEXT_GAP = 10;

// Pose les panneaux de la carte : l'image au milieu de la case, les pieds au bas ; son texte dessous. Devant le sol, derrière ce qui est plus bas (comme
// un meuble : sa profondeur est le bas de sa case).
export function addMapSigns(scene: Scene, signs: OfficeMap['signs']): void {
  for (const sign of signs) {
    const centreX = sign.x + sign.width / 2;
    const bottom = sign.y + Math.max(sign.height, TILE_SIZE);
    snapToPixels(scene.add.image(centreX, bottom, SIGN_TEXTURE).setOrigin(0.5, 1)).setDepth(Math.max(bottom, DECOR_DEPTH.wall + 1));
    snapToPixels(scene.add.text(centreX, bottom + TEXT_GAP, sign.text, LABEL_STYLE).setOrigin(0.5)).setDepth(DECOR_DEPTH.floor + 0.1);
  }
}
