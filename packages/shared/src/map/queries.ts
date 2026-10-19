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
