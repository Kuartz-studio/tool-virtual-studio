import { describe, expect, test } from 'vitest';
import {
  GAME_IDS,
  MUSIC_SCENES,
  MapError,
  ZONE_TYPES,
  buildTiledMap,
  deskRoomSpecOf,
  freeSpotIn,
  parseOfficeMap,
  placeAt,
  placeByKey,
  type TiledMapJson,
  type TiledObject,
  type TiledObjectLayer,
  type ZoneInput,
} from '../src';

// Une carte de 30 × 14 cases, vide, avec ses murs de pourtour : tout ce qui compte est dans ses zones (les cases sont des pixels de 32).
const WIDTH = 30;
const HEIGHT = 14;
const ascii = Array.from({ length: HEIGHT }, (_, y) => (y === 0 || y === HEIGHT - 1 ? '#'.repeat(WIDTH) : `#${'.'.repeat(WIDTH - 2)}#`));
const tileset = { name: 'dev', image: 'tiles.png' };
const px = (tiles: number) => tiles * 32;

const place = (name: string, x: number, y: number, w: number, h: number, props: Record<string, string | number | boolean> = {}): ZoneInput => ({
  type: 'place',
  name,
  x,
  y,
  w,
  h,
  props: { label: name.toUpperCase(), kind: 'room', scene: 'lobby', ...props },
});

// La place centrale (grande), le café et la salle de sport dedans ou à côté, un couloir, un bureau, et ce qu'ils portent.
const ZONES: ZoneInput[] = [
  place('plaza', 1, 1, 28, 12, { kind: 'open', label: 'Place', scene: 'lobby' }),
  place('cafe', 3, 2, 10, 5, { label: 'Café', scene: 'sunny', music: 1 }),
  place('gym', 16, 2, 8, 6, { label: 'Salle de sport', scene: 'quest', music: 1, destination: 1 }),
  place('hall', 16, 9, 8, 3, { kind: 'street', label: 'Couloir' }),
  { type: 'desk', name: 'A1', x: 25, y: 2, w: 4, h: 3 },
  { type: 'door', name: 'A1', x: 26, y: 5, w: 2, h: 1 },
  { type: 'speaker', name: 'cafe', x: 4, y: 2, w: 1, h: 1 },
  { type: 'speaker', name: 'gym', x: 17, y: 2, w: 1, h: 1 },
  { type: 'coffee', x: 5, y: 6, w: 1, h: 1 },
  { type: 'game', name: 'chess', x: 3, y: 9, w: 3, h: 2 },
  { type: 'seat', name: 'chess:2', x: 6, y: 9, w: 1, h: 1 },
  { type: 'seat', name: 'chess:1', x: 2, y: 9, w: 1, h: 1 },
  { type: 'sign', x: 10, y: 9, w: 3, h: 2, props: { text: 'EN TRAVAUX' } },
  { type: 'spawn', x: 10, y: 12, w: 1, h: 1 },
];

const json = (zones: ZoneInput[] = ZONES): TiledMapJson => buildTiledMap({ ascii, zones, tileset });
const map = parseOfficeMap(json());

function zonesLayer(m: TiledMapJson): TiledObjectLayer {
  return m.layers.find((l): l is TiledObjectLayer => l.type === 'objectgroup' && l.name === 'zones')!;
}
// La carte, avec cette modification des objets du calque zones.
function edited(change: (objects: TiledObject[]) => void): TiledMapJson {
  const m = json();
  change(zonesLayer(m).objects);
  return m;
}
const named = (objects: TiledObject[], type: string, name: string) => objects.find((o) => o.type === type && o.name === name)!;
const setProperty = (o: TiledObject, name: string, value: string | number | boolean | undefined) => {
  const others = (o.properties ?? []).filter((p) => p.name !== name);
  o.properties = value === undefined ? others : [...others, { name, type: typeof value === 'number' ? 'int' : typeof value === 'boolean' ? 'bool' : 'string', value }];
};
const refused = (m: TiledMapJson) => {
  try {
    parseOfficeMap(m);
  } catch (err) {
    expect(err).toBeInstanceOf(MapError);
    expect((err as MapError).code).toBe('bad_zone');
    return (err as MapError).message;
  }
  throw new Error('la carte aurait dû être refusée');
};

