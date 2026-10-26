import { deskKey, type OfficeMap, type Zone } from '../map/parse-map';
import type { Rect } from '../map/places';
import { isWalkableTile } from '../map/queries';
import { decorItem } from './catalog';
import { DEFAULT_FLOOR_THEME, DEFAULT_WALL_THEME, isFloorTheme, isWallTheme } from './themes';
import type { DecorItem, PlacedItem } from './types';

// La pièce d'un bureau : sa taille en cases, et sa porte : de quel côté (au nord ou au sud de la pièce), à quelle colonne elle commence, et sa
// largeur. Les cases de la pièce juste derrière la porte sont son entrée (doorEntryCells). La déco suit son occupant d'un bureau à l'autre :
// celle d'une pièce standard ne tient pas dans une compacte (checkDecor la refuse, la pièce montre alors son poste par défaut).
//
// `outside` : le dehors de la pièce, quand la carte lui en donne un (deskRoomSpecOf) : son côté sud, celui que l'on voit de la rue. C'est la face de sa
// bande de mur sud et la rangée de la rue juste dessous, sur la largeur de la pièce (ni les pans, ni rien chez le voisin), dans les mêmes coordonnées que
// la pièce : la bande occupe les rangées `height` et `height + 1`, la rangée du dehors est `height + 2` (outsideRow). `fixtures` : ce que la carte
// accroche déjà à cette face (l'interrupteur de la lumière, un panneau de sortie…), en cases de la pièce ; un élément mural du dehors ne les recouvre pas.
export interface DeskRoomSpec {
  width: number;
  height: number;
  door: { side: 'north' | 'south'; x: number; width: number };
  outside?: { fixtures: readonly Footprint[] };
}

// La rangée du dehors, en cases de la pièce : sous ses `height` rangées, les deux de sa bande de mur sud, puis la rue.
export function outsideRow(room: Pick<DeskRoomSpec, 'height'>): number {
  return room.height + 2;
}

// Les deux tailles de bureau de la carte : la standard (9 × 7, porte au sud sur les colonnes 3 et 4) et la compacte (6 × 7, colonnes 2 et 3). Une
// porte au nord se dit par `{ ...spec, door: { ...spec.door, side: 'north' } }` : deskRoomSpecOf lit le côté sur la carte, et le dehors, que ces
// pièces-ci n'ont pas (il dépend de ce que la carte pose autour).
export const DESK_ROOMS = {
  standard: { width: 9, height: 7, door: { side: 'south', x: 3, width: 2 } },
  compact: { width: 6, height: 7, door: { side: 'south', x: 2, width: 2 } },
} as const satisfies Record<string, DeskRoomSpec>;

export const MAX_DECOR_ITEMS = 80;

// Un élément se pose au dixième de case près : `x` et `y` sont des multiples de 1 / DECOR_STEPS. Une déco posée à la case près (toutes celles d'avant)
// l'est aussi. Les calculs de place se font en dixièmes entiers (inSteps), sans erreur d'arrondi.
export const DECOR_STEPS = 10;

// Cette coordonnée tombe-t-elle sur un dixième de case ? (0.30000000000000004 y tombe : c'est 0,3 à l'arrondi des nombres à virgule près.)
export function isDecorStep(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * DECOR_STEPS - Math.round(value * DECOR_STEPS)) < 1e-6;
}

// La coordonnée ramenée au dixième de case le plus proche : 0.30000000000000004 devient 0.3.
export function snapToDecorStep(value: number): number {
  return Math.round(value * DECOR_STEPS) / DECOR_STEPS;
}

