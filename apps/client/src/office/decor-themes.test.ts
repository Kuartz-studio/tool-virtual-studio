import { FLOOR_THEMES, SHOP_WALL_THEMES, THEME_COLORS, THEME_MATERIALS, WALL_THEMES } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { FLOOR_ENTRIES, WALL_ENTRIES, materialsOf, shelvesByColor, type FloorEntry, type WallEntry } from './decor-themes';

const labels = (shelves: ReadonlyArray<{ color: string; themes: ReadonlyArray<{ label: string }> }>) =>
  shelves.map((shelf) => [shelf.color, shelf.themes.map((theme) => theme.label)]);

describe('les thèmes rangés par couleur (shelvesByColor)', () => {
  test('toutes les matières : chaque thème une fois, les couleurs dans leur ordre, et dans une couleur, les matières dans l\'ordre du sélecteur', () => {
    for (const [entries, count] of [[FLOOR_ENTRIES, FLOOR_THEMES.length], [WALL_ENTRIES, WALL_THEMES.length + SHOP_WALL_THEMES.length]] as const) {
      const shelves = shelvesByColor<FloorEntry | WallEntry>(entries, 'all');
      expect(shelves.flatMap((shelf) => shelf.themes)).toHaveLength(count);
      const colors = shelves.map((shelf) => THEME_COLORS.indexOf(shelf.color));
      expect(colors).toEqual([...colors].sort((a, b) => a - b));
      for (const shelf of shelves) {
        const ranks = shelf.themes.map((theme) => THEME_MATERIALS.indexOf(theme.look.material));
        expect(ranks, shelf.color).toEqual([...ranks].sort((a, b) => a - b));
      }
    }
  });

  test('les murs de la boutique sont à leur couleur, avec leur prix, après les murs libres de la même matière', () => {
    const black = shelvesByColor(WALL_ENTRIES, 'all').find((shelf) => shelf.color === 'noir')!;
    expect(black.themes.map((theme) => [theme.label, theme.price])).toEqual([
      ['Noir mat', undefined],
      ['Lambris noir', undefined],
      ['Carrelage noir', undefined],
      ['Marbre noir et or', 2800],
      ['Brique noire', undefined],
      ['Néon', 2400],
    ]);
  });

  test('une matière ne garde que ses thèmes ; une couleur qui n\'en a aucun disparaît', () => {
    expect(labels(shelvesByColor(FLOOR_ENTRIES, 'bois'))).toEqual([
      ['beige', ['Parquet clair']],
      ['noir', ['Bois noir']],
      ['brun', ['Parquet brun', 'Noyer']],
      ['rouge', ['Parquet rouge', 'Chevrons']],
    ]);
    expect(shelvesByColor(FLOOR_ENTRIES, 'brique')).toEqual([]);
  });
});

test('les matières du sélecteur : celles qui existent, dans l\'ordre de la liste partagée', () => {
  expect(materialsOf(FLOOR_ENTRIES, WALL_ENTRIES)).toEqual([...THEME_MATERIALS]);
  expect(materialsOf(FLOOR_ENTRIES)).toEqual(['uni', 'bois', 'carrelage', 'moquette', 'pierre', 'beton', 'motif']);
});
