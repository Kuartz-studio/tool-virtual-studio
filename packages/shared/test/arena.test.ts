import { describe, expect, test } from 'vitest';
import { ARENA_WEAPONS, arenaCommandSchema, arrowStep, insideRing, resolveMelee, ringPoints, ringStarts } from '../src/arena/arena';

const RING = { x: 100, y: 100, width: 320, height: 192 };

describe('l\'octogone : sa forme', () => {
  test('le milieu est dedans, les coins coupés sont dehors, comme tout ce qui sort du rectangle', () => {
    expect(insideRing(RING, 260, 196)).toBe(true);
    expect(insideRing(RING, 102, 102)).toBe(false);
    expect(insideRing(RING, 418, 290)).toBe(false);
    expect(insideRing(RING, 99, 196)).toBe(false);
    // Rétréci, le bord n'est plus dedans.
    expect(insideRing(RING, 102, 196)).toBe(true);
    expect(insideRing(RING, 102, 196, 12)).toBe(false);
  });

  test('huit sommets, et deux départs face à face dans le ring', () => {
    expect(ringPoints(RING)).toHaveLength(8);
    const [west, east] = ringStarts(RING);
    expect(west.dir).toBe('right');
    expect(east.dir).toBe('left');
    expect(insideRing(RING, west.x, west.y, 12) && insideRing(RING, east.x, east.y, 12)).toBe(true);
  });
});

describe('l\'octogone : les armes de mêlée', () => {
  test('un coup touche à portée, devant soi', () => {
    expect(resolveMelee('sword', { x: 0, y: 0, dir: 'right' }, { x: 40, y: 0 })).toBe(ARENA_WEAPONS.sword.damage);
  });

  test('trop loin, ou dans le dos : dans le vide', () => {
    expect(resolveMelee('sword', { x: 0, y: 0, dir: 'right' }, { x: ARENA_WEAPONS.sword.rangePx + 1, y: 0 })).toBeNull();
    expect(resolveMelee('sword', { x: 0, y: 0, dir: 'left' }, { x: 40, y: 0 })).toBeNull();
  });

  test('la lance porte plus loin que l\'épée ; le marteau frappe plus fort que le katana, mais plus lentement', () => {
    expect(resolveMelee('sword', { x: 0, y: 0, dir: 'right' }, { x: 80, y: 0 })).toBeNull();
    expect(resolveMelee('spear', { x: 0, y: 0, dir: 'right' }, { x: 80, y: 0 })).toBe(ARENA_WEAPONS.spear.damage);
    expect(ARENA_WEAPONS.hammer.damage).toBeGreaterThan(ARENA_WEAPONS.katana.damage);
    expect(ARENA_WEAPONS.hammer.cooldownMs).toBeGreaterThan(ARENA_WEAPONS.katana.cooldownMs);
  });

  test('l\'arc ne frappe pas au corps à corps : ses flèches volent', () => {
    expect(resolveMelee('bow', { x: 0, y: 0, dir: 'right' }, { x: 10, y: 0 })).toBeNull();
  });
});

describe('l\'octogone : les flèches', () => {
  const arrow = { x: 200, y: 200, dir: 'right' as const, traveled: 0, rangePx: 300 };

  test('une flèche touche la cible qu\'elle croise, même entre deux pas', () => {
    expect(arrowStep(arrow, 50, { x: 230, y: 210 }, RING)).toMatchObject({ hit: true, done: true });
  });

  test('elle passe à côté d\'une cible trop loin de sa ligne, ou derrière elle', () => {
    expect(arrowStep(arrow, 50, { x: 230, y: 240 }, RING).hit).toBe(false);
    expect(arrowStep(arrow, 50, { x: 150, y: 200 }, RING).hit).toBe(false);
  });

  test('elle s\'arrête au bout de sa portée, ou à la cage', () => {
    expect(arrowStep({ ...arrow, traveled: 290 }, 50, null, null)).toMatchObject({ traveled: 300, done: true });
    expect(arrowStep({ ...arrow, x: 410 }, 50, null, RING).done).toBe(true);
  });

  test('les commandes refusent ce qui n\'en est pas une', () => {
    expect(arenaCommandSchema.safeParse({ type: 'attack', dir: 'up' }).success).toBe(true);
    expect(arenaCommandSchema.safeParse({ type: 'weapon', weapon: 'bow' }).success).toBe(true);
    expect(arenaCommandSchema.safeParse({ type: 'weapon', weapon: 'bazooka' }).success).toBe(false);
    expect(arenaCommandSchema.safeParse({ type: 'join', role: 'referee' }).success).toBe(false);
  });
});
