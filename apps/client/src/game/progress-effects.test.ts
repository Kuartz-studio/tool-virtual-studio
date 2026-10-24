import { describe, expect, test } from 'vitest';
import { BURST_LIFE_MS, FLOAT_LIFE_MS, FLOAT_RISE_PX, STARS, floatAt, starAt } from './progress-effects';

describe('le texte qui monte', () => {
  test('il paraît, monte de FLOAT_RISE_PX, puis s\'efface ; rien avant sa naissance ni après sa vie', () => {
    expect(floatAt(-1)).toBeNull();
    expect(floatAt(FLOAT_LIFE_MS)).toBeNull();
    expect(floatAt(0)).toEqual({ dy: -0, alpha: 0 });
    const middle = floatAt(FLOAT_LIFE_MS / 2)!;
    expect(middle.alpha).toBe(1);
    expect(middle.dy).toBeLessThan(0);
    expect(floatAt(FLOAT_LIFE_MS - 1)!.dy).toBeCloseTo(-FLOAT_RISE_PX, 0);
    expect(floatAt(FLOAT_LIFE_MS - 1)!.alpha).toBeLessThan(0.01);
  });

  test('en mouvement réduit, il ne monte pas', () => {
    expect(floatAt(FLOAT_LIFE_MS / 2, true)!.dy).toBe(0);
  });
});

describe('la gerbe d\'étoiles', () => {
  test('les étoiles partent vers le haut, en éventail, puis retombent', () => {
    const early = Array.from({ length: STARS }, (_, index) => starAt(150, index)!);
    for (const star of early) expect(star.dy).toBeLessThan(0);
    expect(early[0]!.dx).toBeLessThan(0);
    expect(early.at(-1)!.dx).toBeGreaterThan(0);
    // Plus tard, la chute l'emporte : l'étoile du milieu est redescendue sous son plus haut point.
    const middle = Math.floor(STARS / 2);
    expect(starAt(1000, middle)!.dy).toBeGreaterThan(starAt(400, middle)!.dy);
    expect(starAt(BURST_LIFE_MS, 0)).toBeNull();
  });

  test('en mouvement réduit : aucune étoile', () => {
    expect(starAt(100, 0, true)).toBeNull();
  });
});
