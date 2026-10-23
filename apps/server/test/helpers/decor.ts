import { DEFAULT_DESK_DECOR, DESK_ROOMS, buildOfficeTiledMap, defaultDeskDecor, deskRoomSpecOf, parseOfficeMap, type DecorError, type DeskDecor } from '@bureau/shared';

// Ce que montre une pièce dont la personne n'a rien réglé (et toute place libre), tel qu'il figure dans une DeskInfo.
export const DEFAULT_SETUP = { floor: DEFAULT_DESK_DECOR.floor, wall: DEFAULT_DESK_DECOR.wall, items: DEFAULT_DESK_DECOR.items };

// Ce que montre la place `key` de la grande carte quand rien n'est réglé : le poste par défaut de sa pièce (sa taille et le côté de sa porte : les
// six places n'ont pas toutes le même).
const OFFICE_MAP = parseOfficeMap(buildOfficeTiledMap());
export function defaultSetupOf(key: string): { floor: string; wall: string; items: DeskDecor['items'] } {
  const { floor, wall, items } = defaultDeskDecor(deskRoomSpecOf(OFFICE_MAP, key) ?? DESK_ROOMS.standard);
  return { floor, wall, items };
}

// Un décor valable dans les quatre sortes de pièces de la carte (standard ou compacte, porte au sud ou au nord), différent du poste par défaut : un autre
// sol, d'autres murs, un bureau avec un écran dessus et une plante, loin des portes.
export const CUSTOM_DECOR: DeskDecor = {
  floor: 'noyer',
  wall: 'anthracite',
  items: [
    { id: 'of-7-28', x: 0, y: 3 },
    { id: 'of-14-12', x: 1, y: 3 },
    { id: 'of-6-10', x: 5, y: 3 },
  ],
};

// Un second décor valable, pour vérifier qu'un réglage en remplace un autre.
export const OTHER_DECOR: DeskDecor = { floor: 'sable', wall: 'brun', items: [{ id: 'cf-0-8', x: 0, y: 2 }] };

// Des décors que checkDecor refuse, avec la raison qu'il donne : un thème qui n'existe pas, deux bureaux sur les mêmes cases, un bureau
// posé en travers de la porte.
export const REFUSED_DECORS: Array<{ decor: DeskDecor; reason: DecorError }> = [
  { decor: { ...CUSTOM_DECOR, floor: 'lave' }, reason: 'unknown_theme' },
  { decor: { ...CUSTOM_DECOR, items: [{ id: 'of-7-28', x: 0, y: 0 }, { id: 'of-7-28', x: 2, y: 1 }] }, reason: 'overlap' },
  { decor: { ...CUSTOM_DECOR, items: [{ id: 'of-7-28', x: DESK_ROOMS.standard.door.x - 1, y: DESK_ROOMS.standard.height - 2 }] }, reason: 'blocks_door' },
  // Au dixième de case près, pas plus fin.
  { decor: { ...CUSTOM_DECOR, items: [{ id: 'of-7-28', x: 0.55, y: 3 }] }, reason: 'bad_position' },
];
