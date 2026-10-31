import { decorItem } from '../decor/catalog';
import { DESK_ROOMS, type DeskRoomSpec } from '../decor/placement';
import { DEFAULT_FLOOR_THEME, DEFAULT_WALL_THEME } from '../decor/themes';
import type { ZoneInput } from './build-tiled';
import { MapCanvas, cellHash, type Area, type GardenGround } from './builder';
import type { TiledMapJson } from './tiled-types';

// La carte du bureau : 91 × 56 cases, dessinée par code (et non à la main) : les bureaux se répètent, et leur nombre, leur taille et leurs portes
// doivent rester cohérents. Un bâtiment de 81 × 46 cases, aux murs noirs, posé à 5 cases du bord : un jardin en fait le tour (une haie au bord de la
// carte, un chemin de dalles, des arbres, des buissons, des jardinières). Les murs horizontaux font 2 cases de haut, les verticaux 1.
//
// Le bâtiment a ses coordonnées à lui (0, 0 = son coin nord-ouest, la case (5, 5) de la carte) : c'est dans celles-là que la carte est écrite.
//
//   y  0 ┌ jardin ┬ A5 · A1 · A2 · A3 · A4 · A6 : les six bureaux, portes au sud ──────────────────────────┬ jardin ┐
//   y 10 │ terrasse ├ la rue des bureaux (y 11 à 13) ────────────────────────────────────────────────────┤ terrasse │
//   y 14 ├ conférence │                        la cafétéria (le bar, le salon, les tables)              │ salle de jeux ┤
//   y 30 ├ l'accueil  │ le hall d'entrée │ la salle de sport                                             │ salle de boxe ┤
//   y 44 └────────────┴── l'entrée (x 27 à 30) ──┴──────────────────────────────────────────────────────┴───────────────┘
//
// Les deux angles du nord n'ont aucun mur : la rue des bureaux y débouche sur une terrasse en bois, et au-dessus, un jardin (à l'ouest un jardin naturel
// et son bassin, à l'est un parterre à la française), relié au chemin du tour par des pas japonais.
//
// Les 6 places ont pour clé A1 à A6, écrite dans le nom des deux zones (la pièce `desk` et sa porte `door`) : c'est ce qui les relie, et ce qui
// désigne la place dans la base. A1 à A4 font 9 × 7, A5 et A6 6 × 7 (aux deux bouts de la rangée) ; toutes ont leur porte au sud, sur la rue.
export const OFFICE_WIDTH = 91;
export const OFFICE_HEIGHT = 56;

// L'épaisseur du jardin autour du bâtiment, et le bâtiment.
const B = 5;
const BUILDING = { w: 81, h: 46 } as const;

// Un rectangle du bâtiment, en cases de la carte.
const area = (x: number, y: number, w: number, h: number): Area => ({ x: B + x, y: B + y, w, h });

// Une place de bureau : sa clé, la pièce (en cases), la porte (2 × 2 : elle perce la bande de mur du côté de la rue) et le côté de la pièce où elle est.
export interface OfficeDeskSlot {
  key: string;
  room: Area;
  door: Area;
  doorSide: 'north' | 'south';
  // Les cases de mur qui entourent la pièce, pour que le client les repeigne au thème de son occupant.
  walls: Array<{ x: number; y: number; part: 'top' | 'bottom' | 'stem' }>;
}