describe('les nouvelles zones de la carte', () => {
  test('les types place, coffee, speaker, game, seat et sign sont reconnus', () => {
    for (const type of ['place', 'coffee', 'speaker', 'game', 'seat', 'sign']) expect(ZONE_TYPES).toContain(type);
    expect(map.zones.map((z) => z.type)).toEqual(ZONES.map((z) => z.type));
  });

  test('coffees, speakers, tables, signs et places sont lus', () => {
    expect(map.coffees).toEqual([{ x: px(5) + 16, y: px(6) + 16 }]);
    expect(map.speakers).toEqual([
      { x: px(4) + 16, y: px(2) + 16, place: 'cafe' },
      { x: px(17) + 16, y: px(2) + 16, place: 'gym' },
    ]);
    // Les sièges sont dans l'ordre de leur numéro, quel que soit celui de la carte.
    expect(map.tables).toEqual([
      { game: 'chess', rect: { x: px(3), y: px(9), width: px(3), height: px(2) }, seats: [{ x: px(2) + 16, y: px(9) + 16 }, { x: px(6) + 16, y: px(9) + 16 }] },
    ]);
    expect(map.signs).toEqual([{ x: px(10), y: px(9), width: px(3), height: px(2), text: 'EN TRAVAUX' }]);
    expect(map.places.map((p) => p.key)).toEqual(['plaza', 'cafe', 'gym', 'hall']);
    expect(map.places[2]).toEqual({
      key: 'gym',
      label: 'Salle de sport',
      kind: 'room',
      rects: [{ x: px(16), y: px(2), width: px(8), height: px(6) }],
      scene: 'quest',
      music: true,
      destination: true,
    });
    expect(map.places[3]).toMatchObject({ kind: 'street', music: false, destination: false, scene: 'lobby' });
  });

  test('une carte sans nouvelle zone a des listes vides (la petite carte de développement, les cartes des tests)', () => {
    const plain = parseOfficeMap(json([{ type: 'spawn', x: 10, y: 12, w: 1, h: 1 }]));
    expect([plain.places, plain.coffees, plain.speakers, plain.tables, plain.signs]).toEqual([[], [], [], [], []]);
  });

  test('les jeux de la carte sont ceux de GAME_IDS', () => {
    expect(GAME_IDS).toEqual(['chess', 'backgammon', 'connect4', 'ludo']);
  });

  test('une place sans label est refusée', () => {
    const message = refused(edited((o) => setProperty(named(o, 'place', 'gym'), 'label', undefined)));
    expect(message).toContain('label');
    expect(message).toContain('gym');
  });

  test('une place sans clé (sans nom) est refusée', () => {
    expect(refused(edited((o) => (named(o, 'place', 'gym').name = '')))).toContain('nom');
  });

  test('une scène inconnue est refusée, une scène absente est « lobby »', () => {
    expect(refused(edited((o) => setProperty(named(o, 'place', 'gym'), 'scene', 'disco')))).toContain('disco');
    expect(parseOfficeMap(edited((o) => setProperty(named(o, 'place', 'gym'), 'scene', undefined))).places[2]!.scene).toBe('lobby');
    for (const scene of MUSIC_SCENES) {
      expect(parseOfficeMap(edited((o) => setProperty(named(o, 'place', 'gym'), 'scene', scene))).places[2]!.scene).toBe(scene);
    }
  });

  test('un genre de place inconnu est refusé', () => {
    expect(refused(edited((o) => setProperty(named(o, 'place', 'gym'), 'kind', 'jardin')))).toContain('jardin');
  });

  test('deux places de même clé sont refusées', () => {
    const message = refused(edited((o) => (named(o, 'place', 'hall').name = 'gym')));
    expect(message).toContain('gym');
  });

  test('un speaker dont la place n\'a pas de musique est refusé, comme un speaker sans place', () => {
    expect(refused(edited((o) => setProperty(named(o, 'place', 'gym'), 'music', undefined)))).toContain('speaker');
    expect(refused(edited((o) => (named(o, 'speaker', 'gym').name = 'nulle-part')))).toContain('nulle-part');
    expect(refused(edited((o) => (named(o, 'speaker', 'gym').name = 'hall')))).toContain('hall');
  });

  test('un seat sans game du même jeu est refusé, comme un game qui n\'est pas l\'un des quatre', () => {
    expect(refused(edited((o) => (named(o, 'seat', 'chess:1').name = 'ludo:1')))).toContain('ludo');
    expect(refused(edited((o) => (named(o, 'game', 'chess').name = 'dames')))).toContain('dames');
  });

  test('un seat mal nommé (sans numéro, numéro nul) ou en double est refusé', () => {
    expect(refused(edited((o) => (named(o, 'seat', 'chess:1').name = 'chess')))).toContain('chess');
    expect(refused(edited((o) => (named(o, 'seat', 'chess:1').name = 'chess:0')))).toContain('chess:0');
    expect(refused(edited((o) => (named(o, 'seat', 'chess:1').name = 'chess:2')))).toContain('chess:2');
  });

  test('deux tables du même jeu, un coffee ou un speaker qui n\'est pas de 1 × 1, un sign sans texte : refusés', () => {
    expect(refused(edited((o) => o.push({ ...named(o, 'game', 'chess'), id: 98 })))).toContain('chess');
    expect(refused(edited((o) => (named(o, 'speaker', 'gym').width = 64)))).toContain('speaker');
    expect(refused(edited((o) => (o.find((x) => x.type === 'coffee')!.height = 64)))).toContain('coffee');
    expect(refused(edited((o) => setProperty(o.find((x) => x.type === 'sign')!, 'text', undefined)))).toContain('sign');
  });
});

