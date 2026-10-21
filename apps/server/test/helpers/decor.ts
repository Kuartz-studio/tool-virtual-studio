import { DEFAULT_DESK_DECOR, DESK_ROOM, type DecorError, type DeskDecor } from '@bureau/shared';

// Ce que montre une pièce dont la personne n'a rien réglé (et toute place libre), tel qu'il figure dans une DeskInfo.
export const DEFAULT_SETUP = { floor: DEFAULT_DESK_DECOR.floor, wall: DEFAULT_DESK_DECOR.wall, items: DEFAULT_DESK_DECOR.items };

// Un décor valable, différent du poste par défaut : un autre sol, d'autres murs, un bureau avec un écran dessus et une plante.
export const CUSTOM_DECOR: DeskDecor = {
  floor: 'noyer',
  wall: 'anthracite',
  items: [
    { id: 'of-7-28', x: 0, y: 0 },
    { id: 'of-14-12', x: 1, y: 0 },
    { id: 'of-6-10', x: 8, y: 3 },
  ],
};

// Un second décor valable, pour vérifier qu'un réglage en remplace un autre.
export const OTHER_DECOR: DeskDecor = { floor: 'sable', wall: 'brun', items: [{ id: 'cf-0-8', x: 2, y: 2 }] };

// Des décors que checkDecor refuse, avec la raison qu'il donne : un thème qui n'existe pas, deux bureaux sur les mêmes cases, un bureau
// posé en travers de la porte.
export const REFUSED_DECORS: Array<{ decor: DeskDecor; reason: DecorError }> = [
  { decor: { ...CUSTOM_DECOR, floor: 'lave' }, reason: 'unknown_theme' },
  { decor: { ...CUSTOM_DECOR, items: [{ id: 'of-7-28', x: 0, y: 0 }, { id: 'of-7-28', x: 2, y: 1 }] }, reason: 'overlap' },
  { decor: { ...CUSTOM_DECOR, items: [{ id: 'of-7-28', x: DESK_ROOM.doorX - 1, y: DESK_ROOM.height - 2 }] }, reason: 'blocks_door' },
];
