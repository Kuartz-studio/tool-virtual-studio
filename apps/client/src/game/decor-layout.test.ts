import { describe, expect, test } from 'vitest';
import { DECOR_DEPTH, drawnAt, layoutDecor, namedProperty, placedFromObjects } from './decor-layout';

// Quelques éléments de la banque : un bureau (3 × 2, solide, occupe ses 2 rangées), un écran à poser dessus (1 × 1), une chaise (1 × 2, une
// rangée), un tapis (1 × 2 au sol) et un tableau mural (2 × 2).
const DESK = 'of-7-28';
const SCREEN = 'of-14-12';
const CHAIR = 'of-8-34';
const RUG = 'of-11-4';
const BOARD = 'of-9-12';

describe('layoutDecor', () => {
  test('un meuble se trie par le bas de son empreinte : le bas de son image, en pixels, est aussi sa profondeur', () => {
    const [desk] = layoutDecor([{ id: DESK, x: 4, y: 5 }]);
    expect(desk).toMatchObject({ left: 4 * 32, bottom: (5 + 2) * 32, depth: (5 + 2) * 32 });
  });

  test('qui est plus bas est devant : une chaise sous le bureau passe devant lui, une chaise derrière passe derrière', () => {
    const [desk, front, behind] = layoutDecor([{ id: DESK, x: 4, y: 5 }, { id: CHAIR, x: 5, y: 7 }, { id: CHAIR, x: 5, y: 4 }]);
    expect(front!.depth).toBeGreaterThan(desk!.depth);
    expect(behind!.depth).toBeLessThan(desk!.depth);
  });

  test('un tapis est sous tout, un élément mural juste au-dessus des murs, calé sur le haut de la pièce', () => {
    const [rug, board] = layoutDecor([{ id: RUG, x: 1, y: 3 }, { id: BOARD, x: 2, y: 2 }]);
    expect(rug!.depth).toBe(DECOR_DEPTH.floor);
    expect(board).toMatchObject({ depth: DECOR_DEPTH.wall, bottom: 2 * 32, left: 2 * 32 });
    expect(DECOR_DEPTH.floor).toBeLessThan(DECOR_DEPTH.wall);
  });

  test('un objet posé sur un meuble se dessine juste devant lui, même sur le rang du fond', () => {
    const [desk, screen] = layoutDecor([{ id: DESK, x: 4, y: 5 }, { id: SCREEN, x: 5, y: 5 }]);
    expect(screen!.depth).toBeGreaterThan(desk!.depth);
    expect(screen!.depth).toBeLessThan(desk!.depth + 1);
  });

  test('un objet posé sans meuble dessous : devant sa propre case, derrière ce qui est plus bas', () => {
    const [alone, below] = layoutDecor([{ id: SCREEN, x: 1, y: 1 }, { id: CHAIR, x: 1, y: 3 }]);
    expect(alone!.depth).toBe(2 * 32 + 0.5);
    expect(alone!.depth).toBeLessThan(below!.depth);
  });

  test('un décalage vertical descend l\'image, sans changer ni sa profondeur ni son empreinte : une chaise rentrée sous sa table', () => {
    const [plain, nudged] = layoutDecor([{ id: CHAIR, x: 5, y: 4 }, { id: CHAIR, x: 6, y: 4, offsetY: 16 }]);
    expect(nudged!.bottom).toBe(plain!.bottom + 16);
    expect(nudged!.depth).toBe(plain!.depth);
    expect(nudged!.footprint).toEqual({ ...plain!.footprint, x: 6 });
    expect(nudged!.left).toBe(6 * 32);
  });

  test('un élément inconnu est laissé de côté', () => {
    expect(layoutDecor([{ id: 'nope', x: 0, y: 0 }, { id: DESK, x: 0, y: 0 }])).toHaveLength(1);
  });
});

