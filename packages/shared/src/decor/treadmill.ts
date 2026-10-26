import type { Point } from '../map/find-path';
import { deskKey, type OfficeMap, type Zone } from '../map/parse-map';
import { avatarBodyFits, isWalkableTile } from '../map/queries';
import { DECOR_STEPS, blockedCells } from './placement';
import type { PlacedItem } from './types';

// Le mode Sport sur son tapis de course. Le « Tapis de course » du décor (TREADMILL_ID, 2 × 3 cases, ses deux rangées du bas au sol) est le seul appareil
// sur lequel un mode pose quelqu'un, et seulement dans sa propre pièce : un mode qui conduit à la salle de sport (GYM_PLACE_KEY) propose alors d'aller sur son
// tapis à la place. Son image est la première de la planche animée du pack (props/treadmill.png : la console au nord, la bande vers le sud), 14 px plus bas
// dans sa case ; le jeu fait tourner la planche sous qui y court. Ce fichier dit où l'on court et où l'on descend : le serveur et le client font le même calcul.
export const TREADMILL_ID = 'gy-10-30';
export const GYM_PLACE_KEY = 'gym';
// On ne descend pas sur quelqu'un : à moins de cela de ses pieds (un peu moins d'une case, comme quand on rejoint quelqu'un).
export const STEP_OFF_APART_PX = 28;

// Un tapis de course où quelqu'un court (PublicPlayer.treadmill) : la clé du bureau, et la place de l'élément dans sa pièce (celle de son PlacedItem : le coin
// haut-gauche de son empreinte, en cases, au dixième près).
export interface TreadmillRef {
  desk: string;
  x: number;
  y: number;
}

// Son empreinte, en cases : sa largeur, et les deux rangées du bas de son image, au sol. Ses pieds : au milieu de sa largeur, et au milieu de sa bande, qui
// va de 10 à 40 px au-dessus du bas de l'image (le bas de l'empreinte) ; la console est au-dessus.
const FOOT = { w: 2, h: 2 };
const BELT_ABOVE_BOTTOM_PX = 25;

// La pièce de ce bureau sur la carte (sa zone desk), en cases : son coin haut-gauche et sa taille ; null si la carte ne l'a pas.
function roomOf(map: OfficeMap, desk: string): { x: number; y: number; width: number; height: number } | null {
  const zone: Zone | undefined = map.zones.find((candidate) => candidate.type === 'desk' && deskKey(candidate) === desk);
  if (!zone) return null;
  const size = map.tileSize;
  return { x: Math.round(zone.x / size), y: Math.round(zone.y / size), width: Math.round(zone.width / size), height: Math.round(zone.height / size) };
}

// Une place au dixième de case près, en dixièmes entiers : deux places égales le sont, quels que soient les arrondis des nombres à virgule.
const inSteps = (at: Pick<PlacedItem, 'x' | 'y'>) => ({ x: Math.round(at.x * DECOR_STEPS), y: Math.round(at.y * DECOR_STEPS) });
const sameSpot = (a: Pick<PlacedItem, 'x' | 'y'>, b: Pick<PlacedItem, 'x' | 'y'>): boolean => inSteps(a).x === inSteps(b).x && inSteps(a).y === inSteps(b).y;

// Les tapis de course posés dans une pièce, dans l'ordre de sa déco.
export function treadmillsIn(items: readonly PlacedItem[]): PlacedItem[] {
  return items.filter((item) => item.id === TREADMILL_ID);
}

// La déco a-t-elle encore un tapis à cette place ?
export function hasTreadmillAt(items: readonly PlacedItem[], at: Pick<PlacedItem, 'x' | 'y'>): boolean {
  return items.some((item) => item.id === TREADMILL_ID && sameSpot(item, at));
}

export function sameTreadmill(a: TreadmillRef, b: TreadmillRef): boolean {
  return a.desk === b.desk && sameSpot(a, b);
}

// L'empreinte du tapis, en pixels de la carte, telle que le jeu la dessine (chaque bord au pixel le plus proche : decor-layout.ts) ; null si son bureau n'est
// pas sur la carte.
export function treadmillFootprint(map: OfficeMap, ref: TreadmillRef): { left: number; top: number; right: number; bottom: number } | null {
  const room = roomOf(map, ref.desk);
  if (!room) return null;
  const px = (cells: number) => Math.round(cells * map.tileSize);
  return { left: px(room.x + ref.x), top: px(room.y + ref.y), right: px(room.x + ref.x + FOOT.w), bottom: px(room.y + ref.y + FOOT.h) };
}

