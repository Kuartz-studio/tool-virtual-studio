import type { ZoneInput } from './build-tiled';

// La carte du bureau : 73 × 39 cases. Légende de l'ASCII : `#` mur (bloquant), `.` sol, `T` meuble (bloquant). Elle est écrite par
// code (et non à la main) : les bureaux se répètent, et leur nombre, leur taille et leurs portes doivent rester cohérents.
//
//   y  0 ┌ rangée A : 8 bureaux (4 à l'ouest, 4 à l'est), portes au sud ───────────────────────────────┐
//   y  6 ├──────────────────────────────  allée nord (y 7 à 9)  ──────────────────────────────────────┤
//   y 10 ├ rangée B : 8 bureaux, portes au nord ─────────────────────────────────────────────────────┤
//   y 16 ├ salle de réunion (13 × 7) │ détente, café, arcade (espace ouvert) │ GRANDE SALLE (23 × 13) ┤
//   y 32 ├ rangée C : 4 bureaux, portes au nord │ colonne centrale │ accueil, point d'apparition ─────┤
//   y 38 └──────────────────────────────────────────────────────────────────────────────────────────┘
//
// Une colonne centrale (x 33 à 39) relie tout de haut en bas. Chaque bureau est une pièce de 7 × 5 cases, fermée par des murs, avec une
// porte de 2 cases : la zone `desk` en couvre l'intérieur, la zone `door` le passage. Les 20 places ont pour clé A1 à A8, B1 à B8 et C1 à
// C4, écrite dans le nom des deux zones : c'est ce qui les relie, et ce qui désigne la place dans la base.
export const OFFICE_WIDTH = 73;
export const OFFICE_HEIGHT = 39;

// Une place de bureau : sa clé, la pièce (en cases) et la porte (en cases), et de quel côté s'ouvre la porte.
export interface OfficeDeskSlot {
  key: string;
  room: { x: number; y: number; w: number; h: number };
  door: { x: number; y: number; w: number; h: number };
  side: 'north' | 'south';
}

const ROOM_WIDTH = 7;   // d'un mur à l'autre, il y a 1 mur + 7 cases de pièce : un bureau tous les 8 x
const ROOM_HEIGHT = 5;
const WEST_WALLS = [0, 8, 16, 24];   // le mur ouest de chaque bureau de l'ouest ; le dernier est suivi du mur est, x 32
const EAST_WALLS = [40, 48, 56, 64];

// Les bureaux d'une rangée : y0 est le premier rang de la pièce ; `side` dit de quel côté est la porte (au sud : mur du bas de la
// pièce ; au nord : mur du haut).
function rowSlots(prefix: string, y0: number, side: 'north' | 'south', walls: number[]): OfficeDeskSlot[] {
  return walls.map((wall, i) => {
    const x = wall + 1;
    return {
      key: `${prefix}${walls === WEST_WALLS ? i + 1 : i + 1 + WEST_WALLS.length}`,
      room: { x, y: y0, w: ROOM_WIDTH, h: ROOM_HEIGHT },
      door: { x: wall + 3, y: side === 'south' ? y0 + ROOM_HEIGHT : y0 - 1, w: 2, h: 1 },
      side,
    };
  });
}

export const OFFICE_DESK_SLOTS: OfficeDeskSlot[] = [
  ...rowSlots('A', 1, 'south', WEST_WALLS),
  ...rowSlots('A', 1, 'south', EAST_WALLS),
  ...rowSlots('B', 11, 'north', WEST_WALLS),
  ...rowSlots('B', 11, 'north', EAST_WALLS),
  ...rowSlots('C', 33, 'north', WEST_WALLS),
];

export const OFFICE_SPAWN = { x: 48, y: 36 };
export const GRAND_HALL = { x: 49, y: 19, w: 23, h: 13 };
export const MEETING_ROOM = { x: 1, y: 17, w: 13, h: 7 };

