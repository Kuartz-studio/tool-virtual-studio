import { decorItem } from '../decor/catalog';
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
//   y  2 │ A5 · A1 · A2 │ place centrale : le café │ salle de réunion │ l'octogone (salle de combat)                       │
//   y 11 ├ rue nord (y 11 à 14), qui traverse la place ──────────────────────────────────────────────────────────────────┤
//   y 17 │ A6 · A3 · A4 │ place centrale : l'accueil (apparition) │ salle de conférence │ connecteur est                   │
//   y 26 ├ rue sud (y 26 à 29) ─────────────────────────────────────────────────────────────────────────────────────────┤
//   y 32 │ salle de sport │ salle de jeu │ détente et piscine                                                              │
//   y 46 └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
//
// Les 6 places ont pour clé A1 à A6, écrite dans le nom des deux zones (la pièce `desk` et sa porte `door`) : c'est ce qui les relie, et ce qui
// désigne la place dans la base. A1 à A4 font 9 × 7, A5 et A6 6 × 7 ; A1, A2 et A5 ont leur porte au sud, A3, A4 et A6 au nord, côté rue. Les petits
// bureaux (A5, A6) sont tout à l'ouest de leur rangée, les grands à leur droite.
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
  { key: 'A1', x: 9, y: 2, spec: DESK_ROOMS.standard, side: 'south' },
  { key: 'A2', x: 20, y: 2, spec: DESK_ROOMS.standard, side: 'south' },
  { key: 'A3', x: 9, y: 17, spec: DESK_ROOMS.standard, side: 'north' },
  { key: 'A4', x: 20, y: 17, spec: DESK_ROOMS.standard, side: 'north' },
  { key: 'A5', x: 1, y: 2, spec: DESK_ROOMS.compact, side: 'south' },
  { key: 'A6', x: 1, y: 17, spec: DESK_ROOMS.compact, side: 'north' },
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

// Les ouvertures de la carte : les portes des bureaux, celles de trois salles (réunion, octogone, conférence) et les quatre arches des salles du sud.
// `room` est la pièce qu'elles ferment (la clé d'un bureau ou d'un lieu).
export interface OfficeOpening extends Area {
  key: string;
  kind: 'door' | 'arch';
  room: string;
}

export const OFFICE_OPENINGS: OfficeOpening[] = [
  ...OFFICE_DESK_SLOTS.map((slot): OfficeOpening => ({ key: `door:${slot.key}`, kind: 'door', room: slot.key, ...slot.door })),
  { key: 'door:meeting', kind: 'door', room: 'meeting', x: 57, y: 9, w: 2, h: 2 },
  { key: 'door:arena', kind: 'door', room: 'arena', x: 72, y: 9, w: 2, h: 2 },
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
const ARENA_ROOM: Area = { x: 66, y: 2, w: 14, h: 7 };
// Le ring de l'octogone, au milieu de la salle contre le mur nord : le public se tient sur les côtés et sur la rangée du sud, devant la porte.
export const OFFICE_RING: Area = { x: 68, y: 2, w: 10, h: 6 };
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
  floorOf(ARENA_ROOM, 'beton');
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

  // La salle de réunion (bande au sud, pans à l'ouest et à l'est) et l'octogone, qui partage son pan est (des murs rouges : une salle de combat).
  c.hWall(MEETING.x - 1, MEETING.x + MEETING.w, MEETING.y + MEETING.h, 'bleu-ciel');
  c.vWall(MEETING.x - 1, MEETING.y, MEETING.y + MEETING.h - 1, 'bleu-ciel');
  c.vWall(MEETING.x + MEETING.w, MEETING.y, MEETING.y + MEETING.h - 1, 'bleu-ciel');
  c.hWall(ARENA_ROOM.x, ARENA_ROOM.x + ARENA_ROOM.w, ARENA_ROOM.y + ARENA_ROOM.h, 'rouge');
  c.vWall(ARENA_ROOM.x + ARENA_ROOM.w, ARENA_ROOM.y, ARENA_ROOM.y + ARENA_ROOM.h - 1, 'rouge');

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
    ['Octogone', ARENA_ROOM],
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
  c.place('arena', 'Octogone', ARENA_ROOM, { scene: 'quest', music: true });
  c.place('conference', 'Salle de conférence', CONFERENCE, { scene: 'drift', music: true });
  c.place('gym', 'Salle de sport', GYM, { scene: 'quest', music: true, destination: true });
  c.place('game', 'Salle de jeu', GAME, { scene: 'dusk', music: true, destination: true });
  c.place('lounge', 'Détente et piscine', LOUNGE, { scene: 'sunny', music: true });

  // Les enceintes (une par lieu qui a de la musique), la case devant la machine à café, les tables des jeux et leurs sièges, le ring de l'octogone.
  c.speaker('cafe', 46, 3);
  c.speaker('reception', 47, 24);
  c.speaker('meeting', 64, 6);
  c.speaker('conference', 52, 19);
  c.speaker('gym', 12, 33);
  c.speaker('game', 34, 33);
  c.speaker('lounge', 79, 33);
  c.speaker('arena', 79, 7);
  c.coffee(40, 5);
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
  c.arena(OFFICE_RING);

  // Quelques inscriptions au sol.
  c.zone({ type: 'label', text: 'CAFÉ', x: 36, y: 9, w: 8, h: 1 });
  c.zone({ type: 'label', text: 'ACCUEIL', x: 35, y: 25, w: 10, h: 1 });
  c.zone({ type: 'label', text: 'SALLE DE RÉUNION', x: 52, y: 8, w: 12, h: 1 });
  // L'interrupteur de la lumière : sur la face du mur nord de la rue (la rangée y 10, que l'on voit de la rue), entre la porte du grand bureau A2 et la
  // place. Le client y pose la plaque. En dernier : les numéros des autres zones ne changent pas.
  c.zone({ type: 'switch', x: 28, y: 10, w: 1, h: 1 });
  // L'inscription de l'octogone, entre les fauteuils du public et la porte.
  c.zone({ type: 'label', text: 'OCTOGONE', x: 70, y: 8, w: 4, h: 1 });
  // Les trois administratrices de l'accueil, chacune sur la case de son poste (les réceptionnistes de l'accueil) : on vient leur parler (la touche E) pour
  // confier une mission à quelqu'un, voir la boutique ou ses caractéristiques. Margot et Lucie aux deux bouts, Inès au milieu. En dernier, elles aussi.
  c.clerk('margot', 39, 17);
  c.clerk('ines', 40, 17);
  c.clerk('lucie', 41, 17);

  return { canvas: c, ascii: c.ascii(), zones: c.zones };
}

