import { DESK_ROOM, checkDecor, decorItem, overlappingItems, type DecorError, type DeskDecor, type PlacedItem } from '@bureau/shared';

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

// Ce que donnerait poser cet élément là : poser tout simplement (`place`), poser en remplaçant ce qui est déjà sur ces cases (`replace` : leur
// rang dans le brouillon actuel, et le brouillon qu'on aurait), ou refuser (`refused` : la pièce ne serait plus valable, même une fois ce
// qui gêne retiré). Remplacer demande confirmation : c'est l'interface qui la pose, avant d'appliquer.
export type PlacePlan =
  | { kind: 'place'; decor: DeskDecor }
  | { kind: 'replace'; decor: DeskDecor; replacing: number[] }
  | { kind: 'refused'; error: DecorError };

export function planPlace(decor: DeskDecor, id: string, at: { x: number; y: number }): PlacePlan {
  const direct = tryPlace(decor, id, at);
  if (direct.ok) return { kind: 'place', decor: direct.decor };
  const replacing = overlappingItems(decor.items, id, at);
  if (replacing.length === 0) return { kind: 'refused', error: direct.error };
  const without: DeskDecor = { ...decor, items: decor.items.filter((_, index) => !replacing.includes(index)) };
  const after = tryPlace(without, id, at);
  return after.ok ? { kind: 'replace', decor: after.decor, replacing } : { kind: 'refused', error: after.error };
}

export function removeAt(decor: DeskDecor, index: number): DeskDecor {
  return { ...decor, items: decor.items.filter((_, i) => i !== index) };
}

export function sameDecor(a: DeskDecor, b: DeskDecor): boolean {
  const same = (p: PlacedItem, q: PlacedItem) => p.id === q.id && p.x === q.x && p.y === q.y;
  return a.floor === b.floor && a.wall === b.wall && a.items.length === b.items.length && a.items.every((item, i) => same(item, b.items[i]!));
}
