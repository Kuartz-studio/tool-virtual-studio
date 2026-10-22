import { describe, expect, test } from 'vitest';
import { cellsOf, columnX, layoutFor, offSlot, pointCell, stackSlot, toViewPoint, WIDE_MIN_WIDTH } from './geometry';
import { discPixels } from './sprites';

// La géométrie du tablier : deux dispositions (large pour les 408 px d'un panneau d'ordinateur, serrée pour les 311 px d'un téléphone), où chaque cible fait 24 px au moins
// (WCAG 2.5.8) et où rien ne se chevauche.

describe('layoutFor : la disposition suit la largeur du conteneur', () => {
  test('311 px (un téléphone de 375) : la disposition serrée, des flèches de 24 px, une barre de 12 px, pas de zone de sortie, environ 300 × 260', () => {
    const layout = layoutFor(311);
    expect(layout).toMatchObject({ mode: 'compact', cell: 24, bar: 12, off: 0, checker: 22 });
    expect(layout.width).toBeLessThanOrEqual(311);
    expect(layout.width).toBeGreaterThanOrEqual(300);
    expect(layout.height).toBeGreaterThanOrEqual(250);
    expect(layout.height).toBeLessThanOrEqual(262);
  });

  test('408 px (le panneau d\'un ordinateur) : la disposition large, une barre cliquable de 24 px et une zone de sortie à droite', () => {
    const layout = layoutFor(408);
    expect(layout.mode).toBe('wide');
    expect(layout.cell).toBeGreaterThanOrEqual(26);
    expect(layout.bar).toBe(24);
    expect(layout.off).toBeGreaterThanOrEqual(40);
    expect(layout.width).toBeLessThanOrEqual(408);
    expect(layout.width).toBeGreaterThanOrEqual(400);
    expect(layout.checker).toBe(26);
  });

  test('la bascule se fait à la largeur qui laisse 26 px aux flèches : juste en dessous, serrée ; juste au-dessus, large', () => {
    expect(layoutFor(WIDE_MIN_WIDTH - 1).mode).toBe('compact');
    expect(layoutFor(WIDE_MIN_WIDTH).mode).toBe('wide');
    expect(layoutFor(WIDE_MIN_WIDTH).cell).toBe(26);
  });

  test('chaque largeur de 306 à 700 px (la plus petite que la disposition serrée remplit) : le tablier tient dans son conteneur, aucune flèche sous 24 px, la barre sous 24 px seulement en disposition serrée', () => {
    for (let width = 306; width <= 700; width += 1) {
      const layout = layoutFor(width);
      expect(layout.width, `${width}`).toBeLessThanOrEqual(width);
      expect(layout.cell, `${width}`).toBeGreaterThanOrEqual(24);
      if (layout.mode === 'wide') expect(layout.bar, `${width}`).toBeGreaterThanOrEqual(24);
      else expect(layout.bar, `${width}`).toBe(12);
    }
  });

  test('un conteneur plus étroit que la disposition serrée (hors téléphones courants) donne la disposition serrée : le tablier sera réduit pour tenir', () => {
    const layout = layoutFor(260);
    expect(layout.mode).toBe('compact');
    expect(layout.cell).toBe(24);
    // Une largeur inconnue (0, avant la première mesure) : la disposition large, celle d'un panneau d'ordinateur.
    expect(layoutFor(0).mode).toBe('wide');
  });

  test('les pions : des disques de 22 px (11 × 2) en serré, de 26 px (13 × 2) en large, et une pile en montre 5 sans dépasser sa flèche', () => {
    for (const width of [311, 408]) {
      const layout = layoutFor(width);
      expect(layout.pointLength).toBeGreaterThanOrEqual(layout.checker * layout.visibleStack);
      expect(layout.visibleStack).toBe(5);
      expect(layout.checker).toBeLessThanOrEqual(layout.cell);
    }
  });
});

