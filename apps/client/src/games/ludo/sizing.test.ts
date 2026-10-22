import { describe, expect, test } from 'vitest';
import { CELL_MAX, CELL_MIN, cellSizeFor, hitSizeFor, horseSizeFor } from './sizing';

// Les tailles du plateau, en pixels : la case (d'après la largeur du conteneur), la zone cliquable d'un cheval, la tête de cheval.

describe('cellSizeFor : quinze cases entières, jamais plus larges que le conteneur', () => {
  test('un panneau de jeu (408 px) : 27 px ; un téléphone (311 px) : 20 px', () => {
    expect(cellSizeFor(408)).toBe(27);
    expect(cellSizeFor(311)).toBe(20);
  });

  test('bornée : de 12 px (en dessous rien ne se lit) à 30 px (un plateau de 450 px suffit, même dans une feuille large)', () => {
    expect(CELL_MIN).toBe(12);
    expect(CELL_MAX).toBe(30);
    expect(cellSizeFor(50)).toBe(CELL_MIN);
    expect(cellSizeFor(2000)).toBe(CELL_MAX);
  });

  test('toujours un entier, et quinze cases tiennent dans le conteneur dès qu\'il fait 180 px', () => {
    for (let width = 180; width <= 900; width++) {
      const cell = cellSizeFor(width);
      expect(Number.isInteger(cell)).toBe(true);
      expect(cell * 15).toBeLessThanOrEqual(width);
    }
  });
});

describe('hitSizeFor : la zone cliquable d\'un cheval fait 24 px au moins', () => {
  test('une case quand elle fait 24 px ou plus, davantage sinon (cases de 20 px sur téléphone)', () => {
    expect(hitSizeFor(27)).toBe(1);
    expect(hitSizeFor(24)).toBe(1);
    expect(hitSizeFor(20)).toBeCloseTo(1.2);
    expect(hitSizeFor(12)).toBe(2);
    for (let cell = CELL_MIN; cell <= CELL_MAX; cell++) expect(hitSizeFor(cell) * cell).toBeGreaterThanOrEqual(24);
  });
});

describe('horseSizeFor : la tête de cheval, en pixels', () => {
  test('24 px dès que la case fait 26 px : deux pixels d\'écran par pixel du dessin (12 × 12), des bords parfaitement nets', () => {
    expect(horseSizeFor(27)).toBe(24);
    expect(horseSizeFor(26)).toBe(24);
    expect(horseSizeFor(30)).toBe(24);
  });

  test('sinon 80 % de la case : 16 px sur téléphone (cases de 20 px), jamais plus grande que la case', () => {
    expect(horseSizeFor(20)).toBe(16);
    expect(horseSizeFor(25)).toBe(20);
    for (let cell = CELL_MIN; cell <= CELL_MAX; cell++) {
      expect(Number.isInteger(horseSizeFor(cell))).toBe(true);
      expect(horseSizeFor(cell)).toBeLessThan(cell);
      expect(horseSizeFor(cell)).toBeGreaterThanOrEqual(Math.floor(cell * 0.75));
    }
  });
});
