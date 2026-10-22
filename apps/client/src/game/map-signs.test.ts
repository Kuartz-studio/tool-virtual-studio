import { TILE_SIZE } from '@bureau/shared';
import { describe, expect, test, vi } from 'vitest';
import { DECOR_DEPTH } from './decor-layout';
import { SIGN, SIGN_TEXTURE, addMapSigns, addSignTexture, signRows } from './map-signs';

describe('le panneau de chantier, tracé en code', () => {
  const rows = signRows();

  test('24 × 20 pixels : une planche à bandes jaunes et noires, deux pieds, et leur ombre', () => {
    expect([SIGN.width, SIGN.height]).toEqual([24, 20]);
    expect(rows).toHaveLength(20);
    for (const row of rows) expect(row).toHaveLength(24);
    const painted = rows.join('');
    for (const color of ['y', 'k', 'o', 'g', 's']) expect(painted, color).toContain(color);
    // Rien d'autre que les couleurs et le transparent.
    expect(painted.replace(/[ykogs.]/g, '')).toBe('');
  });

  test('les bandes sont en biais, de 3 pixels : jaune quand (colonne + rangée) mod 6 < 3, noir sinon', () => {
    for (let y = 1; y < 12; y++) for (let x = 1; x < 23; x++) expect(rows[y]![x], `${x}, ${y}`).toBe((x + y) % 6 < 3 ? 'y' : 'k');
  });

  test('deux pieds sous la planche, séparés ; au-delà d\'elle les coins sont transparents', () => {
    expect(rows[13]).toBe('....ggg..........ggg....');
    expect(rows[0]![0]).toBe('.');
    expect(rows[12]![23]).toBe('.');
  });
});

describe('addSignTexture', () => {
  function fakeTextures(existing: string[] = []) {
    const added: Array<{ key: string; canvas: { width: number; height: number } }> = [];
    return {
      added,
      textures: { exists: (key: string) => existing.includes(key), addCanvas: (key: string, canvas: { width: number; height: number }) => added.push({ key, canvas }) } as never,
    };
  }
  const makeCanvas = () => {
    const fills: Array<[number, number]> = [];
    const context = { fillStyle: '', fillRect: (x: number, y: number) => fills.push([x, y]) };
    return { width: 0, height: 0, getContext: () => context, fills } as unknown as HTMLCanvasElement & { fills: Array<[number, number]> };
  };

  test('une texture de la taille du panneau, avec un pixel de chaque couleur peint', () => {
    const { added, textures } = fakeTextures();
    const canvas = makeCanvas();
    addSignTexture(textures, () => canvas);
    expect(added).toHaveLength(1);
    expect(added[0]!.key).toBe(SIGN_TEXTURE);
    expect([canvas.width, canvas.height]).toEqual([24, 20]);
    const painted = signRows().join('').replaceAll('.', '').length;
    expect(canvas.fills).toHaveLength(painted);
  });

  test('une texture déjà là n\'est pas refaite (le jeu relance la scène)', () => {
    const { added, textures } = fakeTextures([SIGN_TEXTURE]);
    addSignTexture(textures, makeCanvas);
    expect(added).toHaveLength(0);
  });
});

describe('addMapSigns : les panneaux de la carte', () => {
  // Un objet de jeu de poche : il note ce qu'on lui demande.
  class FakeObject {
    depth = 0;
    constructor(readonly kind: string, readonly x: number, readonly y: number, readonly extra: Record<string, unknown>) {}
    setDepth(depth: number) { this.depth = depth; return this; }
    setOrigin() { return this; }
    setVertexRoundMode() { return this; }
  }
  function fakeScene() {
    const made: FakeObject[] = [];
    const scene = {
      add: {
        image: vi.fn((x: number, y: number, texture: string) => made[made.push(new FakeObject('image', x, y, { texture })) - 1]),
        text: vi.fn((x: number, y: number, text: string) => made[made.push(new FakeObject('text', x, y, { text })) - 1]),
      },
    } as unknown as Phaser.Scene;
    return { scene, made };
  }

  test('une image par panneau, les pieds au bas de sa case, et son texte écrit en dessous', () => {
    const { scene, made } = fakeScene();
    addMapSigns(scene, [{ x: 73 * TILE_SIZE, y: 5 * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE, text: 'EN TRAVAUX' }]);
    const image = made.find((o) => o.kind === 'image')!;
    const text = made.find((o) => o.kind === 'text')!;
    // Centré dans sa case, ses pieds posés au bas de la case.
    expect(image.x).toBe(73 * TILE_SIZE + TILE_SIZE / 2);
    expect(image.y).toBe(6 * TILE_SIZE);
    expect(image.extra.texture).toBe(SIGN_TEXTURE);
    // Il est devant le sol et les tapis, derrière ce qui est plus bas que lui : comme un meuble, par le bas de sa case.
    expect(image.depth).toBe(6 * TILE_SIZE);
    expect(image.depth).toBeGreaterThan(DECOR_DEPTH.wall);
    // Le texte est sous lui, dans l'écriture des inscriptions de la carte.
    expect(text.extra.text).toBe('EN TRAVAUX');
    expect(text.y).toBeGreaterThan(image.y);
  });

  test('sans panneau, rien n\'est dessiné', () => {
    const { scene, made } = fakeScene();
    addMapSigns(scene, []);
    expect(made).toEqual([]);
  });
});
