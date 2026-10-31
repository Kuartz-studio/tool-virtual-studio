import {
  decorItem,
  deskKey,
  deskRoomSpecOf,
  findPath,
  footprintOf,
  furnitureTiles,
  isWalkableTile,
  type Direction,
  type Footprint,
  type OfficeMap,
  type PlacedItem,
  type Point,
  type Zone,
} from '@bureau/shared';
import type { DirectionInput } from './input';

// « Aller à mon bureau » : l'avatar marche tout seul jusqu'à sa place ; un double-clic sur le jeu ou sur la carte du bureau : il y court. Ce fichier
// n'importe pas Phaser : il choisit la case où l'on s'arrête (deskTarget), calcule le trajet (planWalk, planDeskWalk, planWalkNear) et dit, image après
// image, la direction à prendre (AutoWalk). La scène la donne à
// l'avatar comme celle du clavier (LocalPlayer.step) : même vitesse, mêmes animations, mêmes positions envoyées au serveur, qui ne voit aucune
// différence avec une personne qui marche.

// À moins de cette distance (px) d'un point de passage, le long de son tronçon, on l'a atteint (ou dépassé : jamais de demi-tour). Une image de
// marche fait 2,7 px à 60 images par seconde, 5,3 px à 30 : une fenêtre de 4 px de chaque côté en retient toujours une.
export const REACH_PX = 4;
// Un tronçon suit la ligne des centres de case ; à plus de cette distance (px) de cette ligne, on commence par s'y remettre. Le corps de
// l'avatar (20 × 12 px) tient dans sa case avec 5 px de marge au moins : il ne touche jamais un mur en suivant la ligne, ni en tournant
// REACH_PX avant l'angle.
export const LANE_PX = 4;
// Bloqué : les pieds n'ont pas bougé de plus de STUCK_PX depuis plus de STUCK_MS (un meuble ou une porte que la carte ne connaît pas).
export const STUCK_MS = 1000;
const STUCK_PX = 1;

interface Tile {
  tx: number;
  ty: number;
}

const tileOf = (map: OfficeMap, p: Point): Tile => ({ tx: Math.floor(p.x / map.tileSize), ty: Math.floor(p.y / map.tileSize) });
const centerOf = (map: OfficeMap, t: Tile): Point => ({ x: t.tx * map.tileSize + map.tileSize / 2, y: t.ty * map.tileSize + map.tileSize / 2 });
const sameTile = (a: Tile, b: Tile): boolean => a.tx === b.tx && a.ty === b.ty;

// Les cases d'une ligne droite de a à b (même ligne ou même colonne) sont-elles toutes libres ?
function lineIsFree(map: OfficeMap, a: Tile, b: Tile): boolean {
  for (let ty = Math.min(a.ty, b.ty); ty <= Math.max(a.ty, b.ty); ty++) {
    for (let tx = Math.min(a.tx, b.tx); tx <= Math.max(a.tx, b.tx); tx++) {
      if (!isWalkableTile(map, tx, ty)) return false;
    }
  }
  return true;
}

// L'angle d'un trajet en L de a à b, horizontalement d'abord, sinon verticalement d'abord, dont toutes les cases sont libres. a ou b si les deux
// cases sont sur une même ligne ; null si aucun des deux L n'est libre.
function elbowBetween(map: OfficeMap, a: Tile, b: Tile): Tile | null {
  for (const corner of [{ tx: b.tx, ty: a.ty }, { tx: a.tx, ty: b.ty }]) {
    if (lineIsFree(map, a, corner) && lineIsFree(map, corner, b)) return corner;
  }
  return null;
}

