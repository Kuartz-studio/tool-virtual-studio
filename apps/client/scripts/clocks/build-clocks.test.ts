import { existsSync } from 'node:fs';
import { CLOCK_ATLAS, CLOCK_ITEMS, TILE_SIZE } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { readImage, type Img } from '../assets/image';
import { CLOCK_ATLAS_PATH, CLOCK_PREVIEW_PATH, buildClockAtlas, buildPreview } from './build-clocks';

// Les pixels opaques d'un rectangle de l'image.
function opaque(img: Img, x: number, y: number, w: number, h: number): number {
  let count = 0;
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (img.alphaAt(xx, yy) > 0) count++;
  return count;
}

// Les pixels qui diffèrent entre deux rectangles de la même taille.
function differing(img: Img, a: { x: number; y: number }, b: { x: number; y: number }, w: number, h: number): number {
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [p, q] = [img.get(a.x + x, a.y + y), img.get(b.x + x, b.y + y)];
      if (p.r !== q.r || p.g !== q.g || p.b !== q.b || p.a !== q.a) count++;
    }
  }
  return count;
}

describe('l\'atlas des horloges murales', () => {
  const atlas = buildClockAtlas();

  test('celui du dépôt est celui que dessine le script : `pnpm --filter @bureau/client gen:clocks` après tout changement de dessin', () => {
    const committed = readImage(CLOCK_ATLAS_PATH);
    expect([committed.width, committed.height]).toEqual([CLOCK_ATLAS.width, CLOCK_ATLAS.height]);
    expect(Buffer.from(committed.data).equals(Buffer.from(atlas.data))).toBe(true);
  });

  test('chaque horloge a son image et son cadran nu ; l\'image a les aiguilles en plus', () => {
    for (const item of CLOCK_ITEMS) {
      const [w, h] = [item.w * TILE_SIZE, item.h * TILE_SIZE];
      const bare = { x: item.fx, y: item.fy + CLOCK_ATLAS.bareRowOffset };
      expect(opaque(atlas, item.fx, item.fy, w, h), item.id).toBeGreaterThan(w * h * 0.25);
      expect(opaque(atlas, bare.x, bare.y, w, h), item.id).toBeGreaterThan(w * h * 0.25);
      expect(differing(atlas, { x: item.fx, y: item.fy }, bare, w, h), item.id).toBeGreaterThan(8);
    }
  });

  test('rien ne déborde dans les deux pixels vides qui entourent chaque image', () => {
    let inside = 0;
    for (const item of CLOCK_ITEMS) {
      const [w, h] = [item.w * TILE_SIZE, item.h * TILE_SIZE];
      inside += opaque(atlas, item.fx, item.fy, w, h) + opaque(atlas, item.fx, item.fy + CLOCK_ATLAS.bareRowOffset, w, h);
    }
    expect(opaque(atlas, 0, 0, atlas.width, atlas.height)).toBe(inside);
  });

  test('l\'aperçu (docs/horloges.png) est à jour', () => {
    expect(existsSync(CLOCK_PREVIEW_PATH)).toBe(true);
    const committed = readImage(CLOCK_PREVIEW_PATH);
    expect(Buffer.from(committed.data).equals(Buffer.from(buildPreview().data))).toBe(true);
  });
});
