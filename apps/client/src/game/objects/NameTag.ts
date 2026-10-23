import type { ActivityState, Status } from '@bureau/shared';
import type { GameObjects, Scene } from 'phaser';
import { fr } from '../../i18n/fr';
import { cssColor, indicatorRgb } from '../../lib/status';
import { DEPTH } from '../map-layers';
import { snapToPixels } from '../pixel-snap';
import { textResolution } from '../zoom';
import { SpeechBubble } from './SpeechBubble';
import { SteamCup } from './SteamCup';

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
// L'espace entre le bord droit de la pastille et la tasse de café.
const GAP_BESIDE_TAG = 2;
// L'étiquette du mode, au-dessus de la pastille du nom : un texte plus petit et gras, sur la couleur du mode (ou du statut), à un pixel du nom.
const MODE_TEXT_STYLE = { ...TAG_TEXT_STYLE, fontSize: '8px', fontStyle: 'bold' };
const MODE_PAD_X = 3;
const GAP_ABOVE_NAME = 1;
// Le texte posé sur une couleur : blanc, ou l'encre presque noire de l'interface.
const LIGHT_INK = 0xffffff;
const DARK_INK = 0x15171c;

// Ce que dit l'étiquette du mode : le nom du mode en cours, sinon le statut s'il n'est pas « Disponible » ; null pour Disponible, l'état normal : rien.
export function modeLabelOf(status: Status, activity: Pick<ActivityState, 'label'> | null): string | null {
  if (activity) return activity.label;
  return status === 'available' ? null : fr.status[status];
}

// La luminance relative d'une couleur 0xrrggbb (WCAG).
function luminance(rgb: number): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((rgb >> 16) & 0xff) + 0.7152 * channel((rgb >> 8) & 0xff) + 0.0722 * channel(rgb & 0xff);
}

// L'encre d'un texte posé sur cette couleur : le blanc ou l'encre sombre, celle des deux qui contraste le plus avec elle (un mode jaune ou gris s'écrit en sombre).
export function inkOn(rgb: number): number {
  const background = luminance(rgb);
  const onLight = (background + 0.05) / (luminance(DARK_INK) + 0.05);
  const onDark = (luminance(LIGHT_INK) + 0.05) / (background + 0.05);
  return onDark >= onLight ? LIGHT_INK : DARK_INK;
}

