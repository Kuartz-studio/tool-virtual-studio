import { isWalkablePoint, zoneAt, type OfficeMap } from '@bureau/shared';

// Où un joueur arrive : à sa dernière position enregistrée si elle est encore praticable et si elle n'est pas dans une zone occupée
// (une salle de réunion ou un bureau où une conversation a lieu : `busyZoneIds` liste les identifiants de ces zones), pour ne pas le
// faire tomber au milieu d'une réunion. Sinon, au point d'apparition de la carte.
// Une étiquette n'isole personne : zoneAt ne regarde que les zones private et desk. Le résultat est toujours un objet neuf.
// `canStandAt`, s'il est donné, écarte aussi un endroit où cette personne n'a pas le droit d'être (le bureau fermé de quelqu'un d'autre).
export function chooseSpawn(
  m: OfficeMap,
  saved: { x: number; y: number } | null,
  busyZoneIds: ReadonlySet<string>,
  canStandAt: (x: number, y: number) => boolean = () => true,
): { x: number; y: number } {
  if (saved !== null && isWalkablePoint(m, saved.x, saved.y) && canStandAt(saved.x, saved.y)) {
    const zone = zoneAt(m, saved.x, saved.y);
    if (zone === null || !busyZoneIds.has(zone.id)) return { x: saved.x, y: saved.y };
  }
  return { x: m.spawn.x, y: m.spawn.y };
}