describe('placeAt', () => {
  const at = (tx: number, ty: number) => placeAt(map, px(tx) + 16, px(ty) + 16);

  test('la plus petite place gagne : le café, dans la place centrale', () => {
    expect(at(5, 4)?.key).toBe('cafe');
    expect(at(14, 4)?.key).toBe('plaza');
    expect(at(18, 4)?.key).toBe('gym');
    expect(at(18, 10)?.key).toBe('hall');
  });

  test('un point dans une zone desk rend la place `desk:A1`, un bureau', () => {
    expect(at(26, 3)).toEqual({
      key: 'desk:A1',
      label: 'Bureau A1',
      kind: 'desk',
      rects: [{ x: px(25), y: px(2), width: px(4), height: px(3) }],
      scene: 'focus',
      music: true,
      destination: false,
    });
  });

  test('une place contient son bord haut et gauche, pas son bord bas et droit', () => {
    expect(placeAt(map, px(3), px(2))?.key).toBe('cafe');
    expect(placeAt(map, px(13), px(4))?.key).toBe('plaza');
    expect(placeAt(map, px(5), px(7))?.key).toBe('plaza');
  });

  test('hors de toute place : null', () => {
    expect(placeAt(map, 5, 5)).toBeNull();
    expect(placeAt(map, px(40), px(40))).toBeNull();
  });

  test('une carte sans place : null partout', () => {
    expect(placeAt(parseOfficeMap(json([{ type: 'spawn', x: 10, y: 12, w: 1, h: 1 }])), px(5), px(5))).toBeNull();
  });
});

describe('placeByKey', () => {
  test('retrouve une place par sa clé, un bureau par `desk:<clé>`', () => {
    expect(placeByKey(map, 'cafe')?.label).toBe('Café');
    expect(placeByKey(map, 'desk:A1')?.kind).toBe('desk');
    expect(placeByKey(map, 'desk:A9')).toBeUndefined();
    expect(placeByKey(map, 'nulle-part')).toBeUndefined();
  });
});

