import { DESK_PLACE_PREFIX, deskKey, placeAt as placeOf, type DeskInfo, type OfficeMap, type Zone } from '@bureau/shared';
import { fr } from '../i18n/fr';
import { deskTitle } from './desks';

// Le point (x, y) est-il dans cette zone ? Une zone contient son bord haut et gauche, pas son bord bas et droit (comme `zoneAt`).
function within(zone: Zone, x: number, y: number): boolean {
  return x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height;
}

// Un texte de la carte (« SALLE DE RÉUNION ») écrit comme une phrase : « Salle de réunion ».
function sentence(text: string): string {
  const lower = text.trim().toLocaleLowerCase('fr');
  return lower.charAt(0).toLocaleUpperCase('fr') + lower.slice(1);
}

// La clé du bureau (A1…) dont la pièce contient les pieds (x, y), en pixels, ou null : on n'est dans aucun bureau. C'est le calcul de « Bureau de
// Léa » ci-dessous, et celui du bouton du bureau (DeskButton : dans le sien, ou dehors).
export function deskKeyAt(map: OfficeMap | null, x: number, y: number): string | null {
  const room = map?.zones.find((zone) => zone.type === 'desk' && within(zone, x, y));
  return room ? deskKey(room) : null;
}

// Le nom du lieu où sont les pieds (x, y), en pixels. C'est la seule fonction qui nomme un lieu : la puce du lieu (WhereChip) et le filtre « Ici » du
// panneau Personnes (deux personnes sont ici quand leurs lieux portent le même nom) la prennent toutes deux (use-here.ts).
// - Un lieu de la carte (zone `place`, le plus petit qui contient le point : le café dans la place centrale) : son nom (`Place.label`) ; une rue est
//   « Couloir » ; un bureau, « Bureau de Léa » (son nom si elle lui en a donné un, « Place A1 » s'il est libre).
// - Sinon (une carte sans lieux, celle des tests, ou un point hors de tout lieu), ce que ses zones savent nommer : celui de la zone `label` qui contient le
//   point (écrit comme une phrase), le bureau, une pièce à part (zone `private`, qui a un nom : « Salle de réunion »).
// - Ailleurs, « Couloir ». Sans carte (le jeu n'est pas là), rien : null.
export function placeAt(map: OfficeMap | null, desks: readonly DeskInfo[], x: number, y: number): string | null {
  if (map === null) return null;
  const place = placeOf(map, x, y);
  if (place !== null) {
    if (place.kind === 'desk') {
      const key = place.key.slice(DESK_PLACE_PREFIX.length);
      return deskTitle(desks.find((desk) => desk.key === key) ?? { key, ownerName: null, name: null });
    }
    return place.kind === 'street' ? fr.office.where.hallway : place.label;
  }
  const label = map.zones.find((zone) => zone.type === 'label' && zone.text !== null && within(zone, x, y));
  if (label?.text) return sentence(label.text);
  const area = map.zones.find((zone) => zone.type === 'private' && zone.name !== null && within(zone, x, y));
  if (area?.name) return area.name;
  return fr.office.where.hallway;
}