// L'étiquette au-dessus de la tête d'un avatar : un point de statut (de la couleur de l'état d'activité, ou du statut, STATUS_COLORS : celle du menu des
// statuts et du panneau Personnes aussi) et son nom ; au-dessus, l'étiquette de son mode (son nom sur sa couleur, ou le statut s'il n'est pas « Disponible » :
// modeLabelOf), que tout le monde voit, de jour comme de nuit ; plus haut encore, une bulle de parole quand la personne parle (SpeechBubble) ; et à droite
// une tasse de café fumante quand elle en a un (SteamCup, à droite de la pastille : elle ne la décale pas). Elle passe devant tout le reste, la nuit comprise
// (DEPTH.nameTags). Elle n'importe de Phaser que des types : la scène lui donne de quoi dessiner.
export class NameTag {
  private readonly container: GameObjects.Container;
  private readonly background: GameObjects.Rectangle;
  private readonly label: GameObjects.Text;
  private readonly dot: GameObjects.Arc;
  private readonly bubble: SpeechBubble;
  private readonly cup: SteamCup;
  private readonly modeBackground: GameObjects.Rectangle;
  private readonly modeLabel: GameObjects.Text;
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
    this.cup = new SteamCup(scene);
    this.cup.setZoom(zoom);
    this.modeBackground = snapToPixels(scene.add.rectangle(0, 0, 1, 1, 0x000000, 0.92).setOrigin(0, 0));
    this.modeLabel = snapToPixels(scene.add.text(0, 0, '', { ...MODE_TEXT_STYLE, resolution: textResolution(zoom) }).setOrigin(0, 0.5));
    this.container = scene.add
      .container(0, 0, [this.background, this.dot, this.label, this.modeBackground, this.modeLabel, ...this.bubble.objects, ...this.cup.objects])
      .setDepth(DEPTH.nameTags);
    this.paintMode();
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
    this.paintMode();
  }

  // L'état d'activité de la personne : son point prend la couleur qu'elle a choisie ; null, celle de son statut. L'étiquette du mode dit son nom.
  setActivity(activity: ActivityState | null): void {
    this.activity = activity;
    this.paintDot();
    this.paintMode();
  }

  private paintDot(): void {
    this.dot.setFillStyle(indicatorRgb(this.status, this.activity));
  }

  // L'étiquette du mode : son nom, sur la couleur du point, dans l'encre qui s'y lit le mieux ; cachée sans mode ni statut à dire. La bulle de parole monte ou
  // descend avec elle (layout).
  private paintMode(): void {
    const text = modeLabelOf(this.status, this.activity);
    const color = indicatorRgb(this.status, this.activity);
    this.modeLabel.setText(text === null ? '' : displayName(text)).setColor(cssColor(inkOn(color)));
    this.modeBackground.setFillStyle(color, 0.92);
    this.modeLabel.setVisible(text !== null);
    this.modeBackground.setVisible(text !== null);
    this.layout();
  }

  // Le texte de l'étiquette du mode, tel qu'on le voit (vide sans mode à dire).
  modeText(): string {
    return this.modeLabel.visible ? this.modeLabel.text : '';
  }

  // La bulle de parole au-dessus de l'étiquette : montrée tant que la personne parle.
  setSpeaking(speaking: boolean): void {
    this.bubble.setSpeaking(speaking);
  }

  // La tasse de café à droite de la pastille : montrée tant que la personne a un café.
  setCoffee(on: boolean): void {
    this.cup.setActive(on);
  }

  coffeeShown(): boolean {
    return this.cup.visible;
  }

  // À chaque image : les points de la bulle montent l'un après l'autre, et la vapeur de la tasse monte.
  tick(now: number): void {
    this.bubble.tick(now);
    this.cup.tick(now);
  }

  // Le zoom de la caméra a changé : la bulle et la tasse grossissent de loin (jamais sous 16 et 12 px à l'écran), et le texte est redessiné à la nouvelle
  // taille, mais seulement quand sa résolution change (au quart de zoom au-dessus, jamais en dessous de 1 : textResolution), pas à chaque image d'un glissement.
  setZoom(zoom: number): void {
    this.bubble.setZoom(zoom);
    this.cup.setZoom(zoom);
    const resolution = textResolution(zoom);
    if (this.label.style.resolution === resolution) return;
    this.label.setResolution(resolution);
    this.modeLabel.setResolution(resolution);
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

  // La pastille, centrée sur x, son bas sur l'origine du conteneur : le point, puis le nom ; l'étiquette du mode au-dessus, centrée elle aussi ; la bulle
  // de parole juste au-dessus de la plus haute des deux, et la tasse de café à droite, son bas à celui de la pastille.
  private layout(): void {
    const width = TAG_PAD_X + 2 * DOT_RADIUS + DOT_GAP + this.label.width + TAG_PAD_X;
    const height = this.label.height + 2 * TAG_PAD_Y;
    const left = -Math.round(width / 2);
    this.background.setPosition(left, -height).setSize(width, height);
    const middle = -height / 2;
    this.dot.setPosition(left + TAG_PAD_X + DOT_RADIUS, middle);
    this.label.setPosition(left + TAG_PAD_X + 2 * DOT_RADIUS + DOT_GAP, middle);
    let top = -height;
    if (this.modeLabel.visible) {
      const modeWidth = this.modeLabel.width + 2 * MODE_PAD_X;
      const modeHeight = this.modeLabel.height + 2 * TAG_PAD_Y;
      const modeLeft = -Math.round(modeWidth / 2);
      top = -height - GAP_ABOVE_NAME - modeHeight;
      this.modeBackground.setPosition(modeLeft, top).setSize(modeWidth, modeHeight);
      this.modeLabel.setPosition(modeLeft + MODE_PAD_X, top + modeHeight / 2);
    }
    this.bubble.placeAbove(0, top - GAP_ABOVE_TAG);
    this.cup.placeAt(left + width + GAP_BESIDE_TAG, 0);
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
