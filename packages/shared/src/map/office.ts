import { DESK_ROOMS, type DeskRoomSpec } from '../decor/placement';
import { DEFAULT_FLOOR_THEME, DEFAULT_WALL_THEME } from '../decor/themes';
import type { ZoneInput } from './build-tiled';
import { MapCanvas, type Area } from './builder';
import type { TiledMapJson } from './tiled-types';

// La carte du bureau : 81 × 46 cases, dessinée par code (et non à la main) : les bureaux se répètent, et leur nombre, leur taille et leurs portes
// doivent rester cohérents. Les murs horizontaux font 2 cases de haut, les verticaux 1. Le travail est au nord, les loisirs au sud, une place au
// milieu ; deux rues (nord et sud) la traversent, reliées à l'est par un connecteur : pas de cul-de-sac.
//
//   y  0 ┌ murs du nord ─────────────────────────────────────────────────────────────────────────────────────────────────┐
//   y  2 │ A1 · A2 · A5 │ place centrale : le café │ salle de réunion │ salle client                                       │
//   y 11 ├ rue nord (y 11 à 14), qui traverse la place ──────────────────────────────────────────────────────────────────┤
//   y 17 │ A3 · A4 · A6 │ place centrale : l'accueil (apparition) │ salle de conférence │ connecteur est                   │
//   y 26 ├ rue sud (y 26 à 29) ─────────────────────────────────────────────────────────────────────────────────────────┤
//   y 32 │ salle de sport │ salle de jeu │ détente et piscine                                                              │
//   y 46 └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
//
// Les 6 places ont pour clé A1 à A6, écrite dans le nom des deux zones (la pièce `desk` et sa porte `door`) : c'est ce qui les relie, et ce qui
// désigne la place dans la base. A1 à A4 font 9 × 7, A5 et A6 6 × 7 ; A1, A2 et A5 ont leur porte au sud, A3, A4 et A6 au nord, côté rue.
export const OFFICE_WIDTH = 81;
export const OFFICE_HEIGHT = 46;

// Une place de bureau : sa clé, la pièce (en cases), la porte (2 × 2 : elle perce la bande de mur du côté de la rue) et le côté de la pièce où elle est.
export interface OfficeDeskSlot {
  key: string;
  room: Area;
  door: Area;
  doorSide: 'north' | 'south';
  // Les cases de mur qui entourent la pièce, pour que le client les repeigne au thème de son occupant.
  walls: Array<{ x: number; y: number; part: 'top' | 'bottom' | 'stem' }>;
}

// Les six places, dans l'ordre de leur clé : où est la pièce, de quelle taille, et de quel côté est sa porte.
const DESKS: ReadonlyArray<{ key: string; x: number; y: number; spec: DeskRoomSpec; side: 'north' | 'south' }> = [
  { key: 'A1', x: 1, y: 2, spec: DESK_ROOMS.standard, side: 'south' },
  { key: 'A2', x: 12, y: 2, spec: DESK_ROOMS.standard, side: 'south' },
  { key: 'A3', x: 1, y: 17, spec: DESK_ROOMS.standard, side: 'north' },
  { key: 'A4', x: 12, y: 17, spec: DESK_ROOMS.standard, side: 'north' },
  { key: 'A5', x: 23, y: 2, spec: DESK_ROOMS.compact, side: 'south' },
  { key: 'A6', x: 23, y: 17, spec: DESK_ROOMS.compact, side: 'north' },
];

function deskSlot({ key, x, y, spec, side }: (typeof DESKS)[number]): OfficeDeskSlot {
  const [x0, x1] = [x - 1, x + spec.width];   // les deux pans de mur de la pièce
  const [northBand, southBand] = [y - 2, y + spec.height];
  const doorBand = side === 'south' ? southBand : northBand;
  const door = { x: x + spec.door.x, y: doorBand, w: spec.door.width, h: 2 };
  const walls: OfficeDeskSlot['walls'] = [];
  for (let xx = x0; xx <= x1; xx++) {
    const inDoor = xx >= door.x && xx < door.x + door.w;
    for (const band of [northBand, southBand]) {
      if (band === doorBand && inDoor) continue;
      walls.push({ x: xx, y: band, part: 'top' }, { x: xx, y: band + 1, part: 'bottom' });
    }
  }
  for (let yy = y; yy < y + spec.height; yy++) walls.push({ x: x0, y: yy, part: 'stem' }, { x: x1, y: yy, part: 'stem' });
  return { key, room: { x, y, w: spec.width, h: spec.height }, door, doorSide: side, walls };
}

