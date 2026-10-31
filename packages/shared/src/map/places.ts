import type { MusicScene } from '../audio/scenes';
import type { RoomMusic } from '../protocol';
import { avatarBodyFits } from './queries';
import type { Point } from './find-path';
import { deskKey, type GameId, type OfficeMap, type Zone } from './parse-map';

// Un rectangle de la carte, en pixels : son coin haut-gauche et sa taille.
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Un lieu du bureau, tel que la carte le dit (zone `place`) ou tel que le calcul le déduit (un bureau, zone `desk`) :
// - key : son identifiant (`cafe`, `game`, `desk:A1`) ; label : son nom affiché ;
// - kind : `room` (une pièce), `open` (un espace ouvert comme la cafétéria), `street` (un couloir), `outside` (le dehors : le jardin, les terrasses),
//   `desk` (le bureau d'une personne) ;
// - rects : ce qu'il couvre, en pixels (un rectangle, ou plusieurs pour un lieu qui fait le tour du bâtiment, le jardin) ;
// - scene : l'ambiance musicale par défaut ; music : on peut en régler la musique (il a une enceinte) ;
// - destination : un mode peut y envoyer quelqu'un (la salle de sport).
export interface Place {
  key: string;
  label: string;
  kind: 'room' | 'open' | 'street' | 'outside' | 'desk';
  rects: Rect[];
  scene: MusicScene;
  music: boolean;
  destination: boolean;
}

// Une table de jeu : le jeu, son rectangle, et ses sièges (le centre de la case de chacun, dans l'ordre de leur numéro).
export interface GameTable {
  game: GameId;
  rect: Rect;
  seats: Point[];
}

// Le préfixe de la clé d'une place de bureau : `desk:A1`.
export const DESK_PLACE_PREFIX = 'desk:';

// La scène des bureaux : celle du travail.
const DESK_SCENE: MusicScene = 'focus';

const rectOf = (zone: Pick<Zone, 'x' | 'y' | 'width' | 'height'>): Rect => ({ x: zone.x, y: zone.y, width: zone.width, height: zone.height });
const contains = (rect: Rect, x: number, y: number): boolean => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
const areaOf = (place: Place): number => place.rects.reduce((sum, rect) => sum + rect.width * rect.height, 0);

function deskPlace(zone: Zone): Place {
  const key = deskKey(zone);
  return { key: `${DESK_PLACE_PREFIX}${key}`, label: `Bureau ${key}`, kind: 'desk', rects: [rectOf(zone)], scene: DESK_SCENE, music: true, destination: false };
}

// Tous les lieux d'une carte : ceux qu'elle déclare, puis un par bureau. Calculé une fois par carte.
const allPlaces = new WeakMap<OfficeMap, Place[]>();
function placesOf(map: OfficeMap): Place[] {
  let places = allPlaces.get(map);
  if (!places) {
    places = [...map.places, ...map.zones.filter((zone) => zone.type === 'desk').map(deskPlace)];
    allPlaces.set(map, places);
  }
  return places;
}

// Le lieu de ce point (en pixels) : le plus petit qui le contient (le café dans la place centrale), un bureau s'il est dans une zone `desk`. null hors
// de tout lieu. Comme les zones, un lieu contient son bord haut et gauche, pas son bord bas et droit.
export function placeAt(map: OfficeMap, x: number, y: number): Place | null {
  let best: Place | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const place of placesOf(map)) {
    if (!place.rects.some((rect) => contains(rect, x, y))) continue;
    const area = areaOf(place);
    if (area < bestArea) {
      best = place;
      bestArea = area;
    }
  }
  return best;
}

// Ce point (en pixels) est-il dehors : dans un lieu `outside` (le jardin, une terrasse) ?
export function isOutside(map: OfficeMap, x: number, y: number): boolean {
  return placeAt(map, x, y)?.kind === 'outside';
}

// La distance (en pixels) de ce point à l'étendue d'eau la plus proche (zones `water`), 0 dedans ; null si la carte n'a pas d'eau.
export function distanceToWater(map: OfficeMap, x: number, y: number): number | null {
  let best: number | null = null;
  for (const rect of map.waters ?? []) {
    const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
    const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
    const distance = Math.hypot(dx, dy);
    if (best === null || distance < best) best = distance;
  }
  return best;
}

// Ce que joue un lieu : son ambiance par défaut, ou celle qu'on lui a réglée ; le silence (null) s'il a été éteint. `state` est son réglage (`RoomMusic`), ou
// undefined si personne n'y a touché. Un lieu sans enceinte (la rue, la place) n'a pas de réglage : il joue toujours son ambiance par défaut,
// quoi que dise `state`.
export function roomSceneOf(place: Pick<Place, 'scene' | 'music'>, state: Pick<RoomMusic, 'on' | 'scene'> | undefined): MusicScene | null {
  if (!place.music || state === undefined) return place.scene;
  return state.on ? (state.scene ?? place.scene) : null;
}

// Les clés des destinations de la carte (la salle de sport, la salle de jeu) : les lieux où un mode peut conduire.
export const destinationKeys = (map: OfficeMap): string[] => map.places.filter((place) => place.destination).map((place) => place.key);

// Le lieu de cette clé (`cafe`, ou `desk:A1` pour un bureau), ou undefined.
export function placeByKey(map: OfficeMap, key: string): Place | undefined {
  return placesOf(map).find((place) => place.key === key);
}

// Deux personnes posées dans un même lieu se tiennent à cette distance l'une de l'autre au moins, en cases.
export const MIN_SPOT_DISTANCE_TILES = 2;

// Un endroit où poser quelqu'un dans ce lieu : le centre d'une case praticable (son corps y tient), à MIN_SPOT_DISTANCE_TILES cases ou plus de
// chaque point de `taken` (ceux qui y sont déjà, en pixels). Le plus proche du milieu du lieu : loin des murs, et toujours le même pour les
// mêmes données (à égalité, la rangée la plus haute, puis la colonne la plus à gauche). null si le lieu n'a plus de place.
export function freeSpotIn(map: OfficeMap, place: Place, taken: ReadonlyArray<Point>): Point | null {
  const size = map.tileSize;
  const apart = MIN_SPOT_DISTANCE_TILES * size;
  let best: Point | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const rect of place.rects) {
    const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const lastRow = Math.ceil((rect.y + rect.height) / size);
    const lastColumn = Math.ceil((rect.x + rect.width) / size);
    for (let ty = Math.floor(rect.y / size); ty < lastRow; ty++) {
      for (let tx = Math.floor(rect.x / size); tx < lastColumn; tx++) {
        const spot = { x: tx * size + size / 2, y: ty * size + size / 2 };
        if (!avatarBodyFits(map, spot.x, spot.y)) continue;
        if (taken.some((other) => Math.hypot(spot.x - other.x, spot.y - other.y) < apart)) continue;
        const distance = Math.hypot(spot.x - middle.x, spot.y - middle.y);
        // `<` strict : à égalité, la première case rencontrée (la rangée la plus haute, puis la colonne la plus à gauche) reste.
        if (distance < bestDistance) {
          best = spot;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}
