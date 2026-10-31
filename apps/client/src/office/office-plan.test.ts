import { buildOfficeTiledMap, parseOfficeMap, type DeskInfo } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { labelLines, labelSize, outsideCells, planRooms, planSite, planTables, toMapPoint } from './office-plan';

// La largeur d'une lettre des noms, en hauteurs de police (office-plan.ts, CHAR_WIDTH_EM).
const CHAR_WIDTH = 0.6;

// La vraie carte : 91 × 56 cases, ses lieux (zones `place`, le jardin compris) et ses six bureaux.
const office = parseOfficeMap(buildOfficeTiledMap());

const desk = (key: string, patch: Partial<DeskInfo> = {}): DeskInfo => ({
  key,
  ownerId: null,
  ownerName: null,
  name: null,
  locked: false,
  closedByState: false,
  floor: 'wood',
  wall: 'cream',
  items: [],
  ...patch,
});

describe('labelLines', () => {
  test('en capitales, sur une ligne jusqu\'à 12 lettres', () => {
    expect(labelLines('Café')).toEqual(['CAFÉ']);
    expect(labelLines('Octogone')).toEqual(['OCTOGONE']);
  });

  test('plus long : deux lignes, coupées entre deux mots pour que la plus longue soit la plus courte possible', () => {
    expect(labelLines('Salle de conférence')).toEqual(['SALLE DE', 'CONFÉRENCE']);
    expect(labelLines('Détente et piscine')).toEqual(['DÉTENTE', 'ET PISCINE']);
    expect(labelLines('Bureau de Andréa')).toEqual(['BUREAU', 'DE ANDRÉA']);
  });

  test('un seul long mot reste sur une ligne', () => {
    expect(labelLines('Anticonstitutionnellement')).toEqual(['ANTICONSTITUTIONNELLEMENT']);
  });
});

describe('labelSize', () => {
  test('tient en largeur et en hauteur, jamais plus de 48 px de carte', () => {
    expect(labelSize(['CAFÉ'], { width: 5000, height: 5000 })).toBe(48);
    const narrow = labelSize(['SALLE DE RÉUNION'], { width: 200, height: 400 });
    expect(narrow * 16 * CHAR_WIDTH).toBeLessThanOrEqual(200 * 0.8 + 1e-9);
    const flat = labelSize(['A', 'B'], { width: 400, height: 50 });
    expect(flat).toBeLessThan(10);
  });
});