export const OFFICE_DESK_SLOTS: OfficeDeskSlot[] = DESKS.map(deskSlot);

// Les ouvertures de la carte : les portes des bureaux, celles de trois salles (réunion, client, conférence) et les quatre arches des salles du sud.
// `room` est la pièce qu'elles ferment (la clé d'un bureau ou d'un lieu).
export interface OfficeOpening extends Area {
  key: string;
  kind: 'door' | 'arch';
  room: string;
}

export const OFFICE_OPENINGS: OfficeOpening[] = [
  ...OFFICE_DESK_SLOTS.map((slot): OfficeOpening => ({ key: `door:${slot.key}`, kind: 'door', room: slot.key, ...slot.door })),
  { key: 'door:meeting', kind: 'door', room: 'meeting', x: 57, y: 9, w: 2, h: 2 },
  { key: 'door:client', kind: 'door', room: 'client', x: 72, y: 9, w: 2, h: 2 },
  { key: 'door:conference', kind: 'door', room: 'conference', x: 68, y: 15, w: 3, h: 2 },
  { key: 'arch:gym', kind: 'arch', room: 'gym', x: 6, y: 30, w: 2, h: 2 },
  { key: 'arch:game', kind: 'arch', room: 'game', x: 23, y: 30, w: 4, h: 2 },
  { key: 'arch:lounge-west', kind: 'arch', room: 'lounge', x: 44, y: 30, w: 4, h: 2 },
  { key: 'arch:lounge-east', kind: 'arch', room: 'lounge', x: 66, y: 30, w: 4, h: 2 },
];

export const OFFICE_SPAWN = { x: 40, y: 22 };

// Les lieux : l'intérieur de chaque pièce, ou l'espace qu'un lieu ouvert couvre.
const PLAZA: Area = { x: 30, y: 2, w: 20, h: 28 };
const CAFE: Area = { x: 32, y: 2, w: 16, h: 8 };
const RECEPTION: Area = { x: 31, y: 15, w: 18, h: 11 };
const STREET_N: Area = { x: 1, y: 11, w: 78, h: 4 };
const STREET_S: Area = { x: 1, y: 26, w: 78, h: 4 };
const STREET_E: Area = { x: 74, y: 11, w: 6, h: 19 };
const MEETING: Area = { x: 51, y: 2, w: 14, h: 7 };
const CLIENT: Area = { x: 66, y: 2, w: 14, h: 7 };
const CONFERENCE: Area = { x: 51, y: 17, w: 22, h: 7 };
const GYM: Area = { x: 1, y: 32, w: 12, h: 12 };
const GAME: Area = { x: 14, y: 32, w: 22, h: 12 };
const LOUNGE: Area = { x: 37, y: 32, w: 43, h: 12 };
// La terrasse de la piscine : les 19 premières colonnes de la détente ; le bassin (14 × 5) y est posé.
const TERRACE: Area = { x: LOUNGE.x, y: LOUNGE.y, w: 19, h: LOUNGE.h };
const POOL: Area = { x: 39, y: 35, w: 14, h: 5 };

const OUTER_WALL = 'gris-perle';

export interface OfficeBuild {
  canvas: MapCanvas;
  ascii: string[];
  zones: ZoneInput[];
}