// Les pieds de qui court sur ce tapis, en pixels entiers de la carte (ceux que le serveur tient) ; null si son bureau n'est pas sur la carte.
export function treadmillBelt(map: OfficeMap, ref: TreadmillRef): Point | null {
  const f = treadmillFootprint(map, ref);
  return f && { x: Math.round((f.left + f.right) / 2), y: f.bottom - BELT_ABOVE_BOTTOM_PX };
}

// Les cases de sa pièce que le tapis bloque (y × largeur + x) : toutes celles que son empreinte touche, même d'un dixième, comme pour la marche (blockedCells).
const ownCells = (ref: TreadmillRef, width: number): Set<number> => blockedCells([{ id: TREADMILL_ID, x: ref.x, y: ref.y }], width);

// Ce point (des pieds, en pixels de la carte) est-il sur le tapis : dans l'une des cases qu'il bloque ?
export function onTreadmill(map: OfficeMap, ref: TreadmillRef, point: Point): boolean {
  const room = roomOf(map, ref.desk);
  if (!room) return false;
  const [cx, cy] = [Math.floor(point.x / map.tileSize) - room.x, Math.floor(point.y / map.tileSize) - room.y];
  return cx >= 0 && cx < room.width && cy >= 0 && ownCells(ref, room.width).has(cy * room.width + cx);
}

// Où descendre de ce tapis (qu'il y soit encore ou non : on descend aussi d'un tapis qu'on vient de retirer, à sa place d'avant) : le centre d'une case de sa
// pièce où l'on peut se tenir (praticable, sans meuble de `items`, le corps y tient), à `apartPx` ou plus des pieds de chacun de `taken`. Dans cet ordre :
// 1. la rangée juste au sud du tapis, sous lui : on en descend à reculons ;
// 2. les cases qui le bordent : ses côtés, et les coins du sud ;
// 3. le reste de la pièce.
// Dans chaque groupe, la plus proche de ses pieds ; à égalité, la plus haute, puis la plus à gauche. Quand toutes les cases libres sont prises, on descend près de
// quelqu'un plutôt que de rester dans le meuble. null : aucune case (le bureau n'est pas sur la carte, ou sa pièce n'a plus une case libre, ce que checkDecor ne
// laisse pas faire : l'entrée reste toujours libre).
export function treadmillStepOff(map: OfficeMap, ref: TreadmillRef, items: readonly PlacedItem[], taken: readonly Point[] = [], apartPx = 0): Point | null {
  const room = roomOf(map, ref.desk);
  const feet = treadmillBelt(map, ref);
  if (!room || !feet) return null;
  const size = map.tileSize;
  const furniture = blockedCells(items, room.width);
  const own = ownCells(ref, room.width);
  // Les colonnes (de c0 à c1 − 1) et les rangées (de r0 à r1 − 1) que le tapis touche, en cases de sa pièce : r1 est la rangée du sud.
  const at = inSteps(ref);
  const [c0, c1] = [Math.floor(at.x / DECOR_STEPS), Math.ceil((at.x + FOOT.w * DECOR_STEPS) / DECOR_STEPS)];
  const [r0, r1] = [Math.floor(at.y / DECOR_STEPS), Math.ceil((at.y + FOOT.h * DECOR_STEPS) / DECOR_STEPS)];
  const rank = (cx: number, cy: number): number => {
    if (cy === r1 && cx >= c0 && cx < c1) return 0;
    if (cx >= c0 - 1 && cx <= c1 && cy >= r0 && cy <= r1) return 1;
    return 2;
  };
  const pick = (spaced: boolean): Point | null => {
    let best: { spot: Point; rank: number; distance: number } | null = null;
    for (let cy = 0; cy < room.height; cy++) {
      for (let cx = 0; cx < room.width; cx++) {
        const cell = cy * room.width + cx;
        if (furniture.has(cell) || own.has(cell) || !isWalkableTile(map, room.x + cx, room.y + cy)) continue;
        const spot = { x: (room.x + cx) * size + size / 2, y: (room.y + cy) * size + size / 2 };
        if (!avatarBodyFits(map, spot.x, spot.y)) continue;
        if (spaced && taken.some((other) => Math.hypot(other.x - spot.x, other.y - spot.y) < apartPx)) continue;
        const [group, distance] = [rank(cx, cy), Math.hypot(spot.x - feet.x, spot.y - feet.y)];
        // `<` strict : à égalité, la première case rencontrée (la rangée la plus haute, puis la colonne la plus à gauche) reste.
        if (best === null || group < best.rank || (group === best.rank && distance < best.distance - 1e-9)) best = { spot, rank: group, distance };
      }
    }
    return best?.spot ?? null;
  };
  return pick(true) ?? pick(false);
}