// Le mobilier de la carte : des éléments de la banque (packages/shared/src/decor) et des objets animés (packages/shared/src/props), posés par la case de
// leur coin haut-gauche. Les bureaux n'en ont pas ici, ni la rangée de la rue devant eux (leur dehors) : leur déco est celle de leur occupant (DeskInfo),
// dessinée par le client. Un élément mural se pose à la case de la pièce qu'il surplombe (un panneau d'un carreau, une rangée plus haut : à la rangée de
// mur où il doit être).
//
// Les règles de l'agencement, pour que chaque pièce soit logique :
// - un siège regarde ce qu'il sert : une chaise du côté nord d'une table est « de face », du côté sud « de dos » ; aux bouts, « vers la droite » à
//   l'ouest, « vers la gauche » à l'est. Face à un écran ou à une cheminée, on voit le dos des sièges. Les sièges ne bloquent jamais le passage ;
// - le comptoir de la machine à café est contre le mur, la machine dessus et la case où l'on se sert juste devant ;
// - on ne pose pas un meuble dont la vue (de face, de dos, de profil) ne convient pas à l'endroit : mieux vaut rien.
function furnish(c: MapCanvas): void {
  const at = (items: ReadonlyArray<readonly [string, number, number]>) => {
    for (const [id, x, y] of items) c.put(id, x, y);
  };
  const props = (items: ReadonlyArray<readonly [string, number, number]>) => {
    for (const [key, x, y] of items) c.prop(key, x, y);
  };

  // Les sièges d'une table : `north` (de face) et `south` (de dos) sur chacune des colonnes de `cols` (celles de la table par défaut ; une liste de sièges
  // se partage les colonnes à tour de rôle), `west` (vers la droite) et `east` (vers la gauche) au milieu des bouts. La table est posée à (x, y), son
  // empreinte au sol sous ses pieds.
  type Seats = string | readonly string[];
  const seatOf = (seats: Seats, index: number): string => (typeof seats === 'string' ? seats : seats[index % seats.length]!);
  // `tuck` : de combien de pixels on abaisse les chaises du nord (des dossiers seuls, qui passent sous le bord de la table).
  const table = (id: string, x: number, y: number, chairs: { north?: Seats; south?: Seats; west?: string; east?: string; cols?: readonly number[]; tuck?: number } = {}) => {
    const item = decorItem(id);
    if (!item) throw new Error(`Table inconnue : « ${id} ».`);
    c.put(id, x, y);
    const cols = chairs.cols ?? Array.from({ length: item.w }, (_, i) => x + i);
    cols.forEach((col, index) => {
      if (chairs.north) c.put(seatOf(chairs.north, index), col, y - 1, chairs.tuck ? { offsetY: chairs.tuck } : {});
      if (chairs.south) c.put(seatOf(chairs.south, index), col, y + item.claim);
    });
    const middle = y + Math.floor((item.claim - 1) / 2);
    if (chairs.west) c.put(chairs.west, x - 1, middle);
    if (chairs.east) c.put(chairs.east, x + item.w, middle);
  };

  // Les rues : des arbustes entre les portes (jamais dans l'axe d'une porte ou d'une arche : ils la masqueraient), des fontaines à eau, deux bancs, et sur
  // le connecteur est des casiers et de grandes plantes. Un panneau de sortie, vert, à chaque bout des deux rues (il éclaire la nuit).
  // La rangée de la rue juste sous le mur sud d'un bureau, sur la largeur de sa pièce (y 11 devant A5, A1 et A2, y 26 devant A6, A3 et A4), n'est pas à la
  // carte : c'est le dehors du bureau, que son occupant décore (ce qu'elle y posait est devenu son dehors par défaut, defaultDeskDecor). Sur la face de ce
  // mur, la carte ne garde que le panneau de sortie et l'interrupteur de la lumière, que la déco ne recouvre pas.
  at([
    // La rue nord (y 11 à 14) : les portes du nord sont en x 3-4, 12-13, 23-24, 57-58 et 72-73 ; celles du sud en x 3-4, 12-13, 23-24 et 68-70. Entre A5 et
    // A1, sur les deux pans de mur, un banc (deux rangées de profondeur : il ne tiendrait pas dans le dehors d'un bureau).
    ['lr-12-0', 19, 11],
    ['lr-12-0', 53, 11], ['lr-12-0', 68, 11],
    ['of-12-15', 29, 11], ['of-12-15', 63, 11],
    ['lr-12-0', 1, 14], ['lr-12-0', 9, 14], ['lr-12-0', 18, 14], ['lr-12-0', 28, 14],
    ['lr-12-0', 52, 14], ['lr-12-0', 63, 14], ['lr-12-0', 74, 14],
    ['ge-0-15', 7, 11], ['ge-2-15', 60, 11],
    // La rue sud (y 26 à 29) : au nord, les portes ne s'ouvrent pas sur elle ; au sud, les arches des salles (x 6-7, 23-26, 44-47, 66-69).
    ['lr-12-0', 29, 26], ['lr-12-0', 52, 26], ['lr-12-0', 62, 26],
    ['of-12-15', 56, 26],
    ['lr-12-0', 1, 29], ['lr-12-0', 10, 29], ['lr-12-0', 18, 29], ['lr-12-0', 30, 29], ['lr-12-0', 40, 29], ['lr-12-0', 49, 29], ['lr-12-0', 58, 29], ['lr-12-0', 72, 29],
    // Le connecteur est : deux distributeurs contre le mur du nord (de part et d'autre du panneau de sortie), des plantes. Rien contre les murs de côté : un
    // meuble qui regarde le sud n'a pas sa place contre un mur qui regarde l'ouest.
    ['of-0-23', 74, 11], ['of-2-23', 78, 11],
    ['lr-13-21', 74, 18], ['lr-13-21', 74, 25], ['lr-13-21', 78, 18], ['lr-13-21', 78, 25],
    // Les panneaux de sortie : sur la face du mur, la rangée juste au-dessus du premier carreau de la rue, aux quatre bouts (la flèche vers l'extrémité).
    ['mu-14-111-m', 1, 11], ['mu-14-111', 77, 11], ['mu-14-111-m', 1, 26], ['mu-14-111', 72, 26],
  ]);

  // La place centrale : de grands palmiers aux angles.
  at([['lr-13-0', 30, 3], ['lr-13-0', 48, 3], ['lr-13-0', 30, 8], ['lr-13-0', 48, 8]]);

  // Le café : contre le mur nord, une rangée d'appareils (le réfrigérateur, deux distributeurs, la fontaine à eau) puis le comptoir de la machine à café, la
  // machine dessus avec sa bouilloire et ses tasses ; on se sert juste devant, sur la case (40, 5). Quatre tables rondes de quatre places (deux chaises de
  // face au nord, deux de dos au sud) de part et d'autre de l'allée qui mène au comptoir.
  at([
    ['ki-12-23', 33, 4], ['of-2-23', 34, 4], ['of-0-23', 36, 4], ['of-12-15', 38, 4],
    ['cf-8-4', 39, 3],
    ['ki-13-23', 41, 3],
    ['lr-12-0', 44, 4],
    ['ge-12-43', 34, 2], ['lr-0-28', 39, 2], ['lr-2-26', 41, 2], ['ge-12-43', 44, 2],
  ]);
  c.prop('coffee', 40, 3, { onTop: true, offsetY: 16 });
  props([['amplifier-big', 46, 3]]);
  table('ba-0-0', 33, 6, { north: ['ki-0-13', 'ki-3-13'], south: ['ki-0-12', 'ki-1-12'], tuck: 16 });
  table('ba-0-3', 36, 6, { north: ['ki-1-13', 'ki-2-13'], south: ['ki-1-12', 'ki-0-11'], tuck: 16 });
  table('ba-0-6', 42, 6, { north: ['ki-3-13', 'ki-0-13'], south: ['ki-0-11', 'ki-1-11'], tuck: 16 });
  table('ba-0-0', 45, 6, { north: ['ki-2-13', 'ki-1-13'], south: ['ki-1-11', 'ki-0-12'], tuck: 16 });

  // L'accueil : le comptoir, trois postes côte à côte (une réceptionniste blonde à chaque bout, une brune au milieu) et la grande horloge, des plantes de part et d'autre, le tapis sous le point d'apparition,
  // et deux coins d'attente de chaque côté de l'axe : deux fauteuils face à face autour d'une table basse. Et l'enceinte.
  props([['receptionist', 39, 17], ['receptionist-2', 40, 17], ['receptionist', 41, 17], ['grandfather-clock', 38, 17]]);
  at([
    ['lr-10-0', 35, 18], ['lr-10-0', 43, 18],
    ['cf-0-8', 38, 21],
    ['ba-2-33-m', 33, 20], ['of-6-18', 34, 19], ['ba-4-33', 35, 20],
    ['ba-2-33-m', 44, 20], ['of-6-20', 45, 19], ['ba-4-33', 46, 20],
    ['lr-13-21', 31, 15], ['lr-13-21', 46, 15], ['lr-13-0', 31, 24], ['lr-12-9', 43, 24],
  ]);
  props([['amplifier-big', 47, 24]]);

  // La salle de réunion : l'écran et deux tableaux blancs au mur nord, face à la table ; la table (4 × 2 cases au sol), quatre chaises de dos au sud (elles
  // regardent le mur et l'écran) et une de profil à chaque bout (vers la table) ; de chaque côté de l'écran, une bibliothèque.
  at([['of-9-12', 53, 2], ['of-9-12', 61, 2], ['tv-10-1', 57, 2], ['cl-4-13', 51, 4], ['cl-4-13', 62, 4]]);
  table('cf-0-1', 56, 4, { south: ['of-0-8', 'of-1-8'], west: 'of-5-8', east: 'of-4-8' });
  at([['lr-12-9', 51, 8], ['lr-12-9', 64, 8]]);
  props([['amplifier-big', 64, 6]]);

  // La salle de conférence : l'écran géant et deux tableaux au mur nord, un pupitre devant ; deux rangées de chaises de dos (elles regardent l'écran),
  // séparées par une allée, des plantes.
  at([['tv-10-3', 58, 17], ['of-9-12', 54, 17], ['of-9-14', 66, 17], ['cl-14-14', 60, 19]]);
  for (const y of [21, 23]) {
    for (const x of [53, 55, 57, 59, 64, 66, 68, 70]) c.put((x + y) % 2 === 0 ? 'of-0-8' : 'of-1-8', x, y);
  }
  at([['lr-13-21', 71, 17], ['lr-13-21', 51, 22]]);
  props([['amplifier-big', 52, 19]]);

  // La salle de sport : des miroirs au mur, trois tapis de course alignés, deux sacs de frappe, des tapis de sol, des râteliers et des ballons.
  at([['gy-4-21', 2, 32], ['gy-4-21', 9, 32], ['gy-6-23', 1, 32], ['gy-3-1', 5, 39], ['gy-3-4', 1, 37], ['gy-0-14', 1, 43], ['gy-3-14', 10, 43], ['gy-7-2', 7, 43], ['gy-7-0', 8, 41]]);
  props([['treadmill', 2, 35], ['treadmill', 8, 35], ['treadmill', 10, 35], ['punching-bag-left', 2, 40], ['punching-bag-right', 10, 40], ['amplifier-big', 12, 33]]);

  // La salle de jeu : la cheminée au mur nord, devant elle un salon autour d'un grand tapis (deux fauteuils de profil face à face, une table basse, un
  // canapé de dos qui regarde le feu), des bougies et des lampadaires ; au sud-est, les quatre tables de jeu, une chaise de face au nord et une de dos au sud.
  at([
    ['ge-12-21', 17, 34], ['of-6-18', 18, 35], ['ba-2-33-m', 15, 35], ['ba-2-33', 21, 35], ['of-0-19', 18, 37],
    ['lr-12-9', 14, 33], ['lr-12-9', 35, 40], ['gy-7-12', 14, 42], ['gy-7-16', 16, 42],
  ]);
  table('ki-6-18', 24, 35, { north: 'ki-0-13', south: 'ki-0-12', cols: [25], tuck: 16 });
  table('ki-6-18', 29, 35, { north: 'ki-3-13', south: 'ki-1-12', cols: [30], tuck: 16 });
  table('ki-6-18', 24, 40, { north: 'ki-1-13', south: 'ki-0-11', cols: [25], tuck: 16 });
  table('ge-0-5', 29, 40, { north: 'ki-2-13', south: 'ki-1-11', west: 'ki-4-11', east: 'ki-5-13', cols: [30], tuck: 16 });
  props([['chimney', 19, 32], ['candle', 17, 33], ['candle', 22, 33], ['wall-candle', 15, 32], ['wall-candle', 28, 32], ['wall-candle', 33, 32], ['amplifier-big', 34, 33]]);

  // La détente : sur la terrasse, la piscine et ses transats ; dans le salon, la télé sur son meuble entre deux bibliothèques, deux canapés de dos qui la
  // regardent, des fauteuils de profil face à face, une table basse sur un tapis et l'aquarium ; dans le coin musique, un piano, une batterie, des guitares,
  // un ampli et des pieds de micro.
  at([
    ['fi-12-16', 38, 33], ['fi-0-19', 49, 33],
    ['fi-4-19', 39, 41], ['fi-8-19', 44, 41], ['fi-12-19', 49, 41],
    ['lr-13-0', 37, 32], ['lr-13-0', 53, 32], ['lr-13-0', 37, 42], ['lr-13-0', 53, 42],
  ]);
  at([
    ['cl-4-13', 56, 33], ['ba-6-47', 58, 33], ['cl-6-13', 63, 33],
    ['ge-9-7', 59, 35], ['of-6-18', 60, 36], ['ba-2-33-m', 57, 36], ['ba-2-33', 63, 36],
    ['of-0-19', 59, 38], ['of-0-19', 61, 38],
    ['lr-13-21', 56, 41], ['lr-12-9', 66, 40],
  ]);
  at([
    ['ge-12-21', 71, 38], ['ms-2-12', 77, 35], ['ms-2-4', 77, 38], ['ms-0-18', 72, 40],
    ['ms-7-2', 71, 34], ['ms-10-2', 75, 34], ['ms-6-15', 71, 38], ['ms-7-15', 74, 38],
  ]);
  props([['fishtank', 66, 42], ['amplifier', 76, 40], ['amplifier-big', 79, 33]]);

  // L'octogone : le ring (tracé par le client) contre le mur nord ; de chaque côté, un sac de frappe pour s'échauffer, et un pouf à l'ouest ; au
  // sud, devant la porte, une rangée de fauteuils de dos (ils regardent le ring), l'allée de la porte laissée libre. L'enceinte dans le coin sud-est.
  props([['punching-bag-left', 66, 3], ['punching-bag-right', 78, 3], ['amplifier-big', 79, 7]]);
  at([
    ['gy-7-14', 66, 5],
    ['of-0-8', 66, 8], ['of-1-8', 67, 8], ['of-0-8', 68, 8], ['of-1-8', 69, 8],
    ['of-1-8', 76, 8], ['of-0-8', 77, 8], ['of-1-8', 78, 8],
  ]);
}

// La carte telle que le serveur la charge, et son plan pour les tests.
export const OFFICE: { ascii: string[]; zones: ZoneInput[] } = (() => {
  const { ascii, zones } = buildOffice();
  return { ascii, zones };
})();

export function buildOfficeTiledMap(): TiledMapJson {
  return buildOffice().canvas.toTiled();
}
