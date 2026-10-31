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
const ROOMS = ['conference', 'game', 'gym', 'arena'] as const;

// Le bâtiment, en cases de la carte : 81 × 46, à 5 cases du bord ; le jardin fait le tour.
const BUILDING = { x: 5, y: 5, w: 81, h: 46 };

describe('la carte du bureau', () => {
  test('91 × 56 cases (un bâtiment de 81 × 46 et un jardin de 5 cases tout autour), bien plus grande que la carte de développement (24 × 16)', () => {
    expect([map.widthTiles, map.heightTiles]).toEqual([OFFICE_WIDTH, OFFICE_HEIGHT]);
    expect([OFFICE_WIDTH, OFFICE_HEIGHT]).toEqual([91, 56]);
    expect(map.widthTiles * map.heightTiles).toBeGreaterThan(9 * 24 * 16);
  });

  test('6 places de bureau, de clés A1 à A6, chacune avec sa pièce (zone desk) et sa porte (zone door)', () => {
    const desks = map.zones.filter((zone) => zone.type === 'desk');
    const doors = map.zones.filter((zone) => zone.type === 'door');
    expect(desks.map(deskKey).sort()).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
    expect(doors.map((door) => door.name).sort()).toEqual(desks.map(deskKey).sort());
    expect(OFFICE_DESK_SLOTS.map((slot) => slot.key)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
  });

  test('A1 à A4 font 9 × 7, A5 et A6 6 × 7 ; toutes ont leur porte au sud de la pièce, sur la rue', () => {
    const specs = Object.fromEntries(OFFICE_DESK_SLOTS.map((slot) => [slot.key, deskRoomSpecOf(map, slot.key)!]));
    for (const key of ['A1', 'A2', 'A3', 'A4']) expect([specs[key]!.width, specs[key]!.height], key).toEqual([DESK_ROOMS.standard.width, DESK_ROOMS.standard.height]);
    for (const key of ['A5', 'A6']) expect([specs[key]!.width, specs[key]!.height], key).toEqual([DESK_ROOMS.compact.width, DESK_ROOMS.compact.height]);
    for (const slot of OFFICE_DESK_SLOTS) expect(specs[slot.key]!.door.side, slot.key).toBe('south');
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
      expect(open.sort(), `place ${slot.key}`).toEqual([0, 1].map((i) => `${slot.door.x + i},${slot.room.y + slot.room.h}`).sort());
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

  test('chaque salle est fermée par des murs, sauf à ses ouvertures (dans une bande ou dans un pan de mur)', () => {
    const inOpening = (x: number, y: number) => OFFICE_OPENINGS.some((o) => x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h);
    for (const key of ROOMS) {
      const room = areaOf(key);
      const ring: Array<[number, number]> = [];
      for (let x = room.x; x < room.x + room.w; x++) ring.push([x, room.y - 1], [x, room.y + room.h]);
      for (let y = room.y; y < room.y + room.h; y++) ring.push([room.x - 1, y], [room.x + room.w, y]);
      const open = ring.filter(([x, y]) => walkable(x, y));
      expect(open.filter(([x, y]) => !inOpening(x, y)), key).toEqual([]);
      // Et chacune de ses ouvertures y donne bien.
      for (const o of OFFICE_OPENINGS.filter((opening) => opening.room === key)) {
        expect(open.some(([x, y]) => x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h), `${o.key}`).toBe(true);
      }
    }
  });

  test('chaque porte et chaque passage débouche sur du libre des deux côtés', () => {
    expect(OFFICE_OPENINGS).toHaveLength(6 + 5);   // six bureaux ; la conférence, les jeux, le sport, la boxe, l'entrée
    for (const o of OFFICE_OPENINGS) {
      // Une ouverture plus large que haute perce une bande (on la traverse du nord au sud) ; sinon un pan de mur (d'ouest en est).
      const across = o.w >= o.h && o.h === 2 && o.key !== 'arch:conference' && o.key !== 'arch:game' && o.key !== 'arch:arena';
      for (let i = 0; i < (across ? o.w : o.h); i++) {
        const cells: Array<[number, number]> = across
          ? Array.from({ length: o.h + 2 }, (_, j) => [o.x + i, o.y - 1 + j] as [number, number])
          : Array.from({ length: o.w + 2 }, (_, j) => [o.x - 1 + j, o.y + i] as [number, number]);
        for (const [x, y] of cells) expect(walkable(x, y), `${o.key} (${o.room}) en ${x}, ${y}`).toBe(true);
      }
    }
  });

  test('les bandes de mur qui bordent les pièces ne sont percées qu\'aux ouvertures de la liste', () => {
    const openings = new Set(OFFICE_OPENINGS.flatMap((o) => Array.from({ length: o.w * o.h }, (_, i) => `${o.x + (i % o.w)},${o.y + Math.floor(i / o.w)}`)));
    // Les bandes de 2 cases : celle des bureaux (y 14-15), au nord et au sud de la conférence et de la salle de jeux (y 19-20 et 33-34), au nord de la salle
    // de sport (y 35-36), et le mur du sud du bâtiment (y 49-50), que perce l'entrée.
    const bands = [
      { ys: [14, 15], x0: 18, x1: 72 },
      { ys: [19, 20, 33, 34], x0: 5, x1: 21 },
      { ys: [19, 20, 33, 34], x0: 62, x1: 85 },
      { ys: [35, 36], x0: 39, x1: 62 },
      { ys: [49, 50], x0: 5, x1: 85 },
    ];
    const stray: string[] = [];
    for (const band of bands) {
      for (const y of band.ys) for (let x = band.x0; x <= band.x1; x++) if (walkable(x, y) && !openings.has(`${x},${y}`)) stray.push(`${x},${y}`);
    }
    expect(stray).toEqual([]);
  });

  test('tout est atteignable à pied depuis le point d\'apparition : chaque bureau, chaque salle, le jardin', () => {
    const reachable = reachableFrom(map, tileOf(map.spawn.x), tileOf(map.spawn.y));
    const at = (x: number, y: number) => reachable.has(y * map.widthTiles + x);
    for (const slot of OFFICE_DESK_SLOTS) {
      expect(at(slot.door.x, slot.door.y), `porte de ${slot.key}`).toBe(true);
      expect(at(slot.room.x + 3, slot.room.y + slot.room.h - 1), `pièce ${slot.key}`).toBe(true);
    }
    for (const key of ROOMS) {
      const room = areaOf(key);
      const reached = [];
      for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) if (walkable(x, y) && at(x, y)) reached.push(1);
      expect(reached.length, key).toBeGreaterThan(room.w * room.h * 0.4);
    }
    // Le chemin du tour, aux quatre coins, et les deux terrasses.
    for (const [x, y] of [[3, 3], [87, 3], [3, 52], [87, 52], [8, 17], [82, 17]] as const) expect(at(x, y), `${x}, ${y}`).toBe(true);
  });

  test('chaque case libre de la carte est atteignable : aucun meuble, aucun buisson n\'enferme un coin', () => {
    const reachable = reachableFrom(map, tileOf(map.spawn.x), tileOf(map.spawn.y));
    const stuck: string[] = [];
    for (let ty = 0; ty < map.heightTiles; ty++) {
      for (let tx = 0; tx < map.widthTiles; tx++) {
        if (walkable(tx, ty) && !reachable.has(ty * map.widthTiles + tx)) stuck.push(`${tx},${ty}`);
      }
    }
    expect(stuck).toEqual([]);
  });

  test('le point d\'apparition est à l\'accueil, devant le comptoir : (14, 41)', () => {
    expect(OFFICE_SPAWN).toEqual({ x: 14, y: 41 });
    expect([tileOf(map.spawn.x), tileOf(map.spawn.y)]).toEqual([14, 41]);
    expect(placeAt(map, map.spawn.x, map.spawn.y)?.key).toBe('reception');
    expect(zoneAt(map, map.spawn.x, map.spawn.y)).toBeNull();
  });

  test('l\'entrée : une ouverture de 4 cases dans le mur du sud, du hall au jardin, le paillasson devant, sur l\'allée', () => {
    const entrance = OFFICE_OPENINGS.find((o) => o.key === 'arch:entrance')!;
    expect(entrance).toMatchObject({ x: 32, y: 49, w: 4, h: 2, room: 'hall' });
    for (let x = 32; x < 36; x++) for (const y of [48, 49, 50, 51, 52]) expect(walkable(x, y), `${x}, ${y}`).toBe(true);
    expect(placeAt(map, centre(33), centre(48))?.key).toBe('hall');
    expect(placeAt(map, centre(33), centre(51))?.key).toBe('garden');
    const mat = buildOffice().canvas.decor.find((d) => d.id === 'paillasson-entree')!;
    expect([mat.x, mat.y]).toEqual([32, 51]);
  });

  test('le bassin du jardin de l\'angle ouest : une étendue d\'eau (zone water) où l\'on ne marche pas ; on en fait le tour', () => {
    expect(map.waters).toEqual([{ x: 13 * tile, y: 9 * tile, width: 4 * tile, height: 3 * tile }]);
    for (let y = 9; y < 12; y++) for (let x = 13; x < 17; x++) expect(walkable(x, y), `${x}, ${y}`).toBe(false);
    expect(walkable(13, 12)).toBe(true);
    expect(placeAt(map, centre(14), centre(10))?.key).toBe('garden');
  });
});

describe('le jardin', () => {
  const kindAt = (x: number, y: number) => placeAt(map, centre(x), centre(y))?.kind;
  const inBuilding = (x: number, y: number) => x >= BUILDING.x && x < BUILDING.x + BUILDING.w && y >= BUILDING.y && y < BUILDING.y + BUILDING.h;

  test('dehors : toute case hors du bâtiment est au jardin ; dans les deux angles du nord, le jardin, puis la terrasse où débouche la rue', () => {
    for (let y = 0; y < OFFICE_HEIGHT; y++) {
      for (let x = 0; x < OFFICE_WIDTH; x++) if (!inBuilding(x, y)) expect(placeAt(map, centre(x), centre(y))?.key, `${x}, ${y}`).toBe('garden');
    }
    expect(placeByKey(map, 'garden')!.rects).toHaveLength(6);
    expect(placeByKey(map, 'terrace')!.rects).toHaveLength(2);
    for (const [x, y] of [[10, 8], [80, 8]] as const) expect(placeAt(map, centre(x), centre(y))?.key, `${x}, ${y}`).toBe('garden');
    for (const [x, y] of [[10, 16], [80, 16]] as const) expect(placeAt(map, centre(x), centre(y))?.key, `${x}, ${y}`).toBe('terrace');
    expect(kindAt(45, 25)).toBe('open');
  });

  test('les angles ouverts n\'ont aucun mur : de la rue des bureaux, on passe sur la terrasse puis au jardin sans porte', () => {
    for (let y = 5; y < 19; y++) {
      for (const x of [5, 17, 73, 85]) expect(map.blocked[y * map.widthTiles + x] === 0 || !walkable(x, y), `${x}, ${y}`).toBe(true);
    }
    // La rue (y 16 à 18) se prolonge sur les terrasses, jusqu'au jardin du tour.
    for (const x of [6, 10, 16, 18, 72, 74, 80, 84]) expect(walkable(x, 17), `${x}, 17`).toBe(true);
    expect(walkable(4, 17)).toBe(true);
    expect(walkable(86, 17)).toBe(true);
  });

  test('un chemin de dalles fait le tour, deux cases de large, libre de bout en bout ; une haie au bord de la carte', () => {
    const free: string[] = [];
    for (let x = 2; x <= 88; x++) for (const y of [2, 3, 52, 53]) if (!walkable(x, y)) free.push(`${x},${y}`);
    for (let y = 2; y <= 53; y++) for (const x of [2, 3, 87, 88]) if (!walkable(x, y)) free.push(`${x},${y}`);
    expect(free).toEqual([]);
    // Au bord de la carte, la haie arrête l'avatar (sauf sous un arbre ou un gros buisson, qui la remplacent).
    const hedge = (x: number, y: number) => !walkable(x, y);
    expect([...Array(OFFICE_WIDTH).keys()].filter((x) => hedge(x, 0)).length).toBeGreaterThan(OFFICE_WIDTH * 0.9);
  });
});

describe('les lieux', () => {
  // clé, nom, genre, ambiance par défaut, musique réglable, destination d'un mode
  const EXPECTED: Array<[string, string, Place['kind'], Place['scene'], boolean, boolean]> = [
    ['cafe', 'Cafétéria', 'open', 'sunny', true, false],
    ['reception', 'Accueil', 'open', 'lobby', true, false],
    ['hall', "Hall d'entrée", 'open', 'lobby', false, false],
    ['street', 'Couloir', 'street', 'lobby', false, false],
    ['conference', 'Salle de conférence', 'room', 'drift', true, false],
    ['game', 'Salle de jeux', 'room', 'dusk', true, true],
    ['gym', 'Salle de sport', 'room', 'quest', true, true],
    ['arena', 'Salle de boxe', 'room', 'quest', true, false],
    ['terrace', 'Terrasse', 'outside', 'lobby', false, false],
    ['garden', 'Jardin', 'outside', 'lobby', false, false],
  ];

  test('dix lieux déclarés, avec leur nom, leur genre, leur ambiance, leur musique et leur destination', () => {
    expect(map.places.map((p) => [p.key, p.label, p.kind, p.scene, p.music, p.destination])).toEqual(EXPECTED);
  });

  test('les rectangles sont ceux du plan de masse', () => {
    expect(areaOf('cafe')).toEqual({ x: 22, y: 19, w: 40, h: 16 });
    expect(areaOf('reception')).toEqual({ x: 6, y: 35, w: 22, h: 14 });
    expect(areaOf('hall')).toEqual({ x: 28, y: 35, w: 11, h: 14 });
    expect(areaOf('street')).toEqual({ x: 18, y: 16, w: 55, h: 3 });
    expect(areaOf('conference')).toEqual({ x: 6, y: 21, w: 15, h: 12 });
    expect(areaOf('game')).toEqual({ x: 63, y: 21, w: 22, h: 12 });
    expect(areaOf('gym')).toEqual({ x: 40, y: 37, w: 22, h: 12 });
    expect(areaOf('arena')).toEqual({ x: 63, y: 35, w: 22, h: 14 });
    expect(placeByKey(map, 'terrace')!.rects.map((r) => [r.x / tile, r.y / tile, r.width / tile, r.height / tile])).toEqual([[5, 15, 13, 4], [73, 15, 13, 4]]);
  });

  test('le lieu d\'un point : le plus petit qui le contient (un bureau dans sa zone)', () => {
    const at = (x: number, y: number) => placeAt(map, centre(x), centre(y))?.key;
    expect(at(44, 25)).toBe('cafe');
    expect(at(14, 41)).toBe('reception');
    expect(at(33, 45)).toBe('hall');
    expect(at(40, 17)).toBe('street');
    expect(at(12, 26)).toBe('conference');
    expect(at(70, 26)).toBe('game');
    expect(at(50, 42)).toBe('gym');
    expect(at(74, 40)).toBe('arena');
    // Les six bureaux, d'ouest en est : A5 (compact), A1 à A4, A6 (compact).
    expect([21, 30, 40, 50, 60, 69].map((x) => at(x, 10))).toEqual(['desk:A5', 'desk:A1', 'desk:A2', 'desk:A3', 'desk:A4', 'desk:A6']);
  });

  test('la salle de jeux et la salle de sport sont les seules destinations ; les pièces fermées sont aussi des zones privées', () => {
    expect(map.places.filter((p) => p.destination).map((p) => p.key)).toEqual(['game', 'gym']);
    const privates = map.zones.filter((zone) => zone.type === 'private').map((zone) => zone.name);
    expect(privates.sort()).toEqual(['Salle de boxe', 'Salle de conférence', 'Salle de jeux', 'Salle de sport']);
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

  test('la machine à café a sa case libre devant elle, à la cafétéria', () => {
    expect(map.coffees).toHaveLength(1);
    const [coffee] = map.coffees;
    const [cx, cy] = [tileOf(coffee!.x), tileOf(coffee!.y)];
    expect(walkable(cx, cy)).toBe(true);
    expect(placeAt(map, coffee!.x, coffee!.y)?.key).toBe('cafe');
    const props = (json.layers.find((layer) => layer.name === 'props') as TiledObjectLayer).objects;
    const machine = props.find((p) => p.name === 'coffee')!;
    // La machine est sur le bar, dans la colonne de la case, sur sa rangée de devant : on se sert juste en dessous, au tabouret.
    expect([machine.x / tile, machine.y / tile + 1]).toEqual([cx, cy]);
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
      // Les tables sont dans la salle de jeux, et il y a de la place pour y poser du monde tout autour.
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

  test('l\'octogone : un ring au milieu de la salle de boxe, sur des cases libres, le public sur les bancs du sud ; pas de panneau', () => {
    const room = areaOf('arena');
    expect(map.signs).toEqual([]);
    const ring = map.arena!;
    expect(ring).toEqual({ x: 69 * tile, y: 37 * tile, width: 10 * tile, height: 7 * tile });
    const [x0, y0] = [tileOf(ring.x), tileOf(ring.y)];
    expect(inside(room, x0, y0) && inside(room, x0 + 9, y0 + 6)).toBe(true);
    for (let y = y0; y < y0 + 7; y++) for (let x = x0; x < x0 + 10; x++) expect(map.blocked[y * map.widthTiles + x], `${x}, ${y}`).toBe(0);
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

  test('la salle de sport a trois tapis de course, la salle de boxe deux sacs de frappe, la salle de jeux sa cheminée et des bougies, la cafétéria sa machine', () => {
    const count = (key: string, room: string) => props.filter((p) => p.name.startsWith(key) && inside(areaOf(room), p.x / tile, p.y / tile)).length;
    expect(count('treadmill', 'gym')).toBe(3);
    expect(count('punching-bag', 'arena')).toBe(2);
    expect(count('chimney', 'game')).toBe(1);
    expect(count('candle', 'game') + count('wall-candle', 'game')).toBeGreaterThanOrEqual(2);
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

  test('ni sur la rangée de la rue devant un bureau, sur la largeur de sa pièce : c\'est son dehors', () => {
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

  test('chacun des six en a un : la face de son mur sud et la rangée de la rue dessous (y 16), libre sur toute sa largeur', () => {
    for (const slot of OFFICE_DESK_SLOTS) {
      const spec = specOf(slot.key);
      expect(spec.outside, slot.key).toBeDefined();
      const row = slot.room.y + outsideRow(spec);
      expect(row, slot.key).toBe(16);
      for (let x = slot.room.x; x < slot.room.x + slot.room.w; x++) expect(walkable(x, row), `${slot.key} : ${x}, ${row}`).toBe(true);
      expect(placeAt(map, centre(slot.room.x), centre(row))?.kind, slot.key).toBe('street');
    }
  });

  test('la carte n\'accroche rien à ces murs : l\'interrupteur est entre deux bureaux, au droit de leur pan commun', () => {
    for (const slot of OFFICE_DESK_SLOTS) expect(specOf(slot.key).outside!.fixtures, slot.key).toEqual([]);
  });

  test('la face du mur sud prend la couleur que l\'occupant choisit : ses deux rangées sont des murs de la pièce, sauf la porte', () => {
    for (const slot of OFFICE_DESK_SLOTS) {
      const band = slot.room.y + slot.room.h;
      const painted = new Set(slot.walls.map((cell) => `${cell.x},${cell.y}`));
      for (let x = slot.room.x; x < slot.room.x + slot.room.w; x++) {
        const door = x >= slot.door.x && x < slot.door.x + slot.door.w;
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

  test('un lieu en plusieurs rectangles : ses zones de même clé se réunissent ; de même clé mais d\'autres propriétés, refusé', () => {
    expect(OFFICE.zones.filter((zone) => zone.type === 'place' && zone.name === 'garden')).toHaveLength(6);
    const zones = OFFICE.zones.map((zone) => (zone.type === 'place' && zone.name === 'terrace' && zone.x > 40 ? { ...zone, props: { ...zone.props, label: 'Balcon' } } : zone));
    expect(() => parseOfficeMap(buildTiledMap({ ...base, zones }))).toThrow(/deux lieux portent la clé « terrace » sans avoir les mêmes propriétés/);
  });
});

// Ce que la carte pose : les éléments de la banque, par leur case de départ.
const placed = buildOffice().canvas.decor.map((d) => ({ ...d, item: decorItem(d.id)! }));

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
    // La conférence (8 de face, 8 de dos, un à chaque bout) et les quatre tables de jeu (2, 2, 2 et 4).
    expect(checked).toBeGreaterThanOrEqual(28);
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
    expect(seats.length).toBeGreaterThan(50);
    for (const seat of seats) {
      for (const [x, y] of cells(footprintOf(seat.item, seat))) {
        if (!solid.has(`${x},${y}`)) expect(walkable(x, y), `${seat.item.name} en ${x}, ${y}`).toBe(true);
      }
    }
  });

  test('la salle de conférence : la grande table au milieu, huit fauteuils de chaque côté et un à chaque bout, tous tournés vers elle', () => {
    const room = areaOf('conference');
    const table = placed.find((d) => d.id === 'table-conference')!;
    const f = footprintOf(table.item, table);
    expect(inside(room, f.x, f.y) && inside(room, f.x + f.w - 1, f.y + f.h - 1)).toBe(true);
    expect(f.x + f.w / 2).toBe(room.x + room.w / 2);
    const chairs = placed.filter((d) => d.item.cat === 'sieges' && inside(room, d.x, d.y));
    expect(chairs.filter((c) => c.y === f.y - 1).map((c) => facingOf(c.item.name))).toEqual(Array(8).fill('de face'));
    expect(chairs.filter((c) => c.y === f.y + f.h).map((c) => facingOf(c.item.name))).toEqual(Array(8).fill('de dos'));
    expect(chairs.filter((c) => c.x === f.x - 1).map((c) => facingOf(c.item.name))).toEqual(['vers la droite']);
    expect(chairs.filter((c) => c.x === f.x + f.w).map((c) => facingOf(c.item.name))).toEqual(['vers la gauche']);
    expect(chairs).toHaveLength(18);
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

  test('les petits bureaux (A5, A6) aux deux bouts de la rangée, les grands entre eux', () => {
    const x = (key: string) => OFFICE_DESK_SLOTS.find((slot) => slot.key === key)!.room.x;
    expect(['A5', 'A1', 'A2', 'A3', 'A4', 'A6'].map(x)).toEqual([19, 26, 36, 46, 56, 66]);
    for (const key of ['A5', 'A6']) expect(OFFICE_DESK_SLOTS.find((slot) => slot.key === key)!.room.w).toBe(6);
  });

  test('la cafétéria : la machine sur le bar, la case où l\'on se sert juste devant, et derrière le bar ce qui va avec (frigo, distributeur, fontaine)', () => {
    const [coffee] = map.coffees;
    const [cx, cy] = [tileOf(coffee!.x), tileOf(coffee!.y)];
    const bar = placed.find((d) => d.id === 'bar-cafeteria')!;
    const f = footprintOf(bar.item, bar);
    expect(cx >= f.x && cx < f.x + f.w, 'la case de service est devant le bar').toBe(true);
    expect(cy, 'juste en dessous du bar').toBe(f.y + f.h);
    const machine = propObjects.find((p) => p.name === 'coffee')!;
    expect(machine.x / tile >= f.x && machine.x / tile < f.x + f.w, 'la machine est sur le bar').toBe(true);
    const pantry = placed.filter((d) => /^(Réfrigérateur|Distributeur|Fontaine)/.test(d.item.name) && inside(areaOf('cafe'), d.x, d.y));
    expect(pantry.length).toBeGreaterThanOrEqual(3);
    for (const item of pantry) {
      expect(Math.abs(item.x - cx), item.item.name).toBeLessThanOrEqual(8);
      expect(item.y, `${item.item.name} : derrière le bar`).toBeLessThan(f.y);
    }
  });

  test('l\'accueil : trois réceptionnistes côte à côte sur le comptoir, la brune entre deux blondes ; l\'horloge comtoise contre le mur', () => {
    const posts = propObjects.filter((p) => p.name.startsWith('receptionist')).sort((a, b) => a.x - b.x);
    expect(posts.map((p) => p.name)).toEqual(['receptionist-seule', 'receptionist-2-seule', 'receptionist-seule']);
    expect(new Set(posts.map((p) => p.y)).size).toBe(1);
    expect(posts.map((p) => p.x / tile - posts[0]!.x / tile)).toEqual([0, 1, 2]);
    const counter = placed.find((d) => d.id === 'comptoir-accueil')!;
    const f = footprintOf(counter.item, counter);
    for (const post of posts) expect(inside(f, post.x / tile, post.y / tile), post.name).toBe(true);
    const clock = propObjects.find((p) => p.name === 'grandfather-clock')!;
    expect(placeAt(map, clock.x + tile / 2, clock.y + tile / 2)?.key).toBe('reception');
    expect(walkable(clock.x / tile, clock.y / tile - 1)).toBe(false);   // le mur, juste derrière
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

describe('l\'interrupteur de lumière de la rue des bureaux', () => {
  test('un seul, au centre de la case (35, 15) : sur la face de la bande des bureaux, entre la porte de A1 et celle de A2', () => {
    expect(OFFICE.zones.filter((zone) => zone.type === 'switch')).toEqual([{ type: 'switch', x: 35, y: 15, w: 1, h: 1 }]);
    expect(map.switches).toEqual([{ x: centre(35), y: centre(15) }]);
    const doorOf = (key: string) => OFFICE_DESK_SLOTS.find((slot) => slot.key === key)!.door;
    expect(35).toBeGreaterThanOrEqual(doorOf('A1').x + doorOf('A1').w);
    expect(35).toBeLessThan(doorOf('A2').x);
  });

  test('sur un mur : la rangée qu\'on voit de la rue (y 16 à 18), dont le sol est libre juste dessous', () => {
    const [lightSwitch] = map.switches;
    expect(tileOf(lightSwitch!.y)).toBe(15);
    expect(walkable(35, 15)).toBe(false);
    for (const y of [16, 17, 18]) expect(walkable(35, y), `case 35, ${y}`).toBe(true);
    expect(placeAt(map, centre(35), centre(16))?.key).toBe('street');
    // Ce n'est ni une pièce ni un bureau : personne n'y est « dans » une zone.
    expect(zoneAt(map, lightSwitch!.x, lightSwitch!.y)).toBeNull();
  });

  test('on l\'atteint depuis la rue, à 3 cases au plus ; pas depuis le reste de la carte (l\'accueil, la cafétéria)', () => {
    const feetAt = (tx: number, ty: number) => ({ x: centre(tx), y: centre(ty) });
    expect(withinSwitchReach(feetAt(35, 18), map.switches)).toBe(true);
    expect(withinSwitchReach(feetAt(33, 17), map.switches)).toBe(true);
    expect(withinSwitchReach(feetAt(41, 17), map.switches)).toBe(false);
    expect(withinSwitchReach(feetAt(35, 20), map.switches)).toBe(false);
    expect(withinSwitchReach(map.spawn, map.switches)).toBe(false);
  });
});
