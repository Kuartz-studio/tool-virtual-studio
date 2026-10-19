import { expect, test, vi } from 'vitest';
import { addShadow, placeShadow, SHADOW } from './shadow';

// Une ellipse qui note où on la pose, sans Phaser (qui a besoin d'un vrai canevas).
function fakeEllipse() {
  const ellipse = {
    x: 0,
    y: 0,
    depth: 0,
    setPosition(x: number, y: number) { ellipse.x = x; ellipse.y = y; return ellipse; },
    setDepth(depth: number) { ellipse.depth = depth; return ellipse; },
  };
  return ellipse;
}

test('l\'ombre : une ellipse noire de 18 × 6 px à 25 % d\'opacité', () => {
  expect(SHADOW).toEqual({ width: 18, height: 6, color: 0x000000, alpha: 0.25 });
});

test('addShadow la crée sous les pieds, une profondeur sous l\'avatar (y − 1)', () => {
  const ellipse = fakeEllipse();
  const add = vi.fn(() => ellipse);
  const scene = { add: { ellipse: add } } as unknown as Phaser.Scene;

  expect(addShadow(scene, 80, 240)).toBe(ellipse);

  expect(add).toHaveBeenCalledExactlyOnceWith(80, 240, 18, 6, 0x000000, 0.25);
  expect(ellipse.depth).toBe(239);
});

test('placeShadow la suit : sous les pieds, à la profondeur y − 1', () => {
  const ellipse = fakeEllipse();
  placeShadow(ellipse as unknown as Phaser.GameObjects.Ellipse, 123.5, 300.25);
  expect([ellipse.x, ellipse.y, ellipse.depth]).toEqual([123.5, 300.25, 299.25]);
});
