import { describe, expect, test } from 'vitest';
import { CLOCK_COLORS } from './clock-faces';
import { bareFrameOf, decorTextureKey } from './decor-textures';
import { WallClocks } from './wall-clocks';

// Le samedi 24 octobre 2026, 16:42:07 UTC : 18:42 à Paris, 01:42 le lendemain à Tokyo.
const NOW = Date.parse('2026-10-24T16:42:07.000Z');

// Un faux gestionnaire de textures : chaque canevas retient ce qu'on y peint (le cadran recopié, les pixels), et combien de fois il a été envoyé
// à la carte graphique (refresh).
function fakeTextures({ atlas = true } = {}) {
  const canvases = new Map<string, { frames: string[]; pixels: Array<[number, number, string]>; refreshed: number; destroyed: boolean; width: number; height: number }>();
  const textures = {
    exists: (key: string) => (key === decorTextureKey('horloges') ? atlas : canvases.has(key)),
    createCanvas: (key: string, width: number, height: number) => {
      const canvas = { frames: [] as string[], pixels: [] as Array<[number, number, string]>, refreshed: 0, destroyed: false, width, height };
      canvases.set(key, canvas);
      let fill = '';
      return {
        width,
        height,
        context: {
          set fillStyle(color: string) {
            fill = color;
          },
          fillRect: (x: number, y: number) => canvas.pixels.push([x, y, fill]),
        },
        clear: () => {
          canvas.frames = [];
          canvas.pixels = [];
        },
        drawFrame: (texture: string, frame: string) => canvas.frames.push(`${texture}/${frame}`),
        refresh: () => {
          canvas.refreshed++;
        },
        destroy: () => {
          canvas.destroyed = true;
        },
      };
    },
  };
  return { textures: textures as never, canvases };
}

describe('les horloges vivantes', () => {
  test('une texture par modèle et par fuseau : son cadran nu, puis l\'heure peinte dessus', () => {
    const { textures, canvases } = fakeTextures();
    const clocks = new WallClocks(textures);
    const key = clocks.acquire('horloge-gare', 'Europe/Paris', NOW);
    expect(key).toBe('horloge:horloge-gare:Europe/Paris');
    const canvas = canvases.get(key!)!;
    expect([canvas.width, canvas.height]).toEqual([64, 64]);
    expect(canvas.frames).toEqual([`decor:horloges/${bareFrameOf('horloge-gare')}`]);
    expect(canvas.pixels.some(([, , color]) => color === CLOCK_COLORS.red)).toBe(true);
    expect(canvas.refreshed).toBe(1);
    // Le même modèle, le même fuseau : la même texture. Un autre fuseau : une autre.
    expect(clocks.acquire('horloge-gare', 'Europe/Paris', NOW)).toBe(key);
    expect(clocks.acquire('horloge-gare', 'Asia/Tokyo', NOW)).toBe('horloge:horloge-gare:Asia/Tokyo');
    expect(clocks.keys()).toHaveLength(2);
  });

  test('elle n\'est repeinte que quand l\'heure qu\'elle montre change', () => {
    const { textures, canvases } = fakeTextures();
    const clocks = new WallClocks(textures);
    const round = canvases.get(clocks.acquire('horloge-ronde', 'Europe/Paris', NOW)!)!;
    const led = canvases.get(clocks.acquire('horloge-led', 'Europe/Paris', NOW)!)!;
    clocks.tick(NOW + 300);
    expect([round.refreshed, led.refreshed]).toEqual([1, 1]);
    // Les deux points s'éteignent à la demi-seconde ; la trotteuse avance à la seconde.
    clocks.tick(NOW + 600);
    expect([round.refreshed, led.refreshed]).toEqual([1, 2]);
    clocks.tick(NOW + 1000);
    expect([round.refreshed, led.refreshed]).toEqual([2, 3]);
  });

  test('un onglet qui revient d\'arrière-plan est à l\'heure dès sa première image', () => {
    const { textures, canvases } = fakeTextures();
    const clocks = new WallClocks(textures);
    const led = canvases.get(clocks.acquire('horloge-led', 'Europe/Paris', NOW)!)!;
    const lit = () => led.pixels.filter(([, , color]) => color === CLOCK_COLORS.ledOn).length;
    expect(lit()).toBe((2 + 7 + 4 + 5) * 8 + 8);   // 18:42, les deux points allumés
    // Trois heures sans image, puis une : 21:42.
    clocks.tick(NOW + 3 * 3600_000);
    expect(lit()).toBe((5 + 2 + 4 + 5) * 8 + 8);
  });

  test('rendue par toutes les images qui la montraient, la texture est détruite', () => {
    const { textures, canvases } = fakeTextures();
    const clocks = new WallClocks(textures);
    const key = clocks.acquire('horloge-balancier', 'Europe/Paris', NOW)!;
    clocks.acquire('horloge-balancier', 'Europe/Paris', NOW);
    clocks.release(key);
    expect(canvases.get(key)!.destroyed).toBe(false);
    clocks.release(key);
    expect(canvases.get(key)!.destroyed).toBe(true);
    expect(clocks.keys()).toEqual([]);
    clocks.release(key);
  });

  test('sans l\'atlas des horloges, ou pour un élément qui n\'en est pas une : rien (l\'image de la banque fera l\'affaire)', () => {
    expect(new WallClocks(fakeTextures({ atlas: false }).textures).acquire('horloge-ronde', 'Europe/Paris', NOW)).toBeNull();
    expect(new WallClocks(fakeTextures().textures).acquire('of-15-0', 'Europe/Paris', NOW)).toBeNull();
  });

  test('un fuseau inconnu de ce navigateur est à l\'heure de Paris', () => {
    const clocks = new WallClocks(fakeTextures().textures);
    expect(clocks.acquire('horloge-ronde', 'Mars/Olympus_Mons', NOW)).toBe('horloge:horloge-ronde:Europe/Paris');
  });
});
