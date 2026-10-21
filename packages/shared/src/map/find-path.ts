import type { OfficeMap } from './parse-map';
import { avatarBodyFits, isWalkableTile } from './queries';

export interface Point {
  x: number;
  y: number;
}

// Un chemin, de la case de départ à celle d'arrivée, et le point où il s'arrête :
// - path : les points à suivre dans l'ordre, au centre des cases traversées (le départ, lui, n'y est pas), puis le point d'arrêt ;
// - goal : où la personne s'arrête (le dernier point de path).
export interface FoundPath {
  path: Point[];
  goal: Point;
}

const STRAIGHT = 1;
const DIAGONAL = Math.SQRT2;
const NEIGHBOURS: ReadonlyArray<{ dx: number; dy: number; cost: number }> = [
  { dx: 0, dy: -1, cost: STRAIGHT },
  { dx: 0, dy: 1, cost: STRAIGHT },
  { dx: -1, dy: 0, cost: STRAIGHT },
  { dx: 1, dy: 0, cost: STRAIGHT },
  { dx: -1, dy: -1, cost: DIAGONAL },
  { dx: 1, dy: -1, cost: DIAGONAL },
  { dx: -1, dy: 1, cost: DIAGONAL },
  { dx: 1, dy: 1, cost: DIAGONAL },
];
// Les quatre premiers : les pas droits.
const STRAIGHT_NEIGHBOURS = NEIGHBOURS.slice(0, 4);

// Un tas binaire de [coût, case] : la plus petite distance en premier (la carte est petite, mais le tas ne coûte que ces lignes).
class MinHeap {
  private readonly items: Array<[number, number]> = [];

  get size(): number {
    return this.items.length;
  }

  push(cost: number, tile: number): void {
    const items = this.items;
    items.push([cost, tile]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]![0] <= items[i]![0]) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }

  pop(): [number, number] {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left]![0] < items[smallest]![0]) smallest = left;
        if (right < items.length && items[right]![0] < items[smallest]![0]) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i]!, items[smallest]!];
        i = smallest;
      }
    }
    return top;
  }
}

export interface FindPathOptions {
  // Faux : les quatre directions seulement, pour qui ne marche qu'en ligne droite (l'avatar de la personne qui joue) : le plus court
  // chemin est alors celui qui compte le moins de cases. Vrai par défaut.
  diagonals?: boolean;
}

// Le chemin le plus court de `from` à `to` (des pixels, les pieds de l'avatar) sur les cases praticables : 8 directions, mais jamais
// en diagonale entre deux cases bloquées ni le long d'un angle (les deux cases voisines de la diagonale doivent être libres), pour
// que l'avatar, large de 20 px, ne frotte pas un mur.
//
// `to` sur une case bloquante, ou qu'aucun chemin n'atteint : la case atteignable la plus proche de `to`. null seulement si `from` est
// lui-même sur une case bloquante (ou hors carte). Le point d'arrêt est `to` tel quel quand sa case est libre et que le corps de
// l'avatar y tient ; sinon le centre de la case.
export function findPath(map: OfficeMap, from: Point, to: Point, { diagonals = true }: FindPathOptions = {}): FoundPath | null {
  const { widthTiles: width, heightTiles: height, tileSize } = map;
  const neighbours = diagonals ? NEIGHBOURS : STRAIGHT_NEIGHBOURS;
  const tileOf = (p: Point) => ({ tx: Math.floor(p.x / tileSize), ty: Math.floor(p.y / tileSize) });
  const centerOf = (index: number): Point => ({
    x: (index % width) * tileSize + tileSize / 2,
    y: Math.floor(index / width) * tileSize + tileSize / 2,
  });

  const start = tileOf(from);
  if (!isWalkableTile(map, start.tx, start.ty)) return null;
  const startIndex = start.ty * width + start.tx;

  // Dijkstra depuis la case de départ : le coût de chaque case atteignable, et d'où l'on y vient.
  const cost = new Float64Array(width * height).fill(Infinity);
  const previous = new Int32Array(width * height).fill(-1);
  const heap = new MinHeap();
  cost[startIndex] = 0;
  heap.push(0, startIndex);
  while (heap.size > 0) {
    const [c, index] = heap.pop();
    if (c > cost[index]!) continue;
    const tx = index % width;
    const ty = Math.floor(index / width);
    for (const { dx, dy, cost: step } of neighbours) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (!isWalkableTile(map, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && !(isWalkableTile(map, tx + dx, ty) && isWalkableTile(map, tx, ty + dy))) continue;
      const next = ny * width + nx;
      if (c + step < cost[next]!) {
        cost[next] = c + step;
        previous[next] = index;
        heap.push(c + step, next);
      }
    }
  }

  // L'arrivée : la case visée si on peut y aller, sinon la case atteignable la plus proche du point visé (à égalité, la moins chère).
  const wanted = tileOf(to);
  let goalIndex = -1;
  if (isWalkableTile(map, wanted.tx, wanted.ty) && cost[wanted.ty * width + wanted.tx]! < Infinity) {
    goalIndex = wanted.ty * width + wanted.tx;
  } else {
    let best = Infinity;
    for (let index = 0; index < cost.length; index++) {
      if (cost[index]! === Infinity) continue;
      const c = centerOf(index);
      const distance = Math.hypot(c.x - to.x, c.y - to.y);
      if (distance < best - 1e-9 || (Math.abs(distance - best) <= 1e-9 && cost[index]! < cost[goalIndex]!)) {
        best = distance;
        goalIndex = index;
      }
    }
  }

  const tiles: number[] = [];
  for (let index = goalIndex; index !== startIndex; index = previous[index]!) tiles.push(index);
  tiles.reverse();
  const path = tiles.map(centerOf);

  // Le dernier point : exactement où l'on a lâché, si la case est celle visée et que le corps de l'avatar y tient.
  const exact =
    isWalkableTile(map, wanted.tx, wanted.ty) && goalIndex === wanted.ty * width + wanted.tx && avatarBodyFits(map, to.x, to.y);
  const goal = exact ? { x: to.x, y: to.y } : centerOf(goalIndex);
  if (path.length > 0) path[path.length - 1] = goal;
  else path.push(goal);
  return { path, goal };
}
