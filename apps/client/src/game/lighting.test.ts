import { TILE_SIZE } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import type { LightSource } from './light-sources';
import { LIGHT_TEXTURE_SIZE, LIGHT_TEXTURES } from './light-textures';
import { darknessColor, DIM_COLOR, DIM_LEVEL, DIM_PERSON, DIM_TINT, FALLBACK_ALPHA, GLOW_ALPHA, LightingLayer, NIGHT_ALPHA, NIGHT_COLOR, NIGHT_SIZE_STEP, PERSON_RADIUS_TILES, tintOf, VIEW_MARGIN, viewRect } from './lighting';
import { DEPTH } from './map-layers';

// Les modes de mélange de Phaser (BlendModes) : l'ajout (les halos), la multiplication (les teintes) et l'effacement (les trous dans l'obscurité).
const ADD = 1;
const MULTIPLY = 2;
const ERASE = 17;

type Call = [name: string, ...args: unknown[]];

// Un objet de jeu de poche (Phaser a besoin d'un vrai canevas) : il note ce qu'on lui demande, rien de plus.
class FakeObject {
  x = 0;
  y = 0;
  depth = 0;
  visible = true;
  alpha = 1;
  scaleX = 1;
  scaleY = 1;
  blendMode = 0;
  tint = 0xffffff;
  destroyed = false;
  readonly calls: Call[] = [];
  constructor(
    readonly kind: 'renderTexture' | 'rectangle' | 'image',
    x: number,
    y: number,
    public width: number,
    public height: number,
    readonly extra: Record<string, unknown> = {},
  ) {
    this.x = x;
    this.y = y;
  }
  setOrigin() { return this; }
  setVertexRoundMode() { return this; }
  setDepth(depth: number) { this.depth = depth; return this; }
  setVisible(visible: boolean) { this.visible = visible; return this; }
  setAlpha(alpha: number) { this.alpha = alpha; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setScale(x: number, y = x) { this.scaleX = x; this.scaleY = y; return this; }
  setSize(width: number, height: number) { this.width = width; this.height = height; return this; }
  setBlendMode(mode: number) { this.blendMode = mode; return this; }
  setTint(tint: number) { this.tint = tint; return this; }
  // La couleur d'un rectangle (le voile du repli).
  setFillStyle(color: number) { this.extra.color = color; return this; }
  // Ce que dessine une RenderTexture.
  resize(width: number, height: number) { this.width = width; this.height = height; this.calls.push(['resize', width, height]); return this; }
  clear() { this.calls.push(['clear']); return this; }
  fill(color: number, alpha: number) { this.calls.push(['fill', color, alpha]); return this; }
  stamp(key: string, _frame: unknown, x: number, y: number, config: Record<string, number>) { this.calls.push(['stamp', key, x, y, config]); return this; }
  erase(...args: unknown[]) { this.calls.push(['erase', ...args]); return this; }
  render() { this.calls.push(['render']); return this; }
  destroy() { this.destroyed = true; }
}

// Une scène de poche : la caméra principale (défilement, taille, zoom, et ses événements), le moteur de rendu, et ce que la couche crée.
function fakeScene(renderer: { type: number; contextLost?: boolean } = { type: 2, contextLost: false }) {
  const made: FakeObject[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const camera = {
    scrollX: 1000.5,
    scrollY: 500.25,
    width: 1440,
    height: 900,
    zoomX: 2,
    zoomY: 2,
    get zoom() { return (this.zoomX + this.zoomY) / 2; },
    setZoom(zoom: number) { this.zoomX = zoom; this.zoomY = zoom; return this; },
    on(event: string, fn: () => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(fn); return this; },
    off(event: string, fn: () => void) { listeners.get(event)?.delete(fn); return this; },
    emit(event: string) { for (const fn of listeners.get(event) ?? []) fn(); },
    listenerCount(event: string) { return listeners.get(event)?.size ?? 0; },
  };
  const make = (kind: FakeObject['kind'], x: number, y: number, width: number, height: number, extra?: Record<string, unknown>) => {
    const object = new FakeObject(kind, x, y, width, height, extra);
    made.push(object);
    return object;
  };
  const scene = {
    add: {
      renderTexture: (x: number, y: number, width: number, height: number) => make('renderTexture', x, y, width, height),
      rectangle: (x: number, y: number, width: number, height: number, color: number, alpha: number) => make('rectangle', x, y, width, height, { color, alpha }),
      image: (x: number, y: number, texture: string) => make('image', x, y, LIGHT_TEXTURE_SIZE, LIGHT_TEXTURE_SIZE, { texture }),
    },
    cameras: { main: camera },
    renderer,
  } as unknown as Phaser.Scene;
  return {
    scene,
    camera,
    renderer,
    darkness: () => made.find((object) => object.kind === 'renderTexture'),
    veil: () => made.find((object) => object.kind === 'rectangle')!,
    // Les images de couleur des lumières (teintes et halos) qui sont encore là.
    glows: () => made.filter((object) => object.kind === 'image' && !object.destroyed),
  };
}

// Une horloge qu'on avance à la main.
function setup(options: { reducedMotion?: boolean; renderer?: { type: number; contextLost?: boolean } } = {}) {
  const game = fakeScene(options.renderer);
  const clock = { now: 0 };
  const layer = new LightingLayer(game.scene, { now: () => clock.now, reducedMotion: () => options.reducedMotion ?? false });
  return { ...game, clock, layer };
}

// Les lumières de la carte : une lampe dans la vue (la caméra de poche montre x 1360-2080, y 725-1175), une autre loin de là.
const lamp = (x: number, y: number): LightSource => ({ x, y, kind: 'lamp', radius: 4 * TILE_SIZE, color: 0xffc56b, strength: 0.8 });
const IN_VIEW = lamp(1700, 950);
const FAR = lamp(9000, 9000);
const stamps = (calls: Call[]) => calls.filter(([name]) => name === 'stamp') as Array<[string, string, number, number, Record<string, number>]>;

describe('viewRect', () => {
  // Ce que montre la caméra, comme Camera.preRender (Phaser) le calcule : le milieu de la vue suit le défilement, le zoom la rétrécit autour.
  const worldView = (c: { scrollX: number; scrollY: number; width: number; height: number; zoomX: number; zoomY: number }) => {
    const [width, height] = [c.width / c.zoomX, c.height / c.zoomY];
    return { x: c.scrollX + c.width / 2 - width / 2, y: c.scrollY + c.height / 2 - height / 2, width, height };
  };

  test.each([0.5, 2])('au zoom %s, couvre toute la vue avec la marge de chaque côté, sur des pixels entiers', (zoom) => {
    for (const [scrollX, scrollY] of [[0, 0], [123.25, 456.5], [-40.75, 17.9], [2000.5, 999.99]] as const) {
      const camera = { scrollX, scrollY, width: 1440, height: 900, zoomX: zoom, zoomY: zoom };
      const view = worldView(camera);
      const rect = viewRect(camera);
      expect(VIEW_MARGIN).toBe(2);
      expect(rect.x).toBeLessThanOrEqual(view.x - VIEW_MARGIN);
      expect(rect.y).toBeLessThanOrEqual(view.y - VIEW_MARGIN);
      expect(rect.x + rect.width).toBeGreaterThanOrEqual(view.x + view.width + VIEW_MARGIN);
      expect(rect.y + rect.height).toBeGreaterThanOrEqual(view.y + view.height + VIEW_MARGIN);
      expect([rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)).toBe(true);
    }
  });

  test('sa taille ne dépend que de la vue et du zoom, pas de la fraction de pixel où se pose la caméra : la couche ne change pas de taille à chaque pas', () => {
    const sizes = new Set<string>();
    for (let scroll = 0; scroll < 3; scroll += 0.125) {
      const rect = viewRect({ scrollX: scroll, scrollY: scroll * 2, width: 1440, height: 900, zoomX: 2, zoomY: 2 });
      sizes.add(`${rect.width}×${rect.height}`);
    }
    expect(sizes.size).toBe(1);
  });
});

describe('LightingLayer', () => {
  test('lumière allumée : la couche est invisible et ne dessine rien', () => {
    const { layer, darkness, veil, glows, camera } = setup();
    layer.setLevel('on', { instant: true });
    layer.setStatic([IN_VIEW]);
    layer.track('moi', () => ({ x: 1700, y: 950 }));
    layer.update();
    camera.scrollX += 16;
    camera.emit('followupdate');
    expect(layer.level).toBe(0);
    expect(darkness()!.visible).toBe(false);
    expect(darkness()!.calls).toEqual([]);
    expect(veil().visible).toBe(false);
    expect(glows().every((glow) => !glow.visible)).toBe(true);
  });

  test('setLevel(\'off\', { instant: true }) : la nuit tout de suite, sans fondu (on arrive dans le noir)', () => {
    const { layer } = setup();
    layer.setLevel('off', { instant: true });
    expect(layer.level).toBe(1);
  });

  test('on éteint : un fondu de 450 ms, qui ralentit à la fin', () => {
    const { layer, clock } = setup();
    layer.setLevel('on', { instant: true });
    clock.now = 1000;
    layer.setLevel('off');
    const at = (ms: number) => {
      clock.now = 1000 + ms;
      layer.update();
      return layer.level;
    };
    expect(at(0)).toBe(0);
    expect(at(225)).toBeGreaterThan(0.5);
    expect(at(225)).toBeLessThan(1);
    expect(at(449)).toBeLessThan(1);
    expect(at(450)).toBe(1);
    expect(at(2000)).toBe(1);
  });

  test('on allume : un clignotement de néon, 1 → 0,25 → 0,9 → 0,15 → 0 en 320 ms', () => {
    const { layer, clock } = setup();
    layer.setLevel('off', { instant: true });
    clock.now = 5000;
    layer.setLevel('on');
    const seen: number[] = [];
    for (let ms = 0; ms <= 400; ms += 5) {
      clock.now = 5000 + ms;
      layer.update();
      if (seen.at(-1) !== layer.level) seen.push(layer.level);
      if (ms === 315) expect(layer.level).toBeGreaterThan(0);
    }
    expect(seen).toEqual([1, 0.25, 0.9, 0.15, 0]);
  });

  test('en mouvement réduit, les bascules sont instantanées', () => {
    const { layer } = setup({ reducedMotion: true });
    layer.setLevel('off');
    expect(layer.level).toBe(1);
    layer.setLevel('on');
    expect(layer.level).toBe(0);
  });

  test('la couleur de l\'obscurité va du bleu nuit (0) au presque-noir de la lumière tamisée (1)', () => {
    expect(darknessColor(0)).toBe(NIGHT_COLOR);
    expect(darknessColor(1)).toBe(DIM_COLOR);
    const middle = darknessColor(0.5);
    for (const shift of [16, 8, 0]) {
      const channel = (color: number) => (color >> shift) & 255;
      expect(channel(middle)).toBeGreaterThanOrEqual(Math.min(channel(NIGHT_COLOR), channel(DIM_COLOR)));
      expect(channel(middle)).toBeLessThanOrEqual(Math.max(channel(NIGHT_COLOR), channel(DIM_COLOR)));
    }
  });

  test('tamisée assombrit sans teinter, comme une exposition plus courte : un blanc devient un gris à peine chaud, à un peu plus de la moitié de sa clarté', () => {
    // Ce que montre l'écran sous l'obscurité de la lumière tamisée (sa couleur posée par-dessus, à son opacité), canal par canal.
    const alpha = NIGHT_ALPHA * DIM_LEVEL;
    const under = (day: number) => [16, 8, 0].map((shift) => day * (1 - alpha) + ((DIM_COLOR >> shift) & 255) * alpha);
    const [red, green, blue] = under(255);
    for (const channel of [red!, green!, blue!]) {
      expect(channel / 255).toBeGreaterThan(0.45);
      expect(channel / 255).toBeLessThan(0.62);
    }
    // À peine chaud : le rouge devant le bleu, de moins de 6 % (l'ambre d'abord essayé le teintait de 30 %, un filtre jaune).
    expect(red).toBeGreaterThan(blue!);
    expect(red! / blue!).toBeLessThan(1.06);
    // Et le noir reste noir : pas de voile sur les ombres.
    expect(Math.max(...under(0))).toBeLessThan(12);
  });

  test('tamisée : l\'obscurité plus légère et presque noire, trouée par les lampes de toute leur force, leur teinte plus discrète, et un reflet du halo des personnes', () => {
    const { layer, darkness, glows } = setup();
    layer.setStatic([IN_VIEW]);
    layer.track('moi', () => ({ x: 1650, y: 900 }));
    layer.setLevel('dim', { instant: true });
    layer.update();
    expect(layer.level).toBe(DIM_LEVEL);
    expect(layer.toneLevel).toBe(1);
    const rt = darkness()!;
    expect(rt.visible).toBe(true);
    expect(rt.calls.find(([name]) => name === 'fill')).toEqual(['fill', DIM_COLOR, NIGHT_ALPHA * DIM_LEVEL]);
    const holes = stamps(rt.calls);
    expect(holes.map(([, key]) => key)).toEqual([LIGHT_TEXTURES.banded, LIGHT_TEXTURES.soft]);
    expect(holes.map(([, , , , config]) => config.alpha)).toEqual([IN_VIEW.strength, DIM_PERSON]);
    const glow = glows().find((image) => image.blendMode === ADD)!;
    expect(glow.visible).toBe(true);
    expect(glow.alpha).toBeCloseTo(GLOW_ALPHA * IN_VIEW.strength * DIM_LEVEL);
    // Les teintes multipliées : celle de la lampe, puis celle de la personne.
    const [lampTint, personTint] = glows().filter((image) => image.blendMode === MULTIPLY);
    expect(lampTint!.alpha).toBeCloseTo(DIM_LEVEL * IN_VIEW.strength * DIM_TINT);
    expect(personTint!.alpha).toBeCloseTo(DIM_LEVEL * DIM_PERSON);
  });

  test('du jour à la lumière tamisée : un fondu de 450 ms jusqu\'à DIM_LEVEL, presque noir dès le départ', () => {
    const { layer, darkness, clock } = setup();
    layer.setLevel('on', { instant: true });
    clock.now = 1000;
    layer.setLevel('dim');
    const at = (ms: number) => {
      clock.now = 1000 + ms;
      layer.update();
      return layer.level;
    };
    expect(at(0)).toBe(0);
    expect(at(225)).toBeGreaterThan(DIM_LEVEL / 2);
    expect(at(225)).toBeLessThan(DIM_LEVEL);
    expect(darkness()!.calls.filter(([name]) => name === 'fill').at(-1)![1]).toBe(DIM_COLOR);
    expect(at(450)).toBe(DIM_LEVEL);
    expect(at(2000)).toBe(DIM_LEVEL);
    expect(layer.toneLevel).toBe(1);
  });

  test('de la lumière tamisée à la nuit, et retour : le niveau, la couleur et le halo des personnes glissent ensemble', () => {
    const { layer, darkness, clock } = setup();
    layer.track('moi', () => ({ x: 1650, y: 900 }));
    // Le trou de la personne, au dernier dessin (elle est trouée la dernière).
    const personHole = () => stamps(darkness()!.calls).at(-1)![4].alpha;
    layer.setLevel('dim', { instant: true });
    clock.now = 1000;
    layer.setLevel('off');
    clock.now = 1225;
    layer.update();
    expect(layer.level).toBeGreaterThan(DIM_LEVEL);
    expect(layer.level).toBeLessThan(1);
    expect(layer.toneLevel).toBeGreaterThan(0);
    expect(layer.toneLevel).toBeLessThan(1);
    expect(personHole()).toBeGreaterThan(DIM_PERSON);
    expect(personHole()).toBeLessThan(1);
    clock.now = 1450;
    layer.update();
    expect([layer.level, layer.toneLevel]).toEqual([1, 0]);
    expect(personHole()).toBe(1);

    clock.now = 3000;
    layer.setLevel('dim');
    clock.now = 3450;
    layer.update();
    expect([layer.level, layer.toneLevel]).toEqual([DIM_LEVEL, 1]);
    expect(personHole()).toBe(DIM_PERSON);
  });

  test('de la lumière tamisée au jour : le néon clignote depuis DIM_LEVEL', () => {
    const { layer, clock } = setup();
    layer.setLevel('dim', { instant: true });
    clock.now = 5000;
    layer.setLevel('on');
    const seen: number[] = [];
    for (let ms = 0; ms <= 400; ms += 5) {
      clock.now = 5000 + ms;
      layer.update();
      if (seen.at(-1) !== layer.level) seen.push(layer.level);
    }
    expect(seen).toEqual([1, 0.25, 0.9, 0.15, 0].map((step) => DIM_LEVEL * step));
  });

  test('la nuit : l\'obscurité couvre la vue, trouée en paliers par les lumières de la vue et en douceur autour des personnes', () => {
    const { layer, darkness, camera } = setup();
    layer.setLevel('off', { instant: true });
    layer.setStatic([IN_VIEW, FAR]);
    layer.track('moi', () => ({ x: 1650.4, y: 900.6 }));
    layer.update();
    const rect = viewRect(camera);
    const rt = darkness()!;
    expect(rt.visible).toBe(true);
    expect(rt.depth).toBe(DEPTH.night);
    expect([rt.x, rt.y]).toEqual([rect.x, rect.y]);
    // Au zoom 2, un pixel de la couche est un pixel de la carte : elle fait la taille de la vue (arrondie au pair par Phaser).
    expect(rt.width).toBeGreaterThanOrEqual(rect.width);
    expect(rt.height).toBeGreaterThanOrEqual(rect.height);
    expect(rt.scaleX).toBe(1);
    const drawing = rt.calls.filter(([name]) => name !== 'resize');
    expect(drawing[0]).toEqual(['clear']);
    expect(drawing[1]).toEqual(['fill', NIGHT_COLOR, NIGHT_ALPHA]);
    expect(drawing.at(-1)).toEqual(['render']);
    // Une lampe (l'autre est loin de la vue) et une personne, effacées de l'obscurité.
    const holes = stamps(rt.calls);
    expect(holes.map(([, key]) => key)).toEqual([LIGHT_TEXTURES.banded, LIGHT_TEXTURES.soft]);
    expect(holes.every(([, , , , config]) => config.blendMode === ERASE)).toBe(true);
    const [, , lampX, lampY, lampConfig] = holes[0]!;
    expect([lampX, lampY]).toEqual([IN_VIEW.x - rect.x, IN_VIEW.y - rect.y]);
    expect(lampConfig.scale! * LIGHT_TEXTURE_SIZE).toBeCloseTo(2 * IN_VIEW.radius);
    const [, , personX, personY, personConfig] = holes[1]!;
    expect([personX, personY]).toEqual([Math.round(1650.4 - rect.x), Math.round(900.6 - rect.y)]);
    expect(personConfig.scale! * LIGHT_TEXTURE_SIZE).toBeCloseTo(2 * PERSON_RADIUS_TILES * TILE_SIZE);
    // La nuit, le halo d'une personne est plein.
    expect(personConfig.alpha).toBe(1);
  });

  test('pendant le fondu, l\'obscurité est plus légère', () => {
    const { layer, darkness, clock } = setup();
    layer.setLevel('on', { instant: true });
    layer.setLevel('off');
    clock.now = 225;
    layer.update();
    const fill = darkness()!.calls.find(([name]) => name === 'fill')!;
    expect(fill[2]).toBeCloseTo(NIGHT_ALPHA * layer.level);
  });

  test('la couche suit la caméra : si la vue a bougé au moment de dessiner l\'image, l\'obscurité se redessine à la nouvelle place', () => {
    const { layer, darkness, camera } = setup();
    layer.setLevel('off', { instant: true });
    layer.update();
    const renders = () => darkness()!.calls.filter(([name]) => name === 'render').length;
    expect(renders()).toBe(1);
    // La caméra n'a pas bougé : rien à refaire.
    camera.emit('followupdate');
    expect(renders()).toBe(1);
    // Elle a suivi l'avatar (Camera.preRender, après update()) : 8 px plus loin.
    camera.scrollX += 8;
    camera.emit('followupdate');
    expect(renders()).toBe(2);
    expect(darkness()!.x).toBe(viewRect(camera).x);
  });

  test('le zoom change : la couche se redimensionne pour couvrir la nouvelle vue, sans dépasser la finesse de l\'écran', () => {
    const { layer, darkness, camera } = setup();
    layer.setLevel('off', { instant: true });
    layer.update();
    camera.setZoom(0.5);
    layer.update();
    const rect = viewRect(camera);
    const rt = darkness()!;
    // Vue de loin, un pixel de la couche est un pixel de l'écran (2 pixels de la carte) : deux fois moins de pixels, affichés deux fois plus grands.
    expect(rt.scaleX).toBe(2);
    expect(rt.width * rt.scaleX).toBeGreaterThanOrEqual(rect.width);
    expect(rt.height * rt.scaleY).toBeGreaterThanOrEqual(rect.height);
    expect(rt.width).toBeLessThanOrEqual(Math.ceil(rect.width / 2) + NIGHT_SIZE_STEP);
  });

  test('la texture change de taille par paliers de NIGHT_SIZE_STEP : un glissement du zoom ne la refait pas à chaque image, et elle couvre toujours la vue', () => {
    const { layer, darkness, camera } = setup();
    layer.setLevel('off', { instant: true });
    camera.setZoom(1.5);
    layer.update();
    const rt = darkness()!;
    const resizes = () => rt.calls.filter(([name]) => name === 'resize').length;
    const before = resizes();
    for (let zoom = 1.5; zoom <= 1.575; zoom += 0.005) {
      camera.setZoom(zoom);
      layer.update();
      const rect = viewRect(camera);
      expect(rt.width).toBeGreaterThanOrEqual(rect.width);
      expect(rt.height).toBeGreaterThanOrEqual(rect.height);
      expect(rt.width % NIGHT_SIZE_STEP).toBe(0);
      expect(rt.height % NIGHT_SIZE_STEP).toBe(0);
    }
    // 15 tailles de vue différentes sur ce glissement, une seule fois la texture refaite.
    expect(resizes() - before).toBeLessThanOrEqual(1);
  });

  test('les lampes gagnent un halo chaud en ADD, juste au-dessus de l\'obscurité ; il suit le niveau', () => {
    const { layer, glows, clock } = setup();
    layer.setStatic([IN_VIEW]);
    layer.setLevel('on', { instant: true });
    layer.update();
    const [glow, ...others] = glows().filter((image) => image.blendMode === ADD);
    expect(others).toEqual([]);
    expect(glow!.visible).toBe(false);
    expect(glow!.blendMode).toBe(ADD);
    expect(glow!.tint).toBe(0xffc56b);
    expect(glow!.depth).toBeGreaterThan(DEPTH.night);
    expect(glow!.depth).toBeLessThan(1_000_000.6);
    layer.setLevel('off');
    clock.now = 225;
    layer.update();
    expect(glow!.visible).toBe(true);
    expect(glow!.alpha).toBeCloseTo(GLOW_ALPHA * IN_VIEW.strength * layer.level);
  });

  test('ce qu\'éclaire une lampe prend sa couleur : une teinte chaude multipliée, sur toute sa portée, par les mêmes paliers que sa lumière', () => {
    const { layer, glows } = setup();
    layer.setStatic([IN_VIEW, { ...IN_VIEW, kind: 'screen', color: 0x8cbeff, strength: 0.22 }]);
    layer.setLevel('off', { instant: true });
    layer.update();
    const tints = glows().filter((image) => image.blendMode === MULTIPLY);
    expect(tints.map((tint) => tint.extra.texture)).toEqual([LIGHT_TEXTURES.banded, LIGHT_TEXTURES.banded]);
    // Chaude pour la lampe, froide pour l'écran : leur couleur, éclaircie.
    expect(tints.map((tint) => tint.tint)).toEqual([tintOf(0xffc56b), tintOf(0x8cbeff)]);
    expect(tintOf(0xffc56b)).toBe(0xffd99f);
    expect(tints.every((tint) => tint.visible)).toBe(true);
    // Leur force dit à quel point elles teintent : la lampe à 0,8, l'écran à 0,22.
    expect(tints.map((tint) => tint.alpha)).toEqual([0.8, 0.22]);
    expect(tints[0]!.scaleX * LIGHT_TEXTURE_SIZE).toBeCloseTo(2 * IN_VIEW.radius);
    expect(tints[0]!.depth).toBeGreaterThan(DEPTH.night);
    expect(tints[0]!.depth).toBeLessThan(glows().find((image) => image.blendMode === ADD)!.depth);
  });

  test('le trou est tamponné avec la force de la lumière : une lumière faible laisse de l\'obscurité même à son centre', () => {
    const { layer, darkness } = setup();
    const screen: LightSource = { ...lamp(1600, 900), kind: 'screen', strength: 0.22 };
    layer.setLevel('off', { instant: true });
    layer.setStatic([IN_VIEW, screen]);
    layer.track('moi', () => ({ x: 1800, y: 1000 }));
    layer.update();
    const holes = stamps(darkness()!.calls);
    // La lampe (0,8), l'écran (0,22), puis la personne, dont le halo efface tout : elle n'a pas de force.
    expect(holes.map(([, key]) => key)).toEqual([LIGHT_TEXTURES.banded, LIGHT_TEXTURES.banded, LIGHT_TEXTURES.soft]);
    expect(holes.slice(0, 2).map(([, , , , config]) => config.alpha)).toEqual([0.8, 0.22]);
    expect(holes[2]![4].alpha ?? 1).toBe(1);
    expect(holes.every(([, , , , config]) => config.blendMode === ERASE)).toBe(true);
  });

  test('la teinte et le halo suivent la force : une source à 0,22 les a à 0,22 du niveau de nuit', () => {
    const { layer, glows, clock } = setup();
    layer.setStatic([{ ...IN_VIEW, kind: 'screen', color: 0x8cbeff, strength: 0.22 }]);
    layer.setLevel('on', { instant: true });
    // Au milieu du fondu : le niveau n'est ni 0 ni 1.
    layer.setLevel('off');
    clock.now = 225;
    layer.update();
    expect(layer.level).toBeGreaterThan(0.3);
    expect(layer.level).toBeLessThan(1);
    const tint = glows().find((image) => image.blendMode === MULTIPLY)!;
    const glow = glows().find((image) => image.blendMode === ADD)!;
    expect(tint.alpha).toBeCloseTo(0.22 * layer.level);
    expect(glow.alpha).toBeCloseTo(GLOW_ALPHA * 0.22 * layer.level);
    // En pleine nuit : à 0,22 de la teinte et du halo d'une lumière pleine.
    layer.setLevel('off', { instant: true });
    layer.update();
    expect(tint.alpha).toBeCloseTo(0.22);
    expect(glow.alpha).toBeCloseTo(GLOW_ALPHA * 0.22);
  });

  test('de nouvelles lumières (un bureau a changé) remplacent les anciennes ; les mêmes ne recréent rien', () => {
    const { layer, glows } = setup();
    layer.setStatic([IN_VIEW, FAR]);
    const before = glows();
    layer.setStatic([{ ...IN_VIEW }, { ...FAR }]);
    expect(glows()).toEqual(before);
    layer.setStatic([IN_VIEW]);
    // Une teinte et un halo par lumière.
    expect(glows()).toHaveLength(2);
    expect(before.filter((glow) => glow.destroyed)).toHaveLength(4);
  });

  test('le halo d\'une personne est à peine chaud, comme une lanterne : une teinte multipliée qui la suit', () => {
    const { layer, glows } = setup();
    let at: { x: number; y: number } | null = { x: 1700, y: 950 };
    layer.track('moi', () => at);
    const [tint, ...others] = glows();
    expect(others).toEqual([]);
    expect(tint!.blendMode).toBe(MULTIPLY);
    expect(tint!.extra.texture).toBe(LIGHT_TEXTURES.soft);
    expect(tint!.scaleX * LIGHT_TEXTURE_SIZE).toBeCloseTo(2 * PERSON_RADIUS_TILES * TILE_SIZE);
    // Chaude, mais à peine : le rouge plein, le bleu à peine retenu.
    expect(tint!.tint >> 16).toBe(0xff);
    expect(tint!.tint & 0xff).toBeGreaterThan(0xb0);
    layer.update();
    expect(tint!.visible).toBe(false);
    layer.setLevel('off', { instant: true });
    layer.update();
    expect([tint!.visible, tint!.x, tint!.y, tint!.alpha]).toEqual([true, 1700, 950, 1]);
    at = null;
    layer.update();
    expect(tint!.visible).toBe(false);
    layer.untrack('moi');
    expect(tint!.destroyed).toBe(true);
  });

  test('une personne qui s\'en va (ou qu\'on cache) n\'a plus de halo', () => {
    const { layer, darkness } = setup();
    layer.setLevel('off', { instant: true });
    let hidden = false;
    layer.track('a', () => (hidden ? null : { x: 1700, y: 950 }));
    layer.track('b', () => ({ x: 1750, y: 970 }));
    layer.untrack('b');
    layer.update();
    expect(stamps(darkness()!.calls)).toHaveLength(1);
    hidden = true;
    layer.update();
    expect(stamps(darkness()!.calls)).toHaveLength(1);
  });

  // Les portées avec lesquelles la lumière a troué l'obscurité, en une demi-seconde d'images à 60 par seconde.
  const radiiOf = (source: LightSource, reducedMotion: boolean) => {
    const { layer, darkness, clock } = setup({ reducedMotion });
    layer.setLevel('off', { instant: true });
    layer.setStatic([source]);
    const seen = new Set<number>();
    for (let ms = 0; ms < 500; ms += 16) {
      clock.now = ms;
      layer.update();
      const config = stamps(darkness()!.calls).at(-1)![4];
      seen.add((config.scale! * LIGHT_TEXTURE_SIZE) / 2);
    }
    return [...seen];
  };

  test.each([
    ['la cheminée, ±5 % à 8 Hz', { amplitude: 0.05, hz: 8 }],
    ['une télévision, ±6 % à 6 Hz', { amplitude: 0.06, hz: 6 }],
    ['un vacillement lent et large, ±12 % à 3 Hz', { amplitude: 0.12, hz: 3 }],
  ])('le vacillement ne dépasse jamais son amplitude, et l\'atteint presque : %s ; en mouvement réduit, la portée ne bouge pas', (_name, flicker) => {
    const source: LightSource = { ...IN_VIEW, kind: 'fire', flicker };
    const moving = radiiOf(source, false);
    expect(moving.length).toBeGreaterThan(5);
    const swings = moving.map((radius) => Math.abs(radius / source.radius - 1));
    for (const swing of swings) expect(swing).toBeLessThanOrEqual(flicker.amplitude + 1e-9);
    expect(Math.max(...swings)).toBeGreaterThan(flicker.amplitude / 2);
    expect(radiiOf(source, true)).toEqual([source.radius]);
  });

  test('une lumière dont les données ne donnent pas de vacillement garde sa portée, de quelque sorte qu\'elle soit', () => {
    expect(radiiOf({ ...IN_VIEW, kind: 'lamp' }, false)).toEqual([IN_VIEW.radius]);
    expect(radiiOf({ ...IN_VIEW, kind: 'fire' }, false)).toEqual([IN_VIEW.radius]);
  });

  test('sans WebGL (rendu Canvas) : un voile sombre uni sur toute la vue, à 0,6 × level, sans trous', () => {
    const { layer, darkness, veil, glows, camera } = setup({ renderer: { type: 1 } });
    layer.setStatic([IN_VIEW]);
    layer.track('moi', () => ({ x: 1700, y: 950 }));
    layer.setLevel('off', { instant: true });
    layer.update();
    expect(darkness()?.calls ?? []).toEqual([]);
    expect(darkness()?.visible ?? false).toBe(false);
    const rect = viewRect(camera);
    expect(veil().visible).toBe(true);
    expect(veil().extra.color).toBe(NIGHT_COLOR);
    expect(veil().alpha).toBeCloseTo(FALLBACK_ALPHA);
    expect([veil().x, veil().y, veil().width, veil().height]).toEqual([rect.x, rect.y, rect.width, rect.height]);
    expect(veil().depth).toBe(DEPTH.night);
    expect(glows().every((glow) => !glow.visible)).toBe(true);
    layer.setLevel('dim', { instant: true });
    layer.update();
    expect(veil().extra.color).toBe(DIM_COLOR);
    expect(veil().alpha).toBeCloseTo(FALLBACK_ALPHA * DIM_LEVEL);
    layer.setLevel('on', { instant: true });
    layer.update();
    expect(veil().visible).toBe(false);
  });

  test('contexte WebGL perdu : le voile uni ; au retour du contexte, l\'obscurité trouée revient', () => {
    const { layer, darkness, veil, renderer } = setup();
    layer.setLevel('off', { instant: true });
    renderer.contextLost = true;
    layer.update();
    expect(veil().visible).toBe(true);
    expect(darkness()!.visible).toBe(false);
    expect(darkness()!.calls.filter(([name]) => name === 'render')).toEqual([]);
    renderer.contextLost = false;
    layer.update();
    expect(veil().visible).toBe(false);
    expect(darkness()!.visible).toBe(true);
  });

  test('destroy : la couche, le voile et les halos disparaissent, la caméra n\'est plus écoutée', () => {
    const { layer, darkness, veil, glows, camera } = setup();
    layer.setStatic([IN_VIEW]);
    const created = glows();
    layer.destroy();
    expect(darkness()!.destroyed).toBe(true);
    expect(veil().destroyed).toBe(true);
    expect(created.every((glow) => glow.destroyed)).toBe(true);
    expect(camera.listenerCount('followupdate')).toBe(0);
  });
});
