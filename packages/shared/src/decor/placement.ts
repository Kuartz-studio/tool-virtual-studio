import { deskKey, type OfficeMap } from '../map/parse-map';
import { decorItem } from './catalog';
import { DEFAULT_FLOOR_THEME, DEFAULT_WALL_THEME, isFloorTheme, isWallTheme } from './themes';
import type { DecorItem, PlacedItem } from './types';

// La pièce d'un bureau : sa taille en cases, et sa porte : de quel côté (au nord ou au sud de la pièce), à quelle colonne elle commence, et sa
// largeur. Les cases de la pièce juste derrière la porte sont son entrée (doorEntryCells). La déco suit son occupant d'un bureau à l'autre :
// celle d'une pièce standard ne tient pas dans une compacte (checkDecor la refuse, la pièce montre alors son poste par défaut).
export interface DeskRoomSpec {
  width: number;
  height: number;
  door: { side: 'north' | 'south'; x: number; width: number };
}

// Les deux tailles de bureau de la carte : la standard (9 × 7, porte au sud sur les colonnes 3 et 4) et la compacte (6 × 7, colonnes 2 et 3). Une
// porte au nord se dit par `{ ...spec, door: { ...spec.door, side: 'north' } }` : deskRoomSpecOf lit le côté sur la carte.
export const DESK_ROOMS = {
  standard: { width: 9, height: 7, door: { side: 'south', x: 3, width: 2 } },
  compact: { width: 6, height: 7, door: { side: 'south', x: 2, width: 2 } },
} as const satisfies Record<string, DeskRoomSpec>;

export const MAX_DECOR_ITEMS = 80;

// La pièce d'une place de la carte : la taille de sa zone `desk` et le côté de sa zone `door` (au nord si elle est au-dessus de la pièce), en cases ;
// undefined si la place n'existe pas, ou n'a pas de porte (les bureaux de la petite carte de développement n'ont pas de pièce décorée).
export function deskRoomSpecOf(map: OfficeMap, key: string): DeskRoomSpec | undefined {
  const desk = map.zones.find((zone) => zone.type === 'desk' && deskKey(zone) === key);
  const door = map.zones.find((zone) => zone.type === 'door' && zone.name === key);
  if (!desk || !door) return undefined;
  const size = map.tileSize;
  return {
    width: Math.round(desk.width / size),
    height: Math.round(desk.height / size),
    door: { side: door.y < desk.y ? 'north' : 'south', x: Math.round((door.x - desk.x) / size), width: Math.round(door.width / size) },
  };
}

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
export function blockedCells(items: readonly PlacedItem[], width: number = DESK_ROOMS.standard.width): Set<number> {
  const blocked = new Set<number>();
  for (const placed of items) {
    const item = decorItem(placed.id);
    if (!item || !item.solid || item.kind === 'wall') continue;
    const f = footprintOf(item, placed);
    for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) blocked.add(y * width + x);
  }
  return blocked;
}

// Les cases de la pièce juste derrière la porte : l'entrée, qui doit rester libre. La rangée du bas pour une porte au sud, celle du haut pour une porte
// au nord.
export function doorEntryCells(room: DeskRoomSpec): Array<{ x: number; y: number }> {
  const y = room.door.side === 'north' ? 0 : room.height - 1;
  return Array.from({ length: room.door.width }, (_, i) => ({ x: room.door.x + i, y }));
}

// Une déco est valable dans cette pièce (la standard par défaut) : voir DecorError. Une porte au nord a aussi son mur : un élément mural ne la
// surplombe pas (`blocks_door`, avec le rang de l'élément).
export function checkDecor(decor: DeskDecor, room: DeskRoomSpec = DESK_ROOMS.standard): DecorCheck {
  if (!isFloorTheme(decor.floor) || !isWallTheme(decor.wall)) return { ok: false, error: 'unknown_theme' };
  if (decor.items.length > MAX_DECOR_ITEMS) return { ok: false, error: 'too_many' };

  const placed: Array<{ item: DecorItem; at: Footprint; index: number }> = [];
  for (const [index, entry] of decor.items.entries()) {
    const item = decorItem(entry.id);
    if (!item) return { ok: false, error: 'unknown_item', index };
    if (!Number.isInteger(entry.x) || !Number.isInteger(entry.y)) return { ok: false, error: 'bad_position', index };
    if (item.kind === 'wall' && (entry.y !== 0 || item.h > 2)) return { ok: false, error: 'bad_position', index };
    const at = footprintOf(item, entry);
    if (at.x < 0 || at.y < 0 || at.x + at.w > room.width || at.y + at.h > room.height) return { ok: false, error: 'out_of_room', index };
    placed.push({ item, at, index });
  }

  // Deux éléments de la même sorte (meubles, tapis, objets posés, éléments muraux) ne partagent jamais une case.
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const [a, b] = [placed[i]!, placed[j]!];
      if (a.item.kind === b.item.kind && !apart(a.at, b.at)) return { ok: false, error: 'overlap', index: b.index };
    }
  }

  // Une porte au nord perce le mur où se posent les éléments muraux : aucun ne la surplombe.
  if (room.door.side === 'north') {
    for (const { item, at, index } of placed) {
      if (item.kind === 'wall' && at.x < room.door.x + room.door.width && at.x + at.w > room.door.x) return { ok: false, error: 'blocks_door', index };
    }
  }

  // La porte n'est pas murée, et ce qui reste de libre se rejoint à pied depuis l'entrée.
  const blocked = blockedCells(decor.items, room.width);
  const entries = doorEntryCells(room).filter(({ x, y }) => !blocked.has(y * room.width + x));
  if (entries.length === 0) return { ok: false, error: 'blocks_door' };
  const seen = new Set<number>(entries.map(({ x, y }) => y * room.width + x));
  const queue = entries.map(({ x, y }) => [x, y] as const);
  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const [nx, ny] = [x + dx, y + dy];
      if (nx < 0 || ny < 0 || nx >= room.width || ny >= room.height) continue;
      const cell = ny * room.width + nx;
      if (blocked.has(cell) || seen.has(cell)) continue;
      seen.add(cell);
      queue.push([nx, ny]);
    }
  }
  if (seen.size + blocked.size < room.width * room.height) return { ok: false, error: 'unreachable' };
  return { ok: true };
}

