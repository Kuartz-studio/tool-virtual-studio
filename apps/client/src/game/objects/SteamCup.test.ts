import { describe, expect, test } from 'vitest';
import { CUP_HEIGHT, CUP_MIN_SCREEN_PX, CUP_PIXELS, CUP_TEXTURE, CUP_WIDTH, createCupTexture, cupScale, PUFF_SIZE, STEAM_GAP, STEAM_PERIOD_MS, STEAM_RISE_PX, steamAt, SteamCup } from './SteamCup';

// Un objet de jeu de poche (Phaser a besoin d'un vrai canevas) : il note ce qu'on lui demande, rien de plus.
class FakeObject {
  x = 0;
  y = 0;
  alpha = 1;
  visible = true;
  scaleX = 1;
  originX = 0;
  originY = 0;
  destroyed = false;
  constructor(readonly kind: 'image' | 'rectangle') {}
  setOrigin(x: number, y = x) { this.originX = x; this.originY = y; return this; }
  setVisible(visible: boolean) { this.visible = visible; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setScale(x: number) { this.scaleX = x; return this; }
  setAlpha(alpha: number) { this.alpha = alpha; return this; }
  setVertexRoundMode() { return this; }
  destroy() { this.destroyed = true; }
}

// Des textures de poche, dont le canevas garde les pixels qu'on y pose.
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
  const make = (kind: FakeObject['kind']) => {
    const object = new FakeObject(kind);
    made.push(object);
    return object;
  };
  const scene = { textures, add: { image: () => make('image'), rectangle: () => make('rectangle') } } as unknown as Phaser.Scene;
  const cup = new SteamCup(scene, { reducedMotion: () => options.reducedMotion ?? false });
  const image = made.find((object) => object.kind === 'image')!;
  const puffs = made.filter((object) => object.kind === 'rectangle');
  return { cup, image, puffs, added };
}

describe('la tasse', () => {
  test('le dessin : CUP_WIDTH × CUP_HEIGHT, chaque rangée de la même longueur, avec le contour, la porcelaine et le café', () => {
    expect(CUP_PIXELS).toHaveLength(CUP_HEIGHT);
    for (const row of CUP_PIXELS) expect(row).toHaveLength(CUP_WIDTH);
    const cells = new Set(CUP_PIXELS.join(''));
    expect([...cells].sort()).toEqual(['.', 'X', 'b', 'w']);
  });

  test('createCupTexture : une texture opaque là où le dessin a un pixel, transparente ailleurs ; une seule fois, même rappelée', () => {
    const { textures, added, makeCanvas } = fakeTextures();
    createCupTexture(textures, makeCanvas);
    createCupTexture(textures, makeCanvas);
    expect([...added.keys()]).toEqual([CUP_TEXTURE]);
    const { width, height, pixels } = added.get(CUP_TEXTURE)!;
    expect([width, height]).toEqual([CUP_WIDTH, CUP_HEIGHT]);
    CUP_PIXELS.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        const alpha = pixels[(y * CUP_WIDTH + x) * 4 + 3];
        expect(alpha, `(${x}, ${y}) « ${cell} »`).toBe(cell === '.' ? 0 : 255);
      });
    });
  });

  test('cupScale : 1 de près, plus de loin : sa largeur à l\'écran ne descend jamais sous CUP_MIN_SCREEN_PX', () => {
    expect(cupScale(1.5)).toBe(1);
    expect(cupScale(3)).toBe(1);
    for (const zoom of [1, 0.75, 0.5, 0.3, 0.1]) {
      const scale = cupScale(zoom);
      expect(Number.isInteger(scale)).toBe(true);
      expect(CUP_WIDTH * scale * zoom).toBeGreaterThanOrEqual(CUP_MIN_SCREEN_PX);
      expect(CUP_WIDTH * (scale - 1) * zoom).toBeLessThan(CUP_MIN_SCREEN_PX);
    }
  });
});

describe('la vapeur', () => {
  test('un nuage monte de 0 à STEAM_RISE_PX pixels en s\'effaçant, puis repart d\'en bas : la même chose une période plus tard', () => {
    const start = steamAt(0, 0);
    expect(start.lift).toBe(0);
    expect(start.alpha).toBeGreaterThan(0.5);
    const late = steamAt(STEAM_PERIOD_MS - 1, 0);
    expect(late.lift).toBe(STEAM_RISE_PX - 1);
    expect(late.alpha).toBeLessThan(0.1);
    let previous = Infinity;
    for (let now = 0; now < STEAM_PERIOD_MS; now += 50) {
      const { alpha } = steamAt(now, 0);
      expect(alpha).toBeLessThanOrEqual(previous);
      previous = alpha;
    }
    expect(steamAt(STEAM_PERIOD_MS + 123, 1)).toEqual(steamAt(123, 1));
  });

  test('les trois nuages sont décalés : à chaque instant, ils ne sont pas tous à la même hauteur', () => {
    for (const now of [0, 300, 777]) {
      const lifts = new Set([0, 1, 2].map((index) => steamAt(now, index).lift));
      expect(lifts.size).toBeGreaterThan(1);
    }
  });
});

