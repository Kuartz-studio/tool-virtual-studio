import { describe, expect, test } from 'vitest';
import { BOB_MS, PULSE_MS, SPIN_MS, gemAt, pulseAt } from './walk-marker';

// La marque de la case où l'on court : deux anneaux qui pulsent, une gemme qui tourne en flottant.
describe('pulseAt', () => {
  test('un anneau s\'ouvre et s\'efface en PULSE_MS, puis recommence', () => {
    const start = pulseAt(0, 0);
    const middle = pulseAt(PULSE_MS / 2, 0);
    const late = pulseAt(PULSE_MS * 0.99, 0);
    expect(middle.radius).toBeGreaterThan(start.radius);
    expect(late.radius).toBeGreaterThan(middle.radius);
    expect(middle.alpha).toBeLessThan(start.alpha);
    expect(late.alpha).toBeLessThan(0.02);
    const same = (a: { radius: number; alpha: number }, b: { radius: number; alpha: number }) => {
      expect(a.radius).toBeCloseTo(b.radius, 9);
      expect(a.alpha).toBeCloseTo(b.alpha, 9);
    };
    same(pulseAt(PULSE_MS, 0), start);
    same(pulseAt(3 * PULSE_MS + 123, 0), pulseAt(123, 0));
  });

  test('le second anneau a une demi-période d\'avance : il y en a toujours un de visible', () => {
    expect(pulseAt(0, 0.5).radius).toBeCloseTo(pulseAt(PULSE_MS / 2, 0).radius, 9);
    for (let t = 0; t < PULSE_MS; t += 50) expect(Math.max(pulseAt(t, 0).alpha, pulseAt(t, 0.5).alpha)).toBeGreaterThan(0.35);
  });

  test('en mouvement réduit : un seul anneau, fixe', () => {
    expect(pulseAt(0, 0, true)).toEqual(pulseAt(777, 0, true));
    expect(pulseAt(0, 0.5, true).alpha).toBe(0);
  });
});

describe('gemAt', () => {
  test('elle tourne sur elle-même en SPIN_MS : de face, de profil, de dos, de profil, de face', () => {
    expect(gemAt(0)).toMatchObject({ width: 1, front: true });
    expect(gemAt(SPIN_MS / 4).width).toBeLessThan(0.2);
    expect(gemAt(SPIN_MS / 2)).toMatchObject({ width: 1, front: false });
    expect(gemAt(SPIN_MS).front).toBe(true);
  });

  test('elle flotte : au plus bas au départ, au plus haut à mi-période', () => {
    expect(gemAt(BOB_MS / 2).lift).toBeGreaterThan(gemAt(0).lift);
    expect(gemAt(BOB_MS).lift).toBeCloseTo(gemAt(0).lift, 9);
  });

  test('en mouvement réduit, elle ne tourne ni ne flotte', () => {
    expect(gemAt(SPIN_MS / 4, true)).toEqual(gemAt(0, true));
    expect(gemAt(0, true)).toMatchObject({ width: 1, front: true });
  });
});
