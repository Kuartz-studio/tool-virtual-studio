import { FLOOR_THEMES, TILE_ANIMATIONS, frameAt } from '@bureau/shared';
import type { Tilemaps } from 'phaser';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { prefersReducedMotion } from './reduced-motion';
import { TileAnimator } from './tile-animator';

vi.mock('./reduced-motion', () => ({ prefersReducedMotion: vi.fn(() => false) }));

// Un faux calque : une case par coordonnée, dont seul le numéro de tuile compte.
function fakeLayer(name: string) {
  const tiles = new Map<string, { index: number }>();
  const layer = {
    layer: { name },
    getTileAt: (x: number, y: number) => {
      const key = `${x},${y}`;
      if (!tiles.has(key)) tiles.set(key, { index: -1 });
      return tiles.get(key)!;
    },
  };
  return { layer: layer as unknown as Tilemaps.TilemapLayer, tile: (x: number, y: number) => layer.getTileAt(x, y) };
}

const moving = TILE_ANIMATIONS.find((a) => a.phase === 'x')!;
const still = FLOOR_THEMES.find((floor) => !TILE_ANIMATIONS.some((a) => a.gid === floor.gid))!;

beforeEach(() => {
  vi.mocked(prefersReducedMotion).mockReturnValue(false);
});

describe('les tuiles qui bougent dans les bureaux (TileAnimator)', () => {
  test('une case posée avec une tuile animée montre, à chaque instant, l\'image de son animation ; sa voisine prend son retard', () => {
    const { layer, tile } = fakeLayer('murs');
    const animator = new TileAnimator();
    for (const x of [4, 5]) {
      tile(x, 2).index = moving.gid;
      animator.place(layer, x, 2, moving.gid);
    }
    expect(animator.size).toBe(2);
    for (const now of [0, 1_000, moving.durations[0]! + 5, 123_456]) {
      animator.tick(now);
      expect(tile(4, 2).index).toBe(frameAt(moving, now, 4, 2));
      expect(tile(5, 2).index).toBe(frameAt(moving, now, 5, 2));
    }
  });

  test('une tuile sans animation ne bouge pas, et repeindre une case avec elle l\'arrête', () => {
    const { layer, tile } = fakeLayer('sol');
    const animator = new TileAnimator();
    animator.place(layer, 1, 1, still.gid);
    expect(animator.size).toBe(0);
    animator.place(layer, 1, 1, moving.gid);
    animator.place(layer, 1, 1, still.gid);
    tile(1, 1).index = still.gid;
    animator.tick(moving.durations[0]! + 10);
    expect(tile(1, 1).index).toBe(still.gid);
    expect(animator.size).toBe(0);
  });

  test('deux calques ne se confondent pas : la même case du sol et des murs a chacune sa tuile', () => {
    const sol = fakeLayer('sol');
    const murs = fakeLayer('murs');
    const animator = new TileAnimator();
    animator.place(sol.layer, 0, 0, moving.gid);
    animator.place(murs.layer, 0, 0, still.gid);
    expect(animator.size).toBe(1);
  });

  test('qui demande moins de mouvement voit la tuile de base', () => {
    const { layer, tile } = fakeLayer('murs');
    const animator = new TileAnimator();
    animator.place(layer, 0, 0, moving.gid);
    const busy = moving.durations[0]! + 1;
    animator.tick(busy);
    vi.mocked(prefersReducedMotion).mockReturnValue(true);
    animator.tick(busy);
    expect(tile(0, 0).index).toBe(moving.gid);
  });
});
