import { TILE_SIZE, type LightLevel } from '@bureau/shared';
import type { Cameras, GameObjects, Scene } from 'phaser';
import type { LightFlicker, LightSource } from './light-sources';
import { LIGHT_TEXTURE_SIZE, LIGHT_TEXTURES } from './light-textures';
import { DEPTH } from './map-layers';
import { snapToPixels } from './pixel-snap';
import { prefersReducedMotion } from './reduced-motion';

// La nuit : quand la lumière du bureau est éteinte, une obscurité bleu nuit couvre la carte. Elle est trouée en paliers nets autour des lampes,
// du feu, des télévisions et des écrans (light-sources.ts), chacun à sa force (un écran n'efface que le quart de l'obscurité en son centre, une
// cheminée presque toute), et en douceur autour de chaque personne ; les lumières brillent en plus d'un halo de leur couleur, par-dessus.
// Lumière tamisée, la même couche, plus légère (DIM_LEVEL) et presque noire (DIM_COLOR) : comme une photo moins exposée, tout s'assombrit sans
// changer de couleur, et la chaleur vient des lampes, qui éclairent encore leur flaque. Lumière allumée, la couche n'existe pas à l'écran et ne
// dessine rien : le canevas est celui du jour, au pixel près.
//
// L'obscurité est une RenderTexture posée sur la vue de la caméra et redessinée à chaque image de nuit : un aplat, puis l'effacement d'une
// texture de lumière (light-textures.ts) à chaque lumière visible. Sans WebGL (rendu Canvas), ou le contexte WebGL perdu, c'est un voile uni,
// sans trous. Ce fichier n'importe de Phaser que des types : la scène lui donne de quoi dessiner.

// L'obscurité en pleine nuit (level = 1) : sa couleur et son opacité.
export const NIGHT_COLOR = 0x080b1c;
export const NIGHT_ALPHA = 0.88;
// La lumière tamisée : le plafond baissé. L'obscurité y a pour opacité NIGHT_ALPHA × DIM_LEVEL, la moitié environ, et sa couleur est un presque-noir,
// à peine chaud : elle multiplie la clarté de chaque pixel par un peu plus de 0,5 sans voile coloré, comme une exposition plus courte d'environ deux
// diaphragmes (un ambre, d'abord, faisait un filtre jaune plutôt qu'une pièce plus sombre). Ce qu'éclairent les lampes en prend une teinte plus
// discrète que la nuit (DIM_TINT de la sienne), et une personne n'y porte qu'un reflet de son halo (DIM_PERSON de son trou et de sa teinte).
export const DIM_LEVEL = 0.56;
export const DIM_COLOR = 0x150f08;
export const DIM_TINT = 0.6;
export const DIM_PERSON = 0.25;
// Le niveau d'obscurité de chaque état de la lumière.
export const DARKNESS: Readonly<Record<LightLevel, number>> = { on: 0, dim: DIM_LEVEL, off: 1 };

// La couleur de l'obscurité, du bleu nuit (tone = 0) au presque-noir de la lumière tamisée (1), canal par canal.
export function darknessColor(tone: number): number {
  const mix = (shift: number) => Math.round(((NIGHT_COLOR >> shift) & 255) + (((DIM_COLOR >> shift) & 255) - ((NIGHT_COLOR >> shift) & 255)) * tone);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}
// Le voile du rendu sans WebGL : plus léger, puisque aucune lumière ne le troue.
export const FALLBACK_ALPHA = 0.6;
// La marge de l'obscurité autour de la vue, en pixels de la carte : aucun bord de l'écran ne reste clair.
export const VIEW_MARGIN = 2;
// Le halo d'une personne, en cases, et sa teinte : à peine chaude, comme une lanterne (sans elle, le bord du halo est gris).
export const PERSON_RADIUS_TILES = 2.2;
const PERSON_TINT = 0xffe9c8;
// La couleur des lumières, juste au-dessus de l'obscurité (sous le témoin de l'interrupteur, à 1 000 000,6, et les noms) :
// - la teinte : ce qu'elles éclairent prend leur couleur (multipliée, comme une lumière colorée), sur toute leur portée et par les mêmes paliers.
//   C'est leur couleur, éclaircie (TINT_LIGHTEN de blanc), qui laisse au sol ses couleurs, chaudes ou froides ;
// - le halo : autour de l'ampoule, leur couleur ajoutée (ADD), à GLOW_ALPHA en pleine nuit, sur une part de leur portée.
// La teinte et le halo suivent le niveau de la nuit et la force de la lumière : une source à 0,22 les a à 0,22 de ceux d'une lumière pleine.
// Tamisée, la teinte n'est qu'à DIM_TINT de cela.
const TINT_DEPTH = DEPTH.night + 0.02;
const TINT_LIGHTEN = 0.35;
export const GLOW_ALPHA = 0.35;
const GLOW_SCALE = 0.6;
const GLOW_DEPTH = DEPTH.night + 0.05;

