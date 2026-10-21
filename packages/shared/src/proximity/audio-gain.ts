import { AUDIO_FULL_DISTANCE_PX, AUDIO_SILENT_DISTANCE_PX } from '../constants';
import type { OfficeMap } from '../map/parse-map';
import { zoneAt } from '../map/queries';

// Le volume (de 0 à 1) d'une voix à cette distance (en pixels), dans un espace ouvert : plein jusqu'à AUDIO_FULL_DISTANCE_PX, puis de
// plus en plus faible, sans à-coup (une courbe douce aux deux bouts), jusqu'au silence à AUDIO_SILENT_DISTANCE_PX et au-delà.
// Une distance qui n'est pas un nombre vaut le silence : on n'entend pas quelqu'un dont on ignore la place.
export function audioGain(distancePx: number): number {
  if (!(distancePx < AUDIO_SILENT_DISTANCE_PX)) return 0;
  if (distancePx <= AUDIO_FULL_DISTANCE_PX) return 1;
  const t = (distancePx - AUDIO_FULL_DISTANCE_PX) / (AUDIO_SILENT_DISTANCE_PX - AUDIO_FULL_DISTANCE_PX);
  return 1 - t * t * (3 - 2 * t);
}

// Le volume d'une personne (other) pour qui est en `self`, sur cette carte : tout le monde s'entend à plein volume dans une zone (un
// bureau, une salle de réunion), quelle que soit la distance ; dans un espace ouvert, le volume baisse avec la distance (audioGain).
export function gainBetween(map: OfficeMap, self: { x: number; y: number }, other: { x: number; y: number }): number {
  if (zoneAt(map, self.x, self.y) !== null) return 1;
  return audioGain(Math.hypot(self.x - other.x, self.y - other.y));
}