export function buildOffice(): OfficeBuild {
  const c = new MapCanvas(OFFICE_WIDTH, OFFICE_HEIGHT, 'gris');
  const W = OFFICE_WIDTH;
  const H = OFFICE_HEIGHT;

  // ---- Le sol ---------------------------------------------------------------------------------------------------------------
  const floorOf = (a: Area, id: string) => c.floor(a.x, a.y, a.w, a.h, id);
  for (const slot of OFFICE_DESK_SLOTS) floorOf(slot.room, DEFAULT_FLOOR_THEME);   // les occupants repeignent le leur
  floorOf(PLAZA, 'marbre');
  for (const street of [STREET_N, STREET_S, STREET_E]) floorOf(street, 'gris');   // les rues traversent la place
  floorOf(CAFE, 'damier');
  floorOf(MEETING, 'bleu-clair');
  floorOf(CLIENT, 'blanc');
  floorOf(CONFERENCE, 'graphite');
  floorOf(GYM, 'beton');
  floorOf(GAME, 'parquet-brun');
  floorOf(LOUNGE, 'parquet-clair');
  floorOf(TERRACE, 'pierre');

  // ---- Les murs -------------------------------------------------------------------------------------------------------------
  // Le pourtour : les bandes du nord et du sud, les pans de l'ouest et de l'est.
  c.vWall(0, 2, H - 3, OUTER_WALL);
  c.vWall(W - 1, 2, H - 3, OUTER_WALL);
  c.hWall(0, W - 1, 0, DEFAULT_WALL_THEME);
  c.hWall(0, W - 1, H - 2, OUTER_WALL);

  // Les six bureaux : chacun ses murs (les occupants les repeignent), et sa porte percée dans la bande du côté de la rue.
  for (const slot of OFFICE_DESK_SLOTS) {
    for (const wall of slot.walls) {
      if (wall.part === 'stem') c.vWall(wall.x, wall.y, wall.y, DEFAULT_WALL_THEME);
      else if (wall.part === 'top') c.hWall(wall.x, wall.x, wall.y, DEFAULT_WALL_THEME);
    }
    floorOf(slot.door, 'gris');
  }

  // La salle de réunion (bande au sud, pans à l'ouest et à l'est) et la salle client, qui partage son pan est.
  c.hWall(MEETING.x - 1, MEETING.x + MEETING.w, MEETING.y + MEETING.h, 'bleu-ciel');
  c.vWall(MEETING.x - 1, MEETING.y, MEETING.y + MEETING.h - 1, 'bleu-ciel');
  c.vWall(MEETING.x + MEETING.w, MEETING.y, MEETING.y + MEETING.h - 1, 'bleu-ciel');
  c.hWall(CLIENT.x, CLIENT.x + CLIENT.w, CLIENT.y + CLIENT.h, 'creme');
  c.vWall(CLIENT.x + CLIENT.w, CLIENT.y, CLIENT.y + CLIENT.h - 1, 'creme');

  // La salle de conférence : bandes au nord et au sud, pans à l'ouest et à l'est.
  c.hWall(CONFERENCE.x - 1, CONFERENCE.x + CONFERENCE.w, CONFERENCE.y - 2, 'anthracite');
  c.hWall(CONFERENCE.x - 1, CONFERENCE.x + CONFERENCE.w, CONFERENCE.y + CONFERENCE.h, 'anthracite');
  c.vWall(CONFERENCE.x - 1, CONFERENCE.y, CONFERENCE.y + CONFERENCE.h - 1, 'anthracite');
  c.vWall(CONFERENCE.x + CONFERENCE.w, CONFERENCE.y, CONFERENCE.y + CONFERENCE.h - 1, 'anthracite');

  // Les trois salles du sud : bande au nord (percée d'arches), bande au sud, pans entre elles. Chacune a ses murs.
  for (const [room, theme] of [[GYM, 'anthracite'], [GAME, 'brun'], [LOUNGE, 'menthe']] as const) {
    c.hWall(room.x - 1, room.x + room.w, room.y - 2, theme);
    c.hWall(room.x - 1, room.x + room.w, room.y + room.h, theme);
    c.vWall(room.x - 1, room.y, room.y + room.h - 1, theme);
    c.vWall(room.x + room.w, room.y, room.y + room.h - 1, theme);
  }

  // Les ouvertures : plus de mur, plus d'obstacle, et un sol de rue sous les portes et les arches.
  for (const o of OFFICE_OPENINGS) {
    c.open(o.x, o.y, o.w, o.h);
    floorOf(o, 'gris');
  }

  // La piscine.
  c.pool(POOL.x, POOL.y, POOL.w, POOL.h);

  furnish(c);

  // ---- Les zones ------------------------------------------------------------------------------------------------------------
  c.zone({ type: 'spawn', x: OFFICE_SPAWN.x, y: OFFICE_SPAWN.y, w: 1, h: 1 });
  for (const [name, room] of [
    ['Salle de réunion', MEETING],
    ['Salle client', CLIENT],
    ['Salle de conférence', CONFERENCE],
    ['Salle de sport', GYM],
    ['Salle de jeu', GAME],
    ['Détente et piscine', LOUNGE],
  ] as const) {
    c.zone({ type: 'private', name, ...room });
  }
  for (const slot of OFFICE_DESK_SLOTS) {
    c.zone({ type: 'desk', name: slot.key, x: slot.room.x, y: slot.room.y, w: slot.room.w, h: slot.room.h });
    c.zone({ type: 'door', name: slot.key, x: slot.door.x, y: slot.door.y, w: slot.door.w, h: slot.door.h });
  }

  // Les lieux, avec leur nom, leur ambiance par défaut, leur musique et leur destination.
  c.place('plaza', 'Place centrale', PLAZA, { kind: 'open' });
  c.place('cafe', 'Café', CAFE, { kind: 'open', scene: 'sunny', music: true });
  c.place('reception', 'Accueil', RECEPTION, { kind: 'open', music: true });
  c.place('street-n', 'Couloir', STREET_N, { kind: 'street' });
  c.place('street-s', 'Couloir', STREET_S, { kind: 'street' });
  c.place('street-e', 'Couloir', STREET_E, { kind: 'street' });
  c.place('meeting', 'Salle de réunion', MEETING, { scene: 'focus', music: true });
  c.place('client', 'Salle client', CLIENT, { scene: 'focus' });
  c.place('conference', 'Salle de conférence', CONFERENCE, { scene: 'drift', music: true });
  c.place('gym', 'Salle de sport', GYM, { scene: 'quest', music: true, destination: true });
  c.place('game', 'Salle de jeu', GAME, { scene: 'dusk', music: true, destination: true });
  c.place('lounge', 'Détente et piscine', LOUNGE, { scene: 'sunny', music: true });

  // Les enceintes (une par lieu qui a de la musique), la case devant la machine à café, les tables des jeux et leurs sièges, le panneau de la salle client.
  c.speaker('cafe', 46, 3);
  c.speaker('reception', 47, 24);
  c.speaker('meeting', 64, 6);
  c.speaker('conference', 52, 19);
  c.speaker('gym', 12, 33);
  c.speaker('game', 34, 33);
  c.speaker('lounge', 79, 33);
  c.coffee(37, 5);
  c.table('chess', { x: 24, y: 35, w: 3, h: 2 });
  c.seat('chess', 1, 25, 34);
  c.seat('chess', 2, 25, 37);
  c.table('backgammon', { x: 29, y: 35, w: 3, h: 2 });
  c.seat('backgammon', 1, 30, 34);
  c.seat('backgammon', 2, 30, 37);
  c.table('connect4', { x: 24, y: 40, w: 3, h: 2 });
  c.seat('connect4', 1, 25, 39);
  c.seat('connect4', 2, 25, 42);
  c.table('ludo', { x: 29, y: 40, w: 3, h: 3 });
  c.seat('ludo', 1, 30, 39);
  c.seat('ludo', 2, 32, 41);
  c.seat('ludo', 3, 30, 43);
  c.seat('ludo', 4, 28, 41);
  c.sign('EN TRAVAUX', 73, 5);

  // Quelques inscriptions au sol.
  c.zone({ type: 'label', text: 'CAFÉ', x: 36, y: 9, w: 8, h: 1 });
  c.zone({ type: 'label', text: 'ACCUEIL', x: 35, y: 25, w: 10, h: 1 });
  c.zone({ type: 'label', text: 'SALLE DE RÉUNION', x: 52, y: 8, w: 12, h: 1 });
  // L'interrupteur de la lumière : sur la face du mur nord de la rue (la rangée y 10, que l'on voit de la rue), entre la porte du petit bureau A5 et la
  // place. Le client y pose la plaque. En dernier : les numéros des autres zones ne changent pas.
  c.zone({ type: 'switch', x: 28, y: 10, w: 1, h: 1 });

  return { canvas: c, ascii: c.ascii(), zones: c.zones };
}

