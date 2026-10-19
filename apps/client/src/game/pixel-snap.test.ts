import { expect, test, vi } from 'vitest';
import { snapToPixels } from './pixel-snap';

test('snapToPixels arrondit toujours l\'affichage de l\'objet (mode full) et rend l\'objet', () => {
  const object = {
    setVertexRoundMode: vi.fn(function (this: unknown) {
      return this;
    }),
  };

  expect(snapToPixels(object as never)).toBe(object);
  // `full`, et non `safeAuto` (le défaut de Phaser 4), qui n'arrondit pas dès que la caméra est zoomée.
  expect(object.setVertexRoundMode).toHaveBeenCalledExactlyOnceWith('full');
});