// La pièce d'une place de la carte : la taille de sa zone `desk` et le côté de sa zone `door` (au nord si elle est au-dessus de la pièce), en cases, et
// son dehors si elle en a un (outsideOf) ; undefined si la place n'existe pas, ou n'a pas de porte (les bureaux de la petite carte de développement n'ont pas
// de pièce décorée).
export function deskRoomSpecOf(map: OfficeMap, key: string): DeskRoomSpec | undefined {
  const desk = map.zones.find((zone) => zone.type === 'desk' && deskKey(zone) === key);
  const door = map.zones.find((zone) => zone.type === 'door' && zone.name === key);
  if (!desk || !door) return undefined;
  const size = map.tileSize;
  const room: DeskRoomSpec = {
    width: Math.round(desk.width / size),
    height: Math.round(desk.height / size),
    door: { side: door.y < desk.y ? 'north' : 'south', x: Math.round((door.x - desk.x) / size), width: Math.round(door.width / size) },
  };
  const outside = outsideOf(map, desk, room);
  return outside ? { ...room, outside } : room;
}

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// Le dehors d'une pièce, si la carte lui en donne un : sous la pièce, sa bande de mur sud (deux rangées de mur, que la porte perce quand elle est au sud),
// puis une rangée de rue où l'on marche, sur toute la largeur de la pièce. Ses obstacles sont ce que la carte accroche déjà à la face de cette bande :
// l'interrupteur de la lumière (zone `switch`) et les éléments muraux du calque `objets` (les panneaux de sortie : OfficeMap.wallItems). undefined : la
// carte n'a pas de rue sous ce mur (une autre pièce, le bord de la carte, un meuble de la carte sur la rangée).
function outsideOf(map: OfficeMap, desk: Zone, room: DeskRoomSpec): DeskRoomSpec['outside'] {
  const size = map.tileSize;
  const [left, top] = [Math.round(desk.x / size), Math.round(desk.y / size)];
  const inDoor = (x: number) => room.door.side === 'south' && x >= room.door.x && x < room.door.x + room.door.width;
  for (let x = 0; x < room.width; x++) {
    for (const y of [room.height, room.height + 1]) if (isWalkableTile(map, left + x, top + y) !== inDoor(x)) return undefined;
    if (!isWalkableTile(map, left + x, top + outsideRow(room))) return undefined;
  }
  const band: Rect = { x: desk.x, y: desk.y + desk.height, width: desk.width, height: 2 * size };
  const hung: Rect[] = [...map.zones.filter((zone) => zone.type === 'switch'), ...(map.wallItems ?? [])];
  const fixtures = hung.filter((rect) => overlaps(rect, band)).map((rect) => ({ x: (rect.x - desk.x) / size, y: (rect.y - desk.y) / size, w: rect.width / size, h: rect.height / size }));
  return { fixtures };
}

// Ce qu'une personne règle pour sa pièce : le sol, les murs, et ce qu'elle y a posé.
export interface DeskDecor {
  floor: string;
  wall: string;
  items: PlacedItem[];
}

// Pourquoi une déco est refusée : `too_many` (plus de MAX_DECOR_ITEMS éléments), `unknown_item` ou `unknown_theme`, `bad_position` (une position
// qui ne tombe pas sur un dixième de case, ou un élément mural qui n'est pas contre le mur), `out_of_room` (l'élément déborde de la pièce),
// `overlap` (deux éléments qui se chevauchent), `blocks_door` (un meuble devant la porte), `unreachable` (un coin de la pièce que plus personne ne
// peut atteindre à pied).
// `not_owned` : un élément de la boutique que la personne n'a pas acheté (le serveur seul le sait : checkDecor ne le dit jamais).
export type DecorError = 'too_many' | 'unknown_item' | 'unknown_theme' | 'bad_position' | 'out_of_room' | 'overlap' | 'blocks_door' | 'unreachable' | 'not_owned';
export type DecorCheck = { ok: true } | { ok: false; error: DecorError; index?: number };

