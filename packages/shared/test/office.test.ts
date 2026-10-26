import { describe, expect, test } from 'vitest';
import {
  DESK_ROOMS,
  OFFICE,
  OFFICE_DESK_SLOTS,
  OFFICE_HEIGHT,
  OFFICE_OPENINGS,
  OFFICE_SPAWN,
  OFFICE_WIDTH,
  buildOffice,
  buildOfficeTiledMap,
  buildTiledMap,
  decorItem,
  defaultDeskDecor,
  deskKey,
  deskRoomSpecOf,
  footprintOf,
  freeSpotIn,
  isWalkableTile,
  outsideRow,
  parseOfficeMap,
  placeAt,
  placeByKey,
  propByKey,
  withinSwitchReach,
  zoneAt,
  type OfficeMap,
  type Place,
  type TiledObjectLayer,
} from '../src';

// La carte du bureau (OFFICE), lue comme le serveur la lit.
const json = buildOfficeTiledMap();
const map = parseOfficeMap(json);
const tile = map.tileSize;
const tileOf = (px: number) => Math.floor(px / tile);
const centre = (t: number) => t * tile + tile / 2;
const walkable = (x: number, y: number) => isWalkableTile(map, x, y);

// Le rectangle d'un lieu, en cases.
function areaOf(key: string): { x: number; y: number; w: number; h: number } {
  const rect = placeByKey(map, key)!.rects[0]!;
  return { x: rect.x / tile, y: rect.y / tile, w: rect.width / tile, h: rect.height / tile };
}
const inside = (a: { x: number; y: number; w: number; h: number }, x: number, y: number) => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h;

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

// Les pièces fermées de la carte (les bureaux, les salles) : ce que les murs enferment, et que ne traversent que les ouvertures.
const ROOMS = ['meeting', 'arena', 'conference', 'gym', 'game', 'lounge'] as const;

