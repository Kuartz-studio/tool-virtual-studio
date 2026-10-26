import {
  GYM_PLACE_KEY,
  STEP_OFF_APART_PX,
  freeSpotIn,
  hasTreadmillAt,
  isWalkablePoint,
  onTreadmill,
  placeByKey,
  sameTreadmill,
  treadmillBelt,
  treadmillStepOff,
  treadmillsIn,
  type ActivityState,
  type DeskInfo,
  type MovePayload,
  type OfficeMap,
  type Place,
  type Point,
  type PublicPlayer,
  type TreadmillRef,
  type Zone,
} from '@bureau/shared';
import type { Teleport } from '../teleport';

export interface ModeTravelDeps {
  world: {
    get(id: string): PublicPlayer | undefined;
    list(): PublicPlayer[];
    setTreadmill(id: string, treadmill: TreadmillRef | null, belt?: Point): boolean;
  };
  map: OfficeMap;
  /** Les bureaux : celui d'une personne (sa clé, et ce qu'on y a posé), chaque place (sa pièce, et le point devant sa porte), et la déco de chacune. */
  desks: {
    deskOf(userId: string): Pick<DeskInfo, 'key' | 'items'> | undefined;
    get(key: string): Pick<DeskInfo, 'key' | 'ownerId' | 'items'> | undefined;
    list(): Array<Pick<DeskInfo, 'key' | 'items'>>;
    slot(key: string): { zone: Zone; exit: { x: number; y: number } } | undefined;
  };
  teleport: Teleport;
  /** Dit à tout le bureau qu'elle court sur ce tapis (`treadmill:changed`). Qu'elle en descende, le monde le dit au tick suivant (World.drainTreadmillStops). */
  announceTreadmill: (userId: string, treadmill: TreadmillRef) => void;
}