// Les chemins de la recherche vont de case en case et, à longueur égale, zigzaguent n'importe comment : un avatar qui ne va qu'en ligne droite
// tournerait à chaque case. Chaque morceau qui ne s'éloigne jamais du but (autant de cases que l'écart en colonnes plus l'écart en lignes) est
// donc remplacé par un L, ou une ligne, dont les cases sont libres : la même longueur, bien moins de virages. On prend à chaque fois le plus
// long morceau possible.
function straighten(map: OfficeMap, steps: Tile[]): Tile[] {
  const kept = [steps[0]!];
  let i = 0;
  while (i < steps.length - 1) {
    const from = steps[i]!;
    let to = i + 1;
    let elbow: Tile | null = null;
    for (let j = steps.length - 1; j > i + 1; j--) {
      const candidate = steps[j]!;
      if (Math.abs(candidate.tx - from.tx) + Math.abs(candidate.ty - from.ty) !== j - i) continue;
      elbow = elbowBetween(map, from, candidate);
      if (elbow !== null) {
        to = j;
        break;
      }
    }
    if (elbow !== null) kept.push(elbow);
    kept.push(steps[to]!);
    i = to;
  }
  return kept;
}

// Les angles d'une suite de cases voisines : les doublons, et la case du milieu de trois cases à la suite dans le même sens, disparaissent.
function cornersOf(tiles: Tile[]): Tile[] {
  const corners: Tile[] = [];
  for (const t of tiles) {
    const [a, b] = [corners.at(-2), corners.at(-1)];
    if (b !== undefined && sameTile(b, t)) continue;
    if (a !== undefined && b !== undefined && Math.sign(b.tx - a.tx) === Math.sign(t.tx - b.tx) && Math.sign(b.ty - a.ty) === Math.sign(t.ty - b.ty)) {
      corners.pop();
    }
    corners.push(t);
  }
  return corners;
}

// Le trajet de `from` (les pieds de l'avatar) au centre de la case de `to`, par le plus court chemin à pas droits : l'avatar ne marche que dans
// quatre directions. Les points sont des centres de case, les angles du trajet : le premier est celui de la case où l'on est (on s'y remet sur
// la ligne, voir AutoWalk), et de l'un à l'autre il y a une ligne droite, une ligne ou une colonne, de cases libres.
//
// null : `from` est sur une case bloquante, ou rien ne mène à la case de `to` (on n'ira pas à la case libre la plus proche : la marche ne
// ferait pas ce qu'on lui demande). Un seul point : on est déjà dans la case.
export function planWalk(map: OfficeMap, from: Point, to: Point): Point[] | null {
  const found = findPath(map, from, to, { diagonals: false });
  if (found === null || !sameTile(tileOf(map, found.goal), tileOf(map, to))) return null;
  const steps = [tileOf(map, from), ...found.path.map((p) => tileOf(map, p))].filter((t, i, all) => i === 0 || !sameTile(t, all[i - 1]!));
  return cornersOf(straighten(map, steps)).map((t) => centerOf(map, t));
}

// Le trajet de `from` jusqu'à la case d'à côté de celle de `to`, celle d'où l'on arrive : le plus court chemin jusqu'à sa case, sans son dernier pas (« Suivre »
// s'arrête à une case de la personne suivie). La case de `to` fermée (la personne est dans l'encadrement d'une porte qui nous est fermée, sur un meuble) : on
// va à la case libre qui la touche, si le chemin y mène. null : on n'arrive pas jusqu'à elle. Un seul point : on y est déjà.
export function planApproach(map: OfficeMap, from: Point, to: Point): Point[] | null {
  const found = findPath(map, from, to, { diagonals: false });
  if (found === null) return null;
  const [goal, wanted] = [tileOf(map, found.goal), tileOf(map, to)];
  const reached = sameTile(goal, wanted);
  if (!reached && Math.max(Math.abs(goal.tx - wanted.tx), Math.abs(goal.ty - wanted.ty)) > 1) return null;
  const steps = [tileOf(map, from), ...found.path.map((p) => tileOf(map, p))].filter((t, i, all) => i === 0 || !sameTile(t, all[i - 1]!));
  if (reached && steps.length > 1) steps.pop();
  return cornersOf(straighten(map, steps)).map((t) => centerOf(map, t));
}

