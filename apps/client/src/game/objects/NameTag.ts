import type { ActivityState, Status } from '@bureau/shared';
import type { GameObjects, Scene } from 'phaser';
import { indicatorRgb } from '../../lib/status';
import { DEPTH } from '../map-layers';
import { snapToPixels } from '../pixel-snap';
import { textResolution } from '../zoom';

// Le nom affiché au-dessus d'une tête : 20 caractères au plus, puis « … ».
export const NAME_MAX_LENGTH = 20;

const graphemes = new Intl.Segmenter('fr', { granularity: 'grapheme' });

// Le nom tel que l'étiquette l'affiche. Les caractères se comptent tels qu'on les voit (une lettre et son accent combinant, un
// emoji fait de plusieurs points de code : un seul), pour ne jamais couper un caractère en deux.
export function displayName(name: string): string {
  const visible = Array.from(graphemes.segment(name), (part) => part.segment);
  if (visible.length <= NAME_MAX_LENGTH) return name;
  return `${visible.slice(0, NAME_MAX_LENGTH).join('').trimEnd()}…`;
}

// Le texte : blanc, sur une pastille sombre. Sa taille est en pixels de la carte ; resolution suit le zoom de la caméra (setZoom) :
// le texte est alors dessiné à la taille où on le voit, net, et pas agrandi pixel par pixel comme la carte. Ce que le jeu pose d'autre en
// étiquette (la touche de l'interrupteur, LightSwitch) prend le même style.
export const TAG_TEXT_STYLE = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontSize: '10px',
  color: '#ffffff',
};
export const TAG_PAD_X = 3;
export const TAG_PAD_Y = 1;
export const TAG_BACKGROUND = { color: 0x1d2030, alpha: 0.75 };
const DOT_RADIUS = 2.5;
const DOT_GAP = 3;
// L'anneau de la parole, autour du point.
const RING_RADIUS = DOT_RADIUS + 1.5;
const RING_COLOR = 0xffffff;
// L'espace entre le haut de l'image de l'avatar et le bas de l'étiquette.
const GAP_ABOVE_HEAD = 1;

// L'étiquette au-dessus de la tête d'un avatar : un point de statut (de la couleur de l'état d'activité, ou du statut, STATUS_COLORS : celle du menu des
// statuts et du panneau Personnes aussi), entouré d'un anneau quand la personne parle, et son nom. Elle passe devant tout le reste
// (DEPTH.nameTags). Elle n'importe de Phaser que des types : la scène lui donne de quoi dessiner.
export class NameTag {
  private readonly container: GameObjects.Container;
  private readonly background: GameObjects.Rectangle;
  private readonly label: GameObjects.Text;
  private readonly dot: GameObjects.Arc;
  private readonly ring: GameObjects.Arc;
  private status: Status;
  private activity: ActivityState | null = null;

  constructor(scene: Scene, name: string, status: Status, zoom: number, activity: ActivityState | null = null) {
    this.status = status;
    this.activity = activity;
    this.background = snapToPixels(scene.add.rectangle(0, 0, 1, 1, TAG_BACKGROUND.color, TAG_BACKGROUND.alpha).setOrigin(0, 0));
    this.ring = snapToPixels(scene.add.circle(0, 0, RING_RADIUS).setStrokeStyle(1, RING_COLOR).setVisible(false));
    this.dot = snapToPixels(scene.add.circle(0, 0, DOT_RADIUS, indicatorRgb(status, activity)));
    this.label = snapToPixels(scene.add.text(0, 0, displayName(name), { ...TAG_TEXT_STYLE, resolution: textResolution(zoom) }).setOrigin(0, 0.5));
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
    this.status = status;
    this.paintDot();
  }

  // L'état d'activité de la personne : son point prend la couleur qu'elle a choisie ; null, celle de son statut.
  setActivity(activity: ActivityState | null): void {
    this.activity = activity;
    this.paintDot();
  }

  private paintDot(): void {
    this.dot.setFillStyle(indicatorRgb(this.status, this.activity));
  }

  setSpeaking(speaking: boolean): void {
    this.ring.setVisible(speaking);
  }

  // Le zoom de la caméra a changé : le texte est redessiné à la nouvelle taille, mais seulement quand sa résolution change (au quart de zoom
  // au-dessus, jamais en dessous de 1 : textResolution), pas à chaque image d'un glissement.
  setZoom(zoom: number): void {
    const resolution = textResolution(zoom);
    if (this.label.style.resolution === resolution) return;
    this.label.setResolution(resolution);
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

  // La pastille, centrée sur x, son bas sur l'origine du conteneur : l'anneau et le point, puis le nom.
  private layout(): void {
    const width = TAG_PAD_X + 2 * DOT_RADIUS + DOT_GAP + this.label.width + TAG_PAD_X;
    const height = Math.max(this.label.height, 2 * RING_RADIUS) + 2 * TAG_PAD_Y;
    const left = -Math.round(width / 2);
    this.background.setPosition(left, -height).setSize(width, height);
    const middle = -height / 2;
    this.dot.setPosition(left + TAG_PAD_X + DOT_RADIUS, middle);
    this.ring.setPosition(left + TAG_PAD_X + DOT_RADIUS, middle);
    this.label.setPosition(left + TAG_PAD_X + 2 * DOT_RADIUS + DOT_GAP, middle);
  }
}

// Ce qui porte l'étiquette d'une personne : l'avatar local ou un avatar distant (setSpeaking passe à leur NameTag).
export interface SpeakingTarget {
  setSpeaking(speaking: boolean): void;
}

// L'anneau de parole des étiquettes, d'après l'événement de bus `media:speaking` (media/use-media.ts) : les identifiants de ceux qui
// parlent dans la conversation, soi-même compris, à chaque changement, et [] en la quittant. Seuls les anneaux qui changent sont
// touchés. `targetOf` rend l'avatar d'une personne, ou undefined si la scène ne la dessine pas ; un avatar créé ensuite (quelqu'un qui
// arrive) prend son anneau d'emblée : isSpeaking.
export class SpeakingRings {
  private speaking = new Set<string>();

  constructor(private readonly targetOf: (id: string) => SpeakingTarget | undefined) {}

  update(ids: readonly string[]): void {
    const next = new Set(ids);
    for (const id of this.speaking) {
      if (!next.has(id)) this.targetOf(id)?.setSpeaking(false);
    }
    for (const id of next) {
      if (!this.speaking.has(id)) this.targetOf(id)?.setSpeaking(true);
    }
    this.speaking = next;
  }

  isSpeaking(id: string): boolean {
    return this.speaking.has(id);
  }
}