// La couleur d'une lumière, éclaircie vers le blanc : la teinte de ce qu'elle éclaire.
export function tintOf(color: number): number {
  const lighten = (channel: number) => Math.round(channel + (255 - channel) * TINT_LIGHTEN);
  return (lighten((color >> 16) & 255) << 16) | (lighten((color >> 8) & 255) << 8) | lighten(color & 255);
}

// On éteint ou on tamise : un fondu de 450 ms, qui ralentit à la fin (du jour à la lumière tamisée, de celle-ci à la nuit, ou de la nuit à la lumière
// tamisée, la couleur glissant avec le niveau). On allume : un néon qui clignote avant de tenir, le niveau passant par ces paliers (à ces instants,
// en ms) en 320 ms.
const FADE_MS = 450;
const NEON: ReadonlyArray<readonly [atMs: number, level: number]> = [[0, 1], [80, 0.25], [160, 0.9], [240, 0.15], [320, 0]];
// Une lumière qui vacille (les données de sa sorte : light-sources.ts) voit sa portée bouger de ± l'amplitude, autour de `hz` battements par
// seconde : deux ondes mêlées, la seconde à 13/8 de la première, pour que la flamme ne batte pas comme un métronome.
const flickerFactor = (ms: number, { amplitude, hz }: LightFlicker): number => {
  const t = ms / 1000;
  return 1 + amplitude * (0.7 * Math.sin(2 * Math.PI * hz * t) + 0.3 * Math.sin(2 * Math.PI * hz * (13 / 8) * t + 1.3));
};

// Ce que ce fichier prend de Phaser sans l'importer (Phaser a besoin d'un vrai canevas, que les tests n'ont pas) : le rendu WebGL
// (Phaser.WEBGL), les modes de mélange ADD, MULTIPLY et ERASE (Phaser.BlendModes), et l'événement de la caméra qui suit un objet
// (Phaser.Cameras.Scene2D.Events.FOLLOW_UPDATE).
const WEBGL = 2;
const BLEND_ADD = 1;
const BLEND_MULTIPLY = 2;
const BLEND_ERASE = 17;
const FOLLOW_UPDATE = 'followupdate';

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type ViewCamera = Pick<Cameras.Scene2D.Camera, 'scrollX' | 'scrollY' | 'width' | 'height' | 'zoomX' | 'zoomY'>;

// Ce que la caméra montre, en pixels de la carte, avec la marge. C'est camera.worldView, mais calculé comme Camera.preRender le calcule, depuis le
// défilement du moment : worldView n'est à jour qu'au moment de dessiner l'image, alors qu'un panoramique ou un zoom ont déjà changé le
// défilement. Le coin haut-gauche tombe sur un pixel entier ; la taille ne dépend que de celle de la vue et du zoom, pas de la fraction de pixel
// où se pose la caméra : la couche ne change pas de taille à chaque pas.
export function viewRect(camera: ViewCamera): ViewRect {
  const width = camera.width / camera.zoomX;
  const height = camera.height / camera.zoomY;
  const left = camera.scrollX + (camera.width - width) / 2;
  const top = camera.scrollY + (camera.height - height) / 2;
  return {
    x: Math.floor(left) - VIEW_MARGIN,
    y: Math.floor(top) - VIEW_MARGIN,
    width: Math.ceil(width) + 1 + 2 * VIEW_MARGIN,
    height: Math.ceil(height) + 1 + 2 * VIEW_MARGIN,
  };
}

const sameRect = (a: ViewRect, b: ViewRect | null): boolean =>
  b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

// La taille de la texture de l'obscurité est arrondie au-dessus à ce pas, en pixels de la couche : la vue change de taille à chaque image d'un
// glissement du zoom, et Phaser refait la texture (et son framebuffer) à chaque changement de taille. Le surplus, à droite et en bas de la
// vue, reste hors de l'écran.
export const NIGHT_SIZE_STEP = 64;
const sizeFor = (pixels: number): number => Math.ceil(pixels / NIGHT_SIZE_STEP) * NIGHT_SIZE_STEP;

