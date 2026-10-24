import { decorItem, wallPrice, wallTheme, type DeskDecor } from '@bureau/shared';

// Ce qu'une déco pose sans qu'on l'ait acheté. La boutique s'essaie : dans l'éditeur, on pose ses éléments et ses murs comme les autres (un aperçu, que soi
// seul voit) ; c'est l'enregistrement qui demande de les acheter (DecorCheckout ; le serveur achète tout d'un coup, la commande `decor` les lui nomme
// dans `buy`). Des fonctions pures, que le panneau et ses tests partagent.

// Une ligne de ce qu'on achèterait : le mur de la pièce, ou un élément (une fois, même posé trois fois), avec son nom et son prix en kuartzons.
export interface CartLine {
  id: string;
  kind: 'wall' | 'item';
  name: string;
  price: number;
}

// Ce que cette déco pose de la boutique et que `owned` n'a pas : le mur d'abord (il habille toute la pièce), puis les éléments dans l'ordre où ils sont
// posés, chacun une fois.
export function unpaidIn(decor: DeskDecor, owned: ReadonlySet<string>): CartLine[] {
  const lines: CartLine[] = [];
  const wall = wallPrice(decor.wall);
  if (wall !== undefined && !owned.has(decor.wall)) lines.push({ id: decor.wall, kind: 'wall', name: wallTheme(decor.wall)?.label ?? decor.wall, price: wall });
  const seen = new Set<string>();
  for (const { id } of decor.items) {
    const item = decorItem(id);
    if (item?.price === undefined || owned.has(id) || seen.has(id)) continue;
    seen.add(id);
    lines.push({ id, kind: 'item', name: item.name, price: item.price });
  }
  return lines;
}

export function cartTotal(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.price, 0);
}

// La déco sans cette ligne : l'élément retiré de partout où il est posé, ou le mur remplacé par `wall` (celui qui est enregistré).
export function withoutLine(decor: DeskDecor, id: string, wall: string): DeskDecor {
  if (decor.wall === id) return { ...decor, wall };
  return { ...decor, items: decor.items.filter((item) => item.id !== id) };
}

// La déco sans rien de ce qu'on n'a pas acheté : ce qu'on enregistre quand on renonce aux achats.
export function withoutUnpaid(decor: DeskDecor, owned: ReadonlySet<string>, wall: string): DeskDecor {
  return unpaidIn(decor, owned).reduce((next, line) => withoutLine(next, line.id, wall), decor);
}
