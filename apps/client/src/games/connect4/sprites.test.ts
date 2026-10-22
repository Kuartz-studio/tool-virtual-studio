import { describe, expect, test } from 'vitest';
import { contrast } from './contrast';
import { DISC_ROWS, MARKER_OUTLINE, SLOT_PALETTE, SPRITE_SIZE, TOKEN_PALETTES, spriteLayers, type Palette } from './sprites';

// Les jetons et les trous sont dessinés en code : des lignes de lettres (une lettre, un pixel) et une palette par couleur, comme les pochettes du juke-box (office/ambiance-covers.ts).
// Aucun fichier d'image : l'interface en fait des SVG aux bords nets, à l'échelle entière.

// Les pixels d'un sprite, tels que ses couches les dessinent : on relit les chemins (`M x y h largeur v 1 h -largeur z`) pour retrouver, case par case, la couleur peinte.
function paint(layers: ReturnType<typeof spriteLayers>): Array<Array<string | null>> {
  const grid: Array<Array<string | null>> = Array.from({ length: SPRITE_SIZE }, () => Array.from({ length: SPRITE_SIZE }, () => null));
  for (const { color, d } of layers) {
    for (const [, x, y, width] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let dx = 0; dx < Number(width); dx++) {
        const cell = grid[Number(y)]![Number(x) + dx];
        if (cell === undefined) throw new Error(`pixel hors du sprite : ${x}+${dx}, ${y}`);
        if (grid[Number(y)]![Number(x) + dx] !== null) throw new Error(`pixel peint deux fois : ${Number(x) + dx}, ${y}`);
        grid[Number(y)]![Number(x) + dx] = color;
      }
    }
  }
  return grid;
}

describe('le dessin d\'un jeton', () => {
  test('13 lignes de 13 lettres : un disque, symétrique de gauche à droite et de haut en bas', () => {
    expect(SPRITE_SIZE).toBe(13);
    expect(DISC_ROWS).toHaveLength(13);
    for (const row of DISC_ROWS) expect(row).toHaveLength(13);
    const silhouette = DISC_ROWS.map((row) => [...row].map((letter) => letter !== '.'));
    for (let y = 0; y < 13; y++) {
      for (let x = 0; x < 13; x++) {
        expect(silhouette[y]![x], `(${x}, ${y}) et son symétrique à droite`).toBe(silhouette[y]![12 - x]);
        expect(silhouette[y]![x], `(${x}, ${y}) et son symétrique en bas`).toBe(silhouette[12 - y]![x]);
      }
    }
  });

  test('le disque est plein : chaque ligne est d\'un seul tenant, du bord gauche au bord droit, et le milieu est tout à fait dedans', () => {
    for (const [y, row] of DISC_ROWS.entries()) expect(row, `ligne ${y}`).toMatch(/^\.*[^.]+\.*$/);
    expect(DISC_ROWS[6]).toBe(DISC_ROWS[6]!.replaceAll('.', 'x'));
    expect(DISC_ROWS[0]!.replaceAll('.', '')).toHaveLength(5);
    expect(DISC_ROWS[4]!.replaceAll('.', '')).toHaveLength(13);
  });

  test('chaque lettre du dessin a sa couleur dans chaque palette (rouge, jaune, et le trou), en #rrggbb', () => {
    const letters = new Set([...DISC_ROWS.join('')].filter((letter) => letter !== '.'));
    expect(letters.size).toBeGreaterThanOrEqual(4);
    for (const [name, palette] of [['rouge', TOKEN_PALETTES.red], ['jaune', TOKEN_PALETTES.yellow], ['trou', SLOT_PALETTE], ['rouge du dernier jeton', TOKEN_PALETTES.redLast], ['jaune du dernier jeton', TOKEN_PALETTES.yellowLast]] as const) {
      for (const letter of letters) expect(palette[letter], `${name}, lettre « ${letter} »`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test('le dernier jeton a le même dessin dont le contour est blanc : un cerclage qui ne change ni la forme ni la taille', () => {
    expect(MARKER_OUTLINE).toBe('#ffffff');
    for (const [plain, last] of [[TOKEN_PALETTES.red, TOKEN_PALETTES.redLast], [TOKEN_PALETTES.yellow, TOKEN_PALETTES.yellowLast]] as const) {
      expect(last.o).toBe(MARKER_OUTLINE);
      expect(plain.o).not.toBe(MARKER_OUTLINE);
      for (const letter of Object.keys(plain).filter((key) => key !== 'o')) expect(last[letter], `lettre ${letter}`).toBe(plain[letter]);
    }
  });
});

describe('les couches d\'un sprite (le SVG)', () => {
  test('une couche par couleur, des chemins de rectangles d\'un pixel de haut : rien ne se chevauche, et on retrouve le dessin pixel pour pixel', () => {
    for (const palette of [TOKEN_PALETTES.red, TOKEN_PALETTES.yellow, SLOT_PALETTE, TOKEN_PALETTES.redLast]) {
      const layers = spriteLayers(DISC_ROWS, palette);
      expect(new Set(layers.map((layer) => layer.color)).size).toBe(layers.length);
      const painted = paint(layers);
      for (const [y, row] of DISC_ROWS.entries()) {
        for (const [x, letter] of [...row].entries()) expect(painted[y]![x], `(${x}, ${y})`).toBe(letter === '.' ? null : palette[letter]);
      }
    }
  });

  test('une lettre sans couleur dans la palette n\'est pas peinte (transparent), plutôt que d\'échouer', () => {
    const layers = spriteLayers(['ab', 'ba'], { a: '#112233' } satisfies Palette);
    expect(layers).toEqual([{ color: '#112233', d: 'M0 0h1v1h-1zM1 1h1v1h-1z' }]);
  });

  test('des pixels de même couleur côte à côte forment un seul rectangle', () => {
    expect(spriteLayers(['aab', 'baa'], { a: '#112233', b: '#445566' })).toEqual([
      { color: '#112233', d: 'M0 0h2v1h-2zM1 1h2v1h-2z' },
      { color: '#445566', d: 'M2 0h1v1h-1zM0 1h1v1h-1z' },
    ]);
  });
});

describe('les couleurs se distinguent', () => {
  test('le contraste d\'une couleur à une autre : 21 pour noir sur blanc, 1 pour deux fois la même', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#336699', '#336699')).toBeCloseTo(1, 5);
  });

  test('un jeton se distingue d\'un trou vide (3 contre 1 au moins), et le rouge du jaune : la couleur ne dit pas tout, mais elle se voit', () => {
    expect(contrast(TOKEN_PALETTES.red.b!, SLOT_PALETTE.b!)).toBeGreaterThanOrEqual(3);
    expect(contrast(TOKEN_PALETTES.yellow.b!, SLOT_PALETTE.b!)).toBeGreaterThanOrEqual(3);
    expect(contrast(TOKEN_PALETTES.red.b!, TOKEN_PALETTES.yellow.b!)).toBeGreaterThanOrEqual(3);
  });

  test('le cerclage du dernier jeton se détache du trou voisin : 3 contre 1 au moins (le plateau, lui, est vu avec la feuille de style)', () => {
    expect(contrast(MARKER_OUTLINE, SLOT_PALETTE.o!)).toBeGreaterThanOrEqual(3);
    expect(contrast(MARKER_OUTLINE, SLOT_PALETTE.b!)).toBeGreaterThanOrEqual(3);
  });
});
