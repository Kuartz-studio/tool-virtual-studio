import { FOLLOW_GAP_TILES, TILE_SIZE, furnitureTiles, speedOf, type DeskInfo, type Direction, type OfficeMap, type Point } from '@bureau/shared';
import { AutoWalk, planApproach } from './auto-walk';

// « Suivre » quelqu'un (le menu d'une personne, au clic droit) : la marche automatique (auto-walk.ts), vers une cible qui bouge. L'avatar va jusqu'à la case
// d'avant la sienne, s'arrête à FOLLOW_GAP_TILES case d'elle, et repart quand elle s'éloigne. Ce fichier n'importe pas Phaser : la scène donne, à chaque image, la
// carte de la marche, ses pieds et ceux de la personne suivie, et applique la direction rendue comme celle du clavier.

// Arrêté : à moins de STOP_PX de ses pieds (une case d'écart, et un quart de case de jeu : elle n'est jamais pile au centre de sa case). Il ne repart qu'au-delà
// de RESUME_PX : sans cet écart, il repartirait au moindre de ses pas.
export const FOLLOW_STOP_PX = (FOLLOW_GAP_TILES + 0.25) * TILE_SIZE;
export const FOLLOW_RESUME_PX = (FOLLOW_GAP_TILES + 1) * TILE_SIZE;
// Plus loin que cela, il court pour la rattraper (la course de Maj, que le serveur accepte toujours).
export const FOLLOW_SPRINT_PX = 4 * TILE_SIZE;
// Le trajet est recalculé quand la personne change de case, et au moins toutes les FOLLOW_REPLAN_MS (un trajet que la marche a abandonné, bloquée).
export const FOLLOW_REPLAN_MS = 400;

// La carte comme la voit qui en suit un autre : celle du jeu, plus les meubles posés dans les bureaux et devant eux, dans la rue (furnitureTiles), et les
// portes qui nous sont fermées (`closedDesks`, les clés de leurs places). Le chemin les contourne ; s'il n'y en a plus, on ne suit plus.
export function followWalkMap(map: OfficeMap, desks: ReadonlyArray<Pick<DeskInfo, 'key' | 'items'>>, closedDesks: readonly string[]): OfficeMap {
  const blocked = Uint8Array.from(map.blocked);
  for (const index of furnitureTiles(map, desks)) blocked[index] = 1;
  const size = map.tileSize;
  for (const door of map.zones) {
    if (door.type !== 'door' || door.name === null || !closedDesks.includes(door.name)) continue;
    for (let ty = Math.floor(door.y / size); ty < Math.ceil((door.y + door.height) / size); ty++) {
      for (let tx = Math.floor(door.x / size); tx < Math.ceil((door.x + door.width) / size); tx++) blocked[ty * map.widthTiles + tx] = 1;
    }
  }
  return { ...map, blocked };
}

// Ce que rend une image : la direction à prendre, s'il faut courir et où poser les pieds avant le pas (AutoWalk.snap), rien (on est à côté d'elle), ou
// `blocked` (plus de chemin jusqu'à elle).
export type FollowStep = { dir: Direction; sprint: boolean; snap: Point | null } | null | 'blocked';

export class Follow {
  private target: { id: string; tile: number; plannedAt: number; walking: boolean } | null = null;
  private readonly walk = new AutoWalk(() => {});

  // La personne suivie, ou null.
  get id(): string | null {
    return this.target?.id ?? null;
  }

  start(id: string): void {
    this.walk.cancel();
    this.target = { id, tile: -1, plannedAt: Number.NEGATIVE_INFINITY, walking: true };
  }

  stop(): void {
    this.walk.cancel();
    this.target = null;
  }

  // Une image : la direction, d'après la carte de la marche (followWalkMap), ses pieds et ceux de la personne suivie (en pixels), et la durée de l'image
  // (`delta`, ms), qui donne la longueur du pas (AutoWalk.update).
  update(map: OfficeMap, feet: Point, goal: Point, now: number, delta = 0): FollowStep {
    const target = this.target;
    if (target === null) return null;
    const gap = Math.hypot(goal.x - feet.x, goal.y - feet.y);
    if (gap <= FOLLOW_STOP_PX || (!target.walking && gap <= FOLLOW_RESUME_PX)) {
      this.walk.cancel();
      target.walking = false;
      return null;
    }
    const tile = Math.floor(goal.y / map.tileSize) * map.widthTiles + Math.floor(goal.x / map.tileSize);
    if (!this.walk.walking || tile !== target.tile || now - target.plannedAt >= FOLLOW_REPLAN_MS) {
      const route = planApproach(map, feet, goal);
      if (route === null) return 'blocked';
      target.tile = tile;
      target.plannedAt = now;
      this.walk.start(route, feet, now);
    }
    const sprint = gap > FOLLOW_SPRINT_PX;
    const dir = this.walk.update(feet, now, (speedOf(sprint, false) * delta) / 1000);
    target.walking = dir !== null;
    return dir === null ? null : { dir, sprint, snap: this.walk.snap };
  }
}
