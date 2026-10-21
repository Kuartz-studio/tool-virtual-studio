import { describe, expect, test } from 'vitest';
import { DECOR_DEPTH, drawnAt, layoutDecor } from './decor-layout';

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

  test('un élément inconnu est laissé de côté', () => {
    expect(layoutDecor([{ id: 'nope', x: 0, y: 0 }, { id: DESK, x: 0, y: 0 }])).toHaveLength(1);
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