// Le trajet de `from` au point `to` qu'on a montré (un double-clic) : jusqu'à sa case, ou, s'il est dans un mur, un meuble ou une pièce où l'on ne va pas, jusqu'à
// la case atteignable la plus proche de lui (findPath). null : `from` est sur une case bloquante. Un seul point : on y est déjà.
export function planWalkNear(map: OfficeMap, from: Point, to: Point): Point[] | null {
  const found = findPath(map, from, to, { diagonals: false });
  if (found === null) return null;
  const steps = [tileOf(map, from), ...found.path.map((p) => tileOf(map, p))].filter((t, i, all) => i === 0 || !sameTile(t, all[i - 1]!));
  return cornersOf(straighten(map, steps)).map((t) => centerOf(map, t));
}

// La pièce d'un bureau, en cases de la carte : son coin haut-gauche et sa taille. Le décor des occupants n'existe que dans les pièces que la
// carte décrit avec une porte (DecorLayer) : les autres cartes (celle de développement) n'ont pas de meubles.
function roomTiles(map: OfficeMap, room: Zone): { tx: number; ty: number; width: number; height: number; decorated: boolean } {
  const [width, height] = [Math.round(room.width / map.tileSize), Math.round(room.height / map.tileSize)];
  return {
    tx: Math.round(room.x / map.tileSize),
    ty: Math.round(room.y / map.tileSize),
    width,
    height,
    decorated: deskRoomSpecOf(map, deskKey(room)) !== undefined,
  };
}

// La carte comme la marche la voit : celle du jeu, plus les meubles solides que l'occupant a posés dans sa pièce et devant elle, dans la rue (des
// obstacles pour l'avatar, mais pas dans la carte, où chacun règle la sienne). Les sièges, tapis et éléments muraux ne bloquent rien. Un meuble posé
// au dixième de case bloque toutes les cases qu'il touche (furnitureTiles, la règle de passage de la déco) : le chemin passe par des cases entièrement
// libres. Ceux des autres bureaux, la scène les a déjà mis dans `map` (la carte de la marche de « Suivre »).
export function deskWalkMap(map: OfficeMap, room: Zone, items: readonly PlacedItem[]): OfficeMap {
  if (!roomTiles(map, room).decorated) return map;
  const blocked = Uint8Array.from(map.blocked);
  for (const index of furnitureTiles(map, [{ key: deskKey(room), items }])) blocked[index] = 1;
  return { ...map, blocked };
}

// Le siège du poste de travail : celui qui est posé juste sous un bureau (même colonne, à moins d'une demi-case de son bord : la déco se pose au
// dixième de case), sinon le premier siège posé. Son empreinte, en cases de la pièce ; null sans siège.
function seatOf(items: readonly PlacedItem[]): Footprint | null {
  const placed = items.flatMap((p) => {
    const item = decorItem(p.id);
    return item ? [{ item, foot: footprintOf(item, p) }] : [];
  });
  const seats = placed.filter(({ item }) => item.cat === 'sieges' && item.kind === 'object');
  const desks = placed.filter(({ item }) => item.cat === 'bureaux' && item.kind === 'object');
  const below = (desk: Footprint, seat: Footprint) => seat.y - (desk.y + desk.h) > -1e-6 && seat.y - (desk.y + desk.h) < 0.5;
  const atDesk = seats.find(({ foot }) => desks.some((d) => below(d.foot, foot) && foot.x < d.foot.x + d.foot.w && d.foot.x < foot.x + foot.w));
  return (atDesk ?? seats[0])?.foot ?? null;
}

