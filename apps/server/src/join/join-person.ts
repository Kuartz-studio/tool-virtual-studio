import { JOIN_SEARCH_TILES, furnitureTiles, insideRing, spotNear, zoneAt, type ArenaState, type DeskInfo, type JoinAck, type OfficeMap, type PublicPlayer } from '@bureau/shared';
import type { Teleport } from '../teleport';

export interface JoinDeps {
  world: { get(id: string): PublicPlayer | undefined; list(): PublicPlayer[] };
  map: OfficeMap;
  /** Les bureaux : où cette personne peut se tenir (pas dans le bureau fermé d'un autre), et la déco de chacun (ses meubles). */
  desks: { canStandAt(userId: string, x: number, y: number): boolean; list(): DeskInfo[] };
  /** L'octogone : on ne quitte pas un combat en rejoignant quelqu'un. Absent : la carte n'en a pas. */
  arena?: { state(): ArenaState };
  teleport: Teleport;
}

// À moins de cela des pieds de quelqu'un, on ne pose personne : un peu moins d'une case, pour que deux avatars ne se chevauchent pas.
export const ARRIVAL_APART_PX = 28;
// La marge du ring où l'on ne pose personne : celle des places du public (arena-controller.ts).
const RING_MARGIN = -12;

// « Rejoindre » quelqu'un (le menu d'une personne, au clic droit, quand on est à FOLLOW_RANGE_TILES cases ou plus d'elle) : le serveur pose la personne qui le
// demande à côté d'elle, par un voyage voulu (l'anneau de lumière et son son). La case est celle de spotNear : la plus proche d'elle en marchant depuis là où
// elle est (jamais de l'autre côté d'un mur), où l'on tient sans toucher personne ni un meuble, hors du bureau fermé d'un autre (on arrive alors devant sa
// porte), hors du cadre d'une porte et du ring de l'octogone. Un combattant de l'octogone ne quitte pas son combat (`busy`).
export function createJoin(d: JoinDeps) {
  return (userId: string, targetId: string): JoinAck => {
    if (targetId === userId) return { ok: false, error: 'self' };
    const target = d.world.get(targetId);
    if (!d.world.get(userId)) return { ok: false, error: 'invalid' };
    if (!target) return { ok: false, error: 'offline' };
    const arena = d.arena?.state();
    if (arena && (arena.phase === 'countdown' || arena.phase === 'fight') && arena.fighters.some((fighter) => fighter.id === userId)) return { ok: false, error: 'busy' };
    const ring = d.map.arena;
    const furniture = furnitureTiles(d.map, d.desks.list());
    const spot = spotNear(d.map, target, {
      blocked: (tx, ty) => furniture.has(ty * d.map.widthTiles + tx),
      canStand: (x, y) => d.desks.canStandAt(userId, x, y) && zoneAt(d.map, x, y, ['door']) === null && (ring === null || !insideRing(ring, x, y, RING_MARGIN)),
      taken: d.world.list().filter((p) => p.id !== userId),
      apartPx: ARRIVAL_APART_PX,
      maxSteps: JOIN_SEARCH_TILES,
    });
    if (spot === null || !d.teleport(userId, spot, 'teleport')) return { ok: false, error: 'no_spot' };
    return { ok: true };
  };
}

export type Join = ReturnType<typeof createJoin>;