export interface Footprint {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Ce qu'un élément occupe, en cases (au dixième près, comme sa position) : sa largeur sur les `claim` rangées du bas de son image. Un élément
// mural n'occupe que sa place sur le mur (une rangée : celle de la première case de la pièce, que le mur surplombe ; dehors, celle de la rue, sous le
// mur du dehors).
export function footprintOf(item: DecorItem, at: { x: number; y: number }): Footprint {
  return { x: at.x, y: at.y, w: item.w, h: item.kind === 'wall' ? 1 : item.claim };
}

// La même empreinte, en dixièmes de case entiers.
function inSteps(f: Footprint): Footprint {
  return { x: Math.round(f.x * DECOR_STEPS), y: Math.round(f.y * DECOR_STEPS), w: Math.round(f.w * DECOR_STEPS), h: Math.round(f.h * DECOR_STEPS) };
}

// Deux empreintes (en dixièmes) qui ne se chevauchent pas : elles peuvent se toucher par un bord.
const apart = (a: Footprint, b: Footprint): boolean => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

// Les éléments déjà posés qui gênent celui-ci posé là : ceux de la même sorte dont l'empreinte chevauche la sienne (checkDecor refuse ce
// chevauchement). Leur rang dans `items`. C'est ce qu'un remplacement retire.
export function overlappingItems(items: readonly PlacedItem[], id: string, at: { x: number; y: number }): number[] {
  const item = decorItem(id);
  if (!item) return [];
  const target = inSteps(footprintOf(item, at));
  return items.flatMap((placed, index) => {
    const other = decorItem(placed.id);
    return other && other.kind === item.kind && !apart(inSteps(footprintOf(other, placed)), target) ? [index] : [];
  });
}

// Les cases de la pièce que les meubles solides touchent, même d'un dixième (numéro de case = y × largeur + x ; rien hors de la largeur ni
// au-dessus de la pièce ; ceux du dehors sur la rangée outsideRow). La règle de passage compte en cases entières, comme la marche automatique : un
// meuble à cheval sur deux cases les prend toutes les deux, et ce qui reste libre est toujours une case où l'avatar tient.
export function blockedCells(items: readonly PlacedItem[], width: number = DESK_ROOMS.standard.width): Set<number> {
  const blocked = new Set<number>();
  for (const placed of items) {
    const item = decorItem(placed.id);
    if (!item || !item.solid || item.kind === 'wall') continue;
    const f = inSteps(footprintOf(item, placed));
    const [x0, x1] = [Math.max(0, Math.floor(f.x / DECOR_STEPS)), Math.min(width, Math.ceil((f.x + f.w) / DECOR_STEPS))];
    const [y0, y1] = [Math.max(0, Math.floor(f.y / DECOR_STEPS)), Math.ceil((f.y + f.h) / DECOR_STEPS)];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) blocked.add(y * width + x);
  }
  return blocked;
}

// Les cases de la carte que bloquent les meubles solides posés dans les bureaux (`desks` : la clé de chaque place et ses éléments), en numéros de case de la
// carte (y × largeur + x) : la même règle de passage que blockedCells, dans chaque pièce que la carte décrit avec une porte (ailleurs, pas de décor), et sur
// la rangée de son dehors, dans la rue : ceux-là arrêtent tout le monde. Pour chercher où poser quelqu'un sans le mettre dans un meuble (spotNear), ou le
// chemin de qui marche tout seul (« Suivre », « Aller à mon bureau »).
export function furnitureTiles(map: OfficeMap, desks: ReadonlyArray<{ key: string; items: readonly PlacedItem[] }>): Set<number> {
  const tiles = new Set<number>();
  const itemsOf = new Map(desks.map((desk) => [desk.key, desk.items] as const));
  const size = map.tileSize;
  for (const zone of map.zones) {
    if (zone.type !== 'desk') continue;
    const key = deskKey(zone);
    const items = itemsOf.get(key);
    const room = items && deskRoomSpecOf(map, key);
    if (!items || !room) continue;
    const [left, top] = [Math.round(zone.x / size), Math.round(zone.y / size)];
    for (const cell of blockedCells(items, room.width)) {
      const [x, y] = [cell % room.width, Math.floor(cell / room.width)];
      if (y < room.height || (room.outside && y === outsideRow(room))) tiles.add((top + y) * map.widthTiles + left + x);
    }
  }
  return tiles;
}

// Les cases de la pièce juste derrière la porte : l'entrée, qui doit rester libre. La rangée du bas pour une porte au sud, celle du haut pour une porte
// au nord.
export function doorEntryCells(room: DeskRoomSpec): Array<{ x: number; y: number }> {
  const y = room.door.side === 'north' ? 0 : room.height - 1;
  return Array.from({ length: room.door.width }, (_, i) => ({ x: room.door.x + i, y }));
}

