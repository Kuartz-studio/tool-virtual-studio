import type { DeskInfo, OfficeMap, Place, Rect } from '@bureau/shared';
import { deskTitle } from './desks';

// Le plan schématique du bureau (la carte, touche M), comme un plan d'architecte posé sur sa pelouse : le jardin en fond, l'eau, les terrasses en bois, le
// bâtiment d'un seul tenant cerné de ses murs du dehors (ouverts à l'entrée et vers les terrasses), et dedans chaque pièce en un rectangle, son nom en grandes
// capitales au milieu. Les pièces s'étendent dans leurs murs, jusqu'au milieu d'un mur qu'elles partagent : deux pièces voisines se touchent, sans rien entre
// elles (« A5 et A1 collés entièrement », Andrea, le 31 octobre) ; jamais au-delà du bâtiment. Rien d'imbriqué : ni la place centrale (le café et l'accueil y
// sont), ni les couloirs, qui restent le sol du bâtiment. Les bureaux fermés sont hachurés, avec un cadenas ; les tables de jeu, quatre carrés égaux, alignés.

// Un lieu du plan : son rectangle étendu dans ses murs (en pixels de carte), celui de la carte (`source`, pour retrouver une zone), sa sorte, son nom en une ou
// deux lignes, la taille de sa police et son centre (en pixels de carte : au milieu de la pièce, ou de la bande que les tables de jeu lui laissent). `locked` : un
// bureau fermé (verrouillé, ou par le mode de son occupant), où l'on n'entre pas sans y être admis.
export interface PlanRoom {
  key: string;
  kind: Place['kind'];
  rect: Rect;
  source: Rect;
  lines: string[];
  fontSize: number;
  labelAt: { x: number; y: number };
  locked: boolean;
}

// Un morceau du dehors : un rectangle d'un lieu `outside` (le jardin, une terrasse), en bois (`deck`) ou en herbe, et son nom, placé comme celui d'une pièce
// (sans nom, les bandes du jardin qui font le tour du bâtiment : on le lit dans les angles).
export interface PlanOutside {
  key: string;
  rect: Rect;
  deck: boolean;
  lines: string[];
  fontSize: number;
  labelAt: { x: number; y: number };
}

// Le terrain : le sol du bâtiment (ses cases, en rectangles), ses murs du dehors (un chemin SVG), les morceaux du dehors, l'eau et le ring, en pixels de carte.
export interface PlanSite {
  building: Rect[];
  walls: string;
  outside: PlanOutside[];
  waters: Rect[];
  ring: Rect | null;
}

// La police des noms : Instrument Sans resserrée (font-stretch 75 %) en capitales, dont une lettre fait un peu plus d'une demi-hauteur de large. On compte
// large (0,6), pour qu'un nom ne touche jamais les bords de sa pièce.
const CHAR_WIDTH_EM = 0.6;
// Le nom occupe au plus 80 % de la largeur de la pièce, et sa police au plus 18 % de sa hauteur ; jamais plus d'une case et demie (48 px de carte) : une grande
// salle n'écrit pas son nom plus gros que les autres. Dehors, un nom plus discret (40 px au plus), qui peut prendre 30 % de la hauteur : les terrasses sont
// des bandes basses.
const LABEL_WIDTH_SHARE = 0.8;
interface LabelFit {
  heightShare: number;
  maxPx: number;
}
const ROOM_FIT: LabelFit = { heightShare: 0.18, maxPx: 48 };
const OUTSIDE_FIT: LabelFit = { heightShare: 0.3, maxPx: 40 };
// Au-delà de 12 lettres, un nom de plusieurs mots passe sur deux lignes.
const ONE_LINE_MAX_CHARS = 12;
// Un mur fait au plus trois cases d'épaisseur ; une rangée de cases en est une quand 60 % au moins sont bloquées (une porte la perce).
const MAX_WALL_TILES = 3;
const WALL_SHARE = 0.6;
// Une table de jeu : un carré de deux cases ; deux tables à moins d'une case et demie l'une de l'autre, sur un axe, sont sur la même ligne (ou colonne).
const TABLE_TILES = 2;
const ALIGN_TILES = 1.5;
// Les lieux du dehors en bois : les terrasses. Le reste du dehors est en herbe.
const DECKS: ReadonlySet<string> = new Set(['terrace']);