// La case où l'on s'arrête dans la pièce, sur la carte `map` de la marche : devant le siège (la case qui le suit au sud, au milieu de sa largeur) si
// l'on en connaît un, sinon au centre de la pièce ; si elle est prise, la case libre la plus proche, de préférence plus au sud, puis plus à l'ouest.
function pickTarget(map: OfficeMap, room: Zone, items: readonly PlacedItem[]): Point | null {
  const rect = roomTiles(map, room);
  const seat = rect.decorated ? seatOf(items) : null;
  // La case sous le milieu du siège, et la première rangée entière au sud de lui (il peut être posé au dixième de case).
  const wanted = seat ? { x: Math.floor(seat.x + seat.w / 2), y: Math.ceil(seat.y + seat.h - 1e-6) } : { x: Math.floor(rect.width / 2), y: Math.floor(rect.height / 2) };
  let best: { x: number; y: number; distance: number } | null = null;
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      if (!isWalkableTile(map, rect.tx + x, rect.ty + y)) continue;
      const distance = (x - wanted.x) ** 2 + (y - wanted.y) ** 2;
      if (best === null || distance < best.distance || (distance === best.distance && y > best.y)) best = { x, y, distance };
    }
  }
  return best === null ? null : centerOf(map, { tx: rect.tx + best.x, ty: rect.ty + best.y });
}

// Où l'on s'arrête dans son bureau (le centre de la case, en pixels), ou null si la pièce n'a pas une case libre. `items` : le décor de la pièce
// (DeskInfo.items).
export function deskTarget(map: OfficeMap, room: Zone, items: readonly PlacedItem[]): Point | null {
  return pickTarget(deskWalkMap(map, room, items), room, items);
}

// Le trajet des pieds `from` jusqu'à son bureau (voir planWalk), autour des meubles de la pièce. null : pas de case où s'arrêter, ou pas de
// chemin.
export function planDeskWalk(map: OfficeMap, room: Zone, items: readonly PlacedItem[], from: Point): Point[] | null {
  const walkMap = deskWalkMap(map, room, items);
  const target = pickTarget(walkMap, room, items);
  return target === null ? null : planWalk(walkMap, from, target);
}

interface Walk {
  // Le trajet (planWalk) : l'avatar est dans la case du premier point, et va au suivant, d'indice `next`.
  route: readonly Point[];
  next: number;
  // Où étaient les pieds quand ils ont bougé pour la dernière fois (de plus de STUCK_PX), et quand.
  anchor: Point;
  anchorAt: number;
  // L'heure de la dernière image.
  lastAt: number;
  // Il y court (un double-clic), au lieu d'y marcher (« Aller à mon bureau »).
  sprint: boolean;
}

// La marche automatique : suit un trajet en disant, à chaque image, la direction à prendre. Elle ne bouge rien elle-même : la scène lit la
// direction (update) et la donne à l'avatar, qui avance comme au clavier, murs et meubles compris.
//
// Chaque tronçon (d'un point du trajet au suivant) est suivi sur la ligne des centres de case : s'il en est loin (au départ, l'avatar est n'importe
// où dans sa case), on s'y remet d'abord, puis on avance jusqu'au point. L'avatar ne tourne pas en rond : un point dépassé est atteint.
//
// Un pas d'une image peut être plus long que ces marges : en courant (8 px à 60 images par seconde), et deux fois plus sur une machine qui n'en dessine que
// 30. L'avatar passerait alors d'un côté à l'autre de la ligne sans jamais y tomber, en zigzag, et ses positions en biais finiraient par couper l'angle
// d'un mur, que le serveur refuse. À moins d'un pas de la ligne, il s'y pose donc (`snap`, que la scène applique avant de le faire avancer), et il
// tourne à un angle dès qu'il en est à moins d'un demi-pas.
//
// Elle s'arrête (et le dit, `onState(false)`) à l'arrivée, à l'appel de cancel(), et si les pieds ne bougent plus depuis STUCK_MS.
export class AutoWalk {
  private walk: Walk | null = null;
  private snapTo: Point | null = null;

  // `onState` : dit si l'avatar marche tout seul, à chaque départ, et à chaque arrêt ou chemin introuvable.
  constructor(private readonly onState: (walking: boolean) => void) {}

  get walking(): boolean {
    return this.walk !== null;
  }

  // Court-il ? Faux hors marche.
  get sprinting(): boolean {
    return this.walk?.sprint ?? false;
  }