describe('planRooms', () => {
  const rooms = planRooms(office, []);
  const byKey = (key: string) => rooms.find((room) => room.key === key)!;
  const right = (key: string) => byKey(key).rect.x + byKey(key).rect.width;

  test('rien d\'imbriqué, ni couloir ni dehors : les espaces ouverts, puis les pièces, puis les bureaux', () => {
    expect(rooms.some((room) => room.kind === 'street' || room.kind === 'outside')).toBe(false);
    const order = { outside: 0, street: 0, open: 1, room: 2, desk: 3 };
    for (let i = 1; i < rooms.length; i++) expect(order[rooms[i]!.kind]).toBeGreaterThanOrEqual(order[rooms[i - 1]!.kind]);
    expect(byKey('cafe').lines).toEqual(['CAFÉTÉRIA']);
    expect(rooms.filter((room) => room.kind === 'desk').map((room) => room.key)).toEqual(['desk:A1', 'desk:A2', 'desk:A3', 'desk:A4', 'desk:A5', 'desk:A6']);
    for (const a of rooms) for (const b of rooms) if (a !== b) expect(a.rect.x >= b.rect.x && a.rect.x + a.rect.width <= b.rect.x + b.rect.width && a.rect.y >= b.rect.y && a.rect.y + a.rect.height <= b.rect.y + b.rect.height, `${a.key} dans ${b.key}`).toBe(false);
  });

  test('les pièces s\'étendent dans leurs murs : deux voisines se touchent au milieu du mur, une rangée va d\'un seul tenant', () => {
    expect(right('desk:A5')).toBe(byKey('desk:A1').rect.x);
    expect(right('desk:A1')).toBe(byKey('desk:A2').rect.x);
    expect(right('desk:A4')).toBe(byKey('desk:A6').rect.x);
    expect(right('conference')).toBe(byKey('cafe').rect.x);
    expect(right('cafe')).toBe(byKey('game').rect.x);
    expect(right('gym')).toBe(byKey('arena').rect.x);
    // La rangée des bureaux s'étend dans son mur du nord (la pièce commence à la rangée 7), d'un seul tenant : la même hauteur d'un bout à l'autre.
    expect(byKey('desk:A1').rect.y).toBeLessThan(7 * 32);
    for (const key of ['desk:A2', 'desk:A3', 'desk:A4', 'desk:A5', 'desk:A6']) expect(byKey(key).rect).toMatchObject({ y: byKey('desk:A1').rect.y, height: byKey('desk:A1').rect.height });
  });

  test('jamais dans le jardin, ni l\'une sur l\'autre : les pièces s\'arrêtent au mur du dehors, et celles qui se partagent un mur s\'y rejoignent', () => {
    const outside = outsideCells(office);
    for (const room of rooms) {
      for (let y = room.rect.y; y < room.rect.y + room.rect.height; y += 16) {
        for (let x = room.rect.x; x < room.rect.x + room.rect.width; x += 16) expect(outside[Math.floor(y / 32) * office.widthTiles + Math.floor(x / 32)], `${room.key} en (${x}, ${y})`).toBe(0);
      }
    }
    for (const a of rooms) {
      for (const b of rooms) {
        const overlap = a !== b && a.rect.x < b.rect.x + b.rect.width && b.rect.x < a.rect.x + a.rect.width && a.rect.y < b.rect.y + b.rect.height && b.rect.y < a.rect.y + a.rect.height;
        expect(overlap, `${a.key} sur ${b.key}`).toBe(false);
      }
    }
    // La salle de sport sous la cafétéria, l'accueil sous la conférence : pas un fil de couloir entre elles.
    const bottom = (key: string) => byKey(key).rect.y + byKey(key).rect.height;
    expect(byKey('gym').rect.y).toBe(bottom('cafe'));
    expect(byKey('reception').rect.y).toBe(bottom('conference'));
  });

  test('les tables de jeu : quatre carrés égaux, en deux rangées et deux colonnes', () => {
    const tables = planTables(office);
    expect(tables).toHaveLength(4);
    expect(new Set(tables.map((table) => `${table.width}×${table.height}`))).toEqual(new Set(['64×64']));
    expect(new Set(tables.map((table) => table.x)).size).toBe(2);
    expect(new Set(tables.map((table) => table.y)).size).toBe(2);
  });

  test('le nom de la salle de jeu ne passe pas sous ses tables', () => {
    const game = byKey('game');
    const halfWidth = (game.fontSize * CHAR_WIDTH * Math.max(...game.lines.map((line) => line.length))) / 2;
    const halfHeight = (game.fontSize * game.lines.length) / 2;
    for (const table of planTables(office)) {
      const apart =
        game.labelAt.x + halfWidth <= table.x || game.labelAt.x - halfWidth >= table.x + table.width || game.labelAt.y + halfHeight <= table.y || game.labelAt.y - halfHeight >= table.y + table.height;
      expect(apart).toBe(true);
    }
    expect(game.fontSize).toBeGreaterThan(30);
  });

  test('un bureau porte le nom qu\'on lui voit dans le jeu ; fermé (verrouillé, ou par le mode de son occupant), il est hachuré', () => {
    const named = planRooms(office, [desk('A1', { ownerId: 'u1', ownerName: 'Léa', locked: true }), desk('A2', { ownerId: 'u2', ownerName: 'Max', name: 'Le DEWWW' }), desk('A3', { closedByState: true })]);
    const of = (key: string) => named.find((room) => room.key === `desk:${key}`)!;
    expect(of('A1')).toMatchObject({ lines: ['BUREAU', 'DE LÉA'], locked: true });
    expect(of('A2')).toMatchObject({ lines: ['LE DEWWW'], locked: false });
    expect(of('A3').locked).toBe(true);
    expect(of('A4')).toMatchObject({ lines: ['PLACE A4'], locked: false });
  });
});

