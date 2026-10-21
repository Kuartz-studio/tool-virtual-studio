import { decorItem } from './catalog';
import { DEFAULT_FLOOR_THEME, DEFAULT_WALL_THEME, isFloorTheme, isWallTheme } from './themes';
import type { DecorItem, PlacedItem } from './types';

// La pièce d'un bureau : 9 cases de large sur 7 de haut, toutes pareilles (la déco suit son occupant d'un bureau à l'autre). La porte est au
// sud : ses deux cases touchent les deux cases du bas de la pièce, `DESK_ROOM.doorX` et la suivante.
export const DESK_ROOM = { width: 9, height: 7, doorX: 3, doorWidth: 2 } as const;
export const MAX_DECOR_ITEMS = 80;

// Ce qu'une personne règle pour sa pièce : le sol, les murs, et ce qu'elle y a posé.
export interface DeskDecor {
  floor: string;
  wall: string;
  items: PlacedItem[];
}

// Pourquoi une déco est refusée : `too_many` (plus de MAX_DECOR_ITEMS éléments), `unknown_item` ou `unknown_theme`, `bad_position` (une case
// qui n'est pas un entier, ou un élément mural qui n'est pas contre le mur), `out_of_room` (l'élément déborde de la pièce), `overlap` (deux
// éléments sur les mêmes cases), `blocks_door` (un meuble devant la porte), `unreachable` (un coin de la pièce que plus personne ne peut
// atteindre à pied).
export type DecorError = 'too_many' | 'unknown_item' | 'unknown_theme' | 'bad_position' | 'out_of_room' | 'overlap' | 'blocks_door' | 'unreachable';
export type DecorCheck = { ok: true } | { ok: false; error: DecorError; index?: number };

export interface Footprint {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Les cases qu'un élément occupe : sa largeur sur les `claim` rangées du bas de son image. Un élément mural n'occupe que sa place sur le mur
// (une rangée : celle de la première case de la pièce, que le mur surplombe).
export function footprintOf(item: DecorItem, at: { x: number; y: number }): Footprint {
  return { x: at.x, y: at.y, w: item.w, h: item.kind === 'wall' ? 1 : item.claim };
}

const apart = (a: Footprint, b: Footprint): boolean => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

// Les éléments déjà posés qui gênent celui-ci posé là : ceux de la même sorte dont l'empreinte touche la sienne (checkDecor refuse ce
// chevauchement). Leur rang dans `items`. C'est ce qu'un remplacement retire.
export function overlappingItems(items: readonly PlacedItem[], id: string, at: { x: number; y: number }): number[] {
  const item = decorItem(id);
  if (!item) return [];
  const target = footprintOf(item, at);
  return items.flatMap((placed, index) => {
    const other = decorItem(placed.id);
    return other && other.kind === item.kind && !apart(footprintOf(other, placed), target) ? [index] : [];
  });
}

// Les cases de la pièce que les éléments bloquent (numéro de case = y × largeur + x).
export function blockedCells(items: readonly PlacedItem[], width: number = DESK_ROOM.width): Set<number> {
  const blocked = new Set<number>();
  for (const placed of items) {
    const item = decorItem(placed.id);
    if (!item || !item.solid || item.kind === 'wall') continue;
    const f = footprintOf(item, placed);
    for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) blocked.add(y * width + x);
  }
  return blocked;
}

// Les deux cases de la pièce juste derrière la porte : l'entrée, qui doit rester libre.
export const DOOR_ENTRY_CELLS: ReadonlyArray<{ x: number; y: number }> = Array.from({ length: DESK_ROOM.doorWidth }, (_, i) => ({
  x: DESK_ROOM.doorX + i,
  y: DESK_ROOM.height - 1,
}));

export function checkDecor(decor: DeskDecor): DecorCheck {
  if (!isFloorTheme(decor.floor) || !isWallTheme(decor.wall)) return { ok: false, error: 'unknown_theme' };
  if (decor.items.length > MAX_DECOR_ITEMS) return { ok: false, error: 'too_many' };

  const placed: Array<{ item: DecorItem; at: Footprint; index: number }> = [];
  for (const [index, entry] of decor.items.entries()) {
    const item = decorItem(entry.id);
    if (!item) return { ok: false, error: 'unknown_item', index };
    if (!Number.isInteger(entry.x) || !Number.isInteger(entry.y)) return { ok: false, error: 'bad_position', index };
    if (item.kind === 'wall' && (entry.y !== 0 || item.h > 2)) return { ok: false, error: 'bad_position', index };
    const at = footprintOf(item, entry);
    if (at.x < 0 || at.y < 0 || at.x + at.w > DESK_ROOM.width || at.y + at.h > DESK_ROOM.height) return { ok: false, error: 'out_of_room', index };
    placed.push({ item, at, index });
  }

  // Deux éléments de la même sorte (meubles, tapis, objets posés, éléments muraux) ne partagent jamais une case.
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const [a, b] = [placed[i]!, placed[j]!];
      if (a.item.kind === b.item.kind && !apart(a.at, b.at)) return { ok: false, error: 'overlap', index: b.index };
    }
  }

  // La porte n'est pas murée, et ce qui reste de libre se rejoint à pied depuis l'entrée.
  const blocked = blockedCells(decor.items);
  const entries = DOOR_ENTRY_CELLS.filter(({ x, y }) => !blocked.has(y * DESK_ROOM.width + x));
  if (entries.length === 0) return { ok: false, error: 'blocks_door' };
  const seen = new Set<number>(entries.map(({ x, y }) => y * DESK_ROOM.width + x));
  const queue = entries.map(({ x, y }) => [x, y] as const);
  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const [nx, ny] = [x + dx, y + dy];
      if (nx < 0 || ny < 0 || nx >= DESK_ROOM.width || ny >= DESK_ROOM.height) continue;
      const cell = ny * DESK_ROOM.width + nx;
      if (blocked.has(cell) || seen.has(cell)) continue;
      seen.add(cell);
      queue.push([nx, ny]);
    }
  }
  if (seen.size + blocked.size < DESK_ROOM.width * DESK_ROOM.height) return { ok: false, error: 'unreachable' };
  return { ok: true };
}

// Ce que montre une pièce dont la personne n'a rien réglé : un poste de travail prêt à l'emploi (bureau, écran, clavier, lampe, chaise), des
// plantes et quelques éléments au mur. Elle peut tout changer, tout enlever.
export const DEFAULT_DESK_ITEMS: readonly PlacedItem[] = [
  { id: 'of-15-0', x: 0, y: 0 },
  { id: 'of-9-12', x: 3, y: 0 },
  { id: 'of-15-2', x: 6, y: 0 },
  { id: 'of-7-28', x: 3, y: 1 },
  { id: 'of-14-12', x: 4, y: 1 },
  { id: 'of-11-15', x: 5, y: 1 },
  { id: 'of-12-8', x: 3, y: 2 },
  { id: 'of-12-43', x: 4, y: 3 },
  { id: 'of-7-12', x: 7, y: 0 },
  { id: 'lr-13-21', x: 0, y: 4 },
  { id: 'of-0-17', x: 6, y: 4 },
  { id: 'of-6-10', x: 0, y: 1 },
];

export const DEFAULT_DESK_DECOR: DeskDecor = {
  floor: DEFAULT_FLOOR_THEME,
  wall: DEFAULT_WALL_THEME,
  items: [...DEFAULT_DESK_ITEMS],
};