// Le mobilier de la carte : des éléments de la banque (packages/shared/src/decor) et des objets animés (packages/shared/src/props), posés par la case de
// leur coin haut-gauche. Les bureaux n'en ont pas ici : leur déco est celle de leur occupant (DeskInfo), dessinée par le client. Un élément mural se
// pose à la case de la pièce qu'il surplombe.
function furnish(c: MapCanvas): void {
  const at = (items: ReadonlyArray<readonly [string, number, number]>) => {
    for (const [id, x, y] of items) c.put(id, x, y);
  };
  const props = (items: ReadonlyArray<readonly [string, number, number]>) => {
    for (const [key, x, y] of items) c.prop(key, x, y);
  };

  // Les rues : des arbustes entre les portes, des fontaines à eau (jamais dans l'axe d'une porte ou d'une arche : elles la masqueraient), des
  // casiers et de grandes plantes sur le connecteur est.
  at([
    ['lr-12-0', 1, 11], ['lr-12-0', 9, 11], ['lr-12-0', 20, 11], ['lr-12-0', 31, 11], ['lr-12-0', 48, 11], ['lr-12-0', 53, 11], ['lr-12-0', 64, 11], ['lr-12-0', 68, 11],
    ['lr-12-0', 1, 14], ['lr-12-0', 9, 14], ['lr-12-0', 20, 14], ['lr-12-0', 29, 14], ['lr-12-0', 52, 14], ['lr-12-0', 62, 14], ['lr-12-0', 65, 14],
    ['of-12-15', 12, 11], ['of-12-15', 61, 11], ['of-12-15', 12, 14],
    ['lr-12-0', 1, 26], ['lr-12-0', 9, 26], ['lr-12-0', 20, 26], ['lr-12-0', 29, 26], ['lr-12-0', 52, 26], ['lr-12-0', 62, 26],
    ['lr-12-0', 1, 29], ['lr-12-0', 10, 29], ['lr-12-0', 18, 29], ['lr-12-0', 30, 29], ['lr-12-0', 40, 29], ['lr-12-0', 49, 29], ['lr-12-0', 58, 29], ['lr-12-0', 72, 29],
    ['of-12-15', 13, 26], ['of-12-15', 56, 26],
    ['lr-7-4', 78, 16], ['lr-7-4', 78, 20], ['lr-7-4', 78, 24],
    ['lr-13-21', 74, 18], ['lr-13-21', 74, 25],
  ]);

  // La place centrale : de grands palmiers aux angles.
  at([['lr-13-0', 30, 3], ['lr-13-0', 48, 3], ['lr-13-0', 30, 8], ['lr-13-0', 48, 8]]);

  // Le café : un bar contre le mur nord (deux comptoirs bout à bout) avec la machine posée dessus, et un frigo ; trois tables de quatre places ; des palmiers
  // aux angles ; et l'enceinte. On se sert de l'autre côté du bar, sur la case (37, 5) que la carte déclare.
  at([
    ['lr-0-26', 34, 2], ['lr-1-26', 43, 2],
    ['ki-12-21', 33, 3], ['ki-9-21', 37, 3], ['ki-12-23', 41, 3], ['of-12-15', 42, 3],
    ['lr-13-0', 32, 8], ['lr-13-0', 46, 8],
  ]);
  c.prop('coffee', 37, 3, { onTop: true, offsetY: 24 });
  props([['amplifier-big', 46, 3]]);
  for (const x of [35, 40, 45]) at([['ki-9-13', x, 6], ['ki-7-11', x - 1, 6], ['ki-4-11', x + 2, 6], ['ki-6-13', x, 5]]);

  // L'accueil : le comptoir et son poste, deux coins d'attente (un canapé, deux fauteuils et une table basse), un tapis sous le point d'apparition, des
  // plantes, et l'enceinte.
  at([
    ['cf-8-4', 38, 17], ['of-14-28', 39, 17],
    ['lr-1-28', 32, 18], ['tv-5-3', 31, 21], ['of-6-18', 33, 21], ['tv-7-3', 35, 21],
    ['lr-4-28', 45, 18], ['tv-5-5', 44, 21], ['of-6-20', 46, 21],
    ['cf-0-8', 38, 21],
    ['lr-13-21', 31, 15], ['lr-13-21', 46, 15], ['lr-13-0', 31, 24], ['lr-12-9', 43, 24],
  ]);
  props([['amplifier-big', 47, 24]]);

  // La salle de réunion : l'écran et les tableaux au mur, la grande table (4 × 2 cases au sol, au milieu de la salle), et dix chaises autour : quatre
  // au nord, qui regardent la table, quatre au sud, vues de dos, une à chaque bout, de profil. Les chaises touchent la table.
  at([['of-9-12', 52, 2], ['of-9-14', 54, 2], ['tv-10-3', 58, 2], ['of-9-12', 63, 2], ['cf-0-1', 56, 5]]);
  for (const x of [56, 57, 58, 59]) at([['of-2-8', x, 4], ['of-0-8', x, 7]]);
  at([['of-5-8', 55, 5], ['of-4-8', 60, 5], ['lr-12-9', 51, 4], ['lr-12-9', 64, 4]]);
  props([['amplifier-big', 64, 6]]);

  // La salle de conférence : l'écran et deux tableaux, un pupitre, deux rangées de chaises tournées vers l'écran, séparées par une allée, des plantes.
  at([['tv-10-3', 59, 17], ['of-9-12', 55, 17], ['of-9-14', 66, 17], ['cl-14-14', 60, 19]]);
  for (const y of [21, 23]) for (const x of [53, 55, 57, 59, 64, 66, 68, 70]) at([['ki-4-13', x, y]]);
  at([['lr-13-21', 71, 17], ['lr-13-21', 51, 22]]);
  props([['amplifier-big', 52, 19]]);

  // La salle de sport : des miroirs au mur, trois tapis de course alignés, deux sacs de frappe, des tapis de sol, des râteliers et des ballons.
  at([['gy-4-21', 2, 32], ['gy-4-21', 9, 32], ['gy-6-23', 1, 32], ['gy-3-1', 5, 39], ['gy-3-4', 1, 37], ['gy-0-14', 1, 43], ['gy-3-14', 10, 43], ['gy-7-2', 7, 43], ['gy-7-0', 8, 41]]);
  props([['treadmill', 2, 35], ['treadmill', 8, 35], ['treadmill', 10, 35], ['punching-bag-left', 2, 40], ['punching-bag-right', 10, 40], ['amplifier-big', 12, 33]]);

  // La salle de jeu : la cheminée au mur nord, un salon autour d'un grand tapis rouge (deux fauteuils de profil, une table basse, un canapé de dos),
  // des bougies et des lampadaires ; au sud-est, les quatre tables de jeu, avec leurs chaises.
  at([
    ['ge-9-4', 17, 35], ['of-6-18', 18, 36], ['ba-2-33', 15, 36], ['ba-4-33', 21, 36], ['of-0-19', 18, 38],
    ['lr-12-9', 14, 33], ['lr-12-9', 35, 40], ['gy-7-12', 14, 42], ['gy-7-14', 16, 42],
  ]);
  at([
    ['ki-6-18', 24, 35], ['ki-7-11', 25, 34], ['ki-6-13', 25, 37],
    ['ki-6-18', 29, 35], ['ki-7-11', 30, 34], ['ki-6-13', 30, 37],
    ['ki-6-18', 24, 40], ['ki-7-11', 25, 39], ['ki-6-13', 25, 42],
    ['ge-0-5', 29, 40], ['ki-7-11', 30, 39], ['ki-6-13', 30, 43], ['of-5-8', 28, 41], ['of-4-8', 32, 41],
  ]);
  props([['chimney', 19, 32], ['candle', 17, 33], ['candle', 22, 33], ['wall-candle', 15, 32], ['wall-candle', 28, 32], ['wall-candle', 33, 32], ['amplifier-big', 34, 33]]);

  // La détente : sur la terrasse, la piscine et ses transats ; dans le salon, la télé entre deux bibliothèques, un canapé de dos, des fauteuils de profil,
  // une table basse sur un tapis et l'aquarium ; dans le coin musique, un piano, une batterie, des guitares, un ampli et des pieds de micro.
  at([
    ['fi-12-16', 38, 33], ['fi-0-19', 49, 33],
    ['fi-4-19', 39, 41], ['fi-8-19', 44, 41], ['fi-12-19', 49, 41],
    ['lr-13-0', 37, 32], ['lr-13-0', 53, 32], ['lr-13-0', 37, 42], ['lr-13-0', 53, 42],
  ]);
  at([
    ['cl-4-13', 56, 33], ['ba-6-47', 58, 33], ['cl-6-13', 63, 33],
    ['ge-9-7', 59, 35], ['of-6-18', 60, 36], ['ba-2-33', 56, 36], ['ba-4-33', 64, 36],
    ['of-0-19', 59, 38], ['of-0-19', 61, 38],
    ['lr-13-21', 56, 41], ['lr-12-9', 66, 40],
  ]);
  at([
    ['ms-2-12', 77, 35], ['ms-2-4', 77, 38], ['ms-0-18', 72, 40],
    ['ms-7-2', 71, 34], ['ms-10-2', 75, 34], ['ms-6-15', 71, 38], ['ms-7-15', 74, 38],
  ]);
  props([['fishtank', 66, 42], ['amplifier', 76, 40], ['amplifier-big', 79, 33]]);
}

// La carte telle que le serveur la charge, et son plan pour les tests.
export const OFFICE: { ascii: string[]; zones: ZoneInput[] } = (() => {
  const { ascii, zones } = buildOffice();
  return { ascii, zones };
})();

export function buildOfficeTiledMap(): TiledMapJson {
  return buildOffice().canvas.toTiled();
}