describe('SteamCup', () => {
  test('cachée tant qu\'on n\'a pas de café : ni la tasse ni la vapeur ne se montrent', () => {
    const { cup, image, puffs } = setup();
    expect(cup.visible).toBe(false);
    expect(image.visible).toBe(false);
    expect(puffs).toHaveLength(3);
    expect(puffs.every((puff) => !puff.visible)).toBe(true);
    expect(cup.objects).toHaveLength(4);
  });

  test('setActive : la tasse et la vapeur se montrent, puis se cachent', () => {
    const { cup, image, puffs } = setup();
    cup.setActive(true);
    expect([cup.visible, image.visible, ...puffs.map((puff) => puff.visible)]).toEqual([true, true, true, true, true]);
    cup.setActive(false);
    expect([cup.visible, image.visible, ...puffs.map((puff) => puff.visible)]).toEqual([false, false, false, false, false]);
  });

  test('placeAt : le coin bas-gauche de la tasse est au point donné, la vapeur au-dessus d\'elle', () => {
    const { cup, image, puffs } = setup();
    cup.setActive(true);
    cup.placeAt(40, -2);
    expect(image).toMatchObject({ x: 40, y: -2, originX: 0, originY: 1 });
    for (const puff of puffs) {
      expect(puff.x).toBeGreaterThanOrEqual(40);
      expect(puff.x + PUFF_SIZE).toBeLessThanOrEqual(40 + CUP_WIDTH);
      // Le bas du nuage est au-dessus du haut de la tasse, d'un pixel au moins.
      expect(puff.y + PUFF_SIZE).toBeLessThan(-2 - CUP_HEIGHT);
    }
  });

  test('tick : la vapeur monte et s\'efface avec le temps', () => {
    const { cup, puffs } = setup();
    cup.setActive(true);
    cup.placeAt(0, 0);
    cup.tick(0);
    const before = puffs.map((puff) => ({ y: puff.y, alpha: puff.alpha }));
    cup.tick(STEAM_PERIOD_MS / 2);
    const after = puffs.map((puff) => ({ y: puff.y, alpha: puff.alpha }));
    expect(after).not.toEqual(before);
    puffs.forEach((puff, index) => {
      const { lift, alpha } = steamAt(STEAM_PERIOD_MS / 2, index);
      expect(puff.alpha).toBe(alpha);
      expect(puff.y).toBe(-(CUP_HEIGHT + STEAM_GAP + PUFF_SIZE + lift));
    });
  });

  test('tick ne fait rien tant qu\'elle est cachée', () => {
    const { cup, puffs } = setup();
    cup.placeAt(0, 0);
    const before = puffs.map((puff) => [puff.x, puff.y, puff.alpha]);
    cup.tick(400);
    expect(puffs.map((puff) => [puff.x, puff.y, puff.alpha])).toEqual(before);
  });

  test('mouvement réduit : la vapeur est figée (visible, mais elle ne monte plus)', () => {
    const { cup, puffs } = setup({ reducedMotion: true });
    cup.setActive(true);
    cup.placeAt(0, 0);
    cup.tick(0);
    const still = puffs.map((puff) => [puff.x, puff.y, puff.alpha]);
    cup.tick(STEAM_PERIOD_MS / 3);
    cup.tick(STEAM_PERIOD_MS / 2);
    expect(puffs.map((puff) => [puff.x, puff.y, puff.alpha])).toEqual(still);
    expect(puffs.every((puff) => puff.visible && puff.alpha > 0)).toBe(true);
  });

  test('setZoom : de loin la tasse grossit (pixels du dessin entiers), et sa vapeur avec elle', () => {
    const { cup, image, puffs } = setup();
    cup.setActive(true);
    cup.placeAt(10, 0);
    cup.setZoom(0.5);
    const scale = cupScale(0.5);
    expect(scale).toBeGreaterThan(1);
    expect(image.scaleX).toBe(scale);
    expect(puffs.every((puff) => puff.scaleX === scale)).toBe(true);
    cup.tick(0);
    puffs.forEach((puff, index) => expect(puff.y).toBe(-(CUP_HEIGHT + STEAM_GAP + PUFF_SIZE + steamAt(0, index).lift) * scale));
  });

  test('destroy : tous ses objets', () => {
    const { cup, image, puffs } = setup();
    cup.destroy();
    expect([image, ...puffs].every((object) => object.destroyed)).toBe(true);
  });
});
