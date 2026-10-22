import { describe, expect, test } from 'vitest';
import { behindFeet, DUST_INTERVAL_MS, DUST_LIFE_MS, DUST_POOL, dustPuff, DustTrail } from './DustTrail';

// Un petit rond de poche : il note ce qu'on lui demande.
class FakeCircle {
  x = 0;
  y = 0;
  radius = 1;
  alpha = 0;
  depth = 0;
  visible = true;
  destroyed = false;
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setRadius(radius: number) { this.radius = radius; return this; }
  setAlpha(alpha: number) { this.alpha = alpha; return this; }
  setDepth(depth: number) { this.depth = depth; return this; }
  setVisible(visible: boolean) { this.visible = visible; return this; }
  setStrokeStyle() { return this; }
  setVertexRoundMode() { return this; }
  destroy() { this.destroyed = true; }
}

function setup(options: { reducedMotion?: boolean } = {}) {
  const circles: FakeCircle[] = [];
  const scene = {
    add: {
      circle: () => {
        const circle = new FakeCircle();
        circles.push(circle);
        return circle;
      },
    },
  } as unknown as Phaser.Scene;
  const trail = new DustTrail(scene, () => options.reducedMotion ?? false);
  const shown = () => circles.filter((circle) => circle.visible);
  return { trail, circles, shown };
}

const FEET = { x: 200, y: 300 };

describe('un nuage', () => {
  test('il grossit et s\'efface pendant DUST_LIFE_MS, puis n\'est plus', () => {
    const born = dustPuff(0)!;
    const half = dustPuff(DUST_LIFE_MS / 2)!;
    const last = dustPuff(DUST_LIFE_MS - 1)!;
    expect(born.alpha).toBeGreaterThan(half.alpha);
    expect(half.alpha).toBeGreaterThan(last.alpha);
    expect(born.radius).toBeLessThan(half.radius);
    expect(half.radius).toBeLessThan(last.radius);
    expect(dustPuff(DUST_LIFE_MS)).toBeNull();
    expect(dustPuff(-1)).toBeNull();
  });

  test('behindFeet : derrière l\'avatar, dans le sens opposé à celui où il va', () => {
    expect(behindFeet('right')).toEqual({ x: -1, y: 0 });
    expect(behindFeet('left')).toEqual({ x: 1, y: 0 });
    expect(behindFeet('down')).toEqual({ x: 0, y: -1 });
    expect(behindFeet('up')).toEqual({ x: 0, y: 1 });
  });
});

describe('DustTrail', () => {
  test('un avatar qui court sous café laisse un nuage derrière lui, tous les DUST_INTERVAL_MS au plus', () => {
    const { trail, shown } = setup();
    trail.update(0, FEET, true, 'right');
    expect(shown()).toHaveLength(1);
    trail.update(DUST_INTERVAL_MS - 1, FEET, true, 'right');
    expect(shown()).toHaveLength(1);
    trail.update(DUST_INTERVAL_MS, FEET, true, 'right');
    expect(shown()).toHaveLength(2);
  });

  test('le nuage naît derrière ses pieds, et juste sous lui en profondeur (devant le sol, derrière l\'avatar)', () => {
    const { trail, shown } = setup();
    trail.update(0, FEET, true, 'right');
    const [puff] = shown();
    expect(puff!.x).toBeLessThan(FEET.x);
    expect(puff!.y).toBe(FEET.y);
    expect(puff!.depth).toBeLessThan(FEET.y);
    expect(puff!.depth).toBeGreaterThan(FEET.y - 1);
  });

  test('il reste où il est né : l\'avatar a beau avancer, le nuage ne le suit pas', () => {
    const { trail, shown } = setup();
    trail.update(0, FEET, true, 'right');
    const [puff] = shown();
    const born = { x: puff!.x, y: puff!.y };
    trail.update(100, { x: FEET.x + 60, y: FEET.y }, false, 'right');
    expect({ x: puff!.x, y: puff!.y }).toEqual(born);
  });

  test('pas de nuage à l\'arrêt, ni sans café (l\'appelant ne dit « court » que sous café)', () => {
    const { trail, shown } = setup();
    trail.update(0, FEET, false, 'right');
    trail.update(500, FEET, false, 'down');
    expect(shown()).toHaveLength(0);
  });

  test('un nuage s\'efface et disparaît au bout de DUST_LIFE_MS', () => {
    const { trail, shown } = setup();
    trail.update(0, FEET, true, 'right');
    const [puff] = shown();
    trail.update(DUST_LIFE_MS / 2, FEET, false, 'right');
    expect(puff!.visible).toBe(true);
    expect(puff!.alpha).toBeCloseTo(dustPuff(DUST_LIFE_MS / 2)!.alpha, 5);
    expect(puff!.radius).toBeCloseTo(dustPuff(DUST_LIFE_MS / 2)!.radius, 5);
    trail.update(DUST_LIFE_MS, FEET, false, 'right');
    expect(puff!.visible).toBe(false);
  });

  test('la réserve est bornée à DUST_POOL ronds : les plus anciens sont réutilisés, rien ne s\'accumule', () => {
    const { trail, circles, shown } = setup();
    expect(circles).toHaveLength(DUST_POOL);
    for (let now = 0; now < 10 * DUST_LIFE_MS; now += DUST_INTERVAL_MS) trail.update(now, FEET, true, 'right');
    expect(circles).toHaveLength(DUST_POOL);
    expect(shown().length).toBeLessThanOrEqual(DUST_POOL);
    expect(shown().length).toBeGreaterThanOrEqual(DUST_LIFE_MS / DUST_INTERVAL_MS - 1);
  });

  test('mouvement réduit : aucun nuage', () => {
    const { trail, shown } = setup({ reducedMotion: true });
    for (let now = 0; now < 1000; now += DUST_INTERVAL_MS) trail.update(now, FEET, true, 'right');
    expect(shown()).toHaveLength(0);
  });

  test('destroy : tous les ronds', () => {
    const { trail, circles } = setup();
    trail.destroy();
    expect(circles.every((circle) => circle.destroyed)).toBe(true);
  });
});