// Le nom en une ou deux lignes, en capitales : deux lignes au plus équilibrées (la coupure entre deux mots qui laisse la plus longue ligne la plus courte).
export function labelLines(text: string): string[] {
  const upper = text.trim().toLocaleUpperCase('fr');
  const words = upper.split(/\s+/);
  if (upper.length <= ONE_LINE_MAX_CHARS || words.length < 2) return [upper];
  let best: string[] = [upper];
  let bestLength = Number.POSITIVE_INFINITY;
  for (let cut = 1; cut < words.length; cut++) {
    const lines = [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
    const longest = Math.max(...lines.map((line) => line.length));
    if (longest < bestLength) {
      best = lines;
      bestLength = longest;
    }
  }
  return best;
}

// La taille de la police d'un nom de `lines` dans ce rectangle, en pixels de carte : assez petite pour tenir en largeur et en hauteur, jamais plus que `fit` ne
// le permet (48 px dans une pièce).
export function labelSize(lines: readonly string[], rect: Pick<Rect, 'width' | 'height'>, fit: LabelFit = ROOM_FIT): number {
  const longest = Math.max(1, ...lines.map((line) => line.length));
  const byWidth = (rect.width * LABEL_WIDTH_SHARE) / (longest * CHAR_WIDTH_EM);
  const byHeight = (rect.height * fit.heightShare) / Math.max(1, lines.length * 0.7);
  return Math.max(0, Math.min(fit.maxPx, byWidth, byHeight));
}

const contains = (outer: Rect, inner: Rect): boolean =>
  inner !== outer && inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

// Les cases du dehors : celles des lieux `outside` (le jardin, les terrasses), une par octet, ligne après ligne, comme map.blocked : 1 = dehors.
export function outsideCells(map: OfficeMap): Uint8Array {
  const { widthTiles: w, heightTiles: h, tileSize: size } = map;
  const cells = new Uint8Array(w * h);
  for (const place of map.places) {
    if (place.kind !== 'outside') continue;
    for (const rect of place.rects) {
      const [x0, y0] = [Math.max(0, Math.round(rect.x / size)), Math.max(0, Math.round(rect.y / size))];
      const [x1, y1] = [Math.min(w, Math.round((rect.x + rect.width) / size)), Math.min(h, Math.round((rect.y + rect.height) / size))];
      for (let y = y0; y < y1; y++) cells.fill(1, y * w + x0, y * w + x1);
    }
  }
  return cells;
}

type Side = 'left' | 'right' | 'top' | 'bottom';

// L'épaisseur du mur (en cases) contre ce côté du rectangle (en cases : début compris, fin exclue) : les rangées de cases bloquées à 60 % au moins qui le longent,
// jusqu'à MAX_WALL_TILES ; le bord de la carte arrête le compte, et le dehors aussi (une haie ou un arbre du jardin n'est pas un mur du bâtiment).
function wallThickness(map: OfficeMap, outside: Uint8Array, box: { x0: number; y0: number; x1: number; y1: number }, side: Side): number {
  const along = side === 'left' || side === 'right' ? [box.y0, box.y1] : [box.x0, box.x1];
  for (let t = 0; t < MAX_WALL_TILES; t++) {
    const line = side === 'left' ? box.x0 - 1 - t : side === 'right' ? box.x1 + t : side === 'top' ? box.y0 - 1 - t : box.y1 + t;
    const limit = side === 'left' || side === 'right' ? map.widthTiles : map.heightTiles;
    if (line < 0 || line >= limit) return t;
    let blocked = 0;
    for (let i = along[0]!; i < along[1]!; i++) {
      const [tx, ty] = side === 'left' || side === 'right' ? [line, i] : [i, line];
      const cell = ty * map.widthTiles + tx;
      if (outside[cell] === 1) return t;
      if (map.blocked[cell] === 1) blocked++;
    }
    if (blocked < WALL_SHARE * (along[1]! - along[0]!)) return t;
  }
  return MAX_WALL_TILES;
}

const SIDES: readonly Side[] = ['left', 'right', 'top', 'bottom'];
const OPPOSITE: Record<Side, Side> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// La bande de `t` cases qu'un rectangle prendrait dans le mur de ce côté.
function strip(box: Box, side: Side, t: number): Box {
  if (side === 'left') return { ...box, x0: box.x0 - t, x1: box.x0 };
  if (side === 'right') return { ...box, x0: box.x1, x1: box.x1 + t };
  if (side === 'top') return { ...box, y0: box.y0 - t, y1: box.y0 };
  return { ...box, y0: box.y1, y1: box.y1 + t };
}

const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// Chaque rectangle étendu dans les murs qui le bordent : de tout le mur s'il donne sur un couloir ou le dehors, de la moitié s'il le partage avec un autre
// rectangle de la liste (de l'autre côté du mur, et en face sur la moitié de sa longueur au moins) : les deux se touchent alors au milieu du mur. Un mur qui ne
// borde qu'en partie un rectangle (l'accueil, dont le mur du nord s'arrête où commence la cafétéria) ne l'étend pas, puisque la bande prise couvrirait une
// autre pièce ; la pièce d'en face prend alors tout le mur, comme celle qui donne sur un rectangle qui n'y voit pas de mur (la salle de sport sous la
// cafétéria) : il n'en reste rien entre les deux.
export function growIntoWalls(map: OfficeMap, rects: readonly Rect[], outside: Uint8Array = outsideCells(map)): Rect[] {
  const size = map.tileSize;
  const boxes: Box[] = rects.map((rect) => ({ x0: Math.round(rect.x / size), y0: Math.round(rect.y / size), x1: Math.round((rect.x + rect.width) / size), y1: Math.round((rect.y + rect.height) / size) }));
  const walls = boxes.map((box, index) =>
    SIDES.map((side) => {
      const t = wallThickness(map, outside, box, side);
      return t > 0 && boxes.some((other, j) => j !== index && overlaps(strip(box, side, t), other)) ? 0 : t;
    }),
  );
  const growth = walls.map((sides) => [...sides]);
  boxes.forEach((box, index) => {
    SIDES.forEach((side, s) => {
      const t = walls[index]![s]!;
      if (t === 0) return;
      const facing = boxes.findIndex((other, j) => {
        if (j === index) return false;
        const vertical = side === 'left' || side === 'right';
        const edge = side === 'left' ? other.x1 === box.x0 - t : side === 'right' ? other.x0 === box.x1 + t : side === 'top' ? other.y1 === box.y0 - t : other.y0 === box.y1 + t;
        const overlap = vertical ? Math.min(box.y1, other.y1) - Math.max(box.y0, other.y0) : Math.min(box.x1, other.x1) - Math.max(box.x0, other.x0);
        const length = vertical ? Math.min(box.y1 - box.y0, other.y1 - other.y0) : Math.min(box.x1 - box.x0, other.x1 - other.x0);
        return edge && overlap >= length / 2;
      });
      const back = SIDES.indexOf(OPPOSITE[side]);
      if (facing < 0 || walls[facing]![back] === 0) return;
      growth[index]![s] = t / 2;
      growth[facing]![back] = t / 2;
    });
  });
  return boxes.map((box, index) => {
    const [left, right, top, bottom] = growth[index]!;
    return { x: (box.x0 - left!) * size, y: (box.y0 - top!) * size, width: (box.x1 - box.x0 + left! + right!) * size, height: (box.y1 - box.y0 + top! + bottom!) * size };
  });
}

// Les tables de jeu du plan : un carré de TABLE_TILES cases chacune, centré sur sa table, les centres voisins (à moins d'ALIGN_TILES cases) ramenés à leur
// moyenne, sur chaque axe : quatre tables en deux rangées de deux font une grille de quatre carrés égaux.
export function planTables(map: OfficeMap): Rect[] {
  const size = map.tileSize;
  const centers = map.tables.map((table) => ({ x: table.rect.x + table.rect.width / 2, y: table.rect.y + table.rect.height / 2 }));
  const align = (values: number[]): number[] =>
    values.map((value) => {
      const near = values.filter((other) => Math.abs(other - value) < ALIGN_TILES * size);
      return near.reduce((sum, other) => sum + other, 0) / near.length;
    });
  const xs = align(centers.map((c) => c.x));
  const ys = align(centers.map((c) => c.y));
  const side = TABLE_TILES * size;
  return centers.map((_, i) => ({ x: xs[i]! - side / 2, y: ys[i]! - side / 2, width: side, height: side }));
}

// Une ligne se lit mieux que deux : elle l'emporte tant qu'elle s'écrit au moins à 90 % de la taille des deux (« SALLE DE BOXE » sous le ring, plutôt que
// serré en deux lignes à côté).
const ONE_LINE_BONUS = 1.1;

// Où écrire le nom `text` dans ce rectangle, et sur combien de lignes : au milieu ; si des obstacles y sont (les tables de jeu, le ring, l'eau), dans celle des
// quatre bandes qu'ils laissent libres (au-dessus, au-dessous, à gauche, à droite d'eux) où il s'écrit le plus gros, pour qu'il ne passe pas dessous. Sur une
// ligne plutôt que deux quand elle s'y écrit presque aussi gros (ONE_LINE_BONUS).
function placeLabel(rect: Rect, obstacles: readonly Rect[], text: string, fit: LabelFit): Pick<PlanRoom, 'lines' | 'fontSize' | 'labelAt'> {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  if (text.trim() === '') return { lines: [], fontSize: 0, labelAt: center };
  const balanced = labelLines(text);
  const choices = balanced.length > 1 ? [balanced, [balanced.join(' ')]] : [balanced];
  const inside = obstacles.filter((obstacle) => contains(rect, obstacle));
  let bands = [rect];
  if (inside.length > 0) {
    const top = Math.min(...inside.map((o) => o.y));
    const bottom = Math.max(...inside.map((o) => o.y + o.height));
    const left = Math.min(...inside.map((o) => o.x));
    const right = Math.max(...inside.map((o) => o.x + o.width));
    bands = [
      { x: rect.x, y: rect.y, width: rect.width, height: top - rect.y },
      { x: rect.x, y: bottom, width: rect.width, height: rect.y + rect.height - bottom },
      { x: rect.x, y: rect.y, width: left - rect.x, height: rect.height },
      { x: right, y: rect.y, width: rect.x + rect.width - right, height: rect.height },
    ];
  }
  let best = { lines: balanced, fontSize: 0, labelAt: center };
  let bestScore = -1;
  for (const band of bands) {
    for (const lines of choices) {
      const fontSize = labelSize(lines, band, fit);
      const score = lines.length === 1 ? fontSize * ONE_LINE_BONUS : fontSize;
      if (score > bestScore) {
        best = { lines, fontSize, labelAt: { x: band.x + band.width / 2, y: band.y + band.height / 2 } };
        bestScore = score;
      }
    }
  }
  return best;
}

// Une bande du dehors, bien plus longue que large (le jardin qui fait le tour de la carte) : elle ne porte pas de nom, il serait écrit tout autour du plan ;
// on le lit sur les jardins des angles.
const BAND_RATIO = 6;
const isBand = (rect: Rect): boolean => Math.max(rect.width, rect.height) > BAND_RATIO * Math.min(rect.width, rect.height);

// Les lieux du plan, dans l'ordre où on les dessine : les espaces ouverts (la cafétéria, l'accueil), les pièces, puis les bureaux. Les lieux de la carte
// (zones `place`), sans le dehors (le terrain, planSite), ni les couloirs, ni ceux qui en contiennent d'autres ; une carte qui n'en a pas (celle des tests)
// donne ses pièces à part (zones `private`). Un bureau porte le nom qu'on lui voit dans le jeu (deskTitle).
export function planRooms(map: OfficeMap, desks: readonly DeskInfo[]): PlanRoom[] {
  const declared: Array<{ key: string; kind: Place['kind']; rect: Rect; label: string; locked: boolean }> =
    map.places.length > 0
      ? map.places
          .filter((place) => place.kind !== 'outside')
          .flatMap((place) => place.rects.map((rect, i) => ({ key: i === 0 ? place.key : `${place.key}:${i}`, kind: place.kind, rect, label: place.label, locked: false })))
      : map.zones.filter((zone) => zone.type === 'private').map((zone) => ({ key: zone.id, kind: 'room' as const, rect: zone, label: zone.name ?? '', locked: false }));
  const shown = declared.filter((place) => place.kind !== 'street' && !declared.some((other) => other.kind !== 'street' && contains(place.rect, other.rect)));
  const order: Record<Place['kind'], number> = { outside: 0, street: 0, open: 1, room: 2, desk: 3 };
  shown.sort((a, b) => order[a.kind] - order[b.kind]);
  for (const zone of map.zones) {
    if (zone.type !== 'desk') continue;
    const key = zone.name ?? zone.id;
    const desk = desks.find((candidate) => candidate.key === key);
    shown.push({ key: `desk:${key}`, kind: 'desk', rect: zone, label: deskTitle(desk ?? { key, ownerName: null, name: null }), locked: desk !== undefined && (desk.locked || desk.closedByState) });
  }
  const grown = growIntoWalls(map, shown.map((place) => place.rect));
  const obstacles = map.arena ? [...planTables(map), map.arena] : planTables(map);
  return shown.map((place, i) => ({
    key: place.key,
    kind: place.kind,
    rect: grown[i]!,
    source: { x: place.rect.x, y: place.rect.y, width: place.rect.width, height: place.rect.height },
    ...placeLabel(grown[i]!, obstacles, place.label, ROOM_FIT),
    locked: place.locked,
  }));
}

// Le sol du bâtiment : les cases qui ne sont pas dehors, en rectangles (une suite de cases d'une rangée, les rangées pareilles qui se suivent en un seul), en
// pixels de carte. Sans dehors (la carte des tests), toute la carte.
export function planBuilding(map: OfficeMap, outside: Uint8Array = outsideCells(map)): Rect[] {
  const { widthTiles: w, heightTiles: h, tileSize: size } = map;
  const rects: Rect[] = [];
  let above = new Map<string, Rect>();
  for (let y = 0; y < h; y++) {
    const row = new Map<string, Rect>();
    for (let x = 0; x < w; ) {
      if (outside[y * w + x] === 1) {
        x++;
        continue;
      }
      const start = x;
      while (x < w && outside[y * w + x] !== 1) x++;
      const run = `${start}:${x}`;
      const rect = above.get(run);
      if (rect) rect.height += size;
      else rects.push({ x: start * size, y: y * size, width: (x - start) * size, height: size });
      row.set(run, rect ?? rects.at(-1)!);
    }
    above = row;
  }
  return rects;
}

// Les murs du dehors : chaque bord entre une case bloquée du bâtiment (un mur) et le dehors, ou le bord de la carte, les bords d'une même ligne mis bout à
// bout. Une case du bord qu'on traverse (l'entrée, le passage vers une terrasse) n'en a pas : le mur y est ouvert. Un chemin SVG, en pixels de carte.
export function planWalls(map: OfficeMap, outside: Uint8Array = outsideCells(map)): string {
  const { widthTiles: w, heightTiles: h, tileSize: size } = map;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && outside[y * w + x] !== 1;
  // Les bords, par ligne : horizontaux par rangée (y du bord), verticaux par colonne (x du bord), chacun repéré par la case où il commence.
  const rows = new Map<number, number[]>();
  const columns = new Map<number, number[]>();
  const add = (lines: Map<number, number[]>, at: number, from: number) => lines.set(at, [...(lines.get(at) ?? []), from]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y) || map.blocked[y * w + x] !== 1) continue;
      if (!inside(x, y - 1)) add(rows, y, x);
      if (!inside(x, y + 1)) add(rows, y + 1, x);
      if (!inside(x - 1, y)) add(columns, x, y);
      if (!inside(x + 1, y)) add(columns, x + 1, y);
    }
  }
  const path: string[] = [];
  const join = (lines: Map<number, number[]>, horizontal: boolean) => {
    for (const [at, starts] of lines) {
      starts.sort((a, b) => a - b);
      let from = starts[0]!;
      let to = from + 1;
      for (const start of [...starts.slice(1), Number.POSITIVE_INFINITY]) {
        if (start === to) {
          to++;
          continue;
        }
        path.push(horizontal ? `M${from * size} ${at * size}H${to * size}` : `M${at * size} ${from * size}V${to * size}`);
        from = start;
        to = start + 1;
      }
    }
  };
  join(rows, true);
  join(columns, false);
  return path.join('');
}