describe('la carte du bureau', () => {
  test('81 × 46 cases, bien plus grande que la carte de développement (24 × 16)', () => {
    expect([map.widthTiles, map.heightTiles]).toEqual([OFFICE_WIDTH, OFFICE_HEIGHT]);
    expect([OFFICE_WIDTH, OFFICE_HEIGHT]).toEqual([81, 46]);
    expect(map.widthTiles * map.heightTiles).toBeGreaterThan(9 * 24 * 16);
  });

  test('6 places de bureau, de clés A1 à A6, chacune avec sa pièce (zone desk) et sa porte (zone door)', () => {
    const desks = map.zones.filter((zone) => zone.type === 'desk');
    const doors = map.zones.filter((zone) => zone.type === 'door');
    expect(desks.map(deskKey).sort()).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
    expect(doors.map((door) => door.name).sort()).toEqual(desks.map(deskKey).sort());
    expect(OFFICE_DESK_SLOTS.map((slot) => slot.key)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
  });

  test('A1 à A4 font 9 × 7, A5 et A6 6 × 7 ; A1, A2 et A5 ont leur porte au sud de la pièce, A3, A4 et A6 au nord (côté rue)', () => {
    const specs = Object.fromEntries(OFFICE_DESK_SLOTS.map((slot) => [slot.key, deskRoomSpecOf(map, slot.key)!]));
    for (const key of ['A1', 'A2', 'A3', 'A4']) expect([specs[key]!.width, specs[key]!.height], key).toEqual([DESK_ROOMS.standard.width, DESK_ROOMS.standard.height]);
    for (const key of ['A5', 'A6']) expect([specs[key]!.width, specs[key]!.height], key).toEqual([DESK_ROOMS.compact.width, DESK_ROOMS.compact.height]);
    for (const key of ['A1', 'A2', 'A5']) expect(specs[key]!.door.side, key).toBe('south');
    for (const key of ['A3', 'A4', 'A6']) expect(specs[key]!.door.side, key).toBe('north');
    for (const key of ['A1', 'A2', 'A3', 'A4']) expect(specs[key]!.door.x, key).toBe(DESK_ROOMS.standard.door.x);
    for (const key of ['A5', 'A6']) expect(specs[key]!.door.x, key).toBe(DESK_ROOMS.compact.door.x);
    for (const slot of OFFICE_DESK_SLOTS) expect(slot.doorSide, slot.key).toBe(specs[slot.key]!.door.side);
  });

  test('un bureau est une vraie pièce : fermée par des murs sauf à sa porte de 2 cases, qu\'on franchit tout droit', () => {
    for (const slot of OFFICE_DESK_SLOTS) {
      expect([slot.door.w, slot.door.h]).toEqual([2, 2]);
      // Le pourtour de la pièce (cases juste dehors) est bloqué partout, sauf aux deux cases de la porte.
      const ring: Array<[number, number]> = [];
      for (let x = slot.room.x - 1; x <= slot.room.x + slot.room.w; x++) ring.push([x, slot.room.y - 1], [x, slot.room.y + slot.room.h]);
      for (let y = slot.room.y; y < slot.room.y + slot.room.h; y++) ring.push([slot.room.x - 1, y], [slot.room.x + slot.room.w, y]);
      const open = ring.filter(([x, y]) => walkable(x, y)).map(([x, y]) => `${x},${y}`);
      const doorRow = slot.doorSide === 'south' ? slot.room.y + slot.room.h : slot.room.y - 1;
      expect(open.sort(), `place ${slot.key}`).toEqual([0, 1].map((i) => `${slot.door.x + i},${doorRow}`).sort());
    }
  });

  test('les pièces ne se chevauchent pas : bureaux et salles ont chacun leur place', () => {
    const rooms = [
      ...OFFICE_DESK_SLOTS.map((slot) => ({ key: slot.key, ...slot.room })),
      ...ROOMS.map((key) => ({ key, ...areaOf(key) })),
    ];
    for (const a of rooms) {
      for (const b of rooms) {
        if (a === b) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${a.key} et ${b.key}`).toBe(true);
      }
    }
  });

  test('chaque salle est fermée par des murs, sauf à ses ouvertures', () => {
    for (const key of ROOMS) {
      const room = areaOf(key);
      const ring: Array<[number, number]> = [];
      for (let x = room.x; x < room.x + room.w; x++) ring.push([x, room.y - 1], [x, room.y + room.h]);
      for (let y = room.y; y < room.y + room.h; y++) ring.push([room.x - 1, y], [room.x + room.w, y]);
      const open = ring.filter(([x, y]) => walkable(x, y)).map(([x, y]) => `${x},${y}`);
      const expected = OFFICE_OPENINGS.filter((o) => o.room === key).flatMap((o) => {
        const cells: string[] = [];
        for (let i = 0; i < o.w; i++) cells.push(`${o.x + i},${o.y < room.y ? room.y - 1 : room.y + room.h}`);
        return cells;
      });
      expect(open.sort(), key).toEqual(expected.sort());
    }
  });

  test('chaque porte et chaque arche débouche sur du libre des deux côtés', () => {
    expect(OFFICE_OPENINGS).toHaveLength(6 + 3 + 4);   // six bureaux, trois salles à porte, quatre arches
    for (const o of OFFICE_OPENINGS) {
      for (let i = 0; i < o.w; i++) {
        const x = o.x + i;
        for (let y = o.y - 1; y <= o.y + o.h; y++) expect(walkable(x, y), `${o.key} (${o.room}) en ${x}, ${y}`).toBe(true);
      }
    }
  });

  test('les bandes de mur qui bordent les pièces ne sont percées qu\'aux ouvertures de la liste', () => {
    const openings = new Set(OFFICE_OPENINGS.flatMap((o) => Array.from({ length: o.w * o.h }, (_, i) => `${o.x + (i % o.w)},${o.y + Math.floor(i / o.w)}`)));
    // Les bandes de 2 cases : au sud des bureaux du nord (y 9-10), au nord et au sud de ceux du sud (y 15-16 et 24-25), au nord des salles du sud (y 30-31).
    // La place centrale (x 30 à 49) et le connecteur est (x 74 à 79) les traversent : elles y sont ouvertes.
    const crossing = (x: number, y: number) => (x >= 30 && x < 50 && [9, 10, 15, 16, 24, 25].includes(y)) || (x >= 74 && [15, 16, 24, 25].includes(y));
    const stray: string[] = [];
    for (const y of [9, 10, 15, 16, 24, 25, 30, 31]) {
      for (let x = 0; x < OFFICE_WIDTH; x++) if (walkable(x, y) && !crossing(x, y) && !openings.has(`${x},${y}`)) stray.push(`${x},${y}`);
    }
    expect(stray).toEqual([]);
  });

  test('tout est atteignable à pied depuis le point d\'apparition : chaque bureau, chaque salle, la détente', () => {
    const reachable = reachableFrom(map, tileOf(map.spawn.x), tileOf(map.spawn.y));
    const at = (x: number, y: number) => reachable.has(y * map.widthTiles + x);
    for (const slot of OFFICE_DESK_SLOTS) {
      expect(at(slot.door.x, slot.door.y), `porte de ${slot.key}`).toBe(true);
      const inRoom = (dx: number, dy: number) => at(slot.room.x + dx, slot.room.y + dy);
      expect(inRoom(slot.doorSide === 'south' ? 3 : 3, slot.doorSide === 'south' ? slot.room.h - 1 : 0), `pièce ${slot.key}`).toBe(true);
    }
    for (const key of ROOMS) {
      const room = areaOf(key);
      const reached = [];
      for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) if (walkable(x, y) && at(x, y)) reached.push(1);
      expect(reached.length, key).toBeGreaterThan(room.w * room.h * 0.4);
    }
  });

  test('chaque case libre de la carte est atteignable : aucun meuble n\'enferme un coin', () => {
    const reachable = reachableFrom(map, tileOf(map.spawn.x), tileOf(map.spawn.y));
    const stuck: string[] = [];
    for (let ty = 0; ty < map.heightTiles; ty++) {
      for (let tx = 0; tx < map.widthTiles; tx++) {
        if (walkable(tx, ty) && !reachable.has(ty * map.widthTiles + tx)) stuck.push(`${tx},${ty}`);
      }
    }
    expect(stuck).toEqual([]);
  });

  test('le point d\'apparition est à l\'accueil, au milieu de la carte : (40, 22)', () => {
    expect(OFFICE_SPAWN).toEqual({ x: 40, y: 22 });
    expect([tileOf(map.spawn.x), tileOf(map.spawn.y)]).toEqual([40, 22]);
    expect(placeAt(map, map.spawn.x, map.spawn.y)?.key).toBe('reception');
    expect(zoneAt(map, map.spawn.x, map.spawn.y)).toBeNull();
  });

  test('la piscine est un obstacle : on ne marche pas dans l\'eau, la terrasse se parcourt', () => {
    const lounge = areaOf('lounge');
    expect(walkable(lounge.x + 9, lounge.y + 5)).toBe(false);   // au milieu du bassin
    expect(walkable(lounge.x + 1, lounge.y + 1)).toBe(true);    // la terrasse, au coin nord-ouest
  });
});

describe('les lieux', () => {
  // clé, nom, genre, ambiance par défaut, musique réglable, destination d'un mode
  const EXPECTED: Array<[string, string, Place['kind'], Place['scene'], boolean, boolean]> = [
    ['plaza', 'Place centrale', 'open', 'lobby', false, false],
    ['cafe', 'Café', 'open', 'sunny', true, false],
    ['reception', 'Accueil', 'open', 'lobby', true, false],
    ['street-n', 'Couloir', 'street', 'lobby', false, false],
    ['street-s', 'Couloir', 'street', 'lobby', false, false],
    ['street-e', 'Couloir', 'street', 'lobby', false, false],
    ['meeting', 'Salle de réunion', 'room', 'focus', true, false],
    ['arena', 'Octogone', 'room', 'quest', true, false],
    ['conference', 'Salle de conférence', 'room', 'drift', true, false],
    ['gym', 'Salle de sport', 'room', 'quest', true, true],
    ['game', 'Salle de jeu', 'room', 'dusk', true, true],
    ['lounge', 'Détente et piscine', 'room', 'sunny', true, false],
  ];

  test('douze lieux déclarés, avec leur nom, leur genre, leur ambiance, leur musique et leur destination', () => {
    expect(map.places.map((p) => [p.key, p.label, p.kind, p.scene, p.music, p.destination])).toEqual(EXPECTED);
  });

  test('les rectangles sont ceux du plan de masse', () => {
    expect(areaOf('plaza')).toEqual({ x: 30, y: 2, w: 20, h: 28 });
    expect(areaOf('cafe')).toEqual({ x: 32, y: 2, w: 16, h: 8 });
    expect(areaOf('reception')).toEqual({ x: 31, y: 15, w: 18, h: 11 });
    expect(areaOf('street-n')).toEqual({ x: 1, y: 11, w: 78, h: 4 });
    expect(areaOf('street-s')).toEqual({ x: 1, y: 26, w: 78, h: 4 });
    expect(areaOf('street-e')).toEqual({ x: 74, y: 11, w: 6, h: 19 });
    expect(areaOf('meeting')).toEqual({ x: 51, y: 2, w: 14, h: 7 });
    expect(areaOf('arena')).toEqual({ x: 66, y: 2, w: 14, h: 7 });
    expect(areaOf('conference')).toEqual({ x: 51, y: 17, w: 22, h: 7 });
    expect(areaOf('gym')).toEqual({ x: 1, y: 32, w: 12, h: 12 });
    expect(areaOf('game')).toEqual({ x: 14, y: 32, w: 22, h: 12 });
    expect(areaOf('lounge')).toEqual({ x: 37, y: 32, w: 43, h: 12 });
  });

  test('le lieu d\'un point : le plus petit qui le contient (le café dans la place, un bureau dans sa zone)', () => {
    const at = (x: number, y: number) => placeAt(map, centre(x), centre(y))?.key;
    expect(at(40, 5)).toBe('cafe');
    expect(at(31, 5)).toBe('plaza');
    expect(at(40, 20)).toBe('reception');
    expect(at(40, 12)).toBe('street-n');   // la rue traverse la place
    expect(at(10, 27)).toBe('street-s');
    expect(at(76, 20)).toBe('street-e');
    expect(at(55, 5)).toBe('meeting');
    expect(at(70, 5)).toBe('arena');
    expect(at(60, 20)).toBe('conference');
    expect(at(5, 38)).toBe('gym');
    expect(at(20, 38)).toBe('game');
    expect(at(60, 38)).toBe('lounge');
    // Les petits bureaux (A5 au nord, A6 au sud) sont tout à l'ouest de leur rangée, les grands à leur droite.
    expect(at(4, 4)).toBe('desk:A5');
    expect(at(13, 4)).toBe('desk:A1');
    expect(at(25, 4)).toBe('desk:A2');
    expect(at(4, 20)).toBe('desk:A6');
    expect(at(13, 20)).toBe('desk:A3');
    expect(at(25, 20)).toBe('desk:A4');
  });

  test('la salle de sport et la salle de jeu sont les seules destinations ; les pièces fermées sont aussi des zones privées', () => {
    expect(map.places.filter((p) => p.destination).map((p) => p.key)).toEqual(['gym', 'game']);
    const privates = map.zones.filter((zone) => zone.type === 'private').map((zone) => zone.name);
    expect(privates.sort()).toEqual(['Détente et piscine', 'Octogone', 'Salle de conférence', 'Salle de jeu', 'Salle de réunion', 'Salle de sport']);
  });

  test('chaque place de musique a exactement une enceinte, posée contre une case libre', () => {
    const musical = map.places.filter((p) => p.music).map((p) => p.key).sort();
    expect(map.speakers.map((s) => s.place).sort()).toEqual(musical);
    for (const speaker of map.speakers) {
      const [sx, sy] = [tileOf(speaker.x), tileOf(speaker.y)];
      expect(placeAt(map, speaker.x, speaker.y)?.key, `enceinte de ${speaker.place}`).toBe(speaker.place);
      const free = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => walkable(sx + dx!, sy + dy!));
      expect(free, `enceinte de ${speaker.place}`).toBe(true);
    }
  });

  test('la machine à café a sa case libre devant elle, au café', () => {
    expect(map.coffees).toHaveLength(1);
    const [coffee] = map.coffees;
    const [cx, cy] = [tileOf(coffee!.x), tileOf(coffee!.y)];
    expect(walkable(cx, cy)).toBe(true);
    expect(placeAt(map, coffee!.x, coffee!.y)?.key).toBe('cafe');
    const props = (json.layers.find((layer) => layer.name === 'props') as TiledObjectLayer).objects;
    const machine = props.find((p) => p.name === 'coffee')!;
    // La machine est sur le comptoir du bar, dans la colonne de la case, deux rangées plus haut (l'épaisseur du comptoir) : on se sert de l'autre côté.
    expect([machine.x / tile, machine.y / tile + 2]).toEqual([cx, cy]);
    expect(machine.properties).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'depth' })]));
  });

  test('chaque table de jeu a ses sièges (2, 2, 2, 4) sur des cases libres, et freeSpotIn trouve de la place autour d\'elle', () => {
    expect(Object.fromEntries(map.tables.map((t) => [t.game, t.seats.length]))).toEqual({ chess: 2, backgammon: 2, connect4: 2, ludo: 4 });
    for (const table of map.tables) {
      const rect = table.rect;
      for (const seat of table.seats) {
        expect(walkable(tileOf(seat.x), tileOf(seat.y)), `${table.game} : siège en ${seat.x}, ${seat.y}`).toBe(true);
        // Un siège touche la table.
        const [sx, sy] = [tileOf(seat.x), tileOf(seat.y)];
        const [tx0, ty0, tx1, ty1] = [rect.x / tile, rect.y / tile, (rect.x + rect.width) / tile - 1, (rect.y + rect.height) / tile - 1];
        const touching = sx >= tx0 - 1 && sx <= tx1 + 1 && sy >= ty0 - 1 && sy <= ty1 + 1 && !(sx >= tx0 && sx <= tx1 && sy >= ty0 && sy <= ty1);
        expect(touching, `${table.game} : siège en ${sx}, ${sy}`).toBe(true);
      }
      // Les tables sont dans la salle de jeu, et il y a de la place pour y poser du monde tout autour.
      expect(placeAt(map, rect.x + rect.width / 2, rect.y + rect.height / 2)?.key).toBe('game');
      const around: Place = {
        key: `autour:${table.game}`,
        label: 'Autour de la table',
        kind: 'open',
        rects: [{ x: rect.x - 2 * tile, y: rect.y - 2 * tile, width: rect.width + 4 * tile, height: rect.height + 4 * tile }],
        scene: 'lobby',
        music: false,
        destination: false,
      };
      const spot = freeSpotIn(map, around, []);
      expect(spot, table.game).not.toBeNull();
      expect(spot!.x < rect.x || spot!.x >= rect.x + rect.width || spot!.y < rect.y || spot!.y >= rect.y + rect.height, table.game).toBe(true);
    }
  });

  test('l\'octogone : un ring au milieu de sa salle, contre le mur nord, sur des cases libres ; plus de panneau « EN TRAVAUX »', () => {
    const room = areaOf('arena');
    expect(map.signs).toEqual([]);
    const ring = map.arena!;
    expect(ring).toEqual({ x: 68 * tile, y: 2 * tile, width: 10 * tile, height: 6 * tile });
    const [x0, y0] = [tileOf(ring.x), tileOf(ring.y)];
    expect(inside(room, x0, y0) && inside(room, x0 + 9, y0 + 5)).toBe(true);
    for (let y = y0; y < y0 + 6; y++) for (let x = x0; x < x0 + 10; x++) expect(map.blocked[y * map.widthTiles + x], `${x}, ${y}`).toBe(0);
    expect(map.speakers.some((s) => s.place === 'arena')).toBe(true);
  });
});

describe('les meubles et les objets animés', () => {
  const objets = (json.layers.find((layer) => layer.name === 'objets') as TiledObjectLayer).objects;
  const props = (json.layers.find((layer) => layer.name === 'props') as TiledObjectLayer).objects;

  test('le calque d\'objets ne cite que des éléments de la banque, tous dans la carte', () => {
    expect(objets.length).toBeGreaterThan(100);
    for (const object of objets) {
      const item = decorItem(object.name);
      expect(item, object.name).toBeDefined();
      expect(object.x / tile, object.name).toBeGreaterThanOrEqual(0);
      expect(object.x / tile + item!.w, object.name).toBeLessThanOrEqual(OFFICE_WIDTH);
      expect(object.y / tile, object.name).toBeLessThan(OFFICE_HEIGHT);
    }
  });

  test('le calque `props` ne cite que des objets animés connus, tous dans la carte ; ceux qui sont solides bloquent leur empreinte', () => {
    expect(props.length).toBeGreaterThan(15);
    for (const object of props) {
      const prop = propByKey(object.name);
      expect(prop, object.name).toBeDefined();
      expect(object.type).toBe('prop');
      expect(object.x / tile + prop!.w, object.name).toBeLessThanOrEqual(OFFICE_WIDTH);
      expect(object.y / tile - (prop!.h - prop!.claim), object.name).toBeGreaterThanOrEqual(0);
      if (!prop!.solid) continue;
      for (let y = object.y / tile; y < object.y / tile + prop!.claim; y++) {
        for (let x = object.x / tile; x < object.x / tile + prop!.w; x++) expect(walkable(x, y), `${object.name} en ${x}, ${y}`).toBe(false);
      }
    }
  });

  test('la salle de sport a trois tapis de course et deux sacs de frappe, la salle de jeu sa cheminée et des bougies, le salon son aquarium, le café sa machine', () => {
    const count = (key: string, room: string) => props.filter((p) => p.name.startsWith(key) && inside(areaOf(room), p.x / tile, p.y / tile)).length;
    expect(count('treadmill', 'gym')).toBe(3);
    expect(count('punching-bag', 'gym')).toBe(2);
    expect(count('chimney', 'game')).toBe(1);
    expect(count('candle', 'game') + count('wall-candle', 'game')).toBeGreaterThanOrEqual(2);
    expect(count('fishtank', 'lounge')).toBe(1);
    expect(count('coffee', 'cafe')).toBe(1);
    expect(props.filter((p) => p.name === 'coffee')).toHaveLength(1);
  });

  test('une enceinte animée à chaque enceinte de la carte', () => {
    for (const speaker of map.speakers) {
      const [sx, sy] = [tileOf(speaker.x), tileOf(speaker.y)];
      const there = props.some((p) => p.name.startsWith('amplifier') && p.x / tile <= sx && sx < p.x / tile + p.width / tile && p.y / tile <= sy && sy < p.y / tile + p.height / tile);
      expect(there, `enceinte de ${speaker.place}`).toBe(true);
    }
  });

  test('aucun meuble ni objet animé dans un bureau : leur déco est celle de l\'occupant', () => {
    for (const slot of OFFICE_DESK_SLOTS) {
      for (const object of [...objets, ...props]) {
        expect(inside(slot.room, Math.floor(object.x / tile), Math.floor(object.y / tile)), `${object.name} dans ${slot.key}`).toBe(false);
      }
    }
  });

  test('ni sur la rangée de la rue devant un bureau, sur la largeur de sa pièce : c\'est son dehors ; seuls les éléments muraux s\'y accrochent, à la face du mur', () => {
    for (const slot of OFFICE_DESK_SLOTS) {
      const front = { x: slot.room.x, y: slot.room.y + slot.room.h + 2, w: slot.room.w, h: 1 };
      for (const object of objets) {
        const item = decorItem(object.name)!;
        if (item.kind === 'wall') continue;
        const f = footprintOf(item, { x: object.x / tile, y: object.y / tile });
        const touches = f.x < front.x + front.w && front.x < f.x + f.w && f.y < front.y + front.h && front.y < f.y + f.h;
        expect(touches, `${object.name} en ${f.x}, ${f.y}, devant ${slot.key}`).toBe(false);
      }
      for (const object of props) expect(inside(front, object.x / tile, object.y / tile), `${object.name} devant ${slot.key}`).toBe(false);
    }
  });
});

describe('le dehors des bureaux', () => {
  const specOf = (key: string) => deskRoomSpecOf(map, key)!;

  test('chacun des six en a un : la face de son mur sud et la rangée de la rue dessous (y 11 en haut, y 26 en bas), libre sur toute sa largeur', () => {
    for (const slot of OFFICE_DESK_SLOTS) {
      const spec = specOf(slot.key);
      expect(spec.outside, slot.key).toBeDefined();
      const row = slot.room.y + outsideRow(spec);
      expect(row, slot.key).toBe(slot.doorSide === 'south' ? 11 : 26);
      for (let x = slot.room.x; x < slot.room.x + slot.room.w; x++) expect(walkable(x, row), `${slot.key} : ${x}, ${row}`).toBe(true);
      expect(placeAt(map, centre(slot.room.x), centre(row))?.kind, slot.key).toBe('street');
    }
  });

  test('ce que la carte accroche à ces murs : l\'interrupteur devant A2, le panneau de sortie devant A5 et devant A6, rien devant les autres', () => {
    const fixtures = Object.fromEntries(OFFICE_DESK_SLOTS.map((slot) => [slot.key, specOf(slot.key).outside!.fixtures]));
    expect(fixtures).toEqual({
      A1: [],
      A2: [{ x: 8, y: 8, w: 1, h: 1 }],
      A3: [],
      A4: [],
      A5: [{ x: 0, y: 8, w: 1, h: 1 }],
      A6: [{ x: 0, y: 8, w: 1, h: 1 }],
    });
  });

  test('la face du mur sud prend la couleur que l\'occupant choisit : ses deux rangées sont des murs de la pièce, sauf la porte', () => {
    for (const slot of OFFICE_DESK_SLOTS) {
      const band = slot.room.y + slot.room.h;
      const painted = new Set(slot.walls.map((cell) => `${cell.x},${cell.y}`));
      for (let x = slot.room.x; x < slot.room.x + slot.room.w; x++) {
        const door = slot.doorSide === 'south' && x >= slot.door.x && x < slot.door.x + slot.door.w;
        for (const y of [band, band + 1]) expect(painted.has(`${x},${y}`), `${slot.key} : ${x}, ${y}`).toBe(!door);
      }
    }
  });

  test('libre, chaque bureau garde au moins une plante devant lui (son dehors par défaut), et rien de solide dans l\'axe de sa porte', () => {
    for (const slot of OFFICE_DESK_SLOTS) {
      const spec = specOf(slot.key);
      const front = defaultDeskDecor(spec).items.filter((placed) => placed.y === outsideRow(spec));
      expect(front.some((placed) => decorItem(placed.id)!.cat === 'plantes'), slot.key).toBe(true);
      for (const placed of front) {
        const item = decorItem(placed.id)!;
        const inDoorAxis = placed.x < spec.door.x + spec.door.width && spec.door.x < placed.x + item.w;
        expect(item.solid && inDoorAxis, `${item.name} devant ${slot.key}`).toBe(false);
      }
    }
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
  const meeting = areaOf('meeting');
  const table = placed.find((d) => d.id === 'cf-0-1' && inside(meeting, d.x, d.y))!;
  const chairs = placed.filter((d) => d.item.cat === 'sieges' && inside(meeting, d.x, d.y));

  test('la table, de 4 × 2 cases au sol, est au milieu de la salle', () => {
    const f = footprintOf(table.item, table);
    expect([f.w, f.h]).toEqual([4, 2]);
    expect(f.x + f.w / 2).toBe(meeting.x + meeting.w / 2);
  });

  test('les chaises regardent la table et l\'écran : quatre de dos au sud, une de profil à chaque bout vers la table, aucune au nord (devant l\'écran)', () => {
    const f = footprintOf(table.item, table);
    const north = chairs.filter((c) => c.y === f.y - 1);
    const south = chairs.filter((c) => c.y === f.y + f.h);
    expect(north).toEqual([]);
    expect(south.map((c) => c.x).sort((a, b) => a - b)).toEqual([f.x, f.x + 1, f.x + 2, f.x + 3]);
    for (const chair of south) expect(chair.item.name, chair.id).toMatch(/\(de dos\)$/);
    expect(chairs.filter((c) => c.x === f.x - 1).map((c) => c.item.name)).toEqual(['Chaise grise (vers la droite)']);
    expect(chairs.filter((c) => c.x === f.x + f.w).map((c) => c.item.name)).toEqual(['Chaise grise (vers la gauche)']);
    expect(chairs).toHaveLength(6);
  });

  test('les cases qui bloquent sont celles de la table, des deux bibliothèques et de l\'enceinte, ni plus ni moins : jamais une chaise ni une lampe', () => {
    const cellsOf = (f: { x: number; y: number; w: number; h: number }) => Array.from({ length: f.w * f.h }, (_, i) => `${f.x + (i % f.w)},${f.y + Math.floor(i / f.w)}`);
    const blocked = new Set<string>();
    for (let y = meeting.y; y < meeting.y + meeting.h; y++) {
      for (let x = meeting.x; x < meeting.x + meeting.w; x++) if (!walkable(x, y)) blocked.add(`${x},${y}`);
    }
    const shelves = placed.filter((d) => d.item.cat === 'rangement' && inside(meeting, d.x, d.y));
    expect(shelves).toHaveLength(2);
    const speaker = map.speakers.find((s) => s.place === 'meeting')!;
    const expected = [...cellsOf(footprintOf(table.item, table)), ...shelves.flatMap((d) => cellsOf(footprintOf(d.item, d))), `${tileOf(speaker.x)},${tileOf(speaker.y)}`];
    expect([...blocked].sort()).toEqual(expected.sort());
  });
});

describe('les fontaines à eau', () => {
  test('jamais dans l\'axe d\'une porte ou d\'une arche, qu\'elles masqueraient', () => {
    const fountains = placed.filter((d) => d.item.name === 'Fontaine à eau');
    expect(fountains.length).toBeGreaterThan(0);
    for (const fountain of fountains) {
      for (const o of OFFICE_OPENINGS) {
        expect(fountain.x < o.x || fountain.x >= o.x + o.w, `fontaine en ${fountain.x}, ${o.key}`).toBe(true);
      }
    }
  });

  // Loin des bureaux : devant eux, la rangée est leur dehors, que leur occupant décore (la marche y dépendrait de qui l'occupe).
  test('sur la première rangée de la rue nord, un arbuste se traverse et la fontaine qui le suit arrête : (68, 11) et (63, 11), que vise la marche de bout en bout', () => {
    const shrub = placed.find((d) => d.x === 68 && d.y === 11 && d.item.cat === 'plantes');
    const fountain = placed.find((d) => d.x === 63 && d.y === 11 && d.item.name === 'Fontaine à eau');
    expect(shrub?.item.solid, 'l\'arbuste').toBe(false);
    expect(fountain?.item.solid, 'la fontaine').toBe(true);
    for (const x of [64, 65, 66, 67, 68, 69, 70]) expect(walkable(x, 11), `libre en ${x}, 11`).toBe(true);
    expect(walkable(63, 11), 'la fontaine arrête').toBe(false);
  });
});

describe('l\'interrupteur de lumière de la rue nord', () => {
  test('un seul, au centre de la case (28, 10) : la face du mur nord de la rue, entre la porte du grand bureau A2 et la place', () => {
    expect(OFFICE.zones.filter((zone) => zone.type === 'switch')).toEqual([{ type: 'switch', x: 28, y: 10, w: 1, h: 1 }]);
    expect(map.switches).toEqual([{ x: centre(28), y: centre(10) }]);
    const a2 = OFFICE_DESK_SLOTS.find((slot) => slot.key === 'A2')!.door;
    expect(28).toBeGreaterThanOrEqual(a2.x + a2.w);
    expect(28).toBeLessThan(areaOf('plaza').x);
  });

  test('sur un mur : la rangée qu\'on voit de la rue (y 11 à 13), dont le sol est libre juste dessous', () => {
    const [lightSwitch] = map.switches;
    expect(tileOf(lightSwitch!.y)).toBe(10);
    expect(walkable(28, 10)).toBe(false);
    for (const y of [11, 12, 13]) expect(walkable(28, y), `case 28, ${y}`).toBe(true);
    expect(placeAt(map, centre(28), centre(11))?.key).toBe('street-n');
    // Ce n'est ni une pièce ni un bureau : personne n'y est « dans » une zone.
    expect(zoneAt(map, lightSwitch!.x, lightSwitch!.y)).toBeNull();
  });

  test('on l\'atteint depuis la rue, à 3 cases au plus ; pas depuis le reste de la carte (l\'accueil, la place centrale)', () => {
    const feetAt = (tx: number, ty: number) => ({ x: centre(tx), y: centre(ty) });
    expect(withinSwitchReach(feetAt(28, 13), map.switches)).toBe(true);
    expect(withinSwitchReach(feetAt(26, 12), map.switches)).toBe(true);
    expect(withinSwitchReach(feetAt(34, 12), map.switches)).toBe(false);
    expect(withinSwitchReach(feetAt(28, 15), map.switches)).toBe(false);
    expect(withinSwitchReach(map.spawn, map.switches)).toBe(false);
  });
});

describe('l\'agencement : chaque siège regarde ce qu\'il sert, rien n\'est posé de travers', () => {
  const cells = (f: { x: number; y: number; w: number; h: number }): Array<[number, number]> =>
    Array.from({ length: f.w * f.h }, (_, i) => [f.x + (i % f.w), f.y + Math.floor(i / f.w)] as [number, number]);
  const facingOf = (name: string) => /\((?:.*, )?(de face|de dos|vers la gauche|vers la droite)\)/.exec(name)?.[1];
  const tables = placed.filter((d) => d.item.cat === 'bureaux' || (d.item.cat === 'cafe' && /^Table/.test(d.item.name)));
  const tableAt = (x: number, y: number) => tables.some((t) => cells(footprintOf(t.item, t)).some(([cx, cy]) => cx === x && cy === y));
  const propObjects = (json.layers.find((layer) => layer.name === 'props') as TiledObjectLayer).objects;

  test('un siège d\'une case contre une table la regarde : de face au nord, de dos au sud, vers la droite à l\'ouest, vers la gauche à l\'est', () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const seat of placed.filter((d) => d.item.cat === 'sieges' && d.item.w === 1)) {
      const facing = facingOf(seat.item.name);
      if (!facing) continue;
      const wanted = [
        tableAt(seat.x, seat.y + 1) && 'de face',   // la table est au sud du siège : il est au nord d'elle, il regarde vers le sud
        tableAt(seat.x, seat.y - 1) && 'de dos',
        tableAt(seat.x + 1, seat.y) && 'vers la droite',
        tableAt(seat.x - 1, seat.y) && 'vers la gauche',
      ].filter(Boolean);
      if (wanted.length !== 1) continue;
      checked++;
      if (wanted[0] !== facing) wrong.push(`${seat.item.name} en ${seat.x}, ${seat.y} : ${facing} au lieu de ${wanted[0]}`);
    }
    expect(wrong).toEqual([]);
    // Le café (4 tables de 4 chaises), les quatre tables de jeu (2, 2, 2 et 4) et la salle de réunion (4 de dos, 2 de profil).
    expect(checked).toBeGreaterThanOrEqual(30);
  });

  test('aucun siège ne bloque le passage : ses cases sont libres, sauf celles qu\'un meuble solide occupe déjà', () => {
    const solid = new Set<string>();
    for (const d of placed.filter((p) => p.item.solid)) for (const [x, y] of cells(footprintOf(d.item, d))) solid.add(`${x},${y}`);
    for (const object of propObjects) {
      const prop = propByKey(object.name)!;
      if (!prop.solid) continue;
      for (const [x, y] of cells({ x: object.x / tile, y: object.y / tile, w: prop.w, h: prop.claim })) solid.add(`${x},${y}`);
    }
    const seats = placed.filter((d) => d.item.cat === 'sieges');
    expect(seats.length).toBeGreaterThan(60);
    for (const seat of seats) {
      for (const [x, y] of cells(footprintOf(seat.item, seat))) {
        if (!solid.has(`${x},${y}`)) expect(walkable(x, y), `${seat.item.name} en ${x}, ${y}`).toBe(true);
      }
    }
  });

  test('les rangées de la salle de conférence regardent l\'écran : toutes les chaises sont de dos', () => {
    const conference = areaOf('conference');
    const chairs = placed.filter((d) => d.item.cat === 'sieges' && inside(conference, d.x, d.y));
    expect(chairs).toHaveLength(16);
    for (const chair of chairs) expect(facingOf(chair.item.name), chair.item.name).toBe('de dos');
  });

  test('chaque table de jeu a une chaise de face au nord et une de dos au sud (la ludo aussi une de profil à chaque bout, tournées vers elle)', () => {
    for (const table of map.tables) {
      const seats = table.seats.map((seat) => ({ x: tileOf(seat.x), y: tileOf(seat.y) }));
      const chairAt = (x: number, y: number) => placed.find((d) => d.item.cat === 'sieges' && d.x === x && d.y === y);
      const north = seats.find((s) => s.y < table.rect.y / tile)!;
      const south = seats.find((s) => s.y >= (table.rect.y + table.rect.height) / tile)!;
      expect(facingOf(chairAt(north.x, north.y)?.item.name ?? ''), `${table.game} nord`).toBe('de face');
      expect(facingOf(chairAt(south.x, south.y)?.item.name ?? ''), `${table.game} sud`).toBe('de dos');
      if (table.game === 'ludo') {
        const west = seats.find((s) => s.x < table.rect.x / tile)!;
        const east = seats.find((s) => s.x >= (table.rect.x + table.rect.width) / tile)!;
        expect(facingOf(chairAt(west.x, west.y)?.item.name ?? ''), 'ludo ouest').toBe('vers la droite');
        expect(facingOf(chairAt(east.x, east.y)?.item.name ?? ''), 'ludo est').toBe('vers la gauche');
      }
    }
  });

  test('quatre panneaux de sortie, pas un de plus : aux bouts des deux rues, sur la face du mur, au-dessus d\'une case libre, la flèche vers le bout', () => {
    const signs = placed.filter((d) => /^Panneau de sortie/.test(d.item.name));
    expect(signs).toHaveLength(4);
    for (const sign of signs) {
      expect(walkable(sign.x, sign.y), `sous le panneau en ${sign.x}, ${sign.y}`).toBe(true);
      expect(walkable(sign.x, sign.y - 1), `le mur du panneau en ${sign.x}, ${sign.y}`).toBe(false);
      const west = sign.x < OFFICE_WIDTH / 2;
      expect(west ? sign.x <= 3 : sign.x >= 70, `au bout de la rue : ${sign.x}`).toBe(true);
      expect(facingOf(sign.item.name), `${sign.x}, ${sign.y}`).toBe(west ? 'vers la gauche' : 'vers la droite');
    }
    // Deux dans la rue nord (y 11), deux dans la rue sud (y 26), un à l'ouest et un à l'est dans chacune.
    expect(signs.map((s) => `${s.x < OFFICE_WIDTH / 2 ? 'O' : 'E'}${s.y}`).sort()).toEqual(['E11', 'E26', 'O11', 'O26']);
  });

  test('les petits bureaux (A5, A6) sont tout à l\'ouest de leur rangée, les grands bureaux à leur droite', () => {
    const x = (key: string) => OFFICE_DESK_SLOTS.find((slot) => slot.key === key)!.room.x;
    expect([x('A5'), x('A1'), x('A2')]).toEqual([1, 9, 20]);
    expect([x('A6'), x('A3'), x('A4')]).toEqual([1, 9, 20]);
    for (const key of ['A5', 'A6']) expect(OFFICE_DESK_SLOTS.find((slot) => slot.key === key)!.room.w).toBe(6);
  });

  test('le café : la machine a son comptoir contre le mur, la case où l\'on se sert juste devant, et tout ce qui va avec (frigo, distributeurs, fontaine) à portée de main', () => {
    const [coffee] = map.coffees;
    const [cx, cy] = [tileOf(coffee!.x), tileOf(coffee!.y)];
    const counter = placed.find((d) => d.item.name === 'Comptoir d\'accueil' && inside(areaOf('cafe'), d.x, d.y))!;
    const f = footprintOf(counter.item, counter);
    expect(cx >= f.x && cx < f.x + f.w, 'la case de service est devant le comptoir').toBe(true);
    expect(cy, 'juste en dessous du comptoir').toBe(f.y + f.h);
    const machine = propObjects.find((p) => p.name === 'coffee')!;
    expect(machine.x / tile >= f.x && machine.x / tile < f.x + f.w, 'la machine est sur le comptoir').toBe(true);
    const pantry = placed.filter((d) => /^(Réfrigérateur|Distributeur|Fontaine)/.test(d.item.name) && inside(areaOf('cafe'), d.x, d.y));
    expect(pantry.length).toBeGreaterThanOrEqual(4);
    for (const item of pantry) expect(Math.abs(item.x - cx), item.item.name).toBeLessThanOrEqual(8);
  });

  test('l\'accueil : trois postes côte à côte, la réceptionniste brune entre deux blondes, avec l\'horloge à côté', () => {
    const posts = propObjects.filter((p) => p.name.startsWith('receptionist')).sort((a, b) => a.x - b.x);
    expect(posts.map((p) => p.name)).toEqual(['receptionist', 'receptionist-2', 'receptionist']);
    expect(new Set(posts.map((p) => p.y)).size).toBe(1);
    expect(posts.map((p) => p.x / tile - posts[0]!.x / tile)).toEqual([0, 1, 2]);
    const clock = propObjects.find((p) => p.name === 'grandfather-clock')!;
    expect(clock.x / tile).toBe(posts[0]!.x / tile - 1);
    expect(placeAt(map, posts[1]!.x + tile / 2, posts[1]!.y + tile / 2)?.key).toBe('reception');
  });

  test('les administratrices : une à chaque poste de l\'accueil (Margot, Inès, Lucie), sur la case de sa réceptionniste, et l\'on se tient devant elle', () => {
    const posts = propObjects.filter((p) => p.name.startsWith('receptionist')).sort((a, b) => a.x - b.x);
    expect(map.clerks.map((clerk) => clerk.name)).toEqual(['margot', 'ines', 'lucie']);
    // Un objet animé de la carte est rangé par son empreinte au sol (en pixels) : sa case est celle de son coin haut-gauche.
    expect(map.clerks.map((clerk) => [tileOf(clerk.x), tileOf(clerk.y)])).toEqual(posts.map((post) => [post.x / tile, post.y / tile]));
    for (const clerk of map.clerks) expect(walkable(tileOf(clerk.x), tileOf(clerk.y) + 1), `devant ${clerk.name}`).toBe(true);
  });
});
