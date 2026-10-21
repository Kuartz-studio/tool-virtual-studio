import { describe, expect, test } from 'vitest';
import {
  DESK_ROOM,
  GRAND_HALL,
  LOUNGE,
  MEETING_ROOM,
  OFFICE,
  OFFICE_DESK_SLOTS,
  OFFICE_HEIGHT,
  OFFICE_WIDTH,
  buildOffice,
  buildOfficeTiledMap,
  buildTiledMap,
  decorItem,
  deskKey,
  footprintOf,
  isWalkableTile,
  parseOfficeMap,
  withinSwitchReach,
  zoneAt,
  type OfficeMap,
  type TiledObjectLayer,
} from '../src';

// La carte du bureau (OFFICE), lue comme le serveur la lit.
const json = buildOfficeTiledMap();
const map = parseOfficeMap(json);
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
  test('66 × 47 cases, bien plus grande que la carte de développement (24 × 16)', () => {
    expect([map.widthTiles, map.heightTiles]).toEqual([OFFICE_WIDTH, OFFICE_HEIGHT]);
    expect(map.widthTiles * map.heightTiles).toBeGreaterThan(5 * 24 * 16);
  });

  test('6 places de bureau, de clés A1 à A6, chacune avec sa pièce (zone desk) et sa porte (zone door)', () => {
    const desks = map.zones.filter((zone) => zone.type === 'desk');
    const doors = map.zones.filter((zone) => zone.type === 'door');
    expect(desks.map(deskKey).sort()).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
    expect(doors.map((door) => door.name).sort()).toEqual(desks.map(deskKey).sort());
    expect(OFFICE_DESK_SLOTS).toHaveLength(6);
  });

  test('un bureau est une vraie pièce : 9 × 7 cases (63), fermée par des murs sauf à sa porte de 2 cases', () => {
    for (const slot of OFFICE_DESK_SLOTS) {
      expect([slot.room.w, slot.room.h]).toEqual([DESK_ROOM.width, DESK_ROOM.height]);
      expect([slot.room.w, slot.room.h]).toEqual([9, 7]);
      expect([slot.door.w, slot.door.h]).toEqual([2, 2]);
      // Le pourtour de la pièce (cases juste dehors) est bloqué partout, sauf aux deux cases de la porte.
      const ring: Array<[number, number]> = [];
      for (let x = slot.room.x - 1; x <= slot.room.x + slot.room.w; x++) ring.push([x, slot.room.y - 1], [x, slot.room.y + slot.room.h]);
      for (let y = slot.room.y; y < slot.room.y + slot.room.h; y++) ring.push([slot.room.x - 1, y], [slot.room.x + slot.room.w, y]);
      const open = ring.filter(([x, y]) => isWalkableTile(map, x, y)).map(([x, y]) => `${x},${y}`);
      const doorCells = [0, 1].map((i) => `${slot.door.x + i},${slot.room.y + slot.room.h}`);
      expect(open.sort(), `place ${slot.key}`).toEqual(doorCells.sort());
      // La porte est dans le prolongement des deux cases du bas de la pièce : on y entre tout droit.
      expect(slot.door.x).toBe(slot.room.x + DESK_ROOM.doorX);
    }
  });

  test('les pièces ne se chevauchent pas, et un point d\'un bureau, de la grande salle, de la salle de réunion ou de la détente est dans la bonne zone', () => {
    const isolating = map.zones.filter((zone) => zone.type === 'desk' || zone.type === 'private');
    for (const a of isolating) {
      for (const b of isolating) {
        if (a === b) continue;
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart, `${deskKey(a)} et ${deskKey(b)}`).toBe(true);
      }
    }
    expect(zoneAt(map, 56 * 32, 22 * 32)?.name).toBe('Grande salle');
    expect(zoneAt(map, 3 * 32, 20 * 32)?.name).toBe('Salle de réunion');
    expect(zoneAt(map, 4 * 32, 3 * 32)?.name).toBe('A1');
    expect(zoneAt(map, 56 * 32, 6 * 32)?.name).toBe('A6');
    expect(zoneAt(map, 10 * 32, 40 * 32)?.name).toBe('Zone détente');
    expect(zoneAt(map, 36 * 32, 20 * 32)).toBeNull();
  });

  test('la zone détente est une grande zone : au moins 8 fois un bureau ; la salle de réunion, au moins 2 fois ; la grande salle, au moins 2 fois', () => {
    const desk = DESK_ROOM.width * DESK_ROOM.height;
    expect(LOUNGE.w * LOUNGE.h).toBeGreaterThanOrEqual(8 * desk);
    expect(GRAND_HALL.w * GRAND_HALL.h).toBeGreaterThanOrEqual(2 * desk);
    expect(MEETING_ROOM.w * MEETING_ROOM.h).toBeGreaterThanOrEqual(2 * desk);
    // La détente est une zone « private » comme la salle de réunion : tout le monde s'y entend.
    expect(map.zones.find((zone) => zone.name === 'Zone détente')?.type).toBe('private');
  });

  test('tout est atteignable à pied depuis le point d\'apparition : chaque bureau, chaque porte, les salles, la détente', () => {
    const reachable = reachableFrom(map, tileOf(map.spawn.x), tileOf(map.spawn.y));
    const at = (x: number, y: number) => reachable.has(y * map.widthTiles + x);
    for (const slot of OFFICE_DESK_SLOTS) {
      expect(at(slot.door.x, slot.door.y), `porte de ${slot.key}`).toBe(true);
      expect(at(slot.room.x + 1, slot.room.y), `pièce ${slot.key}`).toBe(true);
    }
    expect(at(GRAND_HALL.x + 1, GRAND_HALL.y + 1)).toBe(true);
    expect(at(GRAND_HALL.x + GRAND_HALL.w - 1, GRAND_HALL.y + GRAND_HALL.h - 1)).toBe(true);
    expect(at(MEETING_ROOM.x + 1, MEETING_ROOM.y + 1)).toBe(true);
    expect(at(LOUNGE.x, LOUNGE.y)).toBe(true);
    expect(at(LOUNGE.x + LOUNGE.w - 1, LOUNGE.y + LOUNGE.h - 1)).toBe(true);
  });

  test('chaque case libre de la carte est atteignable : aucun meuble n\'enferme un coin', () => {
    const reachable = reachableFrom(map, tileOf(map.spawn.x), tileOf(map.spawn.y));
    const stuck: string[] = [];
    for (let ty = 0; ty < map.heightTiles; ty++) {
      for (let tx = 0; tx < map.widthTiles; tx++) {
        if (isWalkableTile(map, tx, ty) && !reachable.has(ty * map.widthTiles + tx)) stuck.push(`${tx},${ty}`);
      }
    }
    expect(stuck).toEqual([]);
  });

  test('le point d\'apparition est dans l\'accueil, en bas, loin des bureaux', () => {
    expect([tileOf(map.spawn.x), tileOf(map.spawn.y)]).toEqual([54, 41]);
    expect(zoneAt(map, map.spawn.x, map.spawn.y)).toBeNull();
  });

  test('le calque d\'objets ne cite que des éléments de la banque, tous dans la carte', () => {
    const objets = json.layers.find((layer) => layer.name === 'objets') as TiledObjectLayer;
    expect(objets.objects.length).toBeGreaterThan(50);
    for (const object of objets.objects) {
      const item = decorItem(object.name);
      expect(item, object.name).toBeDefined();
      expect(object.x / 32, object.name).toBeGreaterThanOrEqual(0);
      expect(object.x / 32 + item!.w, object.name).toBeLessThanOrEqual(OFFICE_WIDTH);
      expect(object.y / 32, object.name).toBeLessThan(OFFICE_HEIGHT);
    }
  });

  test('la piscine est un obstacle : on ne marche pas dans l\'eau', () => {
    expect(isWalkableTile(map, 9, 38)).toBe(false);
    expect(isWalkableTile(map, 9, 35)).toBe(true);   // la terrasse
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

// Ce que la carte pose : les éléments de la banque, par leur case de départ.
const placed = buildOffice().canvas.decor.map((d) => ({ ...d, item: decorItem(d.id)! }));

describe('la salle de réunion', () => {
  const table = placed.find((d) => d.id === 'cf-0-1')!;
  const chairs = placed.filter((d) => d.item.cat === 'sieges' && d.y >= MEETING_ROOM.y && d.y < MEETING_ROOM.y + MEETING_ROOM.h && d.x >= MEETING_ROOM.x && d.x < MEETING_ROOM.x + MEETING_ROOM.w);

  test('la table, de 4 × 2 cases au sol, est au milieu de la salle', () => {
    const f = footprintOf(table.item, table);
    expect([f.w, f.h]).toEqual([4, 2]);
    expect(f.x + f.w / 2).toBe(MEETING_ROOM.x + MEETING_ROOM.w / 2);
  });

  test('les chaises touchent la table : une rangée au nord, une au sud, une à chaque bout', () => {
    const f = footprintOf(table.item, table);
    const north = chairs.filter((c) => c.y === f.y - 1);
    const south = chairs.filter((c) => c.y === f.y + f.h);
    expect(north.map((c) => c.x).sort((a, b) => a - b)).toEqual([f.x, f.x + 1, f.x + 2, f.x + 3]);
    expect(south.map((c) => c.x).sort((a, b) => a - b)).toEqual([f.x, f.x + 1, f.x + 2, f.x + 3]);
    expect(chairs.filter((c) => c.x === f.x - 1 || c.x === f.x + f.w)).toHaveLength(2);
    expect(chairs).toHaveLength(10);
  });

  test('les cases qui bloquent sont celles de la table, ni plus ni moins', () => {
    const f = footprintOf(table.item, table);
    const blocked = new Set<string>();
    for (let y = MEETING_ROOM.y; y < MEETING_ROOM.y + MEETING_ROOM.h; y++) {
      for (let x = MEETING_ROOM.x; x < MEETING_ROOM.x + MEETING_ROOM.w; x++) {
        if (!isWalkableTile(map, x, y) && OFFICE.ascii[y]![x] === 'T') blocked.add(`${x},${y}`);
      }
    }
    // Hors les deux grandes plantes d'angle (qui se traversent) : seule la table bloque, sur 4 × 2 cases.
    expect([...blocked].sort()).toEqual(
      Array.from({ length: f.w * f.h }, (_, i) => `${f.x + (i % f.w)},${f.y + Math.floor(i / f.w)}`).sort(),
    );
  });
});

describe('les fontaines à eau', () => {
  test('jamais dans l\'axe d\'une porte de bureau, qu\'elles masqueraient', () => {
    const fountains = placed.filter((d) => d.item.name === 'Fontaine à eau' && d.y === 12);
    expect(fountains.length).toBeGreaterThan(0);
    for (const fountain of fountains) {
      for (const slot of OFFICE_DESK_SLOTS) {
        expect(fountain.x < slot.door.x || fountain.x >= slot.door.x + slot.door.w, `fontaine en ${fountain.x}, porte ${slot.key}`).toBe(true);
      }
    }
  });
});


describe('l\'interrupteur de lumière du couloir', () => {
  const doorOf = (key: string) => OFFICE_DESK_SLOTS.find((slot) => slot.key === key)!.door;

  test('un seul, au centre de la case (32, 10) : la face du mur nord du couloir, à égale distance des portes des bureaux A3 et A4', () => {
    expect(OFFICE.zones.filter((zone) => zone.type === 'switch')).toEqual([{ type: 'switch', x: 32, y: 10, w: 1, h: 1 }]);
    expect(map.switches).toEqual([{ x: 32 * 32 + 16, y: 10 * 32 + 16 }]);
    const [a3, a4] = [doorOf('A3'), doorOf('A4')];
    const [lastWallBeforeLeftDoor, firstWallAfterRightDoor] = [a3.x + a3.w, a4.x - 1];
    expect(lastWallBeforeLeftDoor).toBeLessThan(32);
    expect(firstWallAfterRightDoor).toBeGreaterThan(32);
    expect(32 - lastWallBeforeLeftDoor).toBe(firstWallAfterRightDoor - 32);
  });

  test('sur un mur : la rangée qu\'on voit du couloir (y 11 à 13), dont le sol est libre juste dessous', () => {
    const [lightSwitch] = map.switches;
    expect(tileOf(lightSwitch!.y)).toBe(10);
    expect(isWalkableTile(map, 32, 10)).toBe(false);
    for (const y of [11, 12, 13]) expect(isWalkableTile(map, 32, y), `case 32, ${y}`).toBe(true);
    // Ce n'est ni une pièce ni un bureau : personne n'y est « dans » une zone.
    expect(zoneAt(map, lightSwitch!.x, lightSwitch!.y)).toBeNull();
  });

  test('on l\'atteint depuis le couloir, à 3 cases au plus ; pas depuis le reste de la carte (l\'accueil, la place centrale)', () => {
    const feetAt = (tx: number, ty: number) => ({ x: tx * 32 + 16, y: ty * 32 + 16 });
    expect(withinSwitchReach(feetAt(32, 13), map.switches)).toBe(true);
    expect(withinSwitchReach(feetAt(30, 12), map.switches)).toBe(true);
    expect(withinSwitchReach(feetAt(36, 12), map.switches)).toBe(false);
    expect(withinSwitchReach(feetAt(32, 15), map.switches)).toBe(false);
    expect(withinSwitchReach(map.spawn, map.switches)).toBe(false);
  });
});
