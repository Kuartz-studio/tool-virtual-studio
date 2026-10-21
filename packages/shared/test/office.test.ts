import { describe, expect, test } from 'vitest';
import {
  GRAND_HALL,
  MEETING_ROOM,
  OFFICE,
  OFFICE_DESK_SLOTS,
  OFFICE_HEIGHT,
  OFFICE_WIDTH,
  buildTiledMap,
  deskKey,
  isWalkableTile,
  parseOfficeMap,
  zoneAt,
  type OfficeMap,
} from '../src';

// La carte du bureau (OFFICE), lue comme le serveur la lit.
const map = parseOfficeMap(buildTiledMap({ ...OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
const tileOf = (px: number) => Math.floor(px / map.tileSize);

// Les cases atteignables à pied depuis (tx, ty), dans les quatre directions.
function reachableFrom(m: OfficeMap, tx: number, ty: number): Set<number> {
  const seen = new Set<number>();
  const queue = [[tx, ty] as const];
  seen.add(ty * m.widthTiles + tx);
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const [nx, ny] = [x + dx, y + dy];
      if (!isWalkableTile(m, nx, ny) || seen.has(ny * m.widthTiles + nx)) continue;
      seen.add(ny * m.widthTiles + nx);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

describe('la carte du bureau', () => {
  test('73 × 39 cases, bien plus grande que la carte de développement (24 × 16)', () => {
    expect([map.widthTiles, map.heightTiles]).toEqual([OFFICE_WIDTH, OFFICE_HEIGHT]);
    expect(map.widthTiles * map.heightTiles).toBeGreaterThan(5 * 24 * 16);
  });

  test('20 places de bureau, de clés A1 à A8, B1 à B8 et C1 à C4, chacune avec sa pièce (zone desk) et sa porte (zone door)', () => {
    const desks = map.zones.filter((zone) => zone.type === 'desk');
    const doors = map.zones.filter((zone) => zone.type === 'door');
    expect(desks.map(deskKey).sort()).toEqual(
      [...'12345678'].map((n) => `A${n}`).concat([...'12345678'].map((n) => `B${n}`), [...'1234'].map((n) => `C${n}`)).sort(),
    );
    expect(doors.map((door) => door.name).sort()).toEqual(desks.map(deskKey).sort());
    expect(OFFICE_DESK_SLOTS).toHaveLength(20);
  });

  test('un bureau est une vraie pièce : 7 × 5 cases (35), contre 4 × 3 (12) avant, fermée par des murs sauf à sa porte de 2 cases', () => {
    for (const slot of OFFICE_DESK_SLOTS) {
      expect([slot.room.w, slot.room.h]).toEqual([7, 5]);
      expect([slot.door.w, slot.door.h]).toEqual([2, 1]);
      // Le pourtour de la pièce (cases juste dehors) est bloqué partout, sauf aux deux cases de la porte.
      const ring: Array<[number, number]> = [];
      for (let x = slot.room.x - 1; x <= slot.room.x + slot.room.w; x++) ring.push([x, slot.room.y - 1], [x, slot.room.y + slot.room.h]);
      for (let y = slot.room.y; y < slot.room.y + slot.room.h; y++) ring.push([slot.room.x - 1, y], [slot.room.x + slot.room.w, y]);
      const open = ring.filter(([x, y]) => isWalkableTile(map, x, y)).map(([x, y]) => `${x},${y}`);
      const doorCells = [0, 1].map((i) => `${slot.door.x + i},${slot.door.y}`);
      expect(open.sort(), `place ${slot.key}`).toEqual(doorCells.sort());
    }
  });

  test('les pièces ne se chevauchent pas, et un point d\'un bureau, de la grande salle ou de la salle de réunion est dans la bonne zone', () => {
    const isolating = map.zones.filter((zone) => zone.type === 'desk' || zone.type === 'private');
    for (const a of isolating) {
      for (const b of isolating) {
        if (a === b) continue;
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart, `${deskKey(a)} et ${deskKey(b)}`).toBe(true);
      }
    }
    expect(zoneAt(map, 56 * 32, 25 * 32)?.name).toBe('Grande salle');
    expect(zoneAt(map, 3 * 32, 20 * 32)?.name).toBe('Salle de réunion');
    expect(zoneAt(map, 4 * 32, 3 * 32)?.name).toBe('A1');
    expect(zoneAt(map, 36 * 32, 20 * 32)).toBeNull();
  });

  test('la grande salle est bien plus grande qu\'un bureau (au moins 8 fois), et la salle de réunion aussi grande que 2 bureaux', () => {
    const desk = 7 * 5;
    expect(GRAND_HALL.w * GRAND_HALL.h).toBeGreaterThanOrEqual(8 * desk);
    expect(MEETING_ROOM.w * MEETING_ROOM.h).toBeGreaterThanOrEqual(2 * desk);
  });

  test('tout est atteignable à pied depuis le point d\'apparition : chaque bureau, chaque porte, les deux salles', () => {
    const reachable = reachableFrom(map, tileOf(map.spawn.x), tileOf(map.spawn.y));
    const at = (x: number, y: number) => reachable.has(y * map.widthTiles + x);
    for (const slot of OFFICE_DESK_SLOTS) {
      expect(at(slot.door.x, slot.door.y), `porte de ${slot.key}`).toBe(true);
      expect(at(slot.room.x + 1, slot.room.y), `pièce ${slot.key}`).toBe(true);
    }
    expect(at(GRAND_HALL.x + 1, GRAND_HALL.y + 1)).toBe(true);
    expect(at(GRAND_HALL.x + GRAND_HALL.w - 1, GRAND_HALL.y + GRAND_HALL.h - 1)).toBe(true);
    expect(at(MEETING_ROOM.x + 1, MEETING_ROOM.y + 1)).toBe(true);
  });

  test('chaque case libre d\'une pièce est atteignable : aucun meuble n\'enferme un coin', () => {
    const reachable = reachableFrom(map, tileOf(map.spawn.x), tileOf(map.spawn.y));
    const rooms = map.zones.filter((zone) => zone.type === 'desk' || zone.type === 'private');
    for (const room of rooms) {
      for (let ty = tileOf(room.y); ty < tileOf(room.y + room.height); ty++) {
        for (let tx = tileOf(room.x); tx < tileOf(room.x + room.width); tx++) {
          if (isWalkableTile(map, tx, ty)) expect(reachable.has(ty * map.widthTiles + tx), `${room.name} (${tx}, ${ty})`).toBe(true);
        }
      }
    }
  });

  test('le point d\'apparition est dans l\'accueil, en bas, loin des bureaux', () => {
    expect([tileOf(map.spawn.x), tileOf(map.spawn.y)]).toEqual([48, 36]);
    expect(zoneAt(map, map.spawn.x, map.spawn.y)).toBeNull();
  });
});

describe('les portes et les bureaux dans parseOfficeMap', () => {
  const base = { ...OFFICE, tileset: { name: 'dev', image: 'tiles.png' } };

  test('deux bureaux de même nom : refusé', () => {
    const zones = OFFICE.zones.map((zone) => (zone.type === 'desk' && zone.name === 'A2' ? { ...zone, name: 'A1' } : zone));
    expect(() => parseOfficeMap(buildTiledMap({ ...base, zones }))).toThrow(/deux bureaux portent le nom « A1 »/);
  });

  test('une porte qui ne ferme aucun bureau : refusé', () => {
    const zones = OFFICE.zones.map((zone) => (zone.type === 'door' && zone.name === 'A1' ? { ...zone, name: 'Z9' } : zone));
    expect(() => parseOfficeMap(buildTiledMap({ ...base, zones }))).toThrow(/ne ferme aucun bureau.*« Z9 »/);
  });

  test('un bureau sans nom a pour clé le numéro de sa zone (les cartes d\'avant les noms)', () => {
    expect(deskKey({ name: null, id: '7' })).toBe('7');
    expect(deskKey({ name: 'A1', id: '7' })).toBe('A1');
  });
});
