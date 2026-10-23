import { afterEach, expect, test, vi } from 'vitest';
import { SCENE_IDS, scenesOfTheme } from '../audio/catalog';
import { COVERS, COVER_HEIGHT, COVER_WIDTH, drawCover } from './ambiance-covers';

afterEach(() => {
  vi.restoreAllMocks();
});

test('une pochette par ambiance, de 10 lignes de 16 caractères', () => {
  expect(Object.keys(COVERS).sort()).toEqual([...SCENE_IDS].sort());
  expect([COVER_WIDTH, COVER_HEIGHT]).toEqual([16, 10]);
  for (const id of SCENE_IDS) {
    const { rows } = COVERS[id];
    expect(rows, id).toHaveLength(10);
    for (const row of rows) expect([...row], `${id} : « ${row} »`).toHaveLength(16);
  }
});

test('chaque lettre d\'une pochette est dans sa palette, et chaque couleur de la palette est un #rrggbb servi par au moins une lettre', () => {
  for (const id of SCENE_IDS) {
    const { palette, rows } = COVERS[id];
    const used = new Set(rows.flatMap((row) => [...row]));
    for (const letter of used) expect(palette, `${id} : la lettre « ${letter} »`).toHaveProperty([letter]);
    for (const [letter, color] of Object.entries(palette)) {
      expect(color, `${id} : ${letter}`).toMatch(/^#[0-9a-f]{6}$/);
      expect(used.has(letter), `${id} : « ${letter} » n'est jamais écrite`).toBe(true);
    }
  }
});

test('les pochettes pirates : un tableau à elles chacune, sans en reprendre une autre', () => {
  const pirate = scenesOfTheme('pirate').map((id) => COVERS[id].rows.join(''));
  expect(new Set(pirate).size).toBe(pirate.length);
});

test('les couleurs du ciel de chaque pochette', () => {
  // Le coin haut gauche : la nuit de la ville, l'eau du récif, le ciel de la plage, le crépuscule, l'espace, le soir de l'oasis.
  const corner = (id: (typeof SCENE_IDS)[number]) => COVERS[id].palette[COVERS[id].rows[0]![0]!];
  expect(corner('lobby')).toBe('#141a3a');
  expect(corner('focus')).toBe('#2f8f9a');
  expect(corner('sunny')).toBe('#7cc8f2');
  expect(corner('dusk')).toBe('#3b2a5c');
  expect(corner('drift')).toBe('#170f2e');
  expect(corner('quest')).toBe('#f08a4b');
});

test('drawCover dessine un pixel par caractère, de la couleur de sa lettre, sur un canevas de 16 × 10', () => {
  const fills: Array<{ color: string; x: number; y: number; w: number; h: number }> = [];
  const context = {
    fillStyle: '',
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ color: this.fillStyle, x, y, w, h });
    },
  };
  // happy-dom n'a pas de canevas 2D : un faux contexte, qui retient ce qu'on y dessine.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const canvas = document.createElement('canvas');

  drawCover(canvas, 'sunny');

  expect([canvas.width, canvas.height]).toEqual([16, 10]);
  expect(fills).toHaveLength(160);
  expect(fills.every((fill) => fill.w === 1 && fill.h === 1)).toBe(true);
  const { palette, rows } = COVERS.sunny;
  for (const [y, row] of rows.entries()) {
    for (const [x, letter] of [...row].entries()) {
      expect(fills.find((fill) => fill.x === x && fill.y === y)?.color, `(${x}, ${y})`).toBe(palette[letter]);
    }
  }
});

test('sans contexte 2D, drawCover ne plante pas', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  expect(() => drawCover(document.createElement('canvas'), 'lobby')).not.toThrow();
});
