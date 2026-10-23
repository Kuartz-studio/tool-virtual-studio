import {
  DESK_ROOMS,
  checkDecor,
  decorItem,
  deskRoomSpecOf,
  overlappingItems,
  snapToDecorStep,
  type DecorError,
  type DeskDecor,
  type DeskRoomSpec,
  type OfficeMap,
  type PlacedItem,
} from '@bureau/shared';

// Le brouillon de la déco d'un bureau, que l'éditeur modifie geste après geste avant l'enregistrement : des fonctions pures, que le jeu (la
// souris sur la pièce) et le panneau (les boutons) partagent. Chaque geste dit dans quelle pièce il a lieu : les bureaux de la carte n'ont pas
// tous la même taille ni la porte du même côté.

// La pièce de cette place, telle que la carte la décrit (sa taille, le côté de sa porte) ; la pièce standard tant que la carte n'est pas là, ou si
// la place n'a pas de porte : c'est ce que le serveur suppose aussi.
export function roomOfDesk(map: OfficeMap | null, key: string): DeskRoomSpec {
  return (map ? deskRoomSpecOf(map, key) : undefined) ?? DESK_ROOMS.standard;
}

// Comment l'élément tenu suit le pointeur : au dixième de case (`free`, le placement libre), ou à la case près (`cell` : pour l'aligner sur la
// grille, Maj enfoncée dans la pièce).
export type DecorSnap = 'free' | 'cell';

// Le point de l'élément que le pointeur tient quand il est posé là : le milieu du bas de son empreinte (c'est là qu'on tient un meuble). En cases
// de la pièce, avec leurs fractions.
export function handleOf(id: string, at: { x: number; y: number }): { x: number; y: number } | null {
  const item = decorItem(id);
  return item ? { x: at.x + item.w / 2, y: at.y + item.claim - 0.5 } : null;
}

// Là où l'élément se pose quand le pointeur est en ce point de la pièce (en cases, avec leurs fractions) : le pointeur tient le milieu du bas de
// l'empreinte (handleOf), arrondi au dixième ou à la case selon `snap`, et un élément mural suit le pointeur, collé au mur. L'élément ne sort pas
// de la pièce : il est ramené contre le bord. À la case près, un pointeur dans une case pose un élément de largeur impaire de part et d'autre de
// cette case, comme avant le placement libre.
export function anchorFor(id: string, point: { x: number; y: number }, room: DeskRoomSpec, snap: DecorSnap): { x: number; y: number } | null {
  const item = decorItem(id);
  if (!item) return null;
  const round = snap === 'cell' ? Math.round : snapToDecorStep;
  const clamp = (value: number, max: number) => Math.min(Math.max(round(value), 0), max);
  const x = clamp(point.x - item.w / 2, room.width - item.w);
  if (item.kind === 'wall') return { x, y: 0 };
  return { x, y: clamp(point.y - item.claim + 0.5, room.height - item.claim) };
}

export type PlaceResult = { ok: true; decor: DeskDecor } | { ok: false; error: DecorError };

// Pose cet élément là (la place que donne anchorFor) si la pièce reste valable (checkDecor, que le serveur applique aussi).
export function tryPlace(decor: DeskDecor, id: string, at: { x: number; y: number }, room: DeskRoomSpec): PlaceResult {
  const next: DeskDecor = { ...decor, items: [...decor.items, { id, x: at.x, y: at.y }] };
  const check = checkDecor(next, room);
  return check.ok ? { ok: true, decor: next } : { ok: false, error: check.error };
}

// Ce que donnerait poser cet élément là : poser tout simplement (`place`), poser en remplaçant ce qui est déjà sur ces cases (`replace` : leur
// rang dans le brouillon actuel, et le brouillon qu'on aurait), ou refuser (`refused` : la pièce ne serait plus valable, même une fois ce
// qui gêne retiré). Remplacer demande confirmation : c'est l'interface qui la pose, avant d'appliquer.
export type PlacePlan =
  | { kind: 'place'; decor: DeskDecor }
  | { kind: 'replace'; decor: DeskDecor; replacing: number[] }
  | { kind: 'refused'; error: DecorError };

export function planPlace(decor: DeskDecor, id: string, at: { x: number; y: number }, room: DeskRoomSpec): PlacePlan {
  const direct = tryPlace(decor, id, at, room);
  if (direct.ok) return { kind: 'place', decor: direct.decor };
  const replacing = overlappingItems(decor.items, id, at);
  if (replacing.length === 0) return { kind: 'refused', error: direct.error };
  const without: DeskDecor = { ...decor, items: decor.items.filter((_, index) => !replacing.includes(index)) };
  const after = tryPlace(without, id, at, room);
  return after.ok ? { kind: 'replace', decor: after.decor, replacing } : { kind: 'refused', error: after.error };
}

export function removeAt(decor: DeskDecor, index: number): DeskDecor {
  return { ...decor, items: decor.items.filter((_, i) => i !== index) };
}

export function sameDecor(a: DeskDecor, b: DeskDecor): boolean {
  const same = (p: PlacedItem, q: PlacedItem) => p.id === q.id && p.x === q.x && p.y === q.y;
  return a.floor === b.floor && a.wall === b.wall && a.items.length === b.items.length && a.items.every((item, i) => same(item, b.items[i]!));
}
