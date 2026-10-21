import { DESK_ROOM } from '../decor/placement';
import { DEFAULT_FLOOR_THEME, DEFAULT_WALL_THEME } from '../decor/themes';
import type { ZoneInput } from './build-tiled';
import { MapCanvas } from './builder';
import type { TiledMapJson } from './tiled-types';

// La carte du bureau : 66 × 47 cases, dessinée par code (et non à la main) : les bureaux se répètent, et leur nombre, leur taille et leurs
// portes doivent rester cohérents. Les murs horizontaux font 2 cases de haut, les verticaux 1.
//
//   y  0 ┌ 6 bureaux de 9 × 7 cases, chacun avec sa porte au sud (bandes de mur y 0-1 et 9-10) ────────────────────────┐
//   y 11 ├ couloir (y 11 à 13), puis la place centrale : café, coins de conversation ──────────────────────────────────┤
//   y 14 ├ salle de réunion (14 × 10) │ place centrale │ grande salle (17 × 10) ──────────────────────────────────────────┤
//   y 31 ├ zone détente (42 × 12) : piscine, transats, salon, coin musique │ accueil (point d'apparition) ───────────────┤
//   y 46 └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
//
// Les 6 places ont pour clé A1 à A6, écrite dans le nom des deux zones (la pièce `desk` et sa porte `door`) : c'est ce qui les relie, et ce qui
// désigne la place dans la base.
export const OFFICE_WIDTH = 66;
export const OFFICE_HEIGHT = 47;

// Une place de bureau : sa clé, la pièce (en cases) et la porte (en cases, 2 × 2 : elle perce la bande de mur du sud).
export interface OfficeDeskSlot {
  key: string;
  room: { x: number; y: number; w: number; h: number };
  door: { x: number; y: number; w: number; h: number };
  // Les cases de mur qui entourent la pièce, pour que le client les repeigne au thème de son occupant.
  walls: Array<{ x: number; y: number; part: 'top' | 'bottom' | 'stem' }>;
}

const SLOT_PITCH = DESK_ROOM.width + 2;   // une pièce, avec ses deux pans de mur
const ROOM_Y = 2;
const SOUTH_BAND_Y = ROOM_Y + DESK_ROOM.height;   // 9 : la bande de mur du sud, 2 cases de haut

function deskSlot(index: number): OfficeDeskSlot {
  const x0 = SLOT_PITCH * index;
  const door = { x: x0 + 1 + DESK_ROOM.doorX, y: SOUTH_BAND_Y, w: DESK_ROOM.doorWidth, h: 2 };
  const walls: OfficeDeskSlot['walls'] = [];
  for (let x = x0; x < x0 + SLOT_PITCH; x++) {
    walls.push({ x, y: 0, part: 'top' }, { x, y: 1, part: 'bottom' });
    const inDoor = x >= door.x && x < door.x + door.w;
    if (!inDoor) walls.push({ x, y: SOUTH_BAND_Y, part: 'top' }, { x, y: SOUTH_BAND_Y + 1, part: 'bottom' });
  }
  for (let y = ROOM_Y; y < SOUTH_BAND_Y; y++) walls.push({ x: x0, y, part: 'stem' }, { x: x0 + SLOT_PITCH - 1, y, part: 'stem' });
  return { key: `A${index + 1}`, room: { x: x0 + 1, y: ROOM_Y, w: DESK_ROOM.width, h: DESK_ROOM.height }, door, walls };
}

export const OFFICE_DESK_SLOTS: OfficeDeskSlot[] = Array.from({ length: 6 }, (_, index) => deskSlot(index));

