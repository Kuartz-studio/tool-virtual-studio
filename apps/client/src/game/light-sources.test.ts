import { TILE_SIZE, decorItem } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { LIGHT_EMITTERS, sourcesFromItems } from './light-sources';

// Le rectangle de l'image d'un élément de la banque posé à (x, y), en pixels de la carte : ce que DecorLayer donne.
const placed = (id: string, x: number, y: number) => {
  const item = decorItem(id);
  if (!item) throw new Error(`${id} n'est pas dans la banque`);
  return { id, x, y, w: item.w * TILE_SIZE, h: item.h * TILE_SIZE };
};

const LAMPS = [
  // Les lampadaires.
  'lr-12-9', 'lr-11-9', 'lr-13-9', 'lr-12-12', 'lr-13-12',
  // Les lampes articulées.
  'of-11-15', 'of-10-16', 'of-11-17', 'of-11-19', 'of-11-21', 'of-11-23',
  // Les lampes de chevet.
  'lr-14-7', 'lr-15-7', 'lr-14-9', 'lr-15-9', 'lr-14-13', 'lr-15-13',
  // Les postes portables avec lampe.
  'of-8-26', 'of-14-26',
];
const SCREENS = ['tv-10-3', 'of-9-14', 'tv-10-1'];

describe('LIGHT_EMITTERS', () => {
  test('les lampes, la cheminée et les écrans éclairent, et rien d\'autre', () => {
    for (const id of LAMPS) expect(LIGHT_EMITTERS[id]?.kind, id).toBe('lamp');
    expect(LIGHT_EMITTERS['lr-4-24']?.kind).toBe('fire');
    for (const id of SCREENS) expect(LIGHT_EMITTERS[id]?.kind, id).toBe('screen');
    expect(Object.keys(LIGHT_EMITTERS)).toHaveLength(LAMPS.length + 1 + SCREENS.length);
  });

  test('chaque élément est dans la banque, et sa lumière brille dans son image', () => {
    for (const [id, emitter] of Object.entries(LIGHT_EMITTERS)) {
      const item = decorItem(id);
      expect(item, id).toBeDefined();
      expect(emitter.bulbY, id).toBeGreaterThanOrEqual(0);
      expect(emitter.bulbY, id).toBeLessThan(item!.h * TILE_SIZE);
    }
  });

  test('les lampes et le feu sont chauds, les écrans froids et de plus petite portée', () => {
    const warmth = (color: number) => ((color >> 16) & 255) - (color & 255);
    for (const id of [...LAMPS, 'lr-4-24']) expect(warmth(LIGHT_EMITTERS[id]!.color), id).toBeGreaterThan(0);
    for (const id of SCREENS) {
      expect(warmth(LIGHT_EMITTERS[id]!.color), id).toBeLessThan(0);
      expect(LIGHT_EMITTERS[id]!.radiusTiles, id).toBeLessThan(LIGHT_EMITTERS['lr-12-9']!.radiusTiles);
    }
  });
});

describe('sourcesFromItems', () => {
  test('l\'ampoule du lampadaire lr-12-9 est en haut de son image (son abat-jour), au milieu de sa largeur', () => {
    const [source, ...rest] = sourcesFromItems([placed('lr-12-9', 640, 320)]);
    expect(rest).toEqual([]);
    expect(source).toEqual({ x: 640 + TILE_SIZE / 2, y: 320 + LIGHT_EMITTERS['lr-12-9']!.bulbY, kind: 'lamp', radius: LIGHT_EMITTERS['lr-12-9']!.radiusTiles * TILE_SIZE, color: LIGHT_EMITTERS['lr-12-9']!.color });
    // Dans la moitié haute de l'image (3 cases de haut, dont la première est vide : l'abat-jour est dans la deuxième).
    expect(source!.y).toBeGreaterThan(320 + TILE_SIZE);
    expect(source!.y).toBeLessThan(320 + (3 * TILE_SIZE) / 2);
  });

  test('un élément qui n\'éclaire pas, ou inconnu, ne donne pas de lumière', () => {
    expect(sourcesFromItems([placed('of-14-12', 0, 0), { id: 'inconnu', x: 0, y: 0, w: 32, h: 32 }])).toEqual([]);
  });

  test('une lumière par élément qui éclaire, dans l\'ordre', () => {
    const sources = sourcesFromItems([placed('lr-4-24', 0, 0), placed('of-14-12', 64, 0), placed('tv-10-3', 128, 0)]);
    expect(sources.map((s) => s.kind)).toEqual(['fire', 'screen']);
    // La cheminée brille de son feu, en bas de l'image ; l'écran géant (5 cases) au milieu de sa largeur.
    expect(sources[0]!.y).toBeGreaterThan(2 * TILE_SIZE);
    expect(sources[1]!.x).toBe(128 + (5 * TILE_SIZE) / 2);
  });
});
