import { TILE_SIZE, decorItem, footprintOf, type DecorItem, type Footprint } from '@bureau/shared';

// Où et dans quel ordre se dessinent les éléments posés (ceux de la carte comme ceux d'un bureau). Les coordonnées sont celles de la carte, en
// cases : le coin haut-gauche de l'empreinte de l'élément ; pour un élément mural, la rangée de la première case de la pièce qu'il surplombe.

export interface PlacedAt {
  id: string;
  x: number;
  y: number;
  // De combien de pixels on abaisse l'image (une chaise rentrée sous sa table) : l'empreinte et la profondeur restent celles de sa case.
  offsetY?: number;
}

// Un objet d'un calque de la carte, tel que Phaser le donne : sa position en pixels, et ses propriétés Tiled (la liste de { name, value }, ou une table).
export interface MapObjectProperties {
  properties?: ReadonlyArray<{ name: string; value?: unknown }> | Readonly<Record<string, unknown>>;
}

export function namedProperty(object: MapObjectProperties, name: string): unknown {
  return Array.isArray(object.properties) ? object.properties.find((p) => p.name === name)?.value : (object.properties as Record<string, unknown> | undefined)?.[name];
}

export interface MapObject extends MapObjectProperties {
  name?: string;
  x?: number;
  y?: number;
}

// Les éléments que la carte pose : le nom de chaque objet du calque `objets` est la clé de l'élément, sa position (en pixels) le coin haut-gauche de son
// empreinte ; sa propriété `offsetY`, quand la carte en donne une, le décalage de son image. Ce que la banque ne connaît pas est laissé de côté.
export function placedFromObjects(objects: readonly MapObject[]): PlacedAt[] {
  return objects.flatMap((object) => {
    if (!object.name || !decorItem(object.name)) return [];
    const offsetY = namedProperty(object, 'offsetY');
    return [{ id: object.name, x: Math.round((object.x ?? 0) / TILE_SIZE), y: Math.round((object.y ?? 0) / TILE_SIZE), ...(typeof offsetY === 'number' && offsetY !== 0 ? { offsetY } : {}) }];
  });
}

// Les profondeurs des éléments qui ne se trient pas par leur bas : un tapis est sous tout le monde, un élément mural juste au-dessus des murs.
// Un meuble, lui, a pour profondeur le y (en pixels) du bas de son empreinte, comme un avatar a celui de ses pieds : qui est plus bas est devant.
export const DECOR_DEPTH = { floor: 1.5, wall: 1.6 } as const;

export interface Drawn {
  placed: PlacedAt;
  item: DecorItem;
  // Le coin bas-gauche de l'image, en pixels de la carte (son origine est en bas à gauche).
  left: number;
  bottom: number;
  depth: number;
  footprint: Footprint;
}

const contains = (f: Footprint, x: number, y: number): boolean => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h;

export function layoutDecor(placed: readonly PlacedAt[]): Drawn[] {
  const known = placed.flatMap((entry) => {
    const item = decorItem(entry.id);
    return item ? [{ entry, item, footprint: footprintOf(item, entry) }] : [];
  });
  const objects = known.filter(({ item }) => item.kind === 'object');
  return known.map(({ entry, item, footprint }) => {
    const left = entry.x * TILE_SIZE;
    const footBottom = (footprint.y + footprint.h) * TILE_SIZE;
    const nudge = entry.offsetY ?? 0;
    if (item.kind === 'wall') return { placed: entry, item, left, bottom: entry.y * TILE_SIZE + nudge, depth: DECOR_DEPTH.wall, footprint };
    if (item.kind === 'floor') return { placed: entry, item, left, bottom: footBottom + nudge, depth: DECOR_DEPTH.floor, footprint };
    if (item.kind === 'object') return { placed: entry, item, left, bottom: footBottom + nudge, depth: footBottom, footprint };
    // Un objet posé sur un meuble se dessine devant lui, quel que soit le rang où il est : juste au-dessus du bas du meuble qui le porte.
    const support = objects.filter((o) => contains(o.footprint, footprint.x, footprint.y)).map((o) => (o.footprint.y + o.footprint.h) * TILE_SIZE);
    return { placed: entry, item, left, bottom: footBottom + nudge, depth: Math.max(footBottom, ...support) + 0.5, footprint };
  });
}

// Le meuble ou l'objet le plus en avant sous cette case (x, y de la carte), ou -1. Pour attraper un élément à la souris : on prend celui qu'on
// voit, donc le dernier dessiné parmi ceux dont l'image couvre le point (en pixels).
export function drawnAt(drawn: readonly Drawn[], px: number, py: number): number {
  let best = -1;
  drawn.forEach((d, index) => {
    const w = d.item.w * TILE_SIZE;
    const h = d.item.h * TILE_SIZE;
    if (px < d.left || px >= d.left + w || py < d.bottom - h || py >= d.bottom) return;
    if (best === -1 || d.depth >= drawn[best]!.depth) best = index;
  });
  return best;
}