// Une déco est valable dans cette pièce (la standard par défaut) : voir DecorError. Une porte au nord a aussi son mur : un élément mural ne la
// surplombe pas (`blocks_door`, avec le rang de l'élément).
//
// Le dehors (room.outside) suit ses propres règles : un élément y est quand il est posé pile sur la rangée du dehors (outsideRow), et il n'y tient que sur
// la largeur de la pièce et sur une case de profondeur (`claim` d'au plus 1 ; plus profond, ou entre deux rangées : `out_of_room`). Un élément mural du
// dehors se dessine sur la face du mur sud, comme celui de la rangée 0 sur le mur du nord : il ne recouvre pas la porte d'une pièce dont la porte est au
// sud (`blocks_door`), et rien de solide ne se pose dans la rue juste devant cette porte (`blocks_door`) ; rien du dehors ne cache ce que la carte
// accroche déjà à ce mur (`overlap`).
export function checkDecor(decor: DeskDecor, room: DeskRoomSpec = DESK_ROOMS.standard): DecorCheck {
  if (!isFloorTheme(decor.floor) || !isWallTheme(decor.wall)) return { ok: false, error: 'unknown_theme' };
  if (decor.items.length > MAX_DECOR_ITEMS) return { ok: false, error: 'too_many' };

  // Les empreintes, en dixièmes de case (inSteps), comme la pièce et sa porte.
  const placed: Array<{ item: DecorItem; at: Footprint; index: number; outside: boolean }> = [];
  const [roomW, roomH] = [room.width * DECOR_STEPS, room.height * DECOR_STEPS];
  const outsideY = room.outside ? outsideRow(room) * DECOR_STEPS : null;
  for (const [index, entry] of decor.items.entries()) {
    const item = decorItem(entry.id);
    if (!item) return { ok: false, error: 'unknown_item', index };
    if (!isDecorStep(entry.x) || !isDecorStep(entry.y)) return { ok: false, error: 'bad_position', index };
    const at = inSteps(footprintOf(item, entry));
    const outside = at.y === outsideY;
    if (item.kind === 'wall' && ((entry.y !== 0 && !outside) || item.h > 2)) return { ok: false, error: 'bad_position', index };
    const fits = outside ? at.h <= DECOR_STEPS : at.y >= 0 && at.y + at.h <= roomH;
    if (at.x < 0 || at.x + at.w > roomW || !fits) return { ok: false, error: 'out_of_room', index };
    placed.push({ item, at, index, outside });
  }

  // Deux éléments de la même sorte (meubles, tapis, objets posés, éléments muraux) ne se chevauchent jamais ; ils peuvent se toucher. Ceux du dehors sont
  // sur une autre rangée que ceux de la pièce : ils ne se gênent pas.
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const [a, b] = [placed[i]!, placed[j]!];
      if (a.item.kind === b.item.kind && !apart(a.at, b.at)) return { ok: false, error: 'overlap', index: b.index };
    }
  }

  // La porte perce un mur où se posent des éléments muraux : celui du nord (dedans) quand elle est au nord, celui du dehors quand elle est au sud. Aucun ne
  // la recouvre ; et quand elle donne sur le dehors, aucun meuble solide n'y touche la rue devant elle, même d'un dixième.
  const [doorX0, doorX1] = [room.door.x * DECOR_STEPS, (room.door.x + room.door.width) * DECOR_STEPS];
  for (const { item, at, index, outside } of placed) {
    if (outside !== (room.door.side === 'south') || at.x >= doorX1 || at.x + at.w <= doorX0) continue;
    if (item.kind === 'wall' || (outside && item.solid)) return { ok: false, error: 'blocks_door', index };
  }

  // Ce que la carte accroche au mur du dehors reste visible : rien du dehors ne le recouvre, ni un élément mural (son image monte de sa hauteur au-dessus
  // de la rangée du dehors), ni l'image d'un objet posé devant (elle monte de sa hauteur au-dessus du bas de son empreinte).
  const fixtures = (room.outside?.fixtures ?? []).map(inSteps);
  for (const { item, at, index, outside } of placed) {
    if (!outside) continue;
    const bottom = item.kind === 'wall' ? at.y : at.y + at.h;
    const image = { x: at.x, y: bottom - item.h * DECOR_STEPS, w: at.w, h: item.h * DECOR_STEPS };
    if (fixtures.some((fixture) => !apart(fixture, image))) return { ok: false, error: 'overlap', index };
  }

  // La porte n'est pas murée, et ce qui reste de libre se rejoint à pied depuis l'entrée, de case libre en case libre (blockedCells : une case
  // qu'un meuble touche, même d'un dixième, n'est pas libre). Seulement dans la pièce : le dehors est la rue, qui se rejoint par ailleurs.
  const blocked = new Set([...blockedCells(decor.items, room.width)].filter((cell) => cell < room.width * room.height));
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
// plantes et quelques éléments au mur, et devant elle son dehors par défaut (STANDARD_OUTSIDE). Elle peut tout changer, tout enlever. Il y en a un
// par pièce : la standard et la compacte, porte au sud ou au nord (l'entrée et le mur de la porte restent libres : le poste est à l'autre bout, ou de
// côté). Les cases du poste standard à porte au sud sont celles de toujours. Une déco enregistrée avant qu'on décore le dehors n'a rien dehors : elle
// garde un dehors vide.
export const DEFAULT_DESK_ITEMS: readonly PlacedItem[] = [
  { id: 'of-15-0', x: 0, y: 0 },
  { id: 'of-9-12', x: 3, y: 0 },
  { id: 'of-15-2', x: 6, y: 0 },
  { id: 'of-7-28', x: 3, y: 1 },
  { id: 'of-14-12', x: 4, y: 1 },
  { id: 'of-11-15', x: 5, y: 1 },
  { id: 'of-12-8', x: 3, y: 2 },
  { id: 'of-0-8', x: 4, y: 3 },
  { id: 'of-7-12', x: 7, y: 0 },
  { id: 'lr-13-21', x: 0, y: 4 },
  { id: 'of-0-19', x: 6, y: 4 },
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
  { id: 'of-0-8', x: 6, y: 3 },
  { id: 'lr-13-21', x: 0, y: 4 },
  { id: 'of-0-19', x: 6, y: 4 },
  { id: 'of-6-10', x: 0, y: 1 },
];

