import { DEFAULT_DESK_DECOR, SHOP_WALL_THEMES, decorItemsOf, type DeskDecor } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { cartTotal, unpaidIn, withoutLine, withoutUnpaid } from './decor-cart';

const [statue, painting] = decorItemsOf('boutique');
const wall = SHOP_WALL_THEMES[0];
// Un élément libre de la banque.
const FREE = 'of-6-10';

const decor = (over: Partial<DeskDecor> = {}): DeskDecor => ({ ...DEFAULT_DESK_DECOR, ...over });

describe('ce que la déco pose sans l\'avoir acheté', () => {
  test('le mur d\'abord, puis les éléments dans l\'ordre où ils sont posés, chacun une fois, avec leur prix', () => {
    const items = [
      { id: painting!.id, x: 1, y: 0 },
      { id: FREE, x: 2, y: 2 },
      { id: statue!.id, x: 4, y: 3 },
      { id: painting!.id, x: 5, y: 0 },
    ];
    const lines = unpaidIn(decor({ wall: wall.id, items }), new Set());
    expect(lines).toEqual([
      { id: wall.id, kind: 'wall', name: wall.label, price: wall.price },
      { id: painting!.id, kind: 'item', name: painting!.name, price: painting!.price },
      { id: statue!.id, kind: 'item', name: statue!.name, price: statue!.price },
    ]);
    expect(cartTotal(lines)).toBe(wall.price + painting!.price! + statue!.price!);
  });

  test('ce qu\'on a acheté, les éléments libres et les murs libres ne comptent pas', () => {
    const items = [{ id: statue!.id, x: 4, y: 3 }, { id: FREE, x: 2, y: 2 }];
    expect(unpaidIn(decor({ wall: wall.id, items }), new Set([wall.id, statue!.id]))).toEqual([]);
    expect(unpaidIn(decor({ items: [{ id: FREE, x: 2, y: 2 }] }), new Set())).toEqual([]);
    expect(cartTotal([])).toBe(0);
  });

  test('retirer une ligne : l\'élément part de partout où il est posé ; le mur revient à celui qu\'on donne', () => {
    const items = [{ id: painting!.id, x: 1, y: 0 }, { id: FREE, x: 2, y: 2 }, { id: painting!.id, x: 5, y: 0 }];
    expect(withoutLine(decor({ items }), painting!.id, 'creme').items).toEqual([{ id: FREE, x: 2, y: 2 }]);
    expect(withoutLine(decor({ wall: wall.id, items }), wall.id, 'creme')).toEqual(decor({ wall: 'creme', items }));
  });

  test('sans rien de ce qu\'on n\'a pas acheté : ce qui est acheté et ce qui est libre restent', () => {
    const items = [{ id: painting!.id, x: 1, y: 0 }, { id: statue!.id, x: 4, y: 3 }, { id: FREE, x: 2, y: 2 }];
    expect(withoutUnpaid(decor({ wall: wall.id, items }), new Set([statue!.id]), 'creme')).toEqual(
      decor({ wall: 'creme', items: [{ id: statue!.id, x: 4, y: 3 }, { id: FREE, x: 2, y: 2 }] }),
    );
  });
});
