import { STATUSES } from '@bureau/shared';
import { expect, test } from 'vitest';
import { cssColor, STATUS_COLORS, statusCssColor } from './status';

test('les couleurs des statuts : vert, orange, gris, rouge', () => {
  expect(STATUS_COLORS).toEqual({ available: 0x22c55e, busy: 0xf59e0b, away: 0x9ca3af, dnd: 0xef4444 });
  expect(Object.keys(STATUS_COLORS).sort()).toEqual([...STATUSES].sort());
});

test('statusCssColor : la même couleur en CSS (#rrggbb), pour l\'interface en HTML', () => {
  expect(statusCssColor('available')).toBe('#22c55e');
  expect(statusCssColor('busy')).toBe('#f59e0b');
  expect(statusCssColor('away')).toBe('#9ca3af');
  expect(statusCssColor('dnd')).toBe('#ef4444');
});

test('cssColor garde les zéros de tête : le CSS veut toujours six chiffres', () => {
  expect(cssColor(0x00ff0a)).toBe('#00ff0a');
  expect(cssColor(0x000001)).toBe('#000001');
  expect(cssColor(0)).toBe('#000000');
  expect(cssColor(0xffffff)).toBe('#ffffff');
});