// Le terrain du plan : le bâtiment et ses murs, chaque rectangle du dehors avec son nom (sur l'herbe, à côté de l'eau), l'eau, et le ring.
export function planSite(map: OfficeMap): PlanSite {
  const outside = outsideCells(map);
  const waters = map.waters ?? [];
  const pieces = map.places
    .filter((place) => place.kind === 'outside')
    .flatMap((place) =>
      place.rects.map((rect, i) => ({
        key: i === 0 ? place.key : `${place.key}:${i}`,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        deck: DECKS.has(place.key),
        ...placeLabel(rect, waters, isBand(rect) ? '' : place.label, OUTSIDE_FIT),
      })),
    );
  return { building: planBuilding(map, outside), walls: planWalls(map, outside), outside: pieces, waters, ring: map.arena };
}

// Le point de la carte (en pixels) sous ce point de l'écran, dans un plan dessiné dans `box` (sa boîte à l'écran) pour une carte de `map` pixels. Hors du
// plan, il est hors de la carte.
export function toMapPoint(clientX: number, clientY: number, box: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, map: { width: number; height: number }): { x: number; y: number } {
  if (!(box.width > 0) || !(box.height > 0)) return { x: Number.NaN, y: Number.NaN };
  return { x: ((clientX - box.left) / box.width) * map.width, y: ((clientY - box.top) / box.height) * map.height };
}