describe('les cases : points, barre et sortie', () => {
  test('24 points, la barre, et la sortie en disposition large seulement', () => {
    expect(cellsOf(layoutFor(311)).map((cell) => cell.id).sort()).toEqual([...Array.from({ length: 24 }, (_, index) => `p${index + 1}`), 'bar'].sort());
    expect(cellsOf(layoutFor(408)).some((cell) => cell.id === 'off')).toBe(true);
    expect(cellsOf(layoutFor(408))).toHaveLength(26);
  });

  test('sa maison est en bas à droite : le point 1 au bout de la rangée du bas, le point 6 contre la barre, le point 12 au coin du bas à gauche, le 13 en haut à gauche, le 24 en haut à droite', () => {
    const layout = layoutFor(408);
    const at = (point: number) => pointCell(layout, point);
    const bottom = at(1).y;
    expect(at(1).x).toBeGreaterThan(at(6).x);
    expect(at(6).x).toBeGreaterThan(at(7).x);
    expect(at(12).x).toBeLessThan(at(7).x);
    expect([1, 6, 7, 12].map((point) => at(point).y)).toEqual([bottom, bottom, bottom, bottom]);
    expect(at(13).y).toBeLessThan(bottom);
    expect(at(13).x).toBe(at(12).x);
    expect(at(24).x).toBe(at(1).x);
    expect(at(19).x).toBe(at(6).x);
    expect(at(18).x).toBe(at(7).x);
    expect(at(13).row).toBe('top');
    expect(at(12).row).toBe('bottom');
  });

  test('la barre est entre les deux moitiés : à droite du point 7, à gauche du point 6', () => {
    const layout = layoutFor(408);
    const bar = cellsOf(layout).find((cell) => cell.id === 'bar')!;
    expect(bar.x).toBe(pointCell(layout, 7).x + layout.cell);
    expect(bar.x + bar.width).toBe(pointCell(layout, 6).x);
    expect(columnX(layout, 6) - columnX(layout, 5)).toBe(layout.cell + layout.bar);
  });

  test('chaque cible fait 24 × 24 px au moins ; seule la barre de 12 px de la disposition serrée n\'est pas une cible de pointeur', () => {
    for (const width of [300, 311, 340, 395, 396, 408, 440, 540]) {
      for (const cell of cellsOf(layoutFor(width))) {
        if (cell.pointer) {
          expect(cell.width, `${width} ${cell.id}`).toBeGreaterThanOrEqual(24);
          expect(cell.height, `${width} ${cell.id}`).toBeGreaterThanOrEqual(24);
        } else {
          expect(cell.id, `${width}`).toBe('bar');
          expect(layoutFor(width).mode, `${width}`).toBe('compact');
        }
      }
    }
  });

  test('aucune case ne chevauche une autre, et toutes tiennent dans le tablier', () => {
    for (const width of [311, 408, 500]) {
      const layout = layoutFor(width);
      const cells = cellsOf(layout);
      for (const cell of cells) {
        expect(cell.x, `${width} ${cell.id}`).toBeGreaterThanOrEqual(0);
        expect(cell.y, `${width} ${cell.id}`).toBeGreaterThanOrEqual(0);
        expect(cell.x + cell.width, `${width} ${cell.id}`).toBeLessThanOrEqual(layout.width);
        expect(cell.y + cell.height, `${width} ${cell.id}`).toBeLessThanOrEqual(layout.height);
      }
      for (const [index, a] of cells.entries()) {
        for (const b of cells.slice(index + 1)) {
          const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
          expect(apart, `${width} : ${a.id} et ${b.id}`).toBe(true);
        }
      }
    }
  });

  test('la rangée de chaque case : celle du haut pour les points 13 à 24, celle du bas pour 1 à 12, la barre et la sortie', () => {
    const cells = cellsOf(layoutFor(408));
    for (const cell of cells) {
      const expected = cell.point !== undefined && cell.point >= 13 ? 'top' : 'bottom';
      expect(cell.row, cell.id).toBe(expected);
    }
  });
});

