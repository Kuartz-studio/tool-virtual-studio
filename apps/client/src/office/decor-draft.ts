import { DESK_ROOM, checkDecor, decorItem, type DecorError, type DeskDecor, type PlacedItem } from '@bureau/shared';

// Le brouillon de la déco d'un bureau, que l'éditeur modifie geste après geste avant l'enregistrement : des fonctions pures, que le jeu (la
// souris sur la pièce) et le panneau (les boutons) partagent.

// Là où l'élément se pose quand le pointeur est sur cette case de la pièce : le pointeur est au milieu du bas de l'empreinte (c'est là qu'on
// tient un meuble), et un élément mural suit la colonne du pointeur, collé au mur.
export function anchorFor(id: string, cell: { x: number; y: number }): { x: number; y: number } | null {
  const item = decorItem(id);
  if (!item) return null;
  const x = Math.min(Math.max(cell.x - Math.floor((item.w - 1) / 2), 0), DESK_ROOM.width - item.w);
  if (item.kind === 'wall') return { x, y: 0 };
  return { x, y: cell.y - (item.claim - 1) };
}

export type PlaceResult = { ok: true; decor: DeskDecor } | { ok: false; error: DecorError };

// Pose cet élément là (la place que donne anchorFor) si la pièce reste valable (checkDecor, que le serveur applique aussi).
export function tryPlace(decor: DeskDecor, id: string, at: { x: number; y: number }): PlaceResult {
  const next: DeskDecor = { ...decor, items: [...decor.items, { id, x: at.x, y: at.y }] };
  const check = checkDecor(next);
  return check.ok ? { ok: true, decor: next } : { ok: false, error: check.error };
}

export function removeAt(decor: DeskDecor, index: number): DeskDecor {
  return { ...decor, items: decor.items.filter((_, i) => i !== index) };
}

export function sameDecor(a: DeskDecor, b: DeskDecor): boolean {
  const same = (p: PlacedItem, q: PlacedItem) => p.id === q.id && p.x === q.x && p.y === q.y;
  return a.floor === b.floor && a.wall === b.wall && a.items.length === b.items.length && a.items.every((item, i) => same(item, b.items[i]!));
}
