import { describe, expect, test } from 'vitest';
import { FLOOR_THEMES, SHOP_WALL_THEMES, TILE_ANIMATIONS, TILESET, WALL_THEMES, cycleOf, frameAt, tileAnimation, type TileAnimation } from '../src';

// Une animation d'essai : la base 500 ms, puis trois images de 100 ms ; 200 ms de retard par case.
const sweep: TileAnimation = { gid: 10, frames: [10, 11, 12, 13], durations: [500, 100, 100, 100], phase: 'x', step: 200 };

describe('l\'image que montre une case (frameAt)', () => {
  test('au fil du cycle : la base, puis les images, puis la base au tour suivant ; l\'heure peut être négative', () => {
    expect([0, 499, 500, 650, 799, 800].map((t) => frameAt(sweep, t, 0, 0))).toEqual([10, 10, 11, 12, 13, 10]);
    expect(frameAt(sweep, -1, 0, 0)).toBe(13);
    expect(cycleOf(sweep)).toBe(800);
  });

  test('x : la colonne voisine montre la même image `step` ms plus tard ; la rangée ne compte pas', () => {
    for (const t of [0, 450, 560, 700, 1234]) {
      expect(frameAt(sweep, t + 200, 1, 0)).toBe(frameAt(sweep, t, 0, 0));
      expect(frameAt(sweep, t, 3, 5)).toBe(frameAt(sweep, t, 3, 0));
    }
  });

  test('y le long d\'un pan, xy en diagonale sur un sol, sync partout pareil', () => {
    const down = { ...sweep, phase: 'y' as const };
    const diagonal = { ...sweep, phase: 'xy' as const };
    const together = { ...sweep, phase: 'sync' as const };
    for (const t of [0, 510, 777]) {
      expect(frameAt(down, t + 200, 4, 1)).toBe(frameAt(down, t, 9, 0));
      expect(frameAt(diagonal, t + 400, 1, 1)).toBe(frameAt(diagonal, t, 0, 0));
      expect(frameAt(diagonal, t, 2, 0)).toBe(frameAt(diagonal, t, 0, 2));
      expect(frameAt(together, t, 7, 3)).toBe(frameAt(together, t, 0, 0));
    }
  });

  test('scatter : un retard propre à chaque case, toujours le même, et pas le même pour toutes', () => {
    const scattered = { ...sweep, phase: 'scatter' as const };
    const at = (x: number, y: number) => Array.from({ length: 16 }, (_, i) => frameAt(scattered, i * 50, x, y)).join(',');
    expect(at(3, 4)).toBe(at(3, 4));
    const patterns = new Set(Array.from({ length: 30 }, (_, i) => at(i, 7)));
    expect(patterns.size).toBeGreaterThan(5);
  });
});

describe('les sols et les murs qui bougent (TILE_ANIMATIONS)', () => {
  const faces = [...WALL_THEMES, ...SHOP_WALL_THEMES];

  test('chaque ligne part d\'une tuile de thème, a une durée par image, et ses images sont dans le jeu de tuiles', () => {
    const themeTiles = new Set<number>([...FLOOR_THEMES.map((f) => f.gid), ...faces.flatMap((w) => [w.top, w.bottom, w.stem])]);
    for (const animation of TILE_ANIMATIONS) {
      expect(themeTiles.has(animation.gid), `tuile ${animation.gid}`).toBe(true);
      expect(animation.frames.length).toBe(animation.durations.length);
      expect(animation.frames.length).toBeGreaterThan(1);
      for (const duration of animation.durations) expect(duration).toBeGreaterThan(0);
      for (const frame of animation.frames) {
        expect(frame).toBeGreaterThanOrEqual(1);
        expect(frame).toBeLessThanOrEqual(TILESET.tileCount);
      }
      expect(tileAnimation(animation.gid)).toBe(animation);
    }
  });

  test('un reflet qui traverse se raccorde au bout du cycle : le cycle est un nombre entier de retards de case', () => {
    for (const animation of TILE_ANIMATIONS.filter((a) => a.phase === 'x' || a.phase === 'y' || a.phase === 'xy')) {
      expect(animation.step, `tuile ${animation.gid}`).toBeGreaterThan(0);
      expect(cycleOf(animation) % animation.step, `tuile ${animation.gid}`).toBe(0);
    }
  });

  test('le haut et le bas d\'une face de mur bougent ensemble : même cycle, même décalage', () => {
    for (const wall of faces) {
      const [top, bottom] = [tileAnimation(wall.top), tileAnimation(wall.bottom)];
      if (!top || !bottom) continue;
      expect([cycleOf(top), top.phase, top.step], wall.id).toEqual([cycleOf(bottom), bottom.phase, bottom.step]);
    }
  });

  test('la plupart des sols et des murs bougent, et tous les murs de la boutique', () => {
    const moves = (wall: (typeof faces)[number]) => [wall.top, wall.bottom, wall.stem].some((gid) => tileAnimation(gid) !== undefined);
    expect(FLOOR_THEMES.filter((floor) => tileAnimation(floor.gid)).length).toBeGreaterThanOrEqual(15);
    expect(WALL_THEMES.filter(moves).length).toBeGreaterThanOrEqual(15);
    expect(SHOP_WALL_THEMES.every(moves)).toBe(true);
  });
});