describe('les piles de pions', () => {
  test('la pile d\'un point du haut part du bord du haut et descend, celle du bas part du bord du bas et monte ; chaque pion touche le précédent', () => {
    const layout = layoutFor(311);
    const top = pointCell(layout, 20);
    const bottom = pointCell(layout, 3);
    expect(stackSlot(layout, top, 0).y).toBe(layout.pad + layout.checker / 2);
    expect(stackSlot(layout, top, 1).y - stackSlot(layout, top, 0).y).toBe(layout.checker);
    expect(stackSlot(layout, bottom, 0).y).toBe(layout.height - layout.pad - layout.checker / 2);
    expect(stackSlot(layout, bottom, 1).y - stackSlot(layout, bottom, 0).y).toBe(-layout.checker);
    expect(stackSlot(layout, top, 3).x).toBe(top.x + top.width / 2);
  });

  test('les cinq pions d\'une pile restent dans leur flèche', () => {
    for (const width of [311, 408]) {
      const layout = layoutFor(width);
      for (const point of [3, 20]) {
        const cell = pointCell(layout, point);
        const last = stackSlot(layout, cell, layout.visibleStack - 1);
        expect(last.y - layout.checker / 2).toBeGreaterThanOrEqual(cell.y);
        expect(last.y + layout.checker / 2).toBeLessThanOrEqual(cell.y + cell.height);
      }
    }
  });

  test('la sortie : les pions sortis s\'empilent à plat depuis le bord, ceux du bas en montant, ceux du haut en descendant', () => {
    const layout = layoutFor(408);
    expect(offSlot(layout, 'bottom', 0).y).toBeGreaterThan(layout.height / 2);
    expect(offSlot(layout, 'bottom', 1).y).toBeLessThan(offSlot(layout, 'bottom', 0).y);
    expect(offSlot(layout, 'top', 0).y).toBeLessThan(layout.height / 2);
    expect(offSlot(layout, 'top', 1).y).toBeGreaterThan(offSlot(layout, 'top', 0).y);
    // Quinze pions sortis tiennent dans leur zone.
    expect(offSlot(layout, 'bottom', 14).y).toBeGreaterThan(layout.height / 2);
    expect(offSlot(layout, 'top', 14).y).toBeLessThan(layout.height / 2);
  });
});

describe('toViewPoint : le numéro d\'un point pour celui qui regarde', () => {
  test('dans la numérotation de celui qui regarde, le même ; dans celle de l\'autre, 25 − p', () => {
    expect(toViewPoint(0, 0, 13)).toBe(13);
    expect(toViewPoint(1, 1, 6)).toBe(6);
    expect(toViewPoint(0, 1, 6)).toBe(19);
    expect(toViewPoint(1, 0, 24)).toBe(1);
  });
});

describe('discPixels : un disque en pixel art', () => {
  test('11 et 13 pixels de diamètre : une silhouette ronde et symétrique, cernée d\'un liseré, avec du remplissage, de la lumière et de l\'ombre', () => {
    for (const diameter of [11, 13]) {
      const disc = discPixels(diameter);
      expect(disc).toHaveLength(diameter);
      // La silhouette (tout ce qui n'est pas transparent) est la même vue de droite à gauche et de bas en haut.
      const silhouette = disc.map((row) => row.replace(/[^.]/g, '#'));
      for (const row of silhouette) {
        expect(row).toHaveLength(diameter);
        expect([...row].reverse().join('')).toBe(row);
      }
      expect([...silhouette].reverse()).toEqual(silhouette);
      // Les bords de la silhouette sont du liseré, jamais du remplissage : la première rangée n'est que du liseré, et le premier pixel plein de la rangée du milieu aussi.
      expect(disc[0]!.replaceAll('.', '')).toMatch(/^o+$/);
      const middle = disc[Math.floor(diameter / 2)]!;
      expect(middle[0]).toBe('o');
      expect(middle.at(-1)).toBe('o');
      // Il y a du remplissage, de la lumière et de l'ombre.
      const all = disc.join('');
      for (const letter of ['o', 'f', 'h', 's']) expect(all, `${diameter} ${letter}`).toContain(letter);
      // Un disque de 11 pixels en a de l'ordre de 95 : ni un carré, ni un point.
      const painted = all.replaceAll('.', '').length;
      expect(painted).toBeGreaterThan(diameter * diameter * 0.7);
      expect(painted).toBeLessThan(diameter * diameter * 0.85);
    }
  });
});
