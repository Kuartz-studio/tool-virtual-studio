import { describe, expect, test } from 'vitest';
import { Img } from './image';
import { Art, rgb, sameImage } from './pixel-art';
import { passingSweep, recolor, renderMotion, sparkle, sweepFrames, type Sweep } from './tile-motion';

const GREY = rgb(100, 100, 100);
const surface = (w: number, h: number): Img => {
  const img = new Img(w, h);
  img.fillRect(0, 0, w, h, GREY);
  return img;
};
const sweep: Sweep = { lines: [{ at: 0, width: 3, strength: 0.5 }, { at: 4, width: 1, strength: 0.3 }], slope: 0.5, speed: 4, ms: 50 };

describe('le reflet qui passe (sweepFrames)', () => {
  test('d\'une case à la voisine, la bande se raccorde : la case de droite, en retard de 16 / speed images, montre la suite de la même bande', () => {
    const one = sweepFrames(16, 16, sweep);
    const two = sweepFrames(32, 16, sweep);
    const lag = 16 / sweep.speed;
    const paint = (frames: typeof one, index: number, w: number) => {
      const img = surface(w * 2, 32);
      const frame = frames[index];
      if (frame) frame.draw!(new Art(img));
      return img;
    };
    two.forEach((_, index) => {
      const joined = surface(64, 32);
      joined.paste(paint(one, index, 16), 0, 0, false);
      joined.paste(paint(one, index - lag, 16), 32, 0, false);
      expect(sameImage(joined, paint(two, index, 32)), `image ${index}`).toBe(true);
    });
  });

  test('la bande entre par la gauche et sort par la droite : la première et la dernière image touchent la surface, toutes la changent', () => {
    const frames = sweepFrames(16, 16, sweep);
    for (const frame of frames) {
      const img = surface(32, 32);
      frame.draw!(new Art(img));
      expect(sameImage(img, surface(32, 32))).toBe(false);
    }
  });

  test('passingSweep : le repos d\'abord, et un cycle qui fait un nombre entier de retards de case', () => {
    const motion = passingSweep(16, 32, sweep, 6000, 'x');
    const cycle = motion.frames.reduce((sum, frame) => sum + frame.ms, 0);
    expect(motion.frames[0]!.draw).toBeUndefined();
    expect(motion.step).toBe(200);
    expect(cycle % motion.step).toBe(0);
    expect(Math.abs(cycle - 6000)).toBeLessThanOrEqual(motion.step);
  });

  test('vers le bas (axis y) : la bande avance de rangée en rangée', () => {
    const [first] = sweepFrames(16, 16, { ...sweep, slope: 0, axis: 'y' });
    const img = surface(32, 32);
    first!.draw!(new Art(img));
    const art = new Art(img);
    // La première image n'éclaire que le haut de la surface, sur toute sa largeur.
    expect(art.get(0, 0)).not.toEqual(GREY);
    expect(art.get(15, 0)).not.toEqual(GREY);
    expect(art.get(0, 15)).toEqual(GREY);
  });
});

describe('le rendu d\'un mouvement (renderMotion)', () => {
  test('une face de deux tuiles bouge d\'un bloc : chaque image coupée en haut et bas, la base sans dessin intacte', () => {
    const top = surface(32, 32);
    const bottom = surface(32, 32);
    bottom.fillRect(0, 0, 32, 32, rgb(10, 20, 30));
    const rendered = renderMotion([top, bottom], { frames: [{ ms: 100 }, { ms: 50, draw: (art) => art.set(0, 20, rgb(255, 0, 0)) }], phase: 'x', step: 50 });
    expect(rendered.images.map((frames) => frames.length)).toEqual([2, 2]);
    expect(sameImage(rendered.images[0]![0]!, top)).toBe(true);
    expect(sameImage(rendered.images[1]![0]!, bottom)).toBe(true);
    // Le pixel (0, 20) du dessin est dans la tuile du bas, à sa rangée 4.
    expect(new Art(rendered.images[1]![1]!).get(0, 4)).toEqual(rgb(255, 0, 0));
    expect(sameImage(rendered.images[0]![1]!, top)).toBe(true);
    expect(rendered.durations).toEqual([100, 50]);
  });
});

describe('les petits effets', () => {
  test('une étincelle : un point, une croix, une grande croix au cœur blanc', () => {
    const img = surface(32, 32);
    const art = new Art(img);
    sparkle(art, 8, 8, 2);
    expect(art.get(8, 8)).toEqual(rgb(255, 255, 255));
    expect(art.get(10, 8)).not.toEqual(GREY);
    expect(art.get(9, 9)).toEqual(GREY);
  });

  test('recolor : seuls les pixels que la fonction rend changent', () => {
    const img = surface(32, 32);
    const art = new Art(img);
    art.set(3, 3, rgb(1, 2, 3));
    recolor(art, (color) => (color.r === 1 ? rgb(9, 9, 9) : null));
    expect(art.get(3, 3)).toEqual(rgb(9, 9, 9));
    expect(art.get(4, 3)).toEqual(GREY);
  });
});
