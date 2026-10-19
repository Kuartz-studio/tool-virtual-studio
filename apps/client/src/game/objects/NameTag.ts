import type { Status } from '@bureau/shared';
import type { GameObjects, Scene } from 'phaser';
import { DEPTH } from '../map-layers';
import { snapToPixels } from '../pixel-snap';

// Le nom affiché au-dessus d'une tête : 20 caractères au plus, puis « … ».
export const NAME_MAX_LENGTH = 20;

// La couleur du point de statut (les statuts de la spec : vert, orange, gris, rouge).
export const STATUS_COLORS: Record<Status, number> = {
  available: 0x22c55e,
  busy: 0xf59e0b,
  away: 0x9ca3af,
  dnd: 0xef4444,
};

const graphemes = new Intl.Segmenter('fr', { granularity: 'grapheme' });

// Le nom tel que l'étiquette l'affiche. Les caractères se comptent tels qu'on les voit (une lettre et son accent combinant, un
// emoji fait de plusieurs points de code : un seul), pour ne jamais couper un caractère en deux.
export function displayName(name: string): string {
  const visible = Array.from(graphemes.segment(name), (part) => part.segment);
  if (visible.length <= NAME_MAX_LENGTH) return name;
  return `${visible.slice(0, NAME_MAX_LENGTH).join('').trimEnd()}…`;
}

// Le texte : blanc, sur une pastille sombre. Sa taille est en pixels de la carte ; resolution suit le zoom de la caméra (setZoom) :
// le texte est alors dessiné à la taille où on le voit, net, et pas agrandi pixel par pixel comme la carte.
const TEXT_STYLE = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontSize: '10px',
  color: '#ffffff',
};
const PAD_X = 3;
const PAD_Y = 1;
const DOT_RADIUS = 2.5;
const DOT_GAP = 3;
// L'anneau de la parole, autour du point.
const RING_RADIUS = DOT_RADIUS + 1.5;
const RING_COLOR = 0xffffff;
const BACKGROUND = { color: 0x1d2030, alpha: 0.75 };
// L'espace entre le haut de l'image de l'avatar et le bas de l'étiquette.
const GAP_ABOVE_HEAD = 1;

// L'étiquette au-dessus de la tête d'un avatar : un point de statut (entouré d'un anneau quand la personne parle) et son nom. Elle
// passe devant tout le reste (DEPTH.nameTags). Elle n'importe de Phaser que des types : la scène lui donne de quoi dessiner.
export class NameTag {
  private readonly container: GameObjects.Container;
  private readonly background: GameObjects.Rectangle;
  private readonly label: GameObjects.Text;
  private readonly dot: GameObjects.Arc;
  private readonly ring: GameObjects.Arc;

  constructor(scene: Scene, name: string, status: Status, zoom: number) {
    this.background = snapToPixels(scene.add.rectangle(0, 0, 1, 1, BACKGROUND.color, BACKGROUND.alpha).setOrigin(0, 0));
    this.ring = snapToPixels(scene.add.circle(0, 0, RING_RADIUS).setStrokeStyle(1, RING_COLOR).setVisible(false));
    this.dot = snapToPixels(scene.add.circle(0, 0, DOT_RADIUS, STATUS_COLORS[status]));
    this.label = snapToPixels(scene.add.text(0, 0, displayName(name), { ...TEXT_STYLE, resolution: zoom }).setOrigin(0, 0.5));
    this.container = scene.add.container(0, 0, [this.background, this.ring, this.dot, this.label]).setDepth(DEPTH.nameTags);
    this.layout();
  }

  setName(name: string): void {
    const text = displayName(name);
    if (text === this.label.text) return;
    this.label.setText(text);
    this.layout();
  }

  setStatus(status: Status): void {
    this.dot.setFillStyle(STATUS_COLORS[status]);
  }

  setSpeaking(speaking: boolean): void {
    this.ring.setVisible(speaking);
  }

  // Le zoom de la caméra a changé : le texte est redessiné à la nouvelle taille.
  setZoom(zoom: number): void {
    if (this.label.style.resolution === zoom) return;
    this.label.setResolution(zoom);
    this.layout();
  }

  // Pose l'étiquette au-dessus d'une image d'avatar dont le haut est en (x, top), en pixels de la carte.
  placeAbove(x: number, top: number): void {
    this.container.setPosition(x, top - GAP_ABOVE_HEAD);
  }

  setVisible(visible: boolean): void {
    this.container.setVisible(visible);
  }

  destroy(): void {
    // Le conteneur détruit ses enfants avec lui.
    this.container.destroy();
  }

  // La pastille, centrée sur x, son bas sur l'origine du conteneur : le point, puis le nom.
  private layout(): void {
    const width = PAD_X + 2 * DOT_RADIUS + DOT_GAP + this.label.width + PAD_X;
    const height = Math.max(this.label.height, 2 * RING_RADIUS) + 2 * PAD_Y;
    const left = -Math.round(width / 2);
    this.background.setPosition(left, -height).setSize(width, height);
    const middle = -height / 2;
    this.dot.setPosition(left + PAD_X + DOT_RADIUS, middle);
    this.ring.setPosition(left + PAD_X + DOT_RADIUS, middle);
    this.label.setPosition(left + PAD_X + 2 * DOT_RADIUS + DOT_GAP, middle);
  }
}
