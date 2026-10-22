import { TILE_SIZE, audioGain, type Zone } from '@bureau/shared';
import type { DoorView } from './desk-layer';

// Ce que fait une porte de bureau : elle est ouverte, se ferme, est fermée, ou s'ouvre. Ce fichier décide ce qu'elle veut être et quelle phase suit ; le
// dessin et l'animation sont ceux de DoorSprite, le calque des bureaux (DeskLayer) y branche l'état du bureau et les positions.

export type DoorPhase = 'open' | 'closing' | 'closed' | 'opening';
export type DoorTarget = 'open' | 'closed';

// À moins de cette distance du centre de la porte (en cases), une porte verrouillée s'ouvre pour celui qui y est admis, ou pour son propriétaire.
export const DOOR_REACH_TILES = 1.5;
// Une porte qui s'est ouverte pour quelqu'un se referme ce temps (ms) après son départ.
export const DOOR_CLOSE_DELAY_MS = 600;

// Ce que veut la porte, d'après ce qu'elle est pour soi (doorView) et qui est près d'elle :
// - ouverte pour soi (une place libre, une porte qui n'est pas verrouillée) : elle reste ouverte ;
// - fermée pour soi (le verrou d'un autre, un état d'activité, une exclusion) : elle reste fermée, même de près (on n'y passe pas) ; elle ne s'ouvre que pour
//   son propriétaire, qu'on voit y entrer ;
// - verrouillée, mais où l'on passe (son bureau, ou on y est admis) : elle s'ouvre de près et se ferme de loin.
export function doorTarget({ view, selfNear, ownerNear }: { view: DoorView; selfNear: boolean; ownerNear: boolean }): DoorTarget {
  if (view === 'open') return 'open';
  if (ownerNear) return 'open';
  return view === 'locked-mine' && selfNear ? 'open' : 'closed';
}

// La phase qui suit : un mouvement en cours se finit avant que l'autre ne commence (pas de demi-tour). `target` : ce que la porte veut.
export function nextPhase(phase: DoorPhase, target: DoorTarget): DoorPhase {
  switch (phase) {
    case 'open':
      return target === 'closed' ? 'closing' : 'open';
    case 'closing':
      return 'closed';
    case 'closed':
      return target === 'open' ? 'opening' : 'closed';
    case 'opening':
      return 'open';
  }
}

// Ce que la porte a retenu d'un instant à l'autre : quelqu'un était-il près d'elle, et quand elle doit se refermer (null : pas de fermeture en attente).
export interface DoorWatch {
  near: boolean;
  closeAt: number | null;
}

// La cible de la porte à l'instant `now` (ms), avec ce qu'elle retient pour le suivant : elle s'ouvre tout de suite quand elle le veut ; quand celui pour
// qui elle était ouverte s'éloigne, elle reste ouverte DOOR_CLOSE_DELAY_MS avant de se refermer ; une porte que personne n'a ouverte (un bureau qu'on vient
// de verrouiller) se ferme sans attendre.
export function watchDoor(watch: DoorWatch, input: { view: DoorView; selfNear: boolean; ownerNear: boolean }, now: number): { target: DoorTarget; watch: DoorWatch } {
  const near = input.selfNear || input.ownerNear;
  if (doorTarget(input) === 'open') return { target: 'open', watch: { near, closeAt: null } };
  let closeAt = watch.closeAt;
  if (watch.near && !near) closeAt = now + DOOR_CLOSE_DELAY_MS;
  if (closeAt !== null && now >= closeAt) closeAt = null;
  return { target: closeAt === null ? 'closed' : 'open', watch: { near, closeAt } };
}

// Ce point (les pieds de quelqu'un) est-il à DOOR_REACH_TILES du centre de cette porte ? Une position inconnue n'est pas près.
export function nearDoor(point: { x: number; y: number } | null, door: Pick<Zone, 'x' | 'y' | 'width' | 'height'>, tiles = DOOR_REACH_TILES): boolean {
  if (point === null) return false;
  return Math.hypot(point.x - (door.x + door.width / 2), point.y - (door.y + door.height / 2)) <= tiles * TILE_SIZE;
}

// Le volume du bruit d'une porte à cette distance (en pixels) : celui d'une voix en espace ouvert (audioGain, de partage) : plein de près, de plus en plus
// faible, le silence à 14 cases.
export function doorSoundLevel(distancePx: number): number {
  return audioGain(distancePx);
}