export const OFFICE_SPAWN = { x: 54, y: 41 };
export const MEETING_ROOM = { x: 1, y: 16, w: 14, h: 10 };
export const GRAND_HALL = { x: 48, y: 16, w: 17, h: 10 };
export const LOUNGE = { x: 1, y: 33, w: 42, h: 12 };
export const POOL = { x: 3, y: 36, w: 14, h: 5 };
// La place centrale, entre la salle de réunion et la grande salle, du couloir jusqu'à la zone détente (arche comprise) : le café et les
// coins de conversation.
export const PLAZA = { x: 16, y: 14, w: 31, h: 19 };
// La zone détente se lit d'ouest en est en trois bandes : la terrasse de la piscine (sa largeur, en cases), le salon, puis le coin
// musique (à partir de cette colonne).
export const LOUNGE_TERRACE_WIDTH = 18;
export const LOUNGE_MUSIC_X = 33;

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
  c.floor(0, 11, W, 36, 'gris');                      // couloir, place centrale, accueil
  c.floor(0, 0, W, 11, DEFAULT_FLOOR_THEME);         // les six pièces (les occupants repeignent la leur)
  c.floor(1, 16, 14, 10, 'lilas');                   // salle de réunion
  c.floor(48, 16, 17, 10, 'noyer');                  // grande salle
  c.floor(18, 17, 12, 8, 'damier');                  // le café
  c.floor(44, 33, 21, 12, 'marbre');                 // l'accueil
  c.floor(1, 33, 42, 12, 'parquet-brun');            // la zone détente
  c.floor(LOUNGE.x, LOUNGE.y, LOUNGE_TERRACE_WIDTH, LOUNGE.h, 'pierre');   // la terrasse de la piscine

  // ---- Les murs -------------------------------------------------------------------------------------------------------------
  // Le pourtour : le mur du nord et celui du sud sont des bandes, ceux de l'ouest et de l'est des pans.
  c.vWall(0, 2, H - 3, OUTER_WALL);
  c.vWall(W - 1, 2, H - 3, OUTER_WALL);
  c.hWall(0, W - 1, H - 2, OUTER_WALL);

  // Les six bureaux : chacun ses murs (les occupants les repeignent), et sa porte percée dans la bande du sud.
  for (const slot of OFFICE_DESK_SLOTS) {
    for (const wall of slot.walls) {
      if (wall.part === 'stem') c.vWall(wall.x, wall.y, wall.y, DEFAULT_WALL_THEME);
      else if (wall.part === 'top') c.hWall(wall.x, wall.x, wall.y, DEFAULT_WALL_THEME);
    }
  }
  c.hWall(0, W - 1, 0, DEFAULT_WALL_THEME);
  for (const slot of OFFICE_DESK_SLOTS) c.floor(slot.door.x, slot.door.y, slot.door.w, slot.door.h, 'gris');

  // La salle de réunion : bande au nord (sa porte, 2 cases), bande au sud, pan à l'est.
  const m = MEETING_ROOM;
  c.hWall(0, m.x + m.w, m.y - 2, 'bleu-ciel');
  c.hWall(0, m.x + m.w, m.y + m.h, 'bleu-ciel');
  c.vWall(m.x + m.w, m.y, m.y + m.h - 1, 'bleu-ciel');
  c.open(7, m.y - 2, 2, 2);

  // La grande salle : bandes au nord et au sud, pan à l'ouest (une porte de 3 cases).
  const g = GRAND_HALL;
  c.hWall(g.x - 1, W - 1, g.y - 2, 'bois-sombre');
  c.hWall(g.x - 1, W - 1, g.y + g.h, 'bois-sombre');
  c.vWall(g.x - 1, g.y, g.y + g.h - 1, 'bois-sombre');
  c.open(g.x - 1, g.y + 3, 1, 3);

  // La zone détente : bande au nord (une arche de 4 cases), pan à l'est (une arche de 5 cases vers l'accueil).
  const l = LOUNGE;
  c.hWall(0, l.x + l.w, l.y - 2, 'menthe');
  c.vWall(l.x + l.w, l.y, l.y + l.h - 1, 'menthe');
  c.open(17, l.y - 2, 4, 2);
  c.open(l.x + l.w, 36, 1, 5);
  for (const [x, y, w, h] of [[17, l.y - 2, 4, 2], [l.x + l.w, 36, 1, 5]] as const) c.floor(x, y, w, h, 'gris');

  // La piscine.
  c.pool(POOL.x, POOL.y, POOL.w, POOL.h);

  furnish(c);

  // ---- Les zones ------------------------------------------------------------------------------------------------------------
  c.zone({ type: 'spawn', x: OFFICE_SPAWN.x, y: OFFICE_SPAWN.y, w: 1, h: 1 });
  c.zone({ type: 'private', name: 'Zone détente', x: l.x, y: l.y, w: l.w, h: l.h });
  c.zone({ type: 'private', name: 'Grande salle', x: g.x, y: g.y, w: g.w, h: g.h });
  c.zone({ type: 'private', name: 'Salle de réunion', x: m.x, y: m.y, w: m.w, h: m.h });
  for (const slot of OFFICE_DESK_SLOTS) {
    c.zone({ type: 'desk', name: slot.key, x: slot.room.x, y: slot.room.y, w: slot.room.w, h: slot.room.h });
    c.zone({ type: 'door', name: slot.key, x: slot.door.x, y: slot.door.y, w: slot.door.w, h: slot.door.h });
  }
  c.zone({ type: 'label', text: 'SALLE DE RÉUNION', x: 2, y: 24, w: 12, h: 1 });
  c.zone({ type: 'label', text: 'GRANDE SALLE', x: 52, y: 25, w: 9, h: 1 });
  c.zone({ type: 'label', text: 'PISCINE', x: 4, y: 38, w: 12, h: 1 });
  c.zone({ type: 'label', text: 'ZONE DÉTENTE', x: 22, y: 43, w: 14, h: 1 });
  c.zone({ type: 'label', text: 'CAFÉ', x: 18, y: 24, w: 12, h: 1 });
  c.zone({ type: 'label', text: 'ACCUEIL', x: 47, y: 44, w: 14, h: 1 });
  // L'interrupteur de la lumière : sur la face du mur nord du couloir (la rangée y 10, que l'on voit du couloir), au milieu de l'espace entre les
  // portes des bureaux A3 et A4 (cases 26-27 et 37-38). Le client y pose la plaque. En dernier : les numéros des autres zones ne changent pas.
  c.zone({ type: 'switch', x: 32, y: 10, w: 1, h: 1 });

  return { canvas: c, ascii: c.ascii(), zones: c.zones };
}

