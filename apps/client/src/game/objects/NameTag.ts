import type { ActivityState, Status } from '@bureau/shared';
import type { GameObjects, Scene } from 'phaser';
import { indicatorRgb } from '../../lib/status';
import { DEPTH } from '../map-layers';
import { snapToPixels } from '../pixel-snap';
import { textResolution } from '../zoom';
import { SpeechBubble } from './SpeechBubble';

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
// L'espace entre le haut de l'image de l'avatar et le bas de l'étiquette, et entre le haut de l'étiquette et le bas de la bulle de parole.
const GAP_ABOVE_HEAD = 1;
const GAP_ABOVE_TAG = 1;

// L'étiquette au-dessus de la tête d'un avatar : un point de statut (de la couleur de l'état d'activité, ou du statut, STATUS_COLORS : celle du menu des
// statuts et du panneau Personnes aussi) et son nom, surmontés d'une bulle de parole quand la personne parle (SpeechBubble). Elle passe devant tout
// le reste (DEPTH.nameTags). Elle n'importe de Phaser que des types : la scène lui donne de quoi dessiner.
export class NameTag {
  private readonly container: GameObjects.Container;
  private readonly background: GameObjects.Rectangle;
  private readonly label: GameObjects.Text;
  private readonly dot: GameObjects.Arc;
  private readonly bubble: SpeechBubble;
  private status: Status;
  private activity: ActivityState | null = null;

  constructor(scene: Scene, name: string, status: Status, zoom: number, activity: ActivityState | null = null) {
    this.status = status;
    this.activity = activity;
    this.background = snapToPixels(scene.add.rectangle(0, 0, 1, 1, TAG_BACKGROUND.color, TAG_BACKGROUND.alpha).setOrigin(0, 0));
    this.dot = snapToPixels(scene.add.circle(0, 0, DOT_RADIUS, indicatorRgb(status, activity)));
    this.label = snapToPixels(scene.add.text(0, 0, displayName(name), { ...TAG_TEXT_STYLE, resolution: textResolution(zoom) }).setOrigin(0, 0.5));
    this.bubble = new SpeechBubble(scene);
    this.bubble.setZoom(zoom);
    this.container = scene.add.container(0, 0, [this.background, this.dot, this.label, ...this.bubble.objects]).setDepth(DEPTH.nameTags);
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

  // La bulle de parole au-dessus de l'étiquette : montrée tant que la personne parle.
  setSpeaking(speaking: boolean): void {
    this.bubble.setSpeaking(speaking);
  }

  // À chaque image : les points de la bulle montent l'un après l'autre.
  tick(now: number): void {
    this.bubble.tick(now);
  }

  // Le zoom de la caméra a changé : la bulle grossit de loin (jamais sous 16 px à l'écran), et le texte est redessiné à la nouvelle taille, mais seulement
  // quand sa résolution change (au quart de zoom au-dessus, jamais en dessous de 1 : textResolution), pas à chaque image d'un glissement.
  setZoom(zoom: number): void {
    this.bubble.setZoom(zoom);
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

  // La pastille, centrée sur x, son bas sur l'origine du conteneur : le point, puis le nom ; et la bulle de parole juste au-dessus.
  private layout(): void {
    const width = TAG_PAD_X + 2 * DOT_RADIUS + DOT_GAP + this.label.width + TAG_PAD_X;
    const height = this.label.height + 2 * TAG_PAD_Y;
    const left = -Math.round(width / 2);
    this.background.setPosition(left, -height).setSize(width, height);
    const middle = -height / 2;
    this.dot.setPosition(left + TAG_PAD_X + DOT_RADIUS, middle);
    this.label.setPosition(left + TAG_PAD_X + 2 * DOT_RADIUS + DOT_GAP, middle);
    this.bubble.placeAbove(0, -height - GAP_ABOVE_TAG);
  }
}

// Ce qui porte l'étiquette d'une personne : l'avatar local ou un avatar distant (setSpeaking passe à leur NameTag).
export interface SpeakingTarget {
  setSpeaking(speaking: boolean): void;
}

// Les bulles de parole des étiquettes, de deux sources, allumées tant que l'une des deux le dit :
// - la room audio/vidéo (`media:speaking`, media/use-media.ts) : les identifiants de ceux qui parlent dans la conversation, soi-même compris, à
//   chaque changement, et [] en la quittant. Immédiat : la bulle de soi s'allume sans attendre le serveur ;
// - le serveur (`speaking:changed`) : qui parle dans le bureau, même loin de soi et hors de sa conversation (setServer, et resetServer à chaque init).
// Seules les bulles qui changent sont touchées. `targetOf` rend l'avatar d'une personne, ou undefined si la scène ne la dessine pas ; un avatar
// créé ensuite (quelqu'un qui arrive) prend sa bulle d'emblée : isSpeaking.
export class SpeakingBubbles {
  private fromMedia = new Set<string>();
  private fromServer = new Set<string>();
  // Ceux dont la bulle est allumée, tels que les étiquettes le montrent.
  private shown = new Set<string>();

  constructor(private readonly targetOf: (id: string) => SpeakingTarget | undefined) {}

  // Qui parle dans la room audio/vidéo.
  updateMedia(ids: readonly string[]): void {
    this.fromMedia = new Set(ids);
    this.apply();
  }

  // Le serveur dit que cette personne se met à parler, ou se tait.
  setServer(id: string, speaking: boolean): void {
    if (speaking) this.fromServer.add(id);
    else this.fromServer.delete(id);
    this.apply();
  }

  // Un init : ceux que le serveur dit parler, en remplacement de tout ce qu'il avait dit avant.
  resetServer(ids: readonly string[]): void {
    this.fromServer = new Set(ids);
    this.apply();
  }

  // Quelqu'un s'en va : le serveur ne dit plus rien de lui, même s'il ne s'était pas tu.
  forget(id: string): void {
    this.fromServer.delete(id);
    this.apply();
  }

  isSpeaking(id: string): boolean {
    return this.shown.has(id);
  }

  // Ceux dont la bulle est allumée en ce moment.
  ids(): string[] {
    return [...this.shown];
  }

  private apply(): void {
    const next = new Set([...this.fromMedia, ...this.fromServer]);
    for (const id of this.shown) {
      if (!next.has(id)) this.targetOf(id)?.setSpeaking(false);
    }
    for (const id of next) {
      if (!this.shown.has(id)) this.targetOf(id)?.setSpeaking(true);
    }
    this.shown = next;
  }
}
