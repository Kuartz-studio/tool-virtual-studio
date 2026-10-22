import { describe, expect, test } from 'vitest';
import {
  BUBBLE_HEIGHT,
  BUBBLE_MIN_SCREEN_PX,
  BUBBLE_PIXELS,
  BUBBLE_TEXTURE,
  BUBBLE_WIDTH,
  bubbleScale,
  createSpeechBubbleTexture,
  DOT_STEP_MS,
  dotLift,
  SpeechBubble,
} from './SpeechBubble';

// Un objet de jeu de poche (Phaser a besoin d'un vrai canevas) : il note ce qu'on lui demande, rien de plus.
class FakeObject {
  x = 0;
  y = 0;
  visible = true;
  scaleX = 1;
  scaleY = 1;
  depth = 0;
  originX = 0;
  originY = 0;
  destroyed = false;
  fill: number | undefined;
  constructor(
    readonly kind: 'image' | 'rectangle',
    readonly args: unknown[],
  ) {}
  setOrigin(x: number, y = x) { this.originX = x; this.originY = y; return this; }
  setVisible(visible: boolean) { this.visible = visible; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setScale(x: number, y = x) { this.scaleX = x; this.scaleY = y; return this; }
  setDepth(depth: number) { this.depth = depth; return this; }
  setVertexRoundMode() { return this; }
  destroy() { this.destroyed = true; }
}

// Un canevas qui garde les pixels qu'on y pose, et des textures de poche.
function fakeTextures() {
  const added = new Map<string, { width: number; height: number; pixels: Uint8ClampedArray }>();
  const makeCanvas = () => {
    const canvas = {
      width: 0,
      height: 0,
      pixels: new Uint8ClampedArray(0) as Uint8ClampedArray,
      getContext: () => ({
        createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: (image: { data: Uint8ClampedArray }) => {
          canvas.pixels = image.data;
        },
      }),
    };
    return canvas as unknown as HTMLCanvasElement & { pixels: Uint8ClampedArray };
  };
  const textures = {
    exists: (key: string) => added.has(key),
    addCanvas: (key: string, canvas: { width: number; height: number; pixels: Uint8ClampedArray }) => {
      added.set(key, { width: canvas.width, height: canvas.height, pixels: canvas.pixels });
    },
  } as unknown as Phaser.Textures.TextureManager;
  return { textures, added, makeCanvas };
}

function setup(options: { reducedMotion?: boolean } = {}) {
  const made: FakeObject[] = [];
  const { textures, added } = fakeTextures();
  const scene = {
    textures,
    add: {
      image: (...args: unknown[]) => {
        const object = new FakeObject('image', args);
        made.push(object);
        return object;
      },
      rectangle: (...args: unknown[]) => {
        const object = new FakeObject('rectangle', args);
        made.push(object);
        return object;
      },
    },
  } as unknown as Phaser.Scene;
  const bubble = new SpeechBubble(scene, { reducedMotion: () => options.reducedMotion ?? false });
  const image = made.find((object) => object.kind === 'image')!;
  const dots = made.filter((object) => object.kind === 'rectangle');
  return { bubble, image, dots, made, added };
}

describe('le dessin', () => {
  test('14 × 11 px, des lignes de même longueur, avec un contour (X), un remplissage (o) et du vide (.)', () => {
    expect([BUBBLE_WIDTH, BUBBLE_HEIGHT]).toEqual([14, 11]);
    expect(BUBBLE_PIXELS).toHaveLength(BUBBLE_HEIGHT);
    for (const row of BUBBLE_PIXELS) {
      expect(row).toHaveLength(BUBBLE_WIDTH);
      expect(row).toMatch(/^[Xo.]+$/);
    }
  });

  test('une bulle fermée (le contour entoure le remplissage, sans trou) avec une queue au milieu du bas, qui pointe vers la tête', () => {
    const at = (x: number, y: number) => BUBBLE_PIXELS[y]![x]!;
    // Pas de remplissage au bord : le contour le ferme à droite et à gauche, en haut.
    for (let y = 0; y < BUBBLE_HEIGHT; y++) {
      const row = BUBBLE_PIXELS[y]!;
      const first = row.search(/[Xo]/);
      if (first >= 0) expect(row[first], `ligne ${y}`).toBe('X');
      const last = row.search(/[Xo]\.*$/);
      expect(row[last], `ligne ${y}`).toBe('X');
    }
    expect(BUBBLE_PIXELS[0]).toMatch(/^\.*X+\.*$/);
    // La queue : sous le corps, au milieu (colonne 6 ou 7), jusqu'à la dernière ligne, qui n'a qu'un point de contour.
    expect([...BUBBLE_PIXELS[BUBBLE_HEIGHT - 1]!].filter((c) => c !== '.')).toEqual(['X']);
    const tipX = BUBBLE_PIXELS[BUBBLE_HEIGHT - 1]!.indexOf('X');
    expect(Math.abs(tipX - (BUBBLE_WIDTH - 1) / 2)).toBeLessThanOrEqual(1);
    expect(at(tipX, BUBBLE_HEIGHT - 2)).toBe('o');
  });

  test('createSpeechBubbleTexture : une texture de la taille du dessin, contour sombre, remplissage blanc, vide transparent ; une seule fois', () => {
    const { textures, added, makeCanvas } = fakeTextures();
    createSpeechBubbleTexture(textures, makeCanvas);
    createSpeechBubbleTexture(textures, makeCanvas);
    expect([...added.keys()]).toEqual([BUBBLE_TEXTURE]);
    const { width, height, pixels } = added.get(BUBBLE_TEXTURE)!;
    expect([width, height]).toEqual([BUBBLE_WIDTH, BUBBLE_HEIGHT]);
    const pixel = (x: number, y: number) => [...pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
    BUBBLE_PIXELS.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        const [r, g, b, a] = pixel(x, y);
        if (cell === '.') expect(a, `(${x}, ${y})`).toBe(0);
        else if (cell === 'o') expect([r, g, b, a], `(${x}, ${y})`).toEqual([255, 255, 255, 255]);
        else expect([r, g, b, a], `(${x}, ${y})`).toEqual([0x1d, 0x20, 0x30, 255]);
      });
    });
  });
});

