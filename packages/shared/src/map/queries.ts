import { AVATAR_BODY, COFFEE_REACH_TILES, LIGHT_SWITCH_REACH_TILES, TILE_SIZE } from '../constants';
import type { OfficeMap, Zone, ZoneType } from './parse-map';

// Une case est praticable si elle est dans la carte et que le calque `collisions` n'y a pas de tuile.
// Hors carte, ou si tx et ty ne sont pas des numéros de case entiers : false.
export function isWalkableTile(m: OfficeMap, tx: number, ty: number): boolean {
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return false;
  if (tx < 0 || ty < 0 || tx >= m.widthTiles || ty >= m.heightTiles) return false;
  return m.blocked[ty * m.widthTiles + tx] === 0;
}

// x et y sont les pieds de l'avatar, en pixels : c'est la case où ils se trouvent qui décide.
export function isWalkablePoint(m: OfficeMap, x: number, y: number): boolean {
  return isWalkableTile(m, Math.floor(x / m.tileSize), Math.floor(y / m.tileSize));
}

// La zone de collision d'un avatar dont les pieds sont en (x, y), en pixels (AVATAR_BODY : de x − 10 à x + 10, de y − 11 à y + 1),
// ne chevauche aucune case bloquante et reste dans la carte. La toucher n'est pas la chevaucher : c'est là que la physique Arcade
// arrête l'avatar local (x = 42 contre le mur de gauche, y = 479 contre celui du bas). Coordonnées qui ne sont pas des nombres
// finis : false.
export function avatarBodyFits(m: OfficeMap, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const left = x - AVATAR_BODY.width / 2;
  const right = x + AVATAR_BODY.width / 2;
  const bottom = y + AVATAR_BODY.belowFeet;
  const top = bottom - AVATAR_BODY.height;
  // Les cases que la zone chevauche : celles dont l'intérieur la rencontre (un bord commun ne compte pas).
  const lastColumn = Math.ceil(right / m.tileSize) - 1;
  const lastRow = Math.ceil(bottom / m.tileSize) - 1;
  for (let ty = Math.floor(top / m.tileSize); ty <= lastRow; ty++) {
    for (let tx = Math.floor(left / m.tileSize); tx <= lastColumn; tx++) {
      if (!isWalkableTile(m, tx, ty)) return false;
    }
  }
  return true;
}

// Les zones qui isolent leurs occupants des autres : la salle de réunion et l'espace d'un bureau.
// Une étiquette ou l'apparition ne sont que des repères.
const ISOLATING_ZONE_TYPES: readonly ZoneType[] = ['private', 'desk'];

// La première zone de la carte, parmi ces types, qui contient le point (x, y) en pixels. Une zone contient son bord haut et
// gauche mais pas son bord bas et droit : deux zones voisines ne se partagent jamais un point.
export function zoneAt(m: OfficeMap, x: number, y: number, types: readonly ZoneType[] = ISOLATING_ZONE_TYPES): Zone | null {
  for (const zone of m.zones) {
    if (!types.includes(zone.type)) continue;
    if (x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height) return zone;
  }
  return null;
}

// Cette position (les pieds d'un avatar, en pixels) est à portée d'un interrupteur de lumière : à LIGHT_SWITCH_REACH_TILES cases ou moins
// du centre de l'un d'eux, en ligne droite. Le serveur la pose pour accepter `lights:set`, le client pour montrer qu'on peut appuyer :
// une seule règle. Une position qui n'est pas un nombre fini n'est à portée de rien.
export function withinSwitchReach(pos: { x: number; y: number }, switches: ReadonlyArray<{ x: number; y: number }>): boolean {
  return withinReach(pos, switches, LIGHT_SWITCH_REACH_TILES);
}

// Cette position est à portée d'une machine à café : à COFFEE_REACH_TILES cases ou moins du centre de la case de service de l'une d'elles,
// en ligne droite. La même règle, de même, pour le serveur (`coffee:take`) et le client (montrer qu'on peut se servir). Sans machine (la petite
// carte de développement), personne n'est à portée.
export function withinCoffeeReach(pos: { x: number; y: number }, coffees: ReadonlyArray<{ x: number; y: number }>): boolean {
  return withinReach(pos, coffees, COFFEE_REACH_TILES);
}

function withinReach(pos: { x: number; y: number }, points: ReadonlyArray<{ x: number; y: number }>, tiles: number): boolean {
  const reach = tiles * TILE_SIZE;
  return points.some((p) => Math.hypot(pos.x - p.x, pos.y - p.y) <= reach);
}