describe('freeSpotIn', () => {
  const gym = placeByKey(map, 'gym')!;
  const tileOf = (p: { x: number; y: number }) => ({ x: Math.floor(p.x / 32), y: Math.floor(p.y / 32) });

  test('rend une case praticable de la place, la même à chaque appel', () => {
    const first = freeSpotIn(map, gym, [])!;
    expect(first).not.toBeNull();
    const t = tileOf(first);
    expect(t.x).toBeGreaterThanOrEqual(16);
    expect(t.x).toBeLessThan(24);
    expect(t.y).toBeGreaterThanOrEqual(2);
    expect(t.y).toBeLessThan(8);
    expect(freeSpotIn(map, gym, [])).toEqual(first);
    // Le centre de sa case : un avatar posé là a son corps dans la case.
    expect([first.x % 32, first.y % 32]).toEqual([16, 16]);
  });

  test('à 2 cases au moins des autres : chacun a sa place, sans personne sur personne', () => {
    const taken: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 6; i++) {
      const spot = freeSpotIn(map, gym, taken);
      expect(spot, `personne n° ${i + 1}`).not.toBeNull();
      for (const other of taken) expect(Math.hypot(spot!.x - other.x, spot!.y - other.y)).toBeGreaterThanOrEqual(64);
      taken.push(spot!);
    }
    expect(new Set(taken.map((p) => `${p.x},${p.y}`)).size).toBe(6);
  });

  test('un point déjà pris est évité, même sans en être à 2 cases (la même case)', () => {
    const first = freeSpotIn(map, gym, [])!;
    expect(freeSpotIn(map, gym, [first])).not.toEqual(first);
  });

  test('pleine, la place rend null', () => {
    // Une personne à chaque case de la place : plus aucune n'est à 2 cases d'une autre.
    const everyone: Array<{ x: number; y: number }> = [];
    for (let ty = 2; ty < 8; ty++) for (let tx = 16; tx < 24; tx++) everyone.push({ x: px(tx) + 16, y: px(ty) + 16 });
    expect(freeSpotIn(map, gym, everyone)).toBeNull();
  });

  test('une place sans case praticable rend null (une pièce murée)', () => {
    const walled = parseOfficeMap(
      buildTiledMap({
        ascii: Array.from({ length: HEIGHT }, (_, y) => (y >= 2 && y < 8 ? `${'#'.repeat(WIDTH)}` : `#${'.'.repeat(WIDTH - 2)}#`)),
        zones: ZONES,
        tileset,
      }),
    );
    // La carte de test a ses places posées hors des murs : on prend celle qui est entièrement dans la bande murée.
    expect(freeSpotIn(walled, placeByKey(walled, 'gym')!, [])).toBeNull();
  });

  test('la case choisie est la plus proche du milieu de la place (loin des murs), pas un coin', () => {
    const spot = tileOf(freeSpotIn(map, gym, [])!);
    expect(Math.abs(spot.x - 19.5)).toBeLessThanOrEqual(2);
    expect(Math.abs(spot.y - 4.5)).toBeLessThanOrEqual(2);
  });

  test('une place de bureau (desk:A1) s\'y prête aussi', () => {
    const desk = placeByKey(map, 'desk:A1')!;
    expect(freeSpotIn(map, desk, [])).not.toBeNull();
  });
});

describe('deskRoomSpecOf', () => {
  test('la taille de la zone desk et le côté de la zone door : porte au sud, colonne 1, 2 cases', () => {
    expect(deskRoomSpecOf(map, 'A1')).toEqual({ width: 4, height: 3, door: { side: 'south', x: 1, width: 2 } });
  });

  test('une porte au nord de la pièce est vue du nord', () => {
    const north = parseOfficeMap(
      json([
        { type: 'desk', name: 'A3', x: 4, y: 6, w: 9, h: 7 },
        { type: 'door', name: 'A3', x: 7, y: 4, w: 2, h: 2 },
        { type: 'spawn', x: 10, y: 12, w: 1, h: 1 },
      ]),
    );
    expect(deskRoomSpecOf(north, 'A3')).toEqual({ width: 9, height: 7, door: { side: 'north', x: 3, width: 2 } });
  });

  test('une place inconnue, ou sans porte (les bureaux de la petite carte de développement) : undefined', () => {
    expect(deskRoomSpecOf(map, 'A9')).toBeUndefined();
    const noDoor = parseOfficeMap(json([{ type: 'desk', name: 'B1', x: 4, y: 6, w: 4, h: 3 }, { type: 'spawn', x: 10, y: 12, w: 1, h: 1 }]));
    expect(deskRoomSpecOf(noDoor, 'B1')).toBeUndefined();
  });
});
