import { describe, expect, test } from 'vitest';
import { HORSE_PIXELS, HORSE_ROWS, HORSE_SIZE, horsePaths } from './horse-art';

// La tête de cheval en pixel art (12 × 12) : dessinée en lettres, comme les pochettes des ambiances (office/ambiance-covers.ts), puis rendue en SVG.

describe('la grille de lettres', () => {
  test('12 lignes de 12 lettres', () => {
    expect(HORSE_SIZE).toBe(12);
    expect(HORSE_ROWS).toHaveLength(HORSE_SIZE);
    for (const row of HORSE_ROWS) expect(row).toHaveLength(HORSE_SIZE);
  });

  test('seulement des lettres connues : le contour, le corps, le reflet, la crinière, l\'œil, son éclat et le naseau', () => {
    const letters = new Set(HORSE_ROWS.join('').replaceAll('.', ''));
    expect([...letters].sort()).toEqual(['b', 'e', 'l', 'm', 'n', 'o', 'w']);
  });

  test('le contour est fermé : aucun pixel peint ne touche le vide, ni le bord de la grille, sans être un contour', () => {
    const at = (x: number, y: number): string => HORSE_ROWS[y]?.[x] ?? '.';
    HORSE_ROWS.forEach((row, y) =>
      [...row].forEach((letter, x) => {
        if (letter === '.' || letter === 'o') return;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          expect(at(x + dx, y + dy), `le pixel ${letter} en (${x}, ${y}) touche le vide`).not.toBe('.');
        }
      }),
    );
  });

  test('un cheval qui se lit : deux oreilles en haut, un œil, un naseau, une crinière sombre et un museau clair', () => {
    expect(HORSE_ROWS[0]!.replaceAll('.', '')).toBe('oo');
    const count = (letter: string) => HORSE_ROWS.join('').split(letter).length - 1;
    expect(count('e')).toBe(1);
    expect(count('w')).toBe(1);
    expect(count('n')).toBe(1);
    expect(count('m')).toBeGreaterThanOrEqual(8);
    expect(count('l')).toBeGreaterThanOrEqual(4);
  });
});

describe('horsePaths : le SVG', () => {
  test('un chemin par lettre, qui peint exactement les pixels de cette lettre', () => {
    const paths = horsePaths();
    expect(paths.map((path) => path.key).sort()).toEqual(['b', 'e', 'l', 'm', 'n', 'o', 'w']);
    for (const { key, d } of paths) {
      // Chaque morceau « M x y h n v1 h-n z » est une suite de n pixels sur une ligne.
      const painted = new Set<string>();
      for (const piece of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
        const [x, y, length] = [Number(piece[1]), Number(piece[2]), Number(piece[3])];
        for (let i = 0; i < length; i++) painted.add(`${x + i},${y}`);
      }
      const expected = new Set<string>();
      HORSE_ROWS.forEach((row, y) => [...row].forEach((letter, x) => letter === key && expected.add(`${x},${y}`)));
      expect(painted, `la lettre ${key}`).toEqual(expected);
      // Et rien d'autre dans le chemin que ces morceaux.
      expect(d.replace(/M\d+ \d+h\d+v1h-\d+z/g, '')).toBe('');
    }
  });

  test('les pixels voisins d\'une même lettre sont fondus en un seul morceau : bien moins de morceaux que de pixels', () => {
    const pieces = horsePaths().reduce((sum, { d }) => sum + (d.match(/M/g)?.length ?? 0), 0);
    expect(HORSE_PIXELS).toBe(HORSE_ROWS.join('').replaceAll('.', '').length);
    expect(pieces).toBeLessThan(HORSE_PIXELS);
    expect(pieces).toBeGreaterThan(20);
  });
});