// Ce que montre une pièce dont la personne n'a rien réglé : un poste de travail prêt à l'emploi (bureau, écran, clavier, lampe, chaise), des
// plantes et quelques éléments au mur. Elle peut tout changer, tout enlever. Il y en a un par pièce : la standard et la compacte, porte au sud ou
// au nord (l'entrée et le mur de la porte restent libres : le poste est à l'autre bout, ou de côté). Les cases du poste standard à porte au sud
// sont celles de toujours.
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

// Standard, porte au nord (colonnes 3 et 4 du haut) : le poste est décalé à droite, les tableaux de part et d'autre de la porte.
const STANDARD_NORTH_ITEMS: readonly PlacedItem[] = [
  { id: 'of-15-0', x: 0, y: 0 },
  { id: 'of-15-2', x: 1, y: 0 },
  { id: 'of-9-12', x: 5, y: 0 },
  { id: 'of-7-12', x: 7, y: 0 },
  { id: 'of-7-28', x: 5, y: 1 },
  { id: 'of-14-12', x: 6, y: 1 },
  { id: 'of-11-15', x: 7, y: 1 },
  { id: 'of-12-8', x: 5, y: 2 },
  { id: 'of-12-43', x: 6, y: 3 },
  { id: 'lr-13-21', x: 0, y: 4 },
  { id: 'of-0-17', x: 6, y: 4 },
  { id: 'of-6-10', x: 0, y: 1 },
];

// Compacte (6 × 7), le poste réduit : un bureau de deux cases, son écran, son clavier, sa chaise, un tableau et deux plantes.
const COMPACT_SOUTH_ITEMS: readonly PlacedItem[] = [
  { id: 'of-15-0', x: 0, y: 0 },
  { id: 'of-9-12', x: 3, y: 0 },
  { id: 'of-0-34', x: 3, y: 1 },
  { id: 'of-14-12', x: 3, y: 1 },
  { id: 'of-12-8', x: 3, y: 2 },
  { id: 'of-12-43', x: 4, y: 3 },
  { id: 'of-6-10', x: 0, y: 1 },
  { id: 'lr-13-21', x: 0, y: 4 },
];

// Compacte, porte au nord (colonnes 2 et 3 du haut) : le poste est contre le mur de droite.
const COMPACT_NORTH_ITEMS: readonly PlacedItem[] = [
  { id: 'of-15-0', x: 0, y: 0 },
  { id: 'of-9-12', x: 4, y: 0 },
  { id: 'of-0-34', x: 4, y: 1 },
  { id: 'of-14-12', x: 4, y: 1 },
  { id: 'of-12-8', x: 4, y: 2 },
  { id: 'of-12-43', x: 5, y: 3 },
  { id: 'of-6-10', x: 0, y: 1 },
  { id: 'lr-13-21', x: 0, y: 4 },
];

// Le poste par défaut qui va à cette pièce (taille et colonne de la porte), ou aucun pour une pièce d'une autre forme.
function layoutFor(room: DeskRoomSpec): readonly PlacedItem[] | null {
  const matches = (base: DeskRoomSpec) => room.width === base.width && room.height === base.height && room.door.x === base.door.x && room.door.width === base.door.width;
  const north = room.door.side === 'north';
  if (matches(DESK_ROOMS.standard)) return north ? STANDARD_NORTH_ITEMS : DEFAULT_DESK_ITEMS;
  if (matches(DESK_ROOMS.compact)) return north ? COMPACT_NORTH_ITEMS : COMPACT_SOUTH_ITEMS;
  return null;
}

// La pièce par défaut de cette pièce : son poste de travail, valable pour elle (checkDecor). Une pièce d'une autre forme est vide. Une copie à chaque appel.
export function defaultDeskDecor(room: DeskRoomSpec): DeskDecor {
  const layout = layoutFor(room) ?? [];
  return { floor: DEFAULT_FLOOR_THEME, wall: DEFAULT_WALL_THEME, items: layout.map((item) => ({ ...item })) };
}

export const DEFAULT_DESK_DECOR: DeskDecor = defaultDeskDecor(DESK_ROOMS.standard);