describe('la taille à l\'écran', () => {
  test('bubbleScale : un entier d\'au moins 1, juste assez grand pour que la bulle ne descende jamais sous 16 px de large à l\'écran', () => {
    expect(BUBBLE_MIN_SCREEN_PX).toBe(16);
    for (const zoom of [0.1875, 0.25, 0.375, 0.5, 0.75, 0.9, 1, 1.125, 1.5, 2.25, 3]) {
      const scale = bubbleScale(zoom);
      expect(Number.isInteger(scale), `zoom ${zoom}`).toBe(true);
      expect(scale, `zoom ${zoom}`).toBeGreaterThanOrEqual(1);
      expect(BUBBLE_WIDTH * scale * zoom, `zoom ${zoom} : sous 16 px`).toBeGreaterThanOrEqual(BUBBLE_MIN_SCREEN_PX);
      // Pas plus grande que nécessaire.
      if (scale > 1) expect(BUBBLE_WIDTH * (scale - 1) * zoom, `zoom ${zoom} : trop grande`).toBeLessThan(BUBBLE_MIN_SCREEN_PX);
    }
    // De près, la bulle garde sa taille.
    expect(bubbleScale(1.5)).toBe(1);
    expect(bubbleScale(3)).toBe(1);
  });

  test('setZoom grossit l\'image et les points ensemble', () => {
    const { bubble, image, dots } = setup();
    bubble.setZoom(0.375);
    expect(image.scaleX).toBe(bubbleScale(0.375));
    expect(dots.map((dot) => dot.scaleX)).toEqual([4, 4, 4]);
    bubble.setZoom(1.5);
    expect(image.scaleX).toBe(1);
    expect(dots.map((dot) => dot.scaleX)).toEqual([1, 1, 1]);
  });

  test('de loin, la bulle prend plus de place au-dessus de l\'étiquette : sa hauteur suit son échelle', () => {
    const { bubble } = setup();
    bubble.setZoom(1.5);
    expect(bubble.height).toBe(BUBBLE_HEIGHT);
    bubble.setZoom(0.375);
    expect(bubble.height).toBe(BUBBLE_HEIGHT * 4);
  });
});

describe('montrer et cacher', () => {
  test('cachée au départ ; setSpeaking(true) montre l\'image et les trois points, false les cache', () => {
    const { bubble, image, dots } = setup();
    expect(bubble.visible).toBe(false);
    expect([image, ...dots].every((object) => !object.visible)).toBe(true);
    bubble.setSpeaking(true);
    expect(bubble.visible).toBe(true);
    expect(dots).toHaveLength(3);
    expect([image, ...dots].every((object) => object.visible)).toBe(true);
    bubble.setSpeaking(false);
    expect(bubble.visible).toBe(false);
    expect([image, ...dots].every((object) => !object.visible)).toBe(true);
  });

  test('crée sa texture à sa première apparition, une seule fois pour toutes les bulles', () => {
    const { added } = setup();
    expect([...added.keys()]).toEqual([BUBBLE_TEXTURE]);
  });

  test('placeAbove : le bas et le milieu de l\'image sont en (x, bas) ; les points sont dans le corps de la bulle', () => {
    const { bubble, image, dots } = setup();
    bubble.setZoom(1.5);
    bubble.placeAbove(10, -20);
    expect([image.x, image.y, image.originX, image.originY]).toEqual([10, -20, 0.5, 1]);
    // Le coin haut-gauche de l'image : (10 − 7, −20 − 11) ; les points y sont aux colonnes 3, 6 et 9, de 2 px, à la ligne 3.
    const left = 10 - BUBBLE_WIDTH / 2;
    const top = -20 - BUBBLE_HEIGHT;
    expect(dots.map((dot) => [dot.x, dot.y])).toEqual([
      [left + 3, top + 3],
      [left + 6, top + 3],
      [left + 9, top + 3],
    ]);
    for (const dot of dots) {
      expect(dot.x).toBeGreaterThan(left);
      expect(dot.x + 2).toBeLessThan(left + BUBBLE_WIDTH);
    }
  });

  test('à l\'échelle 2, la bulle grandit autour de son bas : les points suivent', () => {
    const { bubble, dots } = setup();
    bubble.setZoom(0.75);
    bubble.placeAbove(0, 0);
    expect(bubbleScale(0.75)).toBe(2);
    const left = -BUBBLE_WIDTH;
    const top = -2 * BUBBLE_HEIGHT;
    expect(dots.map((dot) => [dot.x, dot.y])).toEqual([
      [left + 6, top + 6],
      [left + 12, top + 6],
      [left + 18, top + 6],
    ]);
  });

  test('destroy détruit l\'image et les points', () => {
    const { bubble, made } = setup();
    bubble.destroy();
    expect(made.every((object) => object.destroyed)).toBe(true);
  });
});