// Le mobilier de la carte : des éléments de la banque (packages/shared/src/decor), posés par la case de leur coin haut-gauche. Les bureaux
// n'en ont pas ici : leur déco est celle de leur occupant (DeskInfo), dessinée par le client. Un élément mural se pose à la case de la
// pièce qu'il surplombe.
function furnish(c: MapCanvas): void {
  const m = MEETING_ROOM;
  const g = GRAND_HALL;
  const l = LOUNGE;
  const at = (items: ReadonlyArray<readonly [string, number, number]>) => {
    for (const [id, x, y] of items) c.put(id, x, y);
  };

  // Le couloir : des plantes entre les portes des bureaux, des fontaines à eau (jamais dans l'axe d'une porte : elles la masqueraient).
  at([
    ['lr-12-0', 1, 12], ['lr-12-0', 10, 12], ['lr-12-0', 21, 12], ['lr-12-0', 32, 12], ['lr-12-0', 43, 12], ['lr-12-0', 54, 12], ['lr-12-0', 64, 12],
    ['of-12-15', 12, 12], ['of-12-15', 46, 12],
  ]);

  // La salle de réunion : l'écran et les tableaux au mur, la grande table (4 × 2 cases au sol, au milieu de la salle), et dix chaises
  // autour : quatre au nord, qui regardent la table, quatre au sud, vues de dos, une à chaque bout, de profil. Les chaises touchent la table.
  at([['of-9-12', 2, m.y], ['of-9-14', 4, m.y], ['tv-10-3', 10, m.y], ['cf-0-1', 6, 20]]);
  for (const x of [6, 7, 8, 9]) at([['of-2-8', x, 19], ['of-0-8', x, 22]]);
  at([['of-5-8', 5, 21], ['of-4-8', 10, 21], ['of-6-7', 1, 23], ['of-6-7', 13, 23], ['lr-12-9', 12, 19], ['lr-12-9', 2, 19]]);

  // La grande salle : l'écran, deux tableaux, un pupitre, trois rangées de chaises tournées vers l'écran.
  at([['tv-10-3', 53, g.y], ['of-9-12', 49, g.y], ['of-9-14', 61, g.y], ['cl-14-14', 55, 17]]);
  for (const y of [20, 22, 24]) for (let x = 50; x <= 62; x += 2) c.put('ki-4-13', x, y);
  at([['lr-13-21', 48, 23], ['lr-13-21', 63, 17]]);

  // La place centrale : le café (un îlot, des tabourets), deux coins de conversation, des plantes.
  at([
    ['ki-9-23', 20, 18], ['ki-10-23', 21, 18], ['of-0-23', 22, 18], ['of-2-23', 24, 18], ['of-4-24', 26, 18],
    ['of-8-38', 20, 20], ['of-10-38', 22, 20], ['of-12-38', 24, 20],
    ['tv-14-1', 20, 22], ['tv-14-1', 22, 22], ['tv-14-1', 24, 22], ['tv-14-1', 26, 22],
    ['of-12-15', 18, 18],
  ]);
  for (const [x, y] of [[33, 18], [38, 18], [33, 24], [38, 24]] as const) {
    at([['ki-9-13', x, y], ['ki-7-11', x - 1, y], ['ki-4-11', x + 2, y], ['ki-6-13', x, y - 1]]);
  }
  at([['lr-13-0', 17, 15], ['lr-13-0', 45, 15], ['lr-13-0', 17, 29], ['lr-13-0', 45, 29], ['lr-10-0', 31, 27], ['lr-10-0', 32, 15]]);
  at([['of-2-17', 21, 27], ['of-6-18', 25, 28], ['of-2-20', 36, 26], ['of-6-18', 34, 28], ['lr-12-9', 20, 26], ['lr-12-9', 40, 26]]);

  // L'accueil : le comptoir et son poste, un coin d'attente, un tapis sous le point d'apparition.
  at([
    ['cf-0-8', 52, 40],
    ['cf-8-4', 52, 35], ['of-14-28', 53, 35],
    ['lr-12-9', 51, 36], ['lr-12-9', 56, 36],
    ['lr-1-28', 46, 40], ['of-6-18', 47, 43], ['lr-13-21', 45, 34], ['lr-13-21', 62, 41], ['cl-0-13', 60, 34],
    ['of-0-17', 57, 43], ['of-6-18', 60, 43], ['lr-13-21', 62, 36], ['lr-12-20', 49, 43],
  ]);

  // La zone détente : la piscine et ses transats, puis le salon (télévision, bibliothèque, cheminée), et le coin musique.
  at([
    ['fi-12-16', 3, 34], ['fi-0-19', 8, 34], ['fi-4-19', 13, 34],
    ['fi-8-19', 3, 42], ['fi-12-19', 8, 42], ['fi-4-22', 13, 42],
    ['lr-13-0', 1, 34], ['lr-13-0', 1, 42], ['lr-13-0', 17, 36], ['lr-13-0', 17, 40],
  ]);
  at([
    ['cl-0-13', 21, l.y], ['cl-6-13', 24, l.y], ['tv-10-1', 28, l.y], ['lr-4-24', 33, l.y], ['cl-8-13', 36, l.y], ['cl-4-13', 38, l.y], ['lr-12-0', 41, l.y],
    ['cf-0-8', 26, 37], ['of-6-18', 27, 38], ['of-0-19', 27, 41], ['tv-5-3', 24, 38], ['tv-7-5', 30, 38],
    ['lr-12-9', 23, 36], ['lr-12-9', 32, 36], ['tv-15-1', 23, 41], ['tv-15-2', 31, 41],
    ['lr-13-21', 19, 43], ['lr-12-20', 41, 43],
  ]);
  at([
    ['ms-2-12', 38, 36], ['ms-2-4', 38, 39],
    ['ms-0-18', 34, 42], ['ms-6-0', 38, 43], ['ms-7-2', 37, 41], ['ms-10-2', 40, 41], ['ms-6-15', 33, 41],
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