  // Le point de passage où l'avatar va, ou null hors marche.
  get waypoint(): Point | null {
    return this.walk === null ? null : this.walk.route[this.walk.next]!;
  }

  // Où poser les pieds avant le pas de cette image (sur la ligne du tronçon, voir update), ou null : ils y sont déjà, ou il n'y a pas de pas.
  get snap(): Point | null {
    return this.snapTo;
  }

  // Part sur ce trajet, depuis ces pieds, en courant si `sprint`. null (chemin introuvable) ou un seul point (on y est) : l'avatar ne bouge pas, et la
  // marche en cours, s'il y en avait une, s'arrête.
  start(route: readonly Point[] | null, feet: Point, now: number, sprint = false): void {
    this.walk = route !== null && route.length > 1 ? { route, next: 1, anchor: { x: feet.x, y: feet.y }, anchorAt: now, lastAt: now, sprint } : null;
    this.onState(this.walk !== null);
  }

  // La marche s'arrête là où est l'avatar. Hors marche, rien.
  cancel(): void {
    if (this.walk !== null) this.stop();
  }

  // Une image : la direction que prend l'avatar, d'après ses pieds (px, en nombres décimaux) et le pas qu'il fera pendant cette image (`step`, px : sa
  // vitesse fois la durée de l'image ; 0, les marges seules), ou null (pas de marche, ou elle vient de s'arrêter). À moins d'un pas de la ligne du
  // tronçon, `snap` dit où le poser sur elle.
  update(feet: Point, now: number, step = 0): Direction | null {
    this.snapTo = null;
    const walk = this.walk;
    if (walk === null) return null;

    // Une pause du jeu plus longue que STUCK_MS (page figée, machine en veille) n'est pas un blocage : l'avatar n'a pas eu l'occasion de bouger.
    if (now - walk.lastAt > STUCK_MS) walk.anchorAt = now;
    walk.lastAt = now;
    if (Math.hypot(feet.x - walk.anchor.x, feet.y - walk.anchor.y) > STUCK_PX) {
      walk.anchor = { x: feet.x, y: feet.y };
      walk.anchorAt = now;
    } else if (now - walk.anchorAt > STUCK_MS) {
      this.stop();
      return null;
    }

    const reach = Math.max(REACH_PX, step / 2);
    const lane = Math.max(LANE_PX, step);
    for (; walk.next < walk.route.length; walk.next++) {
      const [from, to] = [walk.route[walk.next - 1]!, walk.route[walk.next]!];
      const horizontal = from.y === to.y;
      const sign = Math.sign(horizontal ? to.x - from.x : to.y - from.y);
      // Ce qu'il reste à faire sur le tronçon (négatif : on a dépassé le point), et l'écart à la ligne des centres (de quel côté est-elle ?).
      const remaining = (horizontal ? to.x - feet.x : to.y - feet.y) * sign;
      const aside = horizontal ? to.y - feet.y : to.x - feet.x;
      if (remaining <= reach) continue;
      if (Math.abs(aside) > lane) return horizontal ? (aside < 0 ? 'up' : 'down') : aside < 0 ? 'left' : 'right';
      if (aside !== 0) this.snapTo = horizontal ? { x: feet.x, y: to.y } : { x: to.x, y: feet.y };
      return horizontal ? (sign > 0 ? 'right' : 'left') : sign > 0 ? 'down' : 'up';
    }
    this.stop();
    return null;
  }

  private stop(): void {
    this.walk = null;
    this.snapTo = null;
    this.onState(false);
  }
}

// Une touche de déplacement qu'on enfonce reprend la main : la marche s'arrête, même si la touche est relâchée aussitôt. Les touches tapées
// dans un champ, ou avec Ctrl, Alt ou ⌘, ne sont pas pour l'avatar (bindKeyboard) et n'arrêtent rien. Renvoie la fonction qui arrête d'écouter.
export function cancelOnMoveKey(walk: AutoWalk, input: DirectionInput): () => void {
  return input.onPress(() => walk.cancel());
}
