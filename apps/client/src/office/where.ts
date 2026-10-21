import { deskKey, type DeskInfo, type OfficeMap, type Zone } from '@bureau/shared';
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

// Le nom du lieu où sont les pieds (x, y), en pixels : celui de la zone `label` de la carte qui contient le point. Faute d'étiquette, ce que la
// carte sait nommer d'autre : le bureau de quelqu'un (« Bureau de Léa », son nom si elle lui en a donné un), une pièce à part (zone `private`,
// qui a un nom : « Salle de réunion »). Ailleurs, « Couloir ». Sans carte (le jeu n'est pas là), rien : null.
export function placeAt(map: OfficeMap | null, desks: readonly DeskInfo[], x: number, y: number): string | null {
  if (map === null) return null;
  const label = map.zones.find((zone) => zone.type === 'label' && zone.text !== null && within(zone, x, y));
  if (label?.text) return sentence(label.text);
  const room = map.zones.find((zone) => zone.type === 'desk' && within(zone, x, y));
  if (room) {
    const key = deskKey(room);
    return deskTitle(desks.find((desk) => desk.key === key) ?? { key, ownerName: null, name: null });
  }
  const area = map.zones.find((zone) => zone.type === 'private' && zone.name !== null && within(zone, x, y));
  if (area?.name) return area.name;
  return fr.office.where.hallway;
}