// Les six places, dans l'ordre de leur clé : où est la pièce, de quelle taille, et de quel côté est sa porte. D'ouest en est : A5, A1, A2, A3, A4, A6.
const DESKS: ReadonlyArray<{ key: string; x: number; y: number; spec: DeskRoomSpec; side: 'north' | 'south' }> = [
  { key: 'A1', x: B + 21, y: B + 2, spec: DESK_ROOMS.standard, side: 'south' },
  { key: 'A2', x: B + 31, y: B + 2, spec: DESK_ROOMS.standard, side: 'south' },
  { key: 'A3', x: B + 41, y: B + 2, spec: DESK_ROOMS.standard, side: 'south' },
  { key: 'A4', x: B + 51, y: B + 2, spec: DESK_ROOMS.standard, side: 'south' },
  { key: 'A5', x: B + 14, y: B + 2, spec: DESK_ROOMS.compact, side: 'south' },
  { key: 'A6', x: B + 61, y: B + 2, spec: DESK_ROOMS.compact, side: 'south' },
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

// Les ouvertures de la carte : les portes des bureaux, les passages des salles (dans un pan de mur, ou une bande), et l'entrée du bâtiment.
// `room` est la pièce qu'elles ferment (la clé d'un bureau ou d'un lieu).
export interface OfficeOpening extends Area {
  key: string;
  kind: 'door' | 'arch';
  room: string;
}

export const OFFICE_OPENINGS: OfficeOpening[] = [
  ...OFFICE_DESK_SLOTS.map((slot): OfficeOpening => ({ key: `door:${slot.key}`, kind: 'door', room: slot.key, ...slot.door })),
  { key: 'arch:conference', kind: 'arch', room: 'conference', ...area(16, 21, 1, 2) },
  { key: 'arch:game', kind: 'arch', room: 'game', ...area(57, 20, 1, 2) },
  { key: 'arch:gym', kind: 'arch', room: 'gym', ...area(37, 30, 2, 2) },
  { key: 'arch:arena', kind: 'arch', room: 'arena', ...area(57, 37, 1, 2) },
  { key: 'arch:entrance', kind: 'arch', room: 'hall', ...area(27, 44, 4, 2) },
];

// On arrive devant le comptoir de l'accueil.
export const OFFICE_SPAWN = { x: B + 9, y: B + 36 };

// Les lieux : l'intérieur de chaque pièce, ou l'espace qu'un lieu ouvert couvre.
const CONFERENCE = area(1, 16, 15, 12);
const RECEPTION = area(1, 30, 22, 14);
const HALL = area(23, 30, 11, 14);
const CAFE = area(17, 14, 40, 16);
const STREET = area(13, 11, 55, 3);
const GAME = area(58, 16, 22, 12);
const GYM = area(35, 32, 22, 12);
const BOXING = area(58, 30, 22, 14);
// Le ring de l'octogone, au milieu de la salle de boxe : le public est sur les bancs du sud.
export const OFFICE_RING: Area = area(64, 32, 10, 7);
// Les deux angles ouverts du nord (13 × 14 cases chacun) : le jardin (les 10 rangées du haut), puis la terrasse en bois où débouche la rue.
const CORNERS = [{ x0: 0, x1: 12 }, { x0: 68, x1: 80 }] as const;
const CORNER_GARDEN_H = 10;
const CORNER_H = 14;
const TERRACES = CORNERS.map((c) => area(c.x0, CORNER_GARDEN_H, c.x1 - c.x0 + 1, CORNER_H - CORNER_GARDEN_H));
const CORNER_GARDENS = CORNERS.map((c) => area(c.x0, 0, c.x1 - c.x0 + 1, CORNER_GARDEN_H));
// Le bassin du jardin de l'angle ouest.
export const OFFICE_POND: Area = area(8, 4, 4, 3);
// L'entrée du bâtiment, au sud du hall.
const ENTRANCE = area(27, 44, 4, 2);

const WALL = DEFAULT_WALL_THEME;

export interface OfficeBuild {
  canvas: MapCanvas;
  ascii: string[];
  zones: ZoneInput[];
}

export function buildOffice(): OfficeBuild {
  const c = new MapCanvas(OFFICE_WIDTH, OFFICE_HEIGHT, 'creme');
  const W = OFFICE_WIDTH;
  const H = OFFICE_HEIGHT;

  // ---- Le sol : crème partout dans le bâtiment, le parquet clair des bureaux, de la conférence, de la salle de jeux et des terrasses -------------
  const floorOf = (a: Area, id: string) => c.floor(a.x, a.y, a.w, a.h, id);
  for (const slot of OFFICE_DESK_SLOTS) floorOf(slot.room, DEFAULT_FLOOR_THEME);   // les occupants repeignent le leur
  floorOf(CONFERENCE, 'parquet-clair');
  floorOf(GAME, 'parquet-clair');
  floorOf(GYM, 'gris');
  floorOf(BOXING, 'beton');
  floorOf(area(34, 14, 11, 7), 'blanc');   // le coin du bar
  for (const terrace of TERRACES) floorOf(terrace, 'parquet-clair');

  // ---- Les murs, tous noirs -------------------------------------------------------------------------------------------------------------
  const hWall = (x0: number, x1: number, y: number) => c.hWall(B + x0, B + x1, B + y, WALL);
  const vWall = (x: number, y0: number, y1: number) => c.vWall(B + x, B + y0, B + y1, WALL);
  // Les six bureaux : chacun ses murs (les occupants les repeignent), sa porte percée dans la bande du sud. Leurs bandes du nord font celle du bâtiment.
  for (const slot of OFFICE_DESK_SLOTS) {
    for (const wall of slot.walls) {
      if (wall.part === 'stem') c.vWall(wall.x, wall.y, wall.y, WALL);
      else if (wall.part === 'top') c.hWall(wall.x, wall.x, wall.y, WALL);
    }
  }
  // Le pourtour : la bande du sud, les pans de l'ouest et de l'est sous les angles ouverts.
  hWall(0, BUILDING.w - 1, BUILDING.h - 2);
  vWall(0, 16, BUILDING.h - 3);
  vWall(BUILDING.w - 1, 16, BUILDING.h - 3);
  // La salle de conférence et la salle de jeux, de part et d'autre de la cafétéria ; la salle de sport et la salle de boxe au sud.
  hWall(0, 16, 14);
  vWall(16, 16, 27);
  hWall(0, 16, 28);
  hWall(57, 80, 14);
  vWall(57, 16, 27);
  hWall(57, 80, 28);
  hWall(34, 57, 30);
  vWall(34, 32, 43);
  vWall(57, 32, 43);

  // Les ouvertures : plus de mur, plus d'obstacle.
  for (const o of OFFICE_OPENINGS) c.open(o.x, o.y, o.w, o.h);

  furnish(c);
  plantGarden(c);

  // ---- Les zones ------------------------------------------------------------------------------------------------------------------------
  c.zone({ type: 'spawn', x: OFFICE_SPAWN.x, y: OFFICE_SPAWN.y, w: 1, h: 1 });
  for (const [name, room] of [
    ['Salle de conférence', CONFERENCE],
    ['Salle de jeux', GAME],
    ['Salle de sport', GYM],
    ['Salle de boxe', BOXING],
  ] as const) {
    c.zone({ type: 'private', name, ...room });
  }
  for (const slot of OFFICE_DESK_SLOTS) {
    c.zone({ type: 'desk', name: slot.key, x: slot.room.x, y: slot.room.y, w: slot.room.w, h: slot.room.h });
    c.zone({ type: 'door', name: slot.key, x: slot.door.x, y: slot.door.y, w: slot.door.w, h: slot.door.h });
  }

  // Les lieux, avec leur nom, leur ambiance par défaut, leur musique et leur destination. Le dehors (le jardin, les terrasses) n'a pas d'enceinte : la
  // musique s'y tait, on y entend le jardin.
  c.place('cafe', 'Cafétéria', CAFE, { kind: 'open', scene: 'sunny', music: true });
  c.place('reception', 'Accueil', RECEPTION, { kind: 'open', music: true });
  c.place('hall', "Hall d'entrée", HALL, { kind: 'open' });
  c.place('street', 'Couloir', STREET, { kind: 'street' });
  c.place('conference', 'Salle de conférence', CONFERENCE, { scene: 'drift', music: true });
  c.place('game', 'Salle de jeux', GAME, { scene: 'dusk', music: true, destination: true });
  c.place('gym', 'Salle de sport', GYM, { scene: 'quest', music: true, destination: true });
  c.place('arena', 'Salle de boxe', BOXING, { scene: 'quest', music: true });
  c.place('terrace', 'Terrasse', TERRACES, { kind: 'outside' });
  c.place('garden', 'Jardin', [{ x: 0, y: 0, w: W, h: B }, { x: 0, y: H - B, w: W, h: B }, { x: 0, y: B, w: B, h: H - 2 * B }, { x: W - B, y: B, w: B, h: H - 2 * B }, ...CORNER_GARDENS], {
    kind: 'outside',
  });

  // Les enceintes (une par lieu qui a de la musique), la case devant la machine à café, les tables des jeux et leurs sièges, le ring de l'octogone, le
  // bassin.
  const speaker = (place: string, x: number, y: number) => c.speaker(place, B + x, B + y);
  speaker('conference', 15, 17);
  speaker('cafe', 44, 15);
  speaker('reception', 22, 30);
  speaker('game', 78, 17);
  speaker('gym', 56, 36);
  speaker('arena', 79, 39);
  c.coffee(B + 39, B + 20);
  const table = (game: 'chess' | 'backgammon' | 'connect4' | 'ludo', x: number, y: number, w: number, h: number, seats: ReadonlyArray<readonly [number, number]>) => {
    c.table(game, { x: B + x, y: B + y, w, h });
    seats.forEach(([sx, sy], index) => c.seat(game, index + 1, B + sx, B + sy));
  };
  table('chess', 68, 19, 3, 2, [[69, 18], [69, 21]]);
  table('backgammon', 73, 19, 3, 2, [[74, 18], [74, 21]]);
  table('connect4', 68, 24, 3, 2, [[69, 23], [69, 26]]);
  table('ludo', 73, 24, 3, 3, [[74, 23], [76, 25], [74, 27], [72, 25]]);
  c.arena(OFFICE_RING);
  c.water(OFFICE_POND);

  // Quelques inscriptions au sol.
  c.zone({ type: 'label', text: 'ACCUEIL', ...area(5, 34, 9, 1) });
  c.zone({ type: 'label', text: 'CAFÉTÉRIA', ...area(36, 21, 7, 1) });
  // L'interrupteur de la lumière : sur la face de la bande de mur des bureaux (la rangée que l'on voit de la rue), entre A1 et A2, au droit de leur pan
  // commun : il n'est dans le dehors d'aucun des deux. Le client y pose la plaque.
  c.zone({ type: 'switch', ...area(30, 10, 1, 1) });
  // Les trois administratrices de l'accueil, chacune sur la case de son poste, derrière le comptoir : on vient leur parler (la touche E) pour confier une
  // mission à quelqu'un, voir la boutique ou ses caractéristiques. Margot et Lucie aux deux bouts, Inès au milieu.
  c.clerk('margot', B + 8, B + 33);
  c.clerk('ines', B + 9, B + 33);
  c.clerk('lucie', B + 10, B + 33);

  return { canvas: c, ascii: c.ascii(), zones: c.zones };
}

// Le mobilier du bâtiment : des éléments de la banque (packages/shared/src/decor : ceux des planches, et ceux de la carte seule, generated-plan.ts) et des
// objets animés (packages/shared/src/props), posés par la case du coin haut-gauche de leur empreinte, en cases du bâtiment. Les bureaux n'en ont pas ici,
// ni la rangée de la rue devant eux (leur dehors) : leur déco est celle de leur occupant (DeskInfo), dessinée par le client. Un élément mural se pose à la
// case de la pièce qu'il surplombe.
//
// Les règles de l'agencement, pour que chaque pièce soit logique :
// - un siège regarde ce qu'il sert : une chaise du côté nord d'une table est « de face », du côté sud « de dos » ; aux bouts, « vers la droite » à
//   l'ouest, « vers la gauche » à l'est. Les sièges ne bloquent jamais le passage ;
// - ce qui est posé sur un comptoir (la machine à café, une plante) l'est sur son plateau, et se dessine devant lui ;
// - les plantes vont par groupes (un îlot de jardinières, deux plantes de part et d'autre d'une porte), pas une à une au hasard.
function furnish(c: MapCanvas): void {
  type Nudge = { offsetX?: number; offsetY?: number };
  const put = (id: string, x: number, y: number, nudge: Nudge = {}) => c.put(id, B + x, B + y, nudge);
  const at = (items: ReadonlyArray<readonly [string, number, number, Nudge?]>) => {
    for (const [id, x, y, nudge] of items) put(id, x, y, nudge);
  };
  const props = (items: ReadonlyArray<readonly [string, number, number]>) => {
    for (const [key, x, y] of items) c.prop(key, B + x, B + y);
  };

  // Les sièges d'une table : `north` (de face) et `south` (de dos) sur chacune des colonnes de `cols`, `west` (vers la droite) et `east` (vers la
  // gauche) au milieu des bouts. La table est posée à (x, y), son empreinte au sol sous ses pieds. `tuck` : de combien de pixels on abaisse les chaises
  // du nord (des dossiers seuls, qui passent sous le bord de la table).
  const table = (id: string, x: number, y: number, chairs: { north?: string; south?: string; west?: string; east?: string; cols: readonly number[]; tuck?: number }) => {
    const item = decorItem(id);
    if (!item) throw new Error(`Table inconnue : « ${id} ».`);
    put(id, x, y);
    for (const col of chairs.cols) {
      if (chairs.north) put(chairs.north, col, y - 1, chairs.tuck ? { offsetY: chairs.tuck } : {});
      if (chairs.south) put(chairs.south, col, y + item.claim);
    }
    const middle = y + Math.floor((item.claim - 1) / 2);
    if (chairs.west) put(chairs.west, x - 1, middle);
    if (chairs.east) put(chairs.east, x + item.w, middle);
  };

  // ---- Les terrasses : sur chacune, deux parasols et leur chaise longue, le passage vers le jardin gardé au milieu.
  at([['fi-0-19', 0, 11], ['fi-12-19', 8, 11], ['fi-0-22', 69, 11], ['fi-4-19', 76, 11]]);

  // ---- La salle de conférence : la grande table arrondie en bois miel, huit fauteuils de chaque côté et un à chaque bout, l'écran et deux tableaux
  // au mur ; des plantes aux quatre coins et l'enceinte.
  put('table-conference', 4, 21);
  for (let x = 5; x <= 12; x++) {
    put('chaise-conference-face', x, 20, { offsetY: 6 });
    put('chaise-conference-dos', x, 23);
  }
  put('chaise-conference-droite', 3, 22, { offsetX: 6 });
  put('chaise-conference-gauche', 13, 22, { offsetX: -6 });
  at([['tv-10-3', 6, 16], ['of-9-12', 2, 16], ['of-9-14', 12, 16]]);
  at([['plante-grande', 1, 17, { offsetX: -8 }], ['plante-bureau', 14, 17], ['grande-plante', 1, 27], ['palmier-pot', 13, 27, { offsetX: 5 }]]);
  props([['amplifier-big', 15, 17]]);

  // ---- L'accueil : le comptoir en U en bois clair et ses trois réceptionnistes, l'horloge comtoise et un tableau au mur ; deux coins d'attente (un
  // canapé et deux fauteuils sur un tapis, deux fauteuils coques autour d'une table ronde), des lampadaires, des plantes et des jardinières.
  put('comptoir-accueil', 5, 32);
  for (const [key, x] of [['receptionist-seule', 8], ['receptionist-2-seule', 9], ['receptionist-seule', 10]] as const) {
    c.prop(key, B + x, B + 33, { onTop: true, offsetY: -10 });
  }
  props([['grandfather-clock', 3, 30], ['amplifier-big', 22, 30]]);
  at([['of-9-14', 8, 30]]);
  at([['palmier-pot', 1, 31, { offsetX: -9 }], ['plante-grande', 12, 31, { offsetX: 2 }], ['plante-bureau', 4, 32, { offsetX: 4 }], ['grande-plante', 14, 32]]);
  at([['tapis-beige', 2, 37], ['canape-salon', 4, 38], ['table-basse-salon', 4, 39, { offsetY: -4 }], ['ba-2-33-m', 2, 39], ['ba-2-33', 6, 39]]);
  at([['tapis-rond-greige', 13, 37], ['fauteuil-coque-1', 13, 38, { offsetX: 10 }], ['fauteuil-coque-2', 16, 38, { offsetX: -10 }], ['table-ronde-blanche', 14, 39, { offsetY: 6 }]]);
  at([['lampadaire-1', 8, 38, { offsetX: 3 }], ['lampadaire-2', 18, 38, { offsetX: 3 }], ['grande-plante', 20, 35]]);
  at([['plante-grande', 1, 43, { offsetX: -8 }], ['plante-musee', 8, 43], ['jardiniere-3', 10, 43], ['jardiniere-1', 12, 43], ['jardiniere-5', 19, 43], ['plante-bureau', 21, 43, { offsetX: 8 }]]);
  // Une haie de jardinières entre l'accueil et le salon de la cafétéria, dans le prolongement du mur de la conférence.
  at([['jardiniere-2', 17, 29], ['jardiniere-4', 19, 29], ['jardiniere-1', 21, 29]]);

  // ---- Le hall d'entrée : deux paillassons devant la porte, deux jardinières de part et d'autre, deux grandes plantes.
  at([['paillasson', 27, 43], ['paillasson', 29, 43], ['jardiniere-5', 24, 43], ['jardiniere-3', 31, 43], ['grande-plante', 23, 31], ['palmier-pot', 32, 31, { offsetX: -5 }]]);

  // ---- La cafétéria : le bar en U blanc (derrière, le réfrigérateur, deux distributeurs et la fontaine à eau ; dessus, la machine à café, une plante et
  // une coupe de fruits ; devant, cinq tabourets), un coin salon sur un tapis rond, six tables rondes de deux chaises, un îlot de jardinières.
  at([['ki-12-23', 37, 16], ['of-2-23', 38, 16], ['of-10-38', 40, 15], ['of-12-15', 42, 16]]);
  put('bar-cafeteria', 36, 18);
  put('plante-comptoir', 37, 19, { offsetY: -27 });
  c.prop('coffee', B + 39, B + 19, { onTop: true, offsetY: -27 });
  put('coupe-fruits', 40, 19, { offsetY: -27 });
  for (let x = 37; x <= 41; x++) put('tabouret-bar', x, 20);
  at([['plante-grande', 34, 18, { offsetX: -6 }], ['plante-grande', 44, 18, { offsetX: -10 }]]);
  props([['amplifier-big', 44, 15]]);
  // Le salon : un canapé face au sud, deux fauteuils de profil face à face, une table basse, un canapé de dos, sur un grand tapis rond ; des plantes
  // et un lampadaire autour.
  at([['tapis-rond-beige', 19, 20], ['canape-salon', 22, 21], ['table-basse-salon', 22, 22, { offsetY: -6 }], ['ba-2-33-m', 20, 22], ['ba-2-33', 25, 22], ['of-0-19', 22, 23]]);
  at([['grande-plante', 18, 21, { offsetX: -7 }], ['plante-bureau', 27, 20, { offsetX: 6 }], ['plante-haute', 27, 24, { offsetX: 4 }], ['lampadaire-1', 20, 20, { offsetX: 3 }]]);
  // Les tables rondes en bois miel, une chaise de bistrot de chaque côté (de profil, vers la table).
  for (const [x, y] of [[45, 21], [51, 21], [48, 25], [54, 25], [45, 28], [51, 28]] as const) {
    put('ba-0-6', x, y);
    put('chaise-bistrot-m', x - 1, y + 1, { offsetX: 6 });
    put('chaise-bistrot', x + 2, y + 1, { offsetX: -6 });
  }
  at([['plante-bureau', 56, 16], ['grande-plante', 42, 29], ['palmier-pot', 55, 29, { offsetX: -9 }]]);
  // L'îlot de jardinières, au milieu, entre le salon et les tables : un palmier à chaque bout.
  at([['palmier-pot', 28, 26, { offsetX: -1 }], ['jardiniere-3', 29, 26], ['jardiniere-1', 31, 26], ['jardiniere-5', 33, 26], ['palmier-pot', 34, 26, { offsetX: 15 }]]);

  // ---- La salle de jeux : la cheminée au mur nord, devant elle un salon autour d'un grand tapis (deux fauteuils de profil face à face, une table basse,
  // un canapé de dos qui regarde le feu), des bougies et des lampadaires ; à l'est, les quatre tables de jeu, une chaise de face au nord et une de dos au
  // sud (et aux deux bouts de celle des petits chevaux).
  at([
    ['ge-12-21', 61, 18], ['of-6-18', 62, 19], ['ba-2-33-m', 59, 19], ['ba-2-33', 65, 19], ['of-0-19', 62, 21],
    ['lr-12-9', 58, 17], ['lr-12-9', 79, 24], ['gy-7-12', 58, 26], ['gy-7-16', 60, 26],
  ]);
  table('ki-6-18', 68, 19, { north: 'ki-0-13', south: 'ki-0-12', cols: [69], tuck: 16 });
  table('ki-6-18', 73, 19, { north: 'ki-3-13', south: 'ki-1-12', cols: [74], tuck: 16 });
  table('ki-6-18', 68, 24, { north: 'ki-1-13', south: 'ki-0-11', cols: [69], tuck: 16 });
  table('ge-0-5', 73, 24, { north: 'ki-2-13', south: 'ki-1-11', west: 'ki-4-11', east: 'ki-5-13', cols: [74], tuck: 16 });
  props([['chimney', 63, 16], ['candle', 61, 17], ['candle', 66, 17], ['wall-candle', 59, 16], ['wall-candle', 72, 16], ['wall-candle', 77, 16], ['amplifier-big', 78, 17]]);
  at([['plante-grande', 76, 17, { offsetX: -4 }], ['grande-plante', 77, 27]]);

  // ---- La salle de sport : des miroirs au mur, trois tapis de course, des machines, un banc, des haltères, des ballons, des plantes.
  at([['gy-4-21', 40, 32], ['gy-4-21', 43, 32], ['gy-4-21', 46, 32], ['gy-4-21', 49, 32]]);
  props([['treadmill', 40, 34], ['treadmill', 42, 34], ['treadmill', 44, 34], ['amplifier-big', 56, 36]]);
  at([
    ['gy-11-1', 47, 34], ['gy-13-1', 50, 34], ['gy-14-8', 53, 34],
    ['gy-2-25', 44, 39], ['gy-0-14', 49, 43], ['gy-8-25', 53, 43], ['gy-15-0', 55, 41],
    ['gy-4-30', 47, 39], ['gy-10-30', 50, 39], ['gy-9-16', 53, 39],
    ['gy-7-2', 36, 43], ['gy-7-6', 38, 42],
  ]);
  at([['grande-plante', 55, 33], ['plante-grande', 35, 34], ['plante-bureau', 41, 43]]);

  // ---- La salle de boxe : le ring de l'octogone (tracé par le client) au milieu ; de chaque côté, un sac de frappe et un pouf ; au sud, des bancs pour
  // le public ; des plantes dans les coins, l'enceinte.
  props([['punching-bag-left', 59, 31], ['punching-bag-right', 77, 31], ['amplifier-big', 79, 39]]);
  at([['gy-7-14', 60, 36], ['gy-7-14', 76, 36]]);
  for (const x of [61, 64, 71, 74]) put('banc-jardin', x, 41);
  at([['grande-plante', 58, 43], ['plante-grande', 78, 43], ['plante-bureau', 78, 34, { offsetX: 8 }]]);
}

// Le jardin qui fait le tour du bâtiment, en cases de la carte. Du bâtiment vers le bord de la carte (la distance `d`) : une rangée de buissons fleuris
// contre la façade (d = 1), le chemin de dalles (d = 2 et 3), une rangée de buissons et de fleurs (d = 4), la haie (d = 5). Des arbres au sud et sur les
// côtés, de gros buissons au nord (le bord de la carte couperait une couronne), les jardinières du musée contre la façade sud, des bancs face au chemin,
// une allée de dalles de l'entrée au bord de la carte. Les deux angles ouverts ont leur jardin à eux, reliés au chemin par des pas japonais.
function plantGarden(c: MapCanvas): void {
  const W = OFFICE_WIDTH;
  const H = OFFICE_HEIGHT;
  const inRect = (x: number, y: number) => x >= B && x < B + BUILDING.w && y >= B && y < B + BUILDING.h;
  const inCorner = (x: number, y: number) => y >= B && y < B + CORNER_H && CORNERS.some((k) => x >= B + k.x0 && x <= B + k.x1);
  const isTerrace = (x: number, y: number) => inCorner(x, y) && y >= B + CORNER_GARDEN_H;
  const inBuilding = (x: number, y: number) => inRect(x, y) && (!inCorner(x, y) || isTerrace(x, y));
  // La distance d'une case du tour au bâtiment (0 dedans).
  const dist = (x: number, y: number) =>
    Math.max(x < B ? B - x : x >= B + BUILDING.w ? x - (B + BUILDING.w - 1) : 0, y < B ? B - y : y >= B + BUILDING.h ? y - (B + BUILDING.h - 1) : 0);
  const inAlley = (x: number, y: number) => y >= B + BUILDING.h && x >= ENTRANCE.x - 1 && x <= ENTRANCE.x + ENTRANCE.w;

  // Les pas japonais des jardins des angles (en cases du bâtiment) : de la terrasse au chemin du tour, et autour du massif du parterre.
  const stepping = new Set<string>();
  const step = (cells: ReadonlyArray<readonly [number, number]>) => cells.forEach(([x, y]) => stepping.add(`${B + x},${B + y}`));
  step([[6, 9], [6, 8], [6, 7], [5, 6], [5, 5], [5, 4], [6, 3], [6, 2], [6, 1], [6, 0], [6, -1], [4, 5], [3, 5], [2, 5], [1, 5], [0, 5], [-1, 5]]);
  step([[74, -1], [74, 0], [74, 1], [74, 7], [74, 8], [74, 9], [77, 4], [78, 4], [79, 4], [80, 4], [81, 4]]);
  for (let x = 72; x <= 76; x++) step([[x, 2], [x, 6]]);
  for (let y = 3; y <= 5; y++) step([[72, y], [76, y]]);
  const isPath = (x: number, y: number) => stepping.has(`${x},${y}`) || (!inRect(x, y) && (dist(x, y) === 2 || dist(x, y) === 3 || inAlley(x, y)));
  // Une case du tour qui borde un angle ouvert : on y plante moins, pour que le jardin de l'angle et celui du tour n'en fassent qu'un.
  const besideCorner = (x: number, y: number) =>
    (y === B - 1 && CORNERS.some((k) => x >= B + k.x0 - 1 && x <= B + k.x1 + 1)) || ((x === B - 1 || x === B + BUILDING.w) && y >= B && y < B + CORNER_H);

  // ---- Le sol : l'herbe (piquée de fleurs le long de la façade), les dalles du chemin, le bois des terrasses (posé avec le bâtiment).
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (inBuilding(x, y)) continue;
      const h = cellHash(x, y);
      const d = dist(x, y);
      let ground: GardenGround = 'grass';
      if (isPath(x, y)) ground = 'slab';
      else if (inCorner(x, y)) ground = h % 4 === 0 ? 'meadow' : 'grass';
      else if (d === 1) ground = 'flowers';
      else if (d === 4 && h % 3 === 0) ground = 'meadow';
      c.ground(x, y, ground);
    }
  }

  // ---- Ce qui pousse : on retient les cases prises, pour ne rien poser deux fois au même endroit.
  const taken = new Set<string>();
  const take = (x: number, y: number, w = 1, h = 1) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) taken.add(`${x + i},${y + j}`);
  };
  const put = (id: string, x: number, y: number, nudge: { offsetX?: number; offsetY?: number } = {}) => {
    const item = decorItem(id)!;
    c.put(id, x, y, nudge);
    take(x, y, item.w, item.claim);
  };
  // Les buissons : nus, ou fleuris de l'une des trois couleurs ; plusieurs tirages de chacun.
  const FLOWERED = ['rose', 'jaune', 'lilas'] as const;
  const bush = (h: number, flowers?: number) => (flowers === undefined ? `buisson-${1 + (h % 3)}` : `buisson-${FLOWERED[flowers % 3]}-${1 + (h % 2)}`);
  const bigBush = (h: number, flowers?: number) => (flowers === undefined ? `gros-buisson-${1 + (h % 2)}` : `gros-buisson-${FLOWERED[flowers % 3]}`);
  // Une touffe de fleurs, un peu décalée dans sa case.
  const flower = (x: number, y: number, h: number) => put(`fleur-${[1, 2, 3, 1][h % 4]}`, x, y, { offsetX: (h % 7) - 2, offsetY: -3 });

  // Les arbres, au sud et sur les côtés : leur couronne fait trois cases ; elle arrête l'avatar, sauf au-dessus du chemin, qu'elle ombrage sans le couper.
  for (const [x, y] of [
    [1, H - 2], [W - 2, H - 2], [12, H - 2], [24, H - 2], [47, H - 2], [62, H - 2], [77, H - 2],
    [1, 9], [1, 21], [1, 33], [1, 45], [W - 2, 9], [W - 2, 21], [W - 2, 33], [W - 2, 45],
  ] as const) {
    c.put(`arbre-${1 + (cellHash(x, y) % 4)}`, x - 1, y, { offsetY: 10 });
    for (const cx of [x - 1, x, x + 1]) if (!isPath(cx, y)) c.block(cx, y, 1, 1);
    take(x - 1, y, 3);
  }
  // De gros buissons au nord, un sur deux fleuri ; sur les côtés, entre les arbres.
  for (let x = 1; x < W - 2; x += 5) put(bigBush(cellHash(x, 1), x % 2 ? Math.floor(x / 5) : undefined), x, 1);
  for (const y of [4, 15, 27, 39]) {
    put(bigBush(cellHash(0, y), y), 0, y);
    put(bigBush(cellHash(W - 2, y), y + 1), W - 2, y);
  }
  // Contre la façade sud, les jardinières (comme sur la référence) ; des bancs face au chemin.
  const planters = ['jardiniere-1', 'jardiniere-3', 'jardiniere-2', 'jardiniere-5', 'jardiniere-4', 'jardiniere-6'];
  [1, 5, 9, 13, 17, 21, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77].forEach((x, i) => put(planters[i % planters.length]!, B + x, B + BUILDING.h, { offsetY: -2 }));
  for (const x of [2, 14, 35, 49, 64]) put('banc-jardin', B + x, B + BUILDING.h + 3);
  // Le paillasson devant l'entrée, sur l'allée.
  put('paillasson-entree', ENTRANCE.x, B + BUILDING.h);

  // ---- Le jardin de l'angle ouest : un jardin naturel. Le bassin bordé de pierres, ses nénuphars et ses roseaux, un banc qui le regarde, trois massifs de
  // fleurs, un gros buisson, des buissons le long du mur du bureau voisin, quelques fleurs.
  const local = (x: number, y: number): [number, number] => [B + x, B + y];
  put('bassin', OFFICE_POND.x, OFFICE_POND.y);
  put('roseaux', ...local(7, 4), { offsetX: 11 });
  put('roseaux', ...local(7, 6), { offsetX: 13, offsetY: -4 });
  put('roseaux', ...local(11, 6), { offsetX: 15, offsetY: -2 });
  put('banc-jardin', ...local(8, 8));
  put('massif-1', ...local(0, 0));
  put('massif-jaune', ...local(8, 0));
  put('massif-rond-lilas', ...local(0, 7));
  put('gros-buisson-rose', ...local(3, 8));
  for (let y = 0; y <= 9; y++) put(bush(cellHash(y, 12), y % 3 === 1 ? 1 : undefined), ...local(12, y));
  for (const [x, y] of [[4, 1], [7, 2], [3, 3], [9, 3], [11, 8], [4, 9], [1, 6], [7, 9], [10, 9]] as const) flower(...local(x, y), cellHash(x, y));

  // ---- Le jardin de l'angle est : un parterre à la française. Un massif rond au centre et son buisson taillé, une allée de pas japonais en carré
  // autour, quatre massifs aux angles, un banc à l'ouest, des buissons le long du mur du bureau voisin, quelques fleurs.
  put('massif-rond-rouge', ...local(73, 3));
  c.put('buisson-taille', ...local(74, 4), { offsetY: 6 });
  put('massif-rose-1', ...local(69, 0));
  put('massif-rose-2', ...local(77, 0));
  put('massif-or-1', ...local(69, 6));
  put('massif-or-2', ...local(77, 6));
  put('banc-jardin', ...local(69, 4));
  for (let y = 0; y <= 9; y++) put(bush(cellHash(y, 68), y % 3 === 2 ? 1 : undefined), ...local(68, y));
  for (const [x, y] of [[72, 0], [76, 0], [72, 8], [76, 8], [80, 1], [80, 7], [79, 9], [71, 4]] as const) flower(...local(x, y), cellHash(x, y));

  // ---- Le tour : la haie au bord de la carte, des buissons fleuris contre la façade, des buissons et des fleurs sur la rangée du bord du chemin.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (inBuilding(x, y) || isPath(x, y) || inCorner(x, y) || taken.has(`${x},${y}`)) continue;
      const d = dist(x, y);
      const h = cellHash(x, y);
      if (d === 5) put(y === 0 || y === H - 1 ? `haie-${1 + (h % 3)}` : `haie-cote-${1 + (h % 3)}`, x, y);
      else if (d === 1 && besideCorner(x, y)) {
        if (h % 4 === 0) put(bush(h, h % 3), x, y);
        else if (h % 4 === 1) flower(x, y, h);
      } else if (d === 1) {
        if (h % 5 !== 0) put(bush(h, h % 3 === 0 ? undefined : h % 3), x, y);
        else flower(x, y, h);
      } else if (d === 4) {
        if (h % 3 === 0) put(bush(h, h % 2 === 0 ? h % 3 : undefined), x, y);
        else if (h % 3 === 1) flower(x, y, h);
      }
    }
  }
}

// La carte telle que le serveur la charge, et son plan pour les tests.
export const OFFICE: { ascii: string[]; zones: ZoneInput[] } = (() => {
  const { ascii, zones } = buildOffice();
  return { ascii, zones };
})();

export function buildOfficeTiledMap(): TiledMapJson {
  return buildOffice().canvas.toTiled();
}