describe('layoutDecor au dixième de case', () => {
  test('l\'image se pose sur le pixel le plus proche (un dixième fait 3,2 px), et se trie toujours par le bas de son empreinte', () => {
    const [desk] = layoutDecor([{ id: DESK, x: 2.3, y: 1.1 }]);
    expect(desk).toMatchObject({ left: 74, bottom: 99, depth: 99 });   // 2,3 × 32 = 73,6 ; (1,1 + 2) × 32 = 99,2
  });

  test('un objet posé qui déborde du plateau se dessine devant le meuble sous le milieu de son empreinte', () => {
    const [desk, screen] = layoutDecor([{ id: DESK, x: 2, y: 1 }, { id: SCREEN, x: 1.6, y: 1 }]);
    expect(screen!.depth).toBeGreaterThan(desk!.depth);
  });
});

describe('placedFromObjects : les objets du calque de la carte', () => {
  test('le nom est la clé de l\'élément, la position (en pixels) devient le coin haut-gauche de son empreinte, en cases', () => {
    expect(placedFromObjects([{ name: DESK, x: 4 * 32, y: 5 * 32 }, { name: CHAIR, x: 6 * 32 + 1, y: 7 * 32 - 1 }])).toEqual([
      { id: DESK, x: 4, y: 5 },
      { id: CHAIR, x: 6, y: 7 },
    ]);
  });

  test('la propriété offsetY (la liste de Tiled, ou une table) devient le décalage ; absente ou nulle, l\'élément n\'en a pas', () => {
    const [listed, tabled, zero, plain, other] = placedFromObjects([
      { name: CHAIR, x: 0, y: 0, properties: [{ name: 'offsetY', value: 16 }] },
      { name: CHAIR, x: 32, y: 0, properties: { offsetY: 8 } },
      { name: CHAIR, x: 64, y: 0, properties: [{ name: 'offsetY', value: 0 }] },
      { name: CHAIR, x: 96, y: 0 },
      { name: CHAIR, x: 128, y: 0, properties: [{ name: 'depth', value: 160.5 }, { name: 'offsetY', value: '16' }] },
    ]);
    expect(listed).toEqual({ id: CHAIR, x: 0, y: 0, offsetY: 16 });
    expect(tabled).toEqual({ id: CHAIR, x: 1, y: 0, offsetY: 8 });
    expect(zero).toEqual({ id: CHAIR, x: 2, y: 0 });
    expect(plain).toEqual({ id: CHAIR, x: 3, y: 0 });
    expect(other, 'une valeur qui n\'est pas un nombre est ignorée').toEqual({ id: CHAIR, x: 4, y: 0 });
  });

  test('un objet sans nom, ou qui n\'est pas dans la banque, est laissé de côté', () => {
    expect(placedFromObjects([{ x: 0, y: 0 }, { name: 'nope', x: 0, y: 0 }, { name: DESK, x: 0, y: 0 }])).toEqual([{ id: DESK, x: 0, y: 0 }]);
  });

  test('un décalage lu sur la carte descend l\'image : de bout en bout, jusqu\'au bas dessiné', () => {
    const [plain, nudged] = layoutDecor(placedFromObjects([{ name: CHAIR, x: 0, y: 128 }, { name: CHAIR, x: 32, y: 128, properties: [{ name: 'offsetY', value: 16 }] }]));
    expect(nudged!.bottom - plain!.bottom).toBe(16);
  });
});

describe('namedProperty', () => {
  test('lit une propriété d\'un objet de la carte, dans la liste de Tiled comme dans une table ; undefined si elle manque', () => {
    expect(namedProperty({ properties: [{ name: 'depth', value: 160.5 }] }, 'depth')).toBe(160.5);
    expect(namedProperty({ properties: { depth: 7 } }, 'depth')).toBe(7);
    expect(namedProperty({ properties: [{ name: 'depth', value: 1 }] }, 'offsetY')).toBeUndefined();
    expect(namedProperty({}, 'depth')).toBeUndefined();
  });
});

describe('drawnAt', () => {
  test('rend l\'élément le plus en avant sous le point, ou -1', () => {
    const drawn = layoutDecor([{ id: RUG, x: 3, y: 5 }, { id: DESK, x: 3, y: 5 }]);
    // Au milieu du bureau, le bureau (devant) plutôt que le tapis (dessous).
    expect(drawnAt(drawn, 4 * 32, 6 * 32)).toBe(1);
    expect(drawnAt(drawn, 0, 0)).toBe(-1);
  });
});
