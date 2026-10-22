import type { PieceType } from '@bureau/shared/games/chess';
import { describe, expect, test } from 'vitest';
import { SPRITE_SIZE, SPRITES, toneLayers } from './pieces';

// Les croquis des pièces (pixel art 16 × 16, § 9.5.6 : des lettres, pas des images) : leur forme, leur contour, leur symétrie, et le tracé SVG qu'on en tire.
const TYPES: PieceType[] = ['k', 'q', 'r', 'b', 'n', 'p'];
const cell = (type: PieceType, x: number, y: number): string => SPRITES[type][y]?.[x] ?? '.';
const solid = (type: PieceType, x: number, y: number): boolean => cell(type, x, y) !== '.';

describe('les croquis', () => {
  test.each(TYPES)('%s : seize lignes de seize lettres, de `.`, `#`, `o` et `s` seulement', (type) => {
    expect(SPRITES[type]).toHaveLength(SPRITE_SIZE);
    for (const line of SPRITES[type]) {
      expect(line).toHaveLength(SPRITE_SIZE);
      expect(line).toMatch(/^[.#os]+$/);
    }
    expect(SPRITES[type].join('')).toContain('o');
    expect(SPRITES[type].join('')).toContain('#');
  });

  test.each(TYPES)('%s : un contour ferme le dessin (aucun pixel plein n\'a de case vide à côté de lui), et le socle s\'arrête à la quinzième ligne', (type) => {
    for (let y = 0; y < SPRITE_SIZE; y++) {
      for (let x = 0; x < SPRITE_SIZE; x++) {
        const tone = cell(type, x, y);
        if (tone !== 'o' && tone !== 's') continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          expect(solid(type, x + dx, y + dy), `${type} : le pixel ${x},${y} touche le vide en ${x + dx},${y + dy}`).toBe(true);
        }
      }
    }
    expect(SPRITES[type][14]).toContain('#');
    expect(SPRITES[type][15]).toBe('.'.repeat(SPRITE_SIZE));
  });

  test('le roi, la dame, la tour, le fou et le pion sont symétriques ; le cavalier, qui regarde à gauche, ne l\'est pas', () => {
    for (const type of ['k', 'q', 'r', 'b', 'p'] as const) {
      for (let y = 0; y < SPRITE_SIZE; y++) {
        for (let x = 0; x < SPRITE_SIZE / 2; x++) expect(solid(type, x, y), `${type} ${x},${y}`).toBe(solid(type, SPRITE_SIZE - 1 - x, y));
      }
    }
    const knightMirrored = Array.from({ length: SPRITE_SIZE }, (_, y) => Array.from({ length: SPRITE_SIZE }, (_, x) => solid('n', SPRITE_SIZE - 1 - x, y)));
    const knight = Array.from({ length: SPRITE_SIZE }, (_, y) => Array.from({ length: SPRITE_SIZE }, (_, x) => solid('n', x, y)));
    expect(knight).not.toEqual(knightMirrored);
  });

  test('les six pièces ne se ressemblent pas', () => {
    const drawings = new Set(TYPES.map((type) => SPRITES[type].join('/')));
    expect(drawings.size).toBe(6);
  });

  test('le fou a sa fente en diagonale, le cavalier son œil : des pixels au trait à l\'intérieur du dessin', () => {
    expect(cell('b', 9, 4)).toBe('#');
    expect(cell('b', 8, 5)).toBe('#');
    expect(cell('b', 7, 6)).toBe('#');
    expect(cell('n', 5, 6)).toBe('#');
  });

  test('l\'ombre ne se pose que sur les pièces symétriques, du côté droit', () => {
    for (const type of ['k', 'q', 'r', 'b', 'p'] as const) {
      const shaded = SPRITES[type].flatMap((line) => [...line].flatMap((tone, x) => (tone === 's' ? [x] : [])));
      expect(shaded.length).toBeGreaterThan(0);
      expect(Math.min(...shaded)).toBeGreaterThanOrEqual(SPRITE_SIZE / 2);
    }
    expect(SPRITES.n.join('')).not.toContain('s');
  });
});

describe('toneLayers : le tracé SVG de chaque ton', () => {
  // L'aire d'un tracé fait de barres « M x y h w v 1 h -w z » : la somme des largeurs.
  const area = (path: string): number => [...path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)].reduce((sum, match) => sum + Number(match[3]), 0);

  test.each(TYPES)('%s : trois tracés, dont l\'aire est celle des pixels de chaque ton', (type) => {
    const layers = toneLayers(type);
    for (const tone of ['#', 'o', 's'] as const) {
      const count = SPRITES[type].join('').split(tone).length - 1;
      expect(area(layers[tone]), `${type} ${tone}`).toBe(count);
    }
  });

  test('chaque barre est au bon endroit : le pixel de départ de la première barre du roi est celui du dessin', () => {
    const first = /M(\d+) (\d+)h/.exec(toneLayers('k')['#'])!;
    expect(cell('k', Number(first[1]), Number(first[2]))).toBe('#');
  });
});
