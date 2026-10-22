import { WALK_SPEED_PX_PER_S, speedOf } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { RUN_ANIMATION_SCALE, stepAnimationScale } from './step-animation';

// Le dessin d'un pas (six images par direction) ne change pas : la cadence suit la vitesse, mais moins vite qu'elle. Avant la mise à jour,
// marcher (160 px/s) jouait l'animation à sa cadence, courir (480 px/s) à 1,7 fois.
describe('la cadence des pas suit la vitesse', () => {
  test('à la vitesse d\'hier (160 px/s), la cadence du dessin ; à la course d\'hier (480 px/s), RUN_ANIMATION_SCALE', () => {
    expect(stepAnimationScale(160)).toBe(1);
    expect(stepAnimationScale(480)).toBeCloseTo(RUN_ANIMATION_SCALE);
    expect(RUN_ANIMATION_SCALE).toBe(1.7);
  });

  test('entre les deux, en proportion : la marche d\'aujourd\'hui (320 px/s) est à 1,35', () => {
    expect(stepAnimationScale(WALK_SPEED_PX_PER_S)).toBeCloseTo(1.35);
  });

  test('sous café, les pas vont plus vite encore, sans jamais ralentir quand on accélère', () => {
    const speeds = [false, true].flatMap((boosted) => [false, true].map((sprint) => speedOf(sprint, boosted))).sort((a, b) => a - b);
    const scales = speeds.map(stepAnimationScale);
    expect([...scales].sort((a, b) => a - b)).toEqual(scales);
    expect(stepAnimationScale(960)).toBeCloseTo(2.75);
  });

  test('jamais plus lente que le dessin : à l\'arrêt ou presque, 1', () => {
    expect(stepAnimationScale(0)).toBe(1);
    expect(stepAnimationScale(100)).toBe(1);
  });
});