export interface LightingOptions {
  // L'heure, en ms (performance.now par défaut) : les transitions et le vacillement du feu.
  now?: () => number;
  // La personne demande moins de mouvement : ni fondu, ni clignotement, ni feu qui vacille (prefers-reduced-motion par défaut).
  reducedMotion?: () => boolean;
}

// Une transition en cours : de `from` à `to` (le niveau d'obscurité) et de `toneFrom` à `toneTo` (son ton) pour un fondu ; le néon, lui, va
// toujours au jour, et garde le ton d'où il part.
type Transition =
  | { kind: 'fade'; from: number; to: number; toneFrom: number; toneTo: number; start: number }
  | { kind: 'neon'; from: number; start: number };

// Ce que la couche montre en ce moment : rien (le jour), l'obscurité trouée, ou le voile uni du repli.
type Shown = 'none' | 'darkness' | 'veil';

export class LightingLayer {
  private readonly camera: Cameras.Scene2D.Camera;
  private readonly renderer: { type: number; contextLost?: boolean };
  private readonly now: () => number;
  private readonly reducedMotion: () => boolean;
  // L'obscurité trouée, en WebGL seulement ; le voile uni, partout.
  private readonly darkness: GameObjects.RenderTexture | null;
  private readonly veil: GameObjects.Rectangle;
  // La taille demandée à la texture de l'obscurité (Phaser l'arrondit au pair).
  private size = { width: 0, height: 0 };
  private sources: readonly LightSource[] = [];
  private signature = '';
  // La teinte et le halo de chaque lumière posée.
  private colors: Array<{ source: LightSource; tint: GameObjects.Image; glow: GameObjects.Image }> = [];
  // Les personnes : où elles sont (relu à chaque image), et la teinte de leur halo.
  private readonly people = new Map<string, { getPos: () => { x: number; y: number } | null; at: { x: number; y: number } | null; tint: GameObjects.Image }>();
  private lights: LightLevel = 'on';
  private current = 0;
  // Le ton de la couche : 0, celui de la nuit (le bleu nuit, les teintes et les halos pleins) ; 1, celui de la lumière tamisée (le presque-noir,
  // DIM_TINT, DIM_PERSON).
  private tone = 0;
  private transition: Transition | null = null;
  private shown: Shown = 'none';
  // Là où l'obscurité (ou le voile) est posée en ce moment.
  private drawnAt: ViewRect | null = null;

  constructor(
    private readonly scene: Scene,
    options: LightingOptions = {},
  ) {
    this.camera = scene.cameras.main;
    this.renderer = scene.renderer as unknown as { type: number; contextLost?: boolean };
    this.now = options.now ?? (() => performance.now());
    this.reducedMotion = options.reducedMotion ?? prefersReducedMotion;
    this.darkness = this.renderer.type === WEBGL
      ? snapToPixels(scene.add.renderTexture(0, 0, 2, 2)).setOrigin(0, 0).setDepth(DEPTH.night).setVisible(false)
      : null;
    this.veil = snapToPixels(scene.add.rectangle(0, 0, 2, 2, NIGHT_COLOR, 1)).setOrigin(0, 0).setDepth(DEPTH.night).setVisible(false);
    this.camera.on(FOLLOW_UPDATE, this.onFollow);
  }

  // Le niveau de nuit : 0 quand la lumière est allumée (la couche n'est pas à l'écran), DIM_LEVEL tamisée, 1 en pleine nuit ; entre les deux pendant
  // une transition.
  get level(): number {
    return this.current;
  }

  // Le ton de la couche du moment : 0, celui de la nuit ; 1, celui de la lumière tamisée.
  get toneLevel(): number {
    return this.tone;
  }

  // La lumière, telle que le magasin la dit. `instant` : sans transition (on arrive dans le noir, sans fondu). En mouvement réduit, toujours.
  // Rallumer fait clignoter le néon ; tamiser ou éteindre, un fondu. Parti du jour, le fondu prend tout de suite le ton où il va (rien ne se
  // voit encore) ; d'un état sombre à l'autre, le ton glisse avec le niveau.
  setLevel(lights: LightLevel, options: { instant?: boolean } = {}): void {
    const instant = options.instant === true || this.reducedMotion();
    if (lights === this.lights && !instant) return;
    this.lights = lights;
    const to = DARKNESS[lights];
    const toneTo = lights === 'dim' ? 1 : 0;
    if (instant) {
      this.transition = null;
      this.current = to;
      this.tone = toneTo;
      return;
    }
    const start = this.now();
    if (lights === 'on') {
      this.transition = { kind: 'neon', from: this.current, start };
      return;
    }
    const toneFrom = this.current === 0 ? toneTo : this.tone;
    this.transition = { kind: 'fade', from: this.current, to, toneFrom, toneTo, start };
  }

