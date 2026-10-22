import { GAME_ARRIVAL_RING_TILES } from '../constants';
import type { Point } from '../map/find-path';
import type { OfficeMap } from '../map/parse-map';
import { MIN_SPOT_DISTANCE_TILES, freeSpotIn, placeAt, type GameTable, type Place, type Rect } from '../map/places';
import { avatarBodyFits } from '../map/queries';

// Ce que deux rectangles ont en commun, ou null.
function overlap(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

// La case où poser quelqu'un qui arrive à une table (il vient d'accepter une invitation) :
// 1. sa chaise, si elle existe, qu'on peut y tenir et qu'aucun des autres (`taken`, leurs pieds en pixels) n'est à moins de MIN_SPOT_DISTANCE_TILES cases
//    (sur le plus grand des deux axes) ;
// 2. sinon une case de l'anneau autour de la table (son rectangle élargi de GAME_ARRIVAL_RING_TILES cases, resserré à la salle), la plus proche du milieu, à
//    MIN_SPOT_DISTANCE_TILES cases ou plus de chacun (les cases de la table sont bloquées de toute façon) ;
// 3. sinon n'importe quelle case de la salle qui contient la table ;
// 4. sinon null : personne n'est posé, et la personne reste où elle est.
// `chair` : l'indice de la chaise où il va s'asseoir ; null : il regarde, ou la table est pleine.
export function arrivalSpot(map: OfficeMap, table: GameTable, chair: number | null, taken: ReadonlyArray<Point>): Point | null {
  const size = map.tileSize;
  const seat = chair === null ? undefined : table.seats[chair];
  const apart = MIN_SPOT_DISTANCE_TILES * size;
  if (seat && avatarBodyFits(map, seat.x, seat.y) && taken.every((other) => Math.max(Math.abs(seat.x - other.x), Math.abs(seat.y - other.y)) >= apart)) {
    return { x: seat.x, y: seat.y };
  }

  const room = placeAt(map, table.rect.x + table.rect.width / 2, table.rect.y + table.rect.height / 2);
  if (room === null) return null;
  const grow = GAME_ARRIVAL_RING_TILES * size;
  const ring: Rect = { x: table.rect.x - grow, y: table.rect.y - grow, width: table.rect.width + 2 * grow, height: table.rect.height + 2 * grow };
  const rects = room.rects.flatMap((rect) => overlap(ring, rect) ?? []);
  const around: Place = { ...room, rects };
  return freeSpotIn(map, around, taken) ?? freeSpotIn(map, room, taken);
}
