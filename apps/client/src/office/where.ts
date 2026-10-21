import { deskKey, GRAND_HALL, LOUNGE, LOUNGE_MUSIC_X, LOUNGE_TERRACE_WIDTH, MEETING_ROOM, OFFICE_HEIGHT, OFFICE_WIDTH, PLAZA, type DeskInfo, type OfficeMap, type Zone } from '@bureau/shared';
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

// La clé de la grande carte, celle du bureau (les autres, celles des tests, n'ont que leurs zones).
const OFFICE_MAP_KEY = 'office';

interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Cette case est-elle dans ce rectangle (en cases) ?
const inside = (area: Area, tx: number, ty: number): boolean => tx >= area.x && tx < area.x + area.w && ty >= area.y && ty < area.y + area.h;

// L'accueil, où l'on apparaît : à l'est de la zone détente, de la bande de mur du nord de celle-ci jusqu'au mur du bas. La carte ne le dessine pas
// d'un rectangle (sa zone n'est qu'une bande d'une case, « ACCUEIL ») ; ses bords sont ceux des murs qui l'entourent.
const RECEPTION: Area = { x: LOUNGE.x + LOUNGE.w + 1, y: LOUNGE.y - 2, w: OFFICE_WIDTH - 2 - (LOUNGE.x + LOUNGE.w), h: OFFICE_HEIGHT - 2 - (LOUNGE.y - 2) };

// La grande pièce de la grande carte où sont les pieds (x, y), en pixels, ou null : un couloir, un bureau. Les zones `label` de la carte ne sont que
// des bandes d'une case (« CAFÉ », « ACCUEIL », « PISCINE »), et sa zone détente est d'un seul tenant : ce sont les mêmes rectangles que ceux de
// l'ambiance de chaque endroit (audio/scene-at.ts), dans le même ordre, qui nomment ses pièces.
function roomAt(map: OfficeMap, x: number, y: number): string | null {
  const tx = Math.floor(x / map.tileSize);
  const ty = Math.floor(y / map.tileSize);
  const rooms = fr.office.where.rooms;
  if (inside(MEETING_ROOM, tx, ty)) return rooms.meeting;
  if (inside(GRAND_HALL, tx, ty)) return rooms.hall;
  if (inside(LOUNGE, tx, ty)) {
    if (tx < LOUNGE.x + LOUNGE_TERRACE_WIDTH) return rooms.pool;
    return tx < LOUNGE_MUSIC_X ? rooms.lounge : rooms.music;
  }
  if (inside(PLAZA, tx, ty)) return rooms.cafe;
  if (inside(RECEPTION, tx, ty)) return rooms.reception;
  return null;
}

// La clé du bureau (A1…) dont la pièce contient les pieds (x, y), en pixels, ou null : on n'est dans aucun bureau. C'est le calcul de « Bureau de
// Léa » ci-dessous, et celui du bouton du bureau (DeskButton : dans le sien, ou dehors).
export function deskKeyAt(map: OfficeMap | null, x: number, y: number): string | null {
  const room = map?.zones.find((zone) => zone.type === 'desk' && within(zone, x, y));
  return room ? deskKey(room) : null;
}

// Le nom du lieu où sont les pieds (x, y), en pixels. C'est la seule fonction qui nomme un lieu : la puce du lieu (WhereChip) et le filtre « Ici » du
// panneau Personnes (deux personnes sont ici quand leurs lieux portent le même nom) la prennent toutes deux (use-here.ts).
// - Sur la grande carte (`mapKey` « office »), les grandes pièces : Café, Accueil, Piscine, Salon, Coin musique, Grande salle, Salle de réunion.
// - Sinon, ce que la carte sait nommer : celui de la zone `label` qui contient le point (écrit comme une phrase), le bureau de quelqu'un (« Bureau
//   de Léa », son nom si elle lui en a donné un), une pièce à part (zone `private`, qui a un nom : « Salle de réunion »).
// - Ailleurs, « Couloir ». Sans carte (le jeu n'est pas là), rien : null.
export function placeAt(map: OfficeMap | null, mapKey: string | null, desks: readonly DeskInfo[], x: number, y: number): string | null {
  if (map === null) return null;
  if (mapKey === OFFICE_MAP_KEY) {
    const room = roomAt(map, x, y);
    if (room !== null) return room;
  }
  const label = map.zones.find((zone) => zone.type === 'label' && zone.text !== null && within(zone, x, y));
  if (label?.text) return sentence(label.text);
  const key = deskKeyAt(map, x, y);
  if (key !== null) return deskTitle(desks.find((desk) => desk.key === key) ?? { key, ownerName: null, name: null });
  const area = map.zones.find((zone) => zone.type === 'private' && zone.name !== null && within(zone, x, y));
  if (area?.name) return area.name;
  return fr.office.where.hallway;
}