  // Les lumières posées (la carte et les bureaux) : chacune a sa teinte et son halo. Les mêmes lumières ne recréent rien.
  setStatic(sources: readonly LightSource[]): void {
    const signature = JSON.stringify(sources);
    if (signature === this.signature) return;
    this.signature = signature;
    this.sources = sources.map((source) => ({ ...source }));
    this.destroyColors();
    const add = (source: LightSource, key: string, blendMode: number, color: number, depth: number) =>
      snapToPixels(this.scene.add.image(source.x, source.y, key)).setBlendMode(blendMode).setTint(color).setDepth(depth).setVisible(false);
    this.colors = this.sources.map((source) => ({
      source,
      tint: add(source, LIGHT_TEXTURES.banded, BLEND_MULTIPLY, tintOf(source.color), TINT_DEPTH),
      glow: add(source, LIGHT_TEXTURES.glow, BLEND_ADD, source.color, GLOW_DEPTH),
    }));
  }

  // Une personne porte un halo : `getPos` dit où, à chaque image (le milieu de son avatar tel qu'il est dessiné), ou null quand on ne la voit pas.
  track(id: string, getPos: () => { x: number; y: number } | null): void {
    this.untrack(id);
    const tint = snapToPixels(this.scene.add.image(0, 0, LIGHT_TEXTURES.soft))
      .setBlendMode(BLEND_MULTIPLY)
      .setTint(PERSON_TINT)
      .setDepth(TINT_DEPTH)
      .setScale((2 * PERSON_RADIUS_TILES * TILE_SIZE) / LIGHT_TEXTURE_SIZE)
      .setVisible(false);
    this.people.set(id, { getPos, at: null, tint });
  }

  untrack(id: string): void {
    this.people.get(id)?.tint.destroy();
    this.people.delete(id);
  }

  // À chaque image, après la physique (les avatars sont à leur place de l'image) : le niveau avance, et la nuit se redessine.
  update(): void {
    this.advance();
    const level = this.current;
    const fallback = this.darkness === null || this.renderer.contextLost === true;
    if (level === 0) {
      this.hide();
      return;
    }
    const tinted = this.byTone(DIM_TINT);
    const personal = this.byTone(DIM_PERSON);
    for (const { source, tint, glow } of this.colors) {
      tint.setVisible(!fallback);
      glow.setVisible(!fallback);
      if (fallback) continue;
      const radius = this.radiusOf(source);
      tint.setAlpha(level * source.strength * tinted).setScale((2 * radius) / LIGHT_TEXTURE_SIZE);
      glow.setAlpha(GLOW_ALPHA * level * source.strength).setScale((2 * radius * GLOW_SCALE) / LIGHT_TEXTURE_SIZE);
    }
    for (const person of this.people.values()) {
      person.at = person.getPos();
      person.tint.setVisible(!fallback && person.at !== null);
      if (person.at) person.tint.setPosition(person.at.x, person.at.y).setAlpha(level * personal);
    }
    const rect = viewRect(this.camera);
    if (fallback) this.placeVeil(rect);
    else this.paint(rect);
  }

  destroy(): void {
    this.camera.off(FOLLOW_UPDATE, this.onFollow);
    this.darkness?.destroy();
    this.veil.destroy();
    this.destroyColors();
    for (const id of [...this.people.keys()]) this.untrack(id);
  }

  private destroyColors(): void {
    for (const { tint, glow } of this.colors.splice(0)) {
      tint.destroy();
      glow.destroy();
    }
  }

  // La caméra qui suit l'avatar ne calcule où elle regarde qu'au moment de dessiner l'image (Camera.preRender), après update() : si la vue a
  // bougé depuis, l'obscurité se redessine à la nouvelle place. Sans cela, le bord d'où l'on vient resterait clair le temps d'une image (8 px
  // en courant, toute la vue après une téléportation).
  private readonly onFollow = (): void => {
    if (this.shown === 'none') return;
    const rect = viewRect(this.camera);
    if (sameRect(rect, this.drawnAt)) return;
    if (this.shown === 'veil') this.placeVeil(rect);
    else this.paint(rect);
  };