// Compacte (6 × 7), le poste réduit : un bureau de deux cases, son écran, son clavier, sa chaise, un tableau et deux plantes.
const COMPACT_SOUTH_ITEMS: readonly PlacedItem[] = [
  { id: 'of-15-0', x: 0, y: 0 },
  { id: 'of-9-12', x: 3, y: 0 },
  { id: 'of-0-34', x: 3, y: 1 },
  { id: 'of-14-12', x: 3, y: 1 },
  { id: 'of-12-8', x: 3, y: 2 },
  { id: 'of-0-8', x: 4, y: 3 },
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
  { id: 'of-0-8', x: 5, y: 3 },
  { id: 'of-6-10', x: 0, y: 1 },
  { id: 'lr-13-21', x: 0, y: 4 },
];

// Le dehors par défaut, sur la rangée du dehors : ce que la carte posait dans la rue devant les bureaux (des arbustes, une fontaine à eau), le même pour toutes
// les pièces d'une taille, que leur porte soit au nord ou au sud (rien de solide dans l'axe de la porte). Devant une standard, un arbuste et la fontaine à
// l'ouest de la porte, un arbuste à l'est ; devant une compacte, un arbuste à l'est (à l'ouest, le mur des pièces du bout de la rangée porte le panneau de
// sortie, que la plante cacherait). Chaque pièce libre a ainsi au moins une plante devant elle.
const STANDARD_OUTSIDE: ReadonlyArray<{ id: string; x: number }> = [
  { id: 'lr-12-0', x: 0 },
  { id: 'of-12-15', x: 1 },
  { id: 'lr-12-0', x: 7 },
];
const COMPACT_OUTSIDE: ReadonlyArray<{ id: string; x: number }> = [{ id: 'lr-12-0', x: 5 }];

// Le poste par défaut qui va à cette pièce (taille et colonne de la porte), et son dehors, ou aucun pour une pièce d'une autre forme.
function layoutFor(room: DeskRoomSpec): { inside: readonly PlacedItem[]; outside: ReadonlyArray<{ id: string; x: number }> } | null {
  const matches = (base: DeskRoomSpec) => room.width === base.width && room.height === base.height && room.door.x === base.door.x && room.door.width === base.door.width;
  const north = room.door.side === 'north';
  if (matches(DESK_ROOMS.standard)) return { inside: north ? STANDARD_NORTH_ITEMS : DEFAULT_DESK_ITEMS, outside: STANDARD_OUTSIDE };
  if (matches(DESK_ROOMS.compact)) return { inside: north ? COMPACT_NORTH_ITEMS : COMPACT_SOUTH_ITEMS, outside: COMPACT_OUTSIDE };
  return null;
}

// La pièce par défaut de cette pièce : son poste de travail, et devant elle son dehors par défaut si la carte lui en donne un, valable pour elle
// (checkDecor). Une pièce d'une autre forme est vide. Une copie à chaque appel.
export function defaultDeskDecor(room: DeskRoomSpec): DeskDecor {
  const layout = layoutFor(room);
  const outside = room.outside ? (layout?.outside ?? []).map(({ id, x }) => ({ id, x, y: outsideRow(room) })) : [];
  return { floor: DEFAULT_FLOOR_THEME, wall: DEFAULT_WALL_THEME, items: [...(layout?.inside ?? []).map((item) => ({ ...item })), ...outside] };
}

export const DEFAULT_DESK_DECOR: DeskDecor = defaultDeskDecor(DESK_ROOMS.standard);
