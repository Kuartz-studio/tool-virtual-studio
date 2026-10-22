import { freeSpotIn, isWalkablePoint, placeByKey, type ActivityState, type OfficeMap, type Place, type PublicPlayer, type Zone } from '@bureau/shared';
import type { Teleport } from '../teleport';

export interface ModeTravelDeps {
  world: { get(id: string): PublicPlayer | undefined; list(): PublicPlayer[] };
  map: OfficeMap;
  /** Les bureaux : celui d'une personne (sa clé), et sa place (sa pièce, et le point devant sa porte). */
  desks: { deskOf(userId: string): { key: string } | undefined; slot(key: string): { zone: Zone; exit: { x: number; y: number } } | undefined };
  teleport: Teleport;
}

// Ce que le serveur fait d'un mode qui a un emplacement (`place`) : prendre le mode conduit à ce lieu, en sortir ramène au bureau.
// - Prendre un mode dont l'emplacement est une destination de la carte (la salle de sport, la salle de jeu) : on est posé à une place libre de la pièce, loin des autres
//   (freeSpotIn). Si l'on y est déjà, on ne bouge pas (un serveur redémarré qui relit un mode n'y déplace personne) ; si la pièce est pleine, on reste où l'on est et le mode
//   s'applique quand même. Un emplacement qui n'est pas une destination (le café, une clé qui n'existe plus) n'est pas un voyage.
// - Sortir d'un mode qui avait un emplacement, ou en prendre un sans emplacement : retour au bureau (le centre de la pièce, sinon devant sa porte), et à l'apparition sans bureau ;
//   mais seulement si l'on est encore dans la pièce du mode : qui en est parti à pied reste où il est. D'un mode à emplacement à un autre : directement au nouveau lieu, le
//   retour restant le bureau.
// - Un mode sans emplacement, ou qui n'en avait pas, ne déplace jamais personne.
// Chaque voyage est un `teleport` avec la raison « teleport » : le jeu le souligne d'un anneau de lumière et d'un son.
export function createModeTravel(d: ModeTravelDeps) {
  // Le lieu que ce mode vise, si c'est une destination de la carte.
  function destinationOf(mode: ActivityState | null): Place | null {
    const place = mode?.place === undefined ? undefined : placeByKey(d.map, mode.place);
    return place?.destination ? place : null;
  }

  // Cette personne est-elle dans la pièce (l'un de ses rectangles) ?
  const isIn = (player: PublicPlayer, place: Place): boolean =>
    place.rects.some((rect) => player.x >= rect.x && player.x < rect.x + rect.width && player.y >= rect.y && player.y < rect.y + rect.height);

  // Au bureau : le centre de la pièce s'il est praticable, sinon le point devant sa porte ; sans bureau, à l'apparition.
  function home(userId: string): void {
    const desk = d.desks.deskOf(userId);
    const slot = desk && d.desks.slot(desk.key);
    if (!slot) {
      d.teleport(userId, d.map.spawn, 'teleport');
      return;
    }
    const center = { x: slot.zone.x + slot.zone.width / 2, y: slot.zone.y + slot.zone.height / 2 };
    d.teleport(userId, isWalkablePoint(d.map, Math.round(center.x), Math.round(center.y)) ? center : slot.exit, 'teleport');
  }

  return {
    // Cette personne passe du mode `previous` (null : aucun) au mode `next` (null : aucun) : le voyage qui va avec, s'il y en a un.
    change(userId: string, previous: ActivityState | null, next: ActivityState | null): void {
      const me = d.world.get(userId);
      if (!me) return;
      const to = destinationOf(next);
      if (to !== null) {
        if (isIn(me, to)) return;
        const spot = freeSpotIn(d.map, to, d.world.list().filter((other) => other.id !== userId));
        if (spot !== null) d.teleport(userId, spot, 'teleport');
        return;
      }
      const from = destinationOf(previous);
      if (from !== null && isIn(me, from)) home(userId);
    },
  };
}

export type ModeTravel = ReturnType<typeof createModeTravel>;