export function buildOffice(): { ascii: string[]; zones: ZoneInput[] } {
  const grid: string[][] = Array.from({ length: OFFICE_HEIGHT }, () => Array.from({ length: OFFICE_WIDTH }, () => '.'));
  const set = (x: number, y: number, ch: string) => {
    grid[y]![x] = ch;
  };
  const hLine = (y: number, x0: number, x1: number, ch = '#') => {
    for (let x = x0; x <= x1; x++) set(x, y, ch);
  };
  const vLine = (x: number, y0: number, y1: number, ch = '#') => {
    for (let y = y0; y <= y1; y++) set(x, y, ch);
  };
  const block = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy++) hLine(yy, x, x + w - 1, 'T');
  };

  // Les murs extérieurs.
  hLine(0, 0, OFFICE_WIDTH - 1);
  hLine(OFFICE_HEIGHT - 1, 0, OFFICE_WIDTH - 1);
  vLine(0, 0, OFFICE_HEIGHT - 1);
  vLine(OFFICE_WIDTH - 1, 0, OFFICE_HEIGHT - 1);

  // Les bureaux : murs de séparation, mur de la porte (percé), mur du fond, et un bureau de travail au fond de la pièce.
  for (const slot of OFFICE_DESK_SLOTS) {
    const { room, door, side } = slot;
    vLine(room.x - 1, room.y - (side === 'north' ? 1 : 0), room.y + room.h - (side === 'south' ? 0 : 1));
    vLine(room.x + room.w, room.y - (side === 'north' ? 1 : 0), room.y + room.h - (side === 'south' ? 0 : 1));
    const doorWallY = door.y;
    hLine(doorWallY, room.x - 1, room.x + room.w);
    for (let x = door.x; x < door.x + door.w; x++) set(x, doorWallY, '.');
    const backWallY = side === 'south' ? room.y - 1 : room.y + room.h;
    hLine(backWallY, room.x - 1, room.x + room.w);
    // Le bureau de travail, côté du fond : 3 cases sur 1, au milieu.
    block(room.x + 2, side === 'south' ? room.y + 1 : room.y + room.h - 2, 3, 1);
  }
  // La colonne centrale (x 33 à 39) n'a aucun mur : les bureaux de l'ouest finissent à x 32, ceux de l'est commencent à x 40.

  // La salle de réunion (13 × 7), en haut à gauche de l'espace ouvert : murs est et sud, porte au sud. Son mur nord est celui du bas de
  // la rangée B (y 16).
  const m = MEETING_ROOM;
  vLine(m.x + m.w, m.y - 1, m.y + m.h);
  hLine(m.y + m.h, 0, m.x + m.w);
  hLine(m.y + m.h, 6, 8, '.');
  block(m.x + 4, m.y + 2, 5, 2);   // la table

  // La grande salle (23 × 13), à l'est de l'espace ouvert : murs nord, ouest et sud, deux portes de 3 cases à l'ouest.
  const g = GRAND_HALL;
  hLine(g.y - 1, g.x - 1, OFFICE_WIDTH - 1);
  hLine(g.y + g.h, g.x - 1, OFFICE_WIDTH - 1);
  vLine(g.x - 1, g.y - 1, g.y + g.h);
  vLine(g.x - 1, g.y + 2, g.y + 4, '.');
  vLine(g.x - 1, g.y + 8, g.y + 10, '.');
  block(g.x + 5, g.y + 5, 13, 3);   // la grande table

  // Le décor de l'espace ouvert : détente, café, arcade, accueil.
  block(3, 29, 7, 1);    // canapés
  block(5, 26, 2, 1);    // table basse
  block(17, 28, 7, 1);   // comptoir du café
  block(19, 25, 2, 1);
  block(25, 20, 2, 2);   // borne d'arcade
  block(54, 35, 4, 1);   // comptoir d'accueil
  block(41, 34, 1, 1);   // plantes
  block(70, 34, 1, 1);

  const zones: ZoneInput[] = [
    { type: 'spawn', x: OFFICE_SPAWN.x, y: OFFICE_SPAWN.y, w: 1, h: 1 },
    { type: 'private', name: 'Grande salle', x: g.x, y: g.y, w: g.w, h: g.h },
    { type: 'private', name: 'Salle de réunion', x: m.x, y: m.y, w: m.w, h: m.h },
    ...OFFICE_DESK_SLOTS.flatMap((slot): ZoneInput[] => [
      { type: 'desk', name: slot.key, x: slot.room.x, y: slot.room.y, w: slot.room.w, h: slot.room.h },
      { type: 'door', name: slot.key, x: slot.door.x, y: slot.door.y, w: slot.door.w, h: slot.door.h },
    ]),
    { type: 'label', text: 'GRANDE SALLE', x: g.x + 3, y: g.y + 1, w: 17, h: 1 },
    { type: 'label', text: 'SALLE DE RÉUNION', x: m.x + 1, y: m.y + 1, w: 11, h: 1 },
    { type: 'label', text: 'DÉTENTE', x: 3, y: 27, w: 7, h: 1 },
    { type: 'label', text: 'CAFÉ', x: 17, y: 26, w: 7, h: 1 },
    { type: 'label', text: 'ARCADE', x: 23, y: 19, w: 6, h: 1 },
    { type: 'label', text: 'ACCUEIL', x: 44, y: 34, w: 8, h: 1 },
  ];

  return { ascii: grid.map((row) => row.join('')), zones };
}

export const OFFICE: { ascii: string[]; zones: ZoneInput[] } = buildOffice();