describe('planSite', () => {
  const site = planSite(office);
  const tile = 32;

  test('le bâtiment : toute la carte moins le jardin qui l\'entoure et ses deux angles du nord, en deux rectangles', () => {
    expect(site.building).toEqual([
      { x: 18 * tile, y: 5 * tile, width: 55 * tile, height: 14 * tile },
      { x: 5 * tile, y: 19 * tile, width: 81 * tile, height: 32 * tile },
    ]);
  });

  test('ses murs du dehors : fermés tout autour, ouverts à l\'entrée et vers chaque terrasse', () => {
    const segments = [...site.walls.matchAll(/M(\d+) (\d+)([HV])(\d+)/g)].map(([, x, y, axis, end]) => ({ x: Number(x), y: Number(y), axis, end: Number(end) }));
    const covers = (axis: string, at: number, from: number, to: number) =>
      segments.some((s) => s.axis === axis && (axis === 'H' ? s.y === at && s.x <= from && s.end >= to : s.x === at && s.y <= from && s.end >= to));
    // Le mur du sud, de part et d'autre de l'entrée (les cases 32 à 35), pas devant elle.
    expect(covers('H', 51 * tile, 5 * tile, 32 * tile)).toBe(true);
    expect(covers('H', 51 * tile, 36 * tile, 86 * tile)).toBe(true);
    expect(segments.some((s) => s.axis === 'H' && s.y === 51 * tile && s.x < 35 * tile && s.end > 33 * tile)).toBe(false);
    // Le flanc ouest des bureaux, jusqu'à la rue, qui débouche sur la terrasse (rangées 16 à 18).
    expect(covers('V', 18 * tile, 5 * tile, 16 * tile)).toBe(true);
    expect(segments.some((s) => s.axis === 'V' && s.x === 18 * tile && s.end > 16 * tile)).toBe(false);
    expect(covers('V', 73 * tile, 5 * tile, 16 * tile)).toBe(true);
    expect(covers('V', 5 * tile, 19 * tile, 51 * tile)).toBe(true);
    expect(covers('V', 86 * tile, 19 * tile, 51 * tile)).toBe(true);
  });

  test('le dehors : les deux terrasses en bois et le jardin, nommés dans les angles seulement, à côté du bassin et non dessus', () => {
    expect(site.outside.filter((piece) => piece.deck).map((piece) => piece.lines)).toEqual([['TERRASSE'], ['TERRASSE']]);
    const named = site.outside.filter((piece) => !piece.deck && piece.lines.length > 0);
    expect(named.map((piece) => piece.lines)).toEqual([['JARDIN'], ['JARDIN']]);
    const pond = site.waters[0]!;
    expect(pond).toBeDefined();
    for (const piece of named) {
      const half = (piece.fontSize * 0.6 * piece.lines[0]!.length) / 2;
      const apart = piece.labelAt.x + half <= pond.x || piece.labelAt.x - half >= pond.x + pond.width || piece.labelAt.y + piece.fontSize / 2 <= pond.y || piece.labelAt.y - piece.fontSize / 2 >= pond.y + pond.height;
      expect(apart, piece.key).toBe(true);
    }
  });

  test('le ring de la salle de boxe : son nom écrit dessous, sur une ligne', () => {
    const arena = planRooms(office, []).find((room) => room.key === 'arena')!;
    expect(site.ring).toEqual(office.arena);
    expect(arena.lines).toEqual(['SALLE DE BOXE']);
    expect(arena.labelAt.y - arena.fontSize / 2).toBeGreaterThanOrEqual(site.ring!.y + site.ring!.height);
  });
});

describe('toMapPoint', () => {
  test('le point de l\'écran ramené à la carte ; un plan sans taille ne donne rien', () => {
    const box = { left: 100, top: 50, width: 810, height: 460 };
    expect(toMapPoint(100, 50, box, { width: 2592, height: 1472 })).toEqual({ x: 0, y: 0 });
    expect(toMapPoint(505, 280, box, { width: 2592, height: 1472 })).toEqual({ x: 1296, y: 736 });
    expect(toMapPoint(10, 10, { left: 0, top: 0, width: 0, height: 0 }, { width: 1, height: 1 }).x).toBeNaN();
  });
});