  private advance(): void {
    const transition = this.transition;
    if (!transition) return;
    const elapsed = this.now() - transition.start;
    if (transition.kind === 'fade') {
      const progress = Math.min(1, elapsed / FADE_MS);
      const eased = 1 - (1 - progress) ** 3;
      this.current = progress === 1 ? transition.to : transition.from + (transition.to - transition.from) * eased;
      this.tone = progress === 1 ? transition.toneTo : transition.toneFrom + (transition.toneTo - transition.toneFrom) * eased;
      if (progress === 1) this.transition = null;
      return;
    }
    let step = 1;
    for (const [at, level] of NEON) if (elapsed >= at) step = level;
    this.current = transition.from * step;
    if (elapsed >= NEON[NEON.length - 1]![0]) this.transition = null;
  }

  // Une force de la nuit (1) amenée à `dim`, celle de la lumière tamisée, selon le ton du moment : glisse avec lui d'un état sombre à l'autre.
  private byTone(dim: number): number {
    return 1 + (dim - 1) * this.tone;
  }

  // La portée d'une lumière à cette image : celle qui vacille (le feu, une télévision, une bougie) bouge, sauf en mouvement réduit.
  private radiusOf(source: LightSource): number {
    return source.flicker && !this.reducedMotion() ? source.radius * flickerFactor(this.now(), source.flicker) : source.radius;
  }

  private hide(): void {
    if (this.shown === 'none') return;
    this.shown = 'none';
    this.drawnAt = null;
    this.darkness?.setVisible(false);
    this.veil.setVisible(false);
    for (const { tint, glow } of this.colors) {
      tint.setVisible(false);
      glow.setVisible(false);
    }
    for (const person of this.people.values()) person.tint.setVisible(false);
  }

  // Le repli : un voile uni sur toute la vue, plus léger que l'obscurité trouée, de la couleur du moment.
  private placeVeil(rect: ViewRect): void {
    this.shown = 'veil';
    this.drawnAt = rect;
    this.darkness?.setVisible(false);
    this.veil.setFillStyle(darknessColor(this.tone), 1);
    this.veil.setPosition(rect.x, rect.y).setSize(rect.width, rect.height).setAlpha(FALLBACK_ALPHA * this.current).setVisible(true);
  }

  // L'obscurité sur la vue : l'aplat de nuit, puis un trou par lumière visible et par personne.
  private paint(rect: ViewRect): void {
    const darkness = this.darkness!;
    this.shown = 'darkness';
    this.drawnAt = rect;
    this.veil.setVisible(false);
    // Un pixel de la couche est un pixel de la carte (le grain des tuiles) ; vue de loin (zoom < 1), un pixel de l'écran, pour que la
    // texture ne dépasse jamais la taille de l'écran (à un pas de NIGHT_SIZE_STEP près).
    const resolution = Math.min(1, (this.camera.zoomX + this.camera.zoomY) / 2);
    const width = sizeFor(rect.width * resolution);
    const height = sizeFor(rect.height * resolution);
    if (width !== this.size.width || height !== this.size.height) {
      darkness.resize(width, height);
      this.size = { width, height };
    }
    darkness.setPosition(rect.x, rect.y).setScale(1 / resolution).setVisible(true);
    darkness.clear().fill(darknessColor(this.tone), NIGHT_ALPHA * this.current);
    // `strength` : la part d'obscurité que le trou efface en son centre (1, tout : une personne, la nuit).
    const hole = (key: string, x: number, y: number, radius: number, strength?: number) => {
      if (x + radius < rect.x || x - radius > rect.x + rect.width || y + radius < rect.y || y - radius > rect.y + rect.height) return;
      // Au pixel entier : la forme du trou ne change pas d'une image à l'autre quand une personne marche.
      darkness.stamp(key, undefined, Math.round((x - rect.x) * resolution), Math.round((y - rect.y) * resolution), {
        scale: (2 * radius * resolution) / LIGHT_TEXTURE_SIZE,
        blendMode: BLEND_ERASE,
        ...(strength !== undefined && { alpha: strength }),
      });
    };
    for (const source of this.sources) hole(LIGHT_TEXTURES.banded, source.x, source.y, this.radiusOf(source), source.strength);
    const personal = this.byTone(DIM_PERSON);
    for (const { at } of this.people.values()) {
      if (at) hole(LIGHT_TEXTURES.soft, at.x, at.y, PERSON_RADIUS_TILES * TILE_SIZE, personal);
    }
    darkness.render();
  }
}