// Ce que le serveur fait d'un mode qui a un emplacement (`place`) : prendre le mode conduit à ce lieu, en sortir ramène au bureau.
// - Prendre un mode dont l'emplacement est une destination de la carte (la salle de sport, la salle de jeu) : on est posé à une place libre de la pièce, loin des autres
//   (freeSpotIn). Si l'on y est déjà, on ne bouge pas (un serveur redémarré qui relit un mode n'y déplace personne) ; si la pièce est pleine, on reste où l'on est et le mode
//   s'applique quand même. Un emplacement qui n'est pas une destination (le café, une clé qui n'existe plus) n'est pas un voyage.
// - Sortir d'un mode qui avait un emplacement, ou en prendre un sans emplacement : retour au bureau (le centre de la pièce, sinon devant sa porte), et à l'apparition sans bureau ;
//   mais seulement si l'on est encore dans la pièce du mode : qui en est parti à pied reste où il est. D'un mode à emplacement à un autre : directement au nouveau lieu, le
//   retour restant le bureau.
// - Un mode sans emplacement, ou qui n'en avait pas, ne déplace jamais personne.
// - Sur son tapis de course (decor/treadmill.ts) : un mode qui conduit à la salle de sport, pris avec `treadmill`, pose la personne sur le premier tapis de sa pièce où
//   personne ne court, les pieds sur la bande, tournée vers la console ; sa pièce n'en a pas : la salle de sport, comme toujours. Elle y court jusqu'à ce qu'elle en
//   descende, posée sur la case libre devant le tapis (treadmillStepOff) : en sortant du mode (ou en en prenant un sans emplacement : elle est déjà à son bureau),
//   dès qu'elle bouge (`move` : le mode reste, comme quand on sort à pied de la salle de sport), ou quand le tapis quitte sa pièce (`desksChanged`). Un mode à
//   emplacement la conduit, lui, directement à son lieu. Personne n'est jamais laissé dans le meuble : qui arrive sur la bande d'un tapis (après le délai de grâce,
//   ou un redémarrage du serveur) est posé devant lui (`arrival`).
// Chaque voyage est un `teleport` avec la raison « teleport » : le jeu le souligne d'un anneau de lumière et d'un son. Descendre du tapis n'en est pas un (un pas) : une
// simple correction.
export function createModeTravel(d: ModeTravelDeps) {
  // Le lieu que ce mode vise, si c'est une destination de la carte.
  function destinationOf(mode: ActivityState | null): Place | null {
    const place = mode?.place === undefined ? undefined : placeByKey(d.map, mode.place);
    return place?.destination ? place : null;
  }

  // Cette personne est-elle dans la pièce (l'un de ses rectangles) ?
  const isIn = (player: PublicPlayer, place: Place): boolean =>
    place.rects.some((rect) => player.x >= rect.x && player.x < rect.x + rect.width && player.y >= rect.y && player.y < rect.y + rect.height);

  // Ceux qui sont au bureau, sauf elle : on ne la pose pas sur eux.
  const othersThan = (userId: string): PublicPlayer[] => d.world.list().filter((other) => other.id !== userId);

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

  // Monter sur son tapis de course : le premier de sa pièce où personne ne court. Faux si elle n'en a pas (le mode la conduit alors à la salle de sport). Déjà
  // dessus : rien ne bouge.
  function board(userId: string, me: PublicPlayer): boolean {
    const desk = d.desks.deskOf(userId);
    if (!desk) return false;
    if (me.treadmill?.desk === desk.key && hasTreadmillAt(desk.items, me.treadmill)) return true;
    const busy = othersThan(userId).flatMap((other) => (other.treadmill ? [other.treadmill] : []));
    const free = treadmillsIn(desk.items)
      .map(({ x, y }): TreadmillRef => ({ desk: desk.key, x, y }))
      .find((ref) => !busy.some((other) => sameTreadmill(other, ref)));
    const belt = free && treadmillBelt(d.map, free);
    if (!free || !belt) return false;
    if ((me.x !== belt.x || me.y !== belt.y) && !d.teleport(userId, belt, 'teleport')) return false;
    if (d.world.setTreadmill(userId, free, belt)) d.announceTreadmill(userId, free);
    return true;
  }

  // Où descendre de ce tapis : la case libre devant lui (treadmillStepOff, avec la déco de sa pièce telle qu'elle est maintenant), sinon devant la porte de la pièce ;
  // null : nulle part (son bureau n'est plus sur la carte).
  function stepOffSpot(userId: string, ref: TreadmillRef): Point | null {
    const items = d.desks.get(ref.desk)?.items ?? [];
    return treadmillStepOff(d.map, ref, items, othersThan(userId), STEP_OFF_APART_PX) ?? d.desks.slot(ref.desk)?.exit ?? null;
  }

  // Descendre de son tapis : posée sur la case libre devant lui. Posée ailleurs, elle ne court plus (le monde le voit) ; si rien ne la pose, elle cesse quand même
  // de courir.
  function stepOff(userId: string): void {
    const ref = d.world.get(userId)?.treadmill;
    if (!ref) return;
    const spot = stepOffSpot(userId, ref);
    if (spot === null || !d.teleport(userId, spot)) d.world.setTreadmill(userId, null);
  }

  return {
    // Cette personne passe du mode `previous` (null : aucun) au mode `next` (null : aucun) : le voyage qui va avec, s'il y en a un. `treadmill` : elle prend `next` sur son
    // tapis de course (state:set).
    change(userId: string, previous: ActivityState | null, next: ActivityState | null, options: { treadmill?: boolean } = {}): void {
      const me = d.world.get(userId);
      if (!me) return;
      const to = destinationOf(next);
      if (to !== null && options.treadmill === true && to.key === GYM_PLACE_KEY && board(userId, me)) return;
      if (to !== null) {
        if (isIn(me, to)) return;
        const spot = freeSpotIn(d.map, to, othersThan(userId));
        if (spot !== null) d.teleport(userId, spot, 'teleport');
        // La pièce est pleine : elle reste où elle est, mais pas sur son tapis, où ce mode ne la fait pas courir.
        else stepOff(userId);
        return;
      }
      // Sans emplacement : qui courait sur son tapis en descend (il est déjà à son bureau) ; qui est encore dans la pièce du mode revient au bureau.
      if (me.treadmill) {
        stepOff(userId);
        return;
      }
      const from = destinationOf(previous);
      if (from !== null && isIn(me, from)) home(userId);
    },

    // Un `move` de cette personne, avant que le monde ne le lise. Qui court en descend dès qu'elle bouge. Un pas qui la pose hors du tapis (son navigateur l'a fait
    // descendre lui-même, à la case libre devant) passe comme un autre : faux, le monde l'applique (et voit qu'elle ne court plus). Un pas qui la laisse sur le tapis,
    // ou qui marche sur place, ne passe pas : le serveur la pose devant, et rend vrai (le pas est remplacé). Sa position à l'arrêt (sa direction, un arrêt redit)
    // n'est pas un pas : elle court toujours. Qui ne court pas : faux.
    move(userId: string, move: MovePayload): boolean {
      const me = d.world.get(userId);
      const ref = me?.treadmill;
      if (!me || !ref) return false;
      const still = move.x === me.x && move.y === me.y;
      if (still ? !move.moving : !onTreadmill(d.map, ref, move)) return false;
      stepOff(userId);
      return true;
    },

    // Des bureaux ont changé (une déco enregistrée, une place prise ou rendue) : qui court sur un tapis qui n'y est plus (retiré, déplacé), ou dans une pièce qui n'est plus
    // la sienne, en descend, devant sa place d'avant.
    desksChanged(changed: ReadonlyArray<Pick<DeskInfo, 'key' | 'ownerId' | 'items'>>): void {
      for (const runner of d.world.list()) {
        const ref = runner.treadmill;
        const desk = ref && changed.find((candidate) => candidate.key === ref.desk);
        if (ref && desk && (desk.ownerId !== runner.id || !hasTreadmillAt(desk.items, ref))) stepOff(runner.id);
      }
    },

    // Où poser qui arrive au bureau à ce point (sa position enregistrée, ou l'apparition : chooseSpawn) : sur un tapis de course (elle y courait en partant, ou quand le
    // serveur s'est arrêté), devant lui, comme si elle en descendait ; ailleurs, là.
    arrival(userId: string, point: Point): Point {
      for (const desk of d.desks.list()) {
        for (const { x, y } of treadmillsIn(desk.items)) {
          const ref = { desk: desk.key, x, y };
          if (onTreadmill(d.map, ref, point)) return stepOffSpot(userId, ref) ?? point;
        }
      }
      return point;
    },
  };
}

export type ModeTravel = ReturnType<typeof createModeTravel>;