describe('les trois points montent l\'un après l\'autre', () => {
  test('dotLift : un point à la fois, puis un temps de repos, tous les DOT_STEP_MS', () => {
    expect(DOT_STEP_MS).toBe(200);
    const lifted = (now: number) => [0, 1, 2].filter((i) => dotLift(now, i) === 1);
    expect(lifted(0)).toEqual([0]);
    expect(lifted(DOT_STEP_MS - 1)).toEqual([0]);
    expect(lifted(DOT_STEP_MS)).toEqual([1]);
    expect(lifted(2 * DOT_STEP_MS)).toEqual([2]);
    expect(lifted(3 * DOT_STEP_MS)).toEqual([]);
    expect(lifted(4 * DOT_STEP_MS)).toEqual([0]);
    expect(lifted(40 * DOT_STEP_MS + 50)).toEqual([0]);
    expect([dotLift(0, 1), dotLift(0, 2)]).toEqual([0, 0]);
  });

  test('tick : le point du moment est un pixel plus haut, les autres au repos', () => {
    const { bubble, dots } = setup();
    bubble.setSpeaking(true);
    bubble.setZoom(1.5);
    bubble.placeAbove(0, 0);
    const rest = dots.map((dot) => dot.y);
    const lifted = (now: number) => {
      bubble.tick(now);
      return dots.map((dot, i) => rest[i]! - dot.y);
    };
    expect(lifted(0)).toEqual([1, 0, 0]);
    expect(lifted(DOT_STEP_MS)).toEqual([0, 1, 0]);
    expect(lifted(2 * DOT_STEP_MS)).toEqual([0, 0, 1]);
    expect(lifted(3 * DOT_STEP_MS)).toEqual([0, 0, 0]);
  });

  test('à l\'échelle 2, le point monte de 2 px de la carte (un pixel du dessin)', () => {
    const { bubble, dots } = setup();
    bubble.setSpeaking(true);
    bubble.setZoom(0.75);
    bubble.placeAbove(0, 0);
    const rest = dots.map((dot) => dot.y);
    bubble.tick(0);
    expect(rest[0]! - dots[0]!.y).toBe(2);
  });

  test('mouvement réduit : pas de pulsation, les points restent au repos à toute heure', () => {
    const { bubble, dots } = setup({ reducedMotion: true });
    bubble.setSpeaking(true);
    bubble.setZoom(1.5);
    bubble.placeAbove(0, 0);
    const rest = dots.map((dot) => dot.y);
    for (const now of [0, 200, 400, 600, 800, 12_345]) {
      bubble.tick(now);
      expect(dots.map((dot) => dot.y)).toEqual(rest);
    }
  });

  test('un point levé retombe quand on passe en mouvement réduit en cours de route', () => {
    let reduced = false;
    const made: FakeObject[] = [];
    const { textures } = fakeTextures();
    const scene = {
      textures,
      add: {
        image: (...args: unknown[]) => made.push(new FakeObject('image', args)) && made.at(-1)!,
        rectangle: (...args: unknown[]) => made.push(new FakeObject('rectangle', args)) && made.at(-1)!,
      },
    } as unknown as Phaser.Scene;
    const bubble = new SpeechBubble(scene, { reducedMotion: () => reduced });
    const dots = made.filter((object) => object.kind === 'rectangle');
    bubble.setSpeaking(true);
    bubble.placeAbove(0, 0);
    const rest = dots.map((dot) => dot.y);
    bubble.tick(0);
    expect(dots[0]!.y).toBe(rest[0]! - 1);
    reduced = true;
    bubble.tick(0);
    expect(dots.map((dot) => dot.y)).toEqual(rest);
  });

  test('cachée, la bulle ne bouge rien', () => {
    const { bubble, dots } = setup();
    bubble.placeAbove(0, 0);
    const rest = dots.map((dot) => dot.y);
    bubble.tick(0);
    expect(dots.map((dot) => dot.y)).toEqual(rest);
  });
});
