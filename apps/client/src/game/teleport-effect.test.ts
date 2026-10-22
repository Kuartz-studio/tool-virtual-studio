import { describe, expect, test } from 'vitest';
import { RING_END_RADIUS, RING_LIFE_MS, RING_POOL, RING_START_RADIUS, ringAt, TeleportEffect } from './teleport-effect';

// Un rond de poche : il note ce qu'on lui demande.
class FakeRing {
  x = 0;
  y = 0;
  radius = 1;
  alpha = 0;
  depth = 0;
  visible = true;
  stroked = false;
  destroyed = false;
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setRadius(radius: number) { this.radius = radius; return this; }
  setAlpha(alpha: number) { this.alpha = alpha; return this; }
  setDepth(depth: number) { this.depth = depth; return this; }
  setVisible(visible: boolean) { this.visible = visible; return this; }
  setFillStyle() { return this; }
  setStrokeStyle() { this.stroked = true; return this; }
  setVertexRoundMode() { return this; }
  destroy() { this.destroyed = true; }
}

function setup(reducedMotion = false) {
  const rings: FakeRing[] = [];
  const scene = {
    add: {
      circle: () => {
        const ring = new FakeRing();
        rings.push(ring);
        return ring;
      },
    },
  } as unknown as Phaser.Scene;
  const effect = new TeleportEffect(scene, () => reducedMotion);
  const shown = () => rings.filter((ring) => ring.visible);
  return { effect, rings, shown };
}

describe('un anneau de lumière', () => {
  test('il s\'ouvre de RING_START_RADIUS à RING_END_RADIUS en s\'effaçant, pendant RING_LIFE_MS, puis n\'est plus', () => {
    const born = ringAt(0)!;
    const half = ringAt(RING_LIFE_MS / 2)!;
    const late = ringAt(RING_LIFE_MS - 1)!;
    expect(born.radius).toBe(RING_START_RADIUS);
    expect(born.alpha).toBeGreaterThan(half.alpha);
    expect(half.alpha).toBeGreaterThan(late.alpha);
    expect(half.radius).toBeGreaterThan(born.radius);
    expect(late.radius).toBeGreaterThan(half.radius);
    expect(late.radius).toBeLessThanOrEqual(RING_END_RADIUS);
    expect(ringAt(RING_LIFE_MS)).toBeNull();
    expect(ringAt(-1)).toBeNull();
  });

  test('en mouvement réduit, il ne s\'ouvre pas : le même rayon, qui s\'efface seulement', () => {
    const start = ringAt(0, true)!;
    const late = ringAt(RING_LIFE_MS - 1, true)!;
    expect(start.radius).toBe(late.radius);
    expect(start.alpha).toBeGreaterThan(late.alpha);
  });
});

describe('TeleportEffect', () => {
  test('play : un anneau au point donné, en trait seul, devant le sol et les avatars', () => {
    const { effect, shown } = setup();
    effect.play({ x: 100, y: 200 }, 0);
    expect(shown()).toHaveLength(1);
    const [ring] = shown();
    expect(ring).toMatchObject({ x: 100, y: 200, stroked: true });
    expect(ring!.depth).toBeGreaterThan(200);
  });

  test('tick : il s\'ouvre, s\'efface, puis se cache au bout de RING_LIFE_MS', () => {
    const { effect, shown } = setup();
    effect.play({ x: 0, y: 0 }, 1000);
    const [ring] = shown();
    effect.tick(1000 + RING_LIFE_MS / 2);
    expect(ring!.radius).toBeCloseTo(ringAt(RING_LIFE_MS / 2)!.radius, 5);
    expect(ring!.alpha).toBeCloseTo(ringAt(RING_LIFE_MS / 2)!.alpha, 5);
    effect.tick(1000 + RING_LIFE_MS);
    expect(ring!.visible).toBe(false);
  });

  test('un départ et une arrivée en même temps : deux anneaux, chacun à sa place', () => {
    const { effect, shown } = setup();
    effect.play({ x: 10, y: 10 }, 0);
    effect.play({ x: 500, y: 600 }, 0);
    expect(shown().map((ring) => [ring.x, ring.y])).toEqual([[10, 10], [500, 600]]);
  });

  test('la réserve est bornée à RING_POOL anneaux : les plus anciens sont réutilisés', () => {
    const { effect, rings, shown } = setup();
    for (let i = 0; i < RING_POOL * 3; i++) effect.play({ x: i, y: i }, i);
    expect(rings).toHaveLength(RING_POOL);
    expect(shown().length).toBeLessThanOrEqual(RING_POOL);
    // Le dernier posé est bien là.
    expect(shown().some((ring) => ring.x === RING_POOL * 3 - 1)).toBe(true);
  });

  test('mouvement réduit : l\'anneau paraît sans s\'ouvrir, et s\'efface', () => {
    const { effect, shown } = setup(true);
    effect.play({ x: 0, y: 0 }, 0);
    const [ring] = shown();
    const radius = ring!.radius;
    effect.tick(RING_LIFE_MS / 2);
    expect(ring!.radius).toBe(radius);
    expect(ring!.alpha).toBeLessThan(1);
  });

  test('count : combien d\'anneaux sont en vie à cet instant', () => {
    const { effect } = setup();
    expect(effect.count(0)).toBe(0);
    effect.play({ x: 0, y: 0 }, 100);
    effect.play({ x: 5, y: 5 }, 300);
    expect(effect.count(350)).toBe(2);
    expect(effect.count(100 + RING_LIFE_MS)).toBe(1);
    expect(effect.count(300 + RING_LIFE_MS)).toBe(0);
  });

  test('destroy : tous les anneaux', () => {
    const { effect, rings } = setup();
    effect.destroy();
    expect(rings.every((ring) => ring.destroyed)).toBe(true);
  });
});
