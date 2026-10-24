import { describe, expect, test } from 'vitest';
import {
  AVATAR_BODY,
  DEV_OFFICE,
  DEV_TILE,
  TILESET,
  MapError,
  ZONE_TYPES,
  avatarBodyFits,
  buildTiledMap,
  isWalkablePoint,
  isWalkableTile,
  parseOfficeMap,
  withinSwitchReach,
  zoneAt,
  type TiledMapJson,
  type TiledObject,
  type TiledObjectLayer,
  type TiledTileLayer,
} from '../src';

const tileset = { name: 'dev', image: 'tiles.png' };
const devJson = (): TiledMapJson => buildTiledMap({ ...DEV_OFFICE, tileset });
const map = parseOfficeMap(devJson());
const c = (tx: number, ty: number) => [tx * 32 + 16, ty * 32 + 16] as const;   // centre d'une case, en px

function tileLayer(m: TiledMapJson, name: string): TiledTileLayer {
  const layer = m.layers.find((l): l is TiledTileLayer => l.type === 'tilelayer' && l.name === name);
  if (!layer) throw new Error(`calque de tuiles « ${name} » introuvable`);
  return layer;
}
function zonesLayer(m: TiledMapJson): TiledObjectLayer {
  const layer = m.layers.find((l): l is TiledObjectLayer => l.type === 'objectgroup' && l.name === 'zones');
  if (!layer) throw new Error('calque « zones » introuvable');
  return layer;
}
function cells(m: TiledMapJson, name: string): number[] {
  const { data } = tileLayer(m, name);
  if (!Array.isArray(data)) throw new Error(`le calque « ${name} » n'est pas en CSV`);
  return data;
}
// Le n-ième objet du calque zones qui a ce type.
function zoneObject(m: TiledMapJson, type: string, nth = 0): TiledObject {
  const found = zonesLayer(m).objects.filter((o) => o.type === type)[nth];
  if (!found) throw new Error(`zone ${type} n°${nth} introuvable`);
  return found;
}
// Un objet de zone écrit à la main, comme Tiled l'exporterait (rectangle de 1 × 1 case par défaut).
const rect = (o: Partial<TiledObject> & { id: number }): TiledObject => ({ name: '', x: 0, y: 0, width: 32, height: 32, rotation: 0, visible: true, ...o });
function withZones(objects: TiledObject[]): TiledMapJson {
  const m = devJson();
  zonesLayer(m).objects = objects;
  return m;
}

// ---- Les tests de la spec -------------------------------------------------------------------------------------------

test('dimensions et cases bloquantes', () => {
  expect([map.widthTiles, map.heightTiles, map.tileSize]).toEqual([24, 16, 32]);
  expect(isWalkableTile(map, 0, 0)).toBe(false);
  expect(isWalkableTile(map, 1, 1)).toBe(true);
  expect(isWalkableTile(map, 4, 9)).toBe(false);
  expect(isWalkableTile(map, 10, 5)).toBe(true);
  expect(isWalkableTile(map, 11, 5)).toBe(false);
  expect(isWalkablePoint(map, -5, 100)).toBe(false);
});

test('apparition', () => expect(map.spawn).toEqual({ x: 80, y: 240 }));

test('zones', () => {
  const p = map.zones.find((z) => z.type === 'private')!;
  expect(p).toMatchObject({ name: 'Salle de réunion', x: 256, y: 32, width: 192, height: 128 });
  expect(map.zones.filter((z) => z.type === 'desk')).toHaveLength(3);
  expect(zoneAt(map, ...c(10, 2))?.type).toBe('private');
  expect(zoneAt(map, ...c(4, 11))?.type).toBe('desk');
  expect(zoneAt(map, ...c(10, 6))).toBeNull();
  expect(zoneAt(map, ...c(10, 8))).toBeNull();   // une étiquette n'isole pas
});

describe('parseOfficeMap : cartes refusées', () => {
  test.each<[string, string, (m: TiledMapJson) => void]>([
    ['calque collisions absent', 'missing_layer', (m) => { m.layers = m.layers.filter((l) => l.name !== 'collisions'); }],
    ['tileset externe (source)', 'external_tileset', (m) => { m.tilesets = [{ firstgid: 1, source: 'tiles.tsx' }]; }],
    ['calque compressé (zlib)', 'compressed_layer', (m) => { Object.assign(tileLayer(m, 'collisions'), { encoding: 'base64', compression: 'zlib', data: 'eJwDAAAAAAE=' }); }],
    ['pas de zone spawn', 'missing_spawn', (m) => { zonesLayer(m).objects = zonesLayer(m).objects.filter((o) => o.type !== 'spawn'); }],
  ])('%s → MapError %s', (_name, code, mutate) => {
    const m = devJson();
    mutate(m);
    expect(() => parseOfficeMap(m)).toThrow(expect.objectContaining({ code }));
    expect(() => parseOfficeMap(m)).toThrow(MapError);
  });

  test('missing_layer : calque zones absent, calque collisions qui n\'est pas un calque de tuiles, carte sans calques', () => {
    const noZones = devJson();
    noZones.layers = noZones.layers.filter((l) => l.name !== 'zones');
    expect(() => parseOfficeMap(noZones)).toThrow(expect.objectContaining({ code: 'missing_layer', message: expect.stringContaining('zones') }));

    const wrongType = devJson();
    wrongType.layers = wrongType.layers.map((l) => (l.name === 'collisions' ? { type: 'objectgroup' as const, name: 'collisions', objects: [] } : l));
    expect(() => parseOfficeMap(wrongType)).toThrow(expect.objectContaining({ code: 'missing_layer', message: expect.stringContaining('collisions') }));

    const noLayers = devJson();
    Reflect.deleteProperty(noLayers, 'layers');
    expect(() => parseOfficeMap(noLayers)).toThrow(expect.objectContaining({ code: 'missing_layer' }));
  });

  test('missing_layer : le message nomme le calque absent', () => {
    const m = devJson();
    m.layers = m.layers.filter((l) => l.name !== 'collisions');
    expect(() => parseOfficeMap(m)).toThrow(/collisions/);
  });

  test('external_tileset : un seul tileset externe parmi des tilesets intégrés suffit, le message le nomme', () => {
    const m = devJson();
    m.tilesets.push({ firstgid: 6, source: 'mobilier.tsx' });
    expect(() => parseOfficeMap(m)).toThrow(expect.objectContaining({ code: 'external_tileset', message: expect.stringContaining('mobilier.tsx') }));
  });

  test('compressed_layer : le message nomme le calque et la compression', () => {
    const m = devJson();
    Object.assign(tileLayer(m, 'collisions'), { encoding: 'base64', compression: 'zlib', data: 'eJwDAAAAAAE=' });
    expect(() => parseOfficeMap(m)).toThrow(/« collisions »[^]*compressé \(zlib\)/);
  });

  // Phaser ignore (en le signalant seulement dans la console) un calque compressé : la carte s'afficherait à moitié vide.
  // map:check doit donc le refuser quel que soit le calque, pas seulement collisions.
  test.each<[string, (m: TiledMapJson) => void, string]>([
    ['calque sol compressé (zstd)', (m) => { Object.assign(tileLayer(m, 'sol'), { encoding: 'base64', compression: 'zstd', data: 'KLUv' }); }, 'sol'],
    ['calque dessus en base64 non compressé', (m) => { Object.assign(tileLayer(m, 'dessus'), { encoding: 'base64', data: 'AAAAAA==' }); }, 'dessus'],
    ['calque murs sans données', (m) => { Reflect.deleteProperty(tileLayer(m, 'murs'), 'data'); }, 'murs'],
    ['calque collisions de la mauvaise taille', (m) => { tileLayer(m, 'collisions').data = [1, 0, 1]; }, 'collisions'],
    ['calque collisions avec une valeur qui n\'est pas un numéro de tuile', (m) => { tileLayer(m, 'collisions').data = cells(m, 'collisions').map((gid, i) => (i === 30 ? -1 : gid)); }, 'collisions'],
    ['carte infinie (calques en morceaux)', (m) => { m.infinite = true; }, 'infinie'],
  ])('compressed_layer : %s', (_name, mutate, mention) => {
    const m = devJson();
    mutate(m);
    expect(() => parseOfficeMap(m)).toThrow(expect.objectContaining({ code: 'compressed_layer', message: expect.stringContaining(mention) }));
  });

  test.each<[string, (m: TiledMapJson) => void, RegExp]>([
    ['type inconnu', (m) => { zoneObject(m, 'private').type = 'salon'; }, /salon/],
    ['objet sans type', (m) => { Reflect.deleteProperty(zoneObject(m, 'label'), 'type'); }, /n° 5/],
    ['type vide', (m) => { zoneObject(m, 'label').type = '   '; }, /n° 5/],
    ['largeur nulle', (m) => { zoneObject(m, 'desk').width = 0; }, /n° 2/],
    ['hauteur négative', (m) => { zoneObject(m, 'desk', 1).height = -32; }, /n° 3/],
    ['position qui n\'est pas un nombre', (m) => { zoneObject(m, 'desk').x = Number.NaN; }, /n° 2/],
    ['ellipse', (m) => { Object.assign(zoneObject(m, 'desk'), { ellipse: true }); }, /rectangle/],
    ['point', (m) => { Object.assign(zoneObject(m, 'label'), { point: true }); }, /rectangle/],
    ['polygone', (m) => { Object.assign(zoneObject(m, 'private'), { polygon: [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 0, y: 64 }] }); }, /rectangle/],
    ['objet-tuile', (m) => { Object.assign(zoneObject(m, 'desk'), { gid: 3 }); }, /rectangle/],
    ['rotation', (m) => { zoneObject(m, 'desk').rotation = 15; }, /rotation/],
    ['spawn sur un mur', (m) => { Object.assign(zoneObject(m, 'spawn'), { x: 0, y: 0 }); }, /apparition|spawn/],
    ['spawn sur un bureau', (m) => { Object.assign(zoneObject(m, 'spawn'), { x: 4 * 32, y: 9 * 32 }); }, /apparition|spawn/],
    ['spawn hors de la carte', (m) => { Object.assign(zoneObject(m, 'spawn'), { x: 40 * 32, y: 2 * 32 }); }, /apparition|spawn/],
    ['deux zones spawn', (m) => { zonesLayer(m).objects.push(rect({ id: 7, type: 'spawn', x: 32, y: 32 })); }, /spawn/],
    ['une administratrice sans nom', (m) => { zonesLayer(m).objects.push(rect({ id: 7, type: 'clerk', x: 32, y: 32 })); }, /administratrice[^]*nom/],
    ['deux administratrices du même nom', (m) => { zonesLayer(m).objects.push(rect({ id: 7, type: 'clerk', name: 'margot', x: 32, y: 32 }), rect({ id: 8, type: 'clerk', name: 'margot', x: 64, y: 32 })); }, /« margot »/],
    ['une administratrice de deux cases', (m) => { zonesLayer(m).objects.push(rect({ id: 7, type: 'clerk', name: 'margot', x: 32, y: 32, width: 64 })); }, /1 × 1/],
  ])('bad_zone : %s', (_name, mutate, message) => {
    const m = devJson();
    mutate(m);
    expect(() => parseOfficeMap(m)).toThrow(expect.objectContaining({ code: 'bad_zone', message: expect.stringMatching(message) }));
  });

  test('missing_spawn : carte sans aucune zone, ou avec d\'autres zones mais pas d\'apparition', () => {
    expect(() => parseOfficeMap(withZones([]))).toThrow(expect.objectContaining({ code: 'missing_spawn' }));
    expect(() => parseOfficeMap(withZones([rect({ id: 1, type: 'desk', x: 96, y: 320, width: 128, height: 96 })]))).toThrow(
      expect.objectContaining({ code: 'missing_spawn', message: expect.stringContaining('spawn') }),
    );
  });

  test('MapError est une Error nommée, avec un code', () => {
    const err = new MapError('bad_zone', 'message');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('MapError');
    expect(err.code).toBe('bad_zone');
    expect(err.message).toBe('message');
  });
});

describe('lecture des zones', () => {
  test('type lu depuis class ou depuis la propriété type', () => {
    const m = withZones([
      rect({ id: 1, type: '', class: 'spawn', x: 64, y: 224 }),   // Tiled ≥ 1.9 : la classe, et un type vide
      rect({ id: 2, class: 'private', name: 'Salle', x: 256, y: 32, width: 192, height: 128 }),   // class seul
      rect({ id: 3, properties: [{ name: 'type', type: 'string', value: 'desk' }], x: 96, y: 320, width: 128, height: 96 }),   // propriété personnalisée
      rect({ id: 4, type: 'label', class: 'desk', properties: [{ name: 'type', type: 'string', value: 'private' }, { name: 'text', type: 'string', value: 'DEV TEAM' }], x: 288, y: 256, width: 192 }),   // type prime sur class, class sur la propriété
      rect({ id: 5, class: 'desk', properties: [{ name: 'type', type: 'string', value: 'private' }], x: 320, y: 320, width: 128, height: 96 }),   // class prime sur la propriété
    ]);
    expect(parseOfficeMap(m).zones.map((z) => [z.id, z.type])).toEqual([['1', 'spawn'], ['2', 'private'], ['3', 'desk'], ['4', 'label'], ['5', 'desk']]);
    expect(parseOfficeMap(m).spawn).toEqual({ x: 80, y: 240 });
  });

  test('identifiant, nom et texte d\'une zone', () => {
    // Le dessin de la spec : ids 1 à 6 dans l'ordre de saisie ; un nom vide devient null.
    expect(map.zones.map((z) => z.id)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(map.zones.every((z) => typeof z.id === 'string')).toBe(true);
    expect(map.zones.find((z) => z.type === 'label')).toMatchObject({ name: null, text: 'DEV TEAM', x: 288, y: 256, width: 192, height: 32 });
    expect(map.zones.find((z) => z.type === 'private')).toMatchObject({ name: 'Salle de réunion', text: null });
    expect(map.zones.find((z) => z.type === 'spawn')).toMatchObject({ name: null, text: null, x: 64, y: 224, width: 32, height: 32 });
    // La carte de développement n'a pas de porte (zone door) : les bureaux de la grande carte en ont (office.test.ts). Elle n'a pas non plus
    // d'interrupteur (zone switch) : les tests de bout en bout lisent ses pixels, qu'une plaque au mur changerait.
    // La petite carte de développement n'a ni porte, ni interrupteur, ni lieu : seulement ces quatre types, tous reconnus.
    expect(new Set(map.zones.map((z) => z.type))).toEqual(new Set(['spawn', 'private', 'desk', 'label']));
    for (const type of ['spawn', 'private', 'desk', 'label']) expect(ZONE_TYPES).toContain(type);
  });

  test('nom et texte : espaces de bord retirés, vides → null, propriété qui n\'est pas du texte ignorée', () => {
    const m = withZones([
      rect({ id: 1, type: 'spawn', x: 64, y: 224 }),
      rect({ id: 2, type: 'private', name: '  Salle B  ', x: 256, y: 32, width: 192, height: 128 }),
      rect({ id: 3, type: 'label', name: '   ', properties: [{ name: 'text', type: 'int', value: 42 }], x: 288, y: 256, width: 192 }),
      rect({ id: 4, type: 'label', properties: [{ name: 'text', type: 'string', value: '  Équipe\nfrance ' }], x: 288, y: 288, width: 192 }),
    ]);
    const zones = parseOfficeMap(m).zones;
    expect(zones[1]).toMatchObject({ name: 'Salle B', text: null });
    expect(zones[2]).toMatchObject({ name: null, text: null });
    expect(zones[3]!.text).toBe('Équipe\nfrance');
  });

  test('l\'ordre des objets de la carte est conservé et la carte lue n\'est pas modifiée', () => {
    const m = devJson();
    const before = JSON.stringify(m);
    const parsed = parseOfficeMap(m);
    expect(parsed.zones.map((z) => z.type)).toEqual(zonesLayer(m).objects.map((o) => o.type));
    expect(JSON.stringify(m)).toBe(before);
  });

  test('une carte relue depuis un fichier JSON donne la même carte', () => {
    expect(parseOfficeMap(JSON.parse(JSON.stringify(devJson())))).toEqual(map);
  });
});

describe('les interrupteurs de lumière', () => {
  test('une zone switch d\'une case : un interrupteur au centre de la case, en pixels', () => {
    const m = withZones([rect({ id: 1, type: 'spawn', x: 64, y: 224 }), rect({ id: 2, type: 'switch', x: 416, y: 160 })]);
    const parsed = parseOfficeMap(m);
    expect(parsed.switches).toEqual([{ x: 432, y: 176 }]);
    // Une zone parmi les autres : elle garde son rang, et ne devient ni une pièce ni un repère.
    expect(parsed.zones.map((z) => z.type)).toEqual(['spawn', 'switch']);
    expect(zoneAt(parsed, 432, 176)).toBeNull();
  });

  test('plusieurs interrupteurs, dans l\'ordre de la carte ; une zone plus large est prise par son centre', () => {
    const m = withZones([
      rect({ id: 1, type: 'spawn', x: 64, y: 224 }),
      rect({ id: 2, type: 'switch', x: 96, y: 32 }),
      rect({ id: 3, type: 'switch', x: 64, y: 96, width: 64, height: 64 }),
    ]);
    expect(parseOfficeMap(m).switches).toEqual([{ x: 112, y: 48 }, { x: 96, y: 128 }]);
  });

  test('sans zone switch : aucun interrupteur (la carte de développement : ses pixels sont lus par les tests de bout en bout)', () => {
    expect(map.switches).toEqual([]);
    expect(zonesLayer(devJson()).objects.some((o) => o.type === 'switch')).toBe(false);
  });

  test('un interrupteur est un rectangle comme les autres zones : un point de Tiled est refusé', () => {
    const m = withZones([rect({ id: 1, type: 'spawn', x: 64, y: 224 }), rect({ id: 2, type: 'switch', x: 416, y: 160, point: true })]);
    expect(() => parseOfficeMap(m)).toThrow(/ce n'est pas un rectangle \(c'est un point\)/);
  });
});

describe('withinSwitchReach : à 3 cases ou moins d\'un interrupteur', () => {
  const at = { x: 432, y: 176 };
  const reach = 3 * 32;

  test('à 3 cases : à portée ; un pixel de plus : plus à portée', () => {
    expect(withinSwitchReach({ x: at.x, y: at.y + reach }, [at])).toBe(true);
    expect(withinSwitchReach({ x: at.x + reach, y: at.y }, [at])).toBe(true);
    expect(withinSwitchReach({ x: at.x, y: at.y + reach + 1 }, [at])).toBe(false);
    expect(withinSwitchReach({ x: at.x - reach - 1, y: at.y }, [at])).toBe(false);
  });

  test('à 4 cases : trop loin, et pile dessus : à portée', () => {
    expect(withinSwitchReach({ x: at.x, y: at.y + 4 * 32 }, [at])).toBe(false);
    expect(withinSwitchReach(at, [at])).toBe(true);
  });

  test('la distance est celle du plan (euclidienne), pas un carré : en diagonale, 3 cases dans chaque sens sont trop loin', () => {
    expect(withinSwitchReach({ x: at.x + 64, y: at.y + 64 }, [at])).toBe(true);   // 2 cases dans chaque sens : 2,83 cases
    expect(withinSwitchReach({ x: at.x + 72, y: at.y + 72 }, [at])).toBe(false);   // 2,25 cases dans chaque sens : 3,18 cases
  });

  test('plusieurs interrupteurs : le plus proche compte ; aucun : jamais à portée', () => {
    const far = { x: 1040, y: 336 };
    expect(withinSwitchReach({ x: far.x, y: far.y + 64 }, [at, far])).toBe(true);
    expect(withinSwitchReach({ x: 700, y: 256 }, [at, far])).toBe(false);
    expect(withinSwitchReach(at, [])).toBe(false);
  });

  test('une position qui n\'est pas un nombre fini n\'est à portée de rien', () => {
    expect(withinSwitchReach({ x: Number.NaN, y: at.y }, [at])).toBe(false);
    expect(withinSwitchReach({ x: Number.POSITIVE_INFINITY, y: at.y }, [at])).toBe(false);
  });
});

describe('cases praticables', () => {
  test('le plan de la spec : seules les cases « . » se traversent', () => {
    expect(map.blocked).toBeInstanceOf(Uint8Array);
    expect(map.blocked).toHaveLength(24 * 16);
    DEV_OFFICE.ascii.forEach((row, ty) => {
      [...row].forEach((ch, tx) => {
        expect(isWalkableTile(map, tx, ty), `case ${tx}, ${ty} (« ${ch} »)`).toBe(ch === '.');
      });
    });
  });

  test('une carte qui n\'est pas carrée : le bureau T et les murs au bon endroit', () => {
    const tiny = parseOfficeMap(buildTiledMap({ ascii: ['####', '#.T#', '####'], zones: [{ type: 'spawn', x: 1, y: 1, w: 1, h: 1 }], tileset }));
    expect([tiny.widthTiles, tiny.heightTiles]).toEqual([4, 3]);
    expect(tiny.spawn).toEqual({ x: 48, y: 48 });
    expect(isWalkableTile(tiny, 1, 1)).toBe(true);
    expect(isWalkableTile(tiny, 2, 1)).toBe(false);
    expect(isWalkableTile(tiny, 3, 1)).toBe(false);
    expect(isWalkableTile(tiny, 1, 2)).toBe(false);
    expect(isWalkableTile(tiny, 3, 2)).toBe(false);
  });

  test('isWalkableTile : hors carte → false, coordonnées qui ne sont pas des cases → false', () => {
    expect(isWalkableTile(map, -1, 1)).toBe(false);
    expect(isWalkableTile(map, 1, -1)).toBe(false);
    expect(isWalkableTile(map, 24, 1)).toBe(false);
    expect(isWalkableTile(map, 1, 16)).toBe(false);
    expect(isWalkableTile(map, 22, 14)).toBe(true);   // dernière case praticable
    expect(isWalkableTile(map, 1.5, 1)).toBe(false);
    expect(isWalkableTile(map, Number.NaN, 1)).toBe(false);
  });

  test('isWalkablePoint : la case où se trouvent les pieds décide', () => {
    expect(isWalkablePoint(map, ...c(1, 1))).toBe(true);
    expect(isWalkablePoint(map, 32, 32)).toBe(true);          // coin haut gauche de la case (1, 1)
    expect(isWalkablePoint(map, 31.9, 40)).toBe(false);       // case (0, 1) : un mur
    expect(isWalkablePoint(map, 40, 31.9)).toBe(false);       // case (1, 0) : un mur
    expect(isWalkablePoint(map, 735.9, 200)).toBe(true);      // case (22, 6)
    expect(isWalkablePoint(map, 736, 200)).toBe(false);       // case (23, 6) : le mur de droite
    expect(isWalkablePoint(map, 768, 200)).toBe(false);       // hors carte
    expect(isWalkablePoint(map, 200, 512)).toBe(false);
    expect(isWalkablePoint(map, 200, -0.5)).toBe(false);
    expect(isWalkablePoint(map, Number.NaN, 100)).toBe(false);
    expect(isWalkablePoint(map, 100, Number.POSITIVE_INFINITY)).toBe(false);
    expect(isWalkablePoint(map, ...c(4, 9))).toBe(false);     // un bureau
    expect(isWalkablePoint(map, ...c(10, 5))).toBe(true);     // la porte de la salle de réunion
  });

  // Le serveur et le client doivent bloquer les mêmes cases : Phaser ignore les bits de retournement d'une tuile de Tiled
  // (0x80000000, 0x40000000, 0x20000000) et ne compte comme vide que le numéro 0.
  test('une tuile retournée bloque comme une autre, une case vide reste libre même avec un bit de retournement', () => {
    const m = devJson();
    const collisions = cells(m, 'collisions');
    collisions[1 * 24 + 1] = 0x80000000 + 2;   // (1, 1) : mur retourné horizontalement (le format de Tiled)
    collisions[2 * 24 + 1] = 0xe0000000 + 3;   // (1, 2) : les trois bits de retournement
    collisions[0] = 0;                          // (0, 0) : plus de mur
    collisions[1] = 0x80000000;                 // (1, 0) : retournement seul, sans tuile
    const parsed = parseOfficeMap(m);
    expect(isWalkableTile(parsed, 1, 1)).toBe(false);
    expect(isWalkableTile(parsed, 1, 2)).toBe(false);
    expect(isWalkableTile(parsed, 0, 0)).toBe(true);
    expect(isWalkableTile(parsed, 1, 0)).toBe(true);
  });
});

describe('avatarBodyFits : la zone de collision d\'un avatar (20 × 12 px aux pieds) ne touche aucune case bloquante', () => {
  test('la zone : 20 × 12 px, centrée sur les pieds en largeur, son bas un pixel sous les pieds', () => {
    expect(AVATAR_BODY).toEqual({ width: 20, height: 12, belowFeet: 1 });
  });

  test('au milieu d\'une case libre : oui ; sur une case bloquante : non', () => {
    expect(avatarBodyFits(map, 80, 240)).toBe(true);          // l'apparition
    expect(avatarBodyFits(map, ...c(4, 9))).toBe(false);      // un bureau
    expect(avatarBodyFits(map, ...c(0, 7))).toBe(false);      // le mur de gauche
  });

  // Les bords sont ceux où l'avatar local s'arrête (la physique Arcade) : toucher un mur n'est pas le chevaucher.
  test.each([
    ['le mur de gauche (colonne 0, jusqu\'à x = 32) : x − 10 ≥ 32', 42, 240, 41.99, 240],
    ['le mur de droite (colonne 23, dès x = 736) : x + 10 ≤ 736', 726, 240, 726.01, 240],
    ['le mur du bas (ligne 15, dès y = 480) : y + 1 ≤ 480', 80, 479, 80, 479.01],
    ['le mur de la ligne 5 (jusqu\'à y = 192), par-dessous : y − 11 ≥ 192', 80, 203, 80, 202.99],
    ['le dessus d\'un bureau (ligne 9, dès y = 288) : y + 1 ≤ 288', 150, 287, 150, 287.01],
    ['le côté est du bureau du milieu (colonnes 11 et 12, jusqu\'à x = 416) : x − 10 ≥ 416', 426, 300, 425.99, 300],
  ])('%s', (_edge, x, y, pastX, pastY) => {
    expect(avatarBodyFits(map, x, y)).toBe(true);
    expect(avatarBodyFits(map, pastX, pastY)).toBe(false);
  });

  test('une porte (case libre entre deux murs) : le corps de 20 px y passe au milieu, pas contre un montant', () => {
    // La porte de la colonne 3, ligne 5 (x de 96 à 128) : le corps tient si x − 10 ≥ 96 et x + 10 ≤ 128.
    expect(avatarBodyFits(map, 112, 176)).toBe(true);
    expect(avatarBodyFits(map, 105.99, 176)).toBe(false);
    expect(avatarBodyFits(map, 118.01, 176)).toBe(false);
  });

  test('hors carte, ou coordonnées qui ne sont pas des nombres : non', () => {
    expect(avatarBodyFits(map, -50, 240)).toBe(false);
    expect(avatarBodyFits(map, 80, 10_000)).toBe(false);
    expect(avatarBodyFits(map, Number.NaN, 240)).toBe(false);
    expect(avatarBodyFits(map, 80, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('zoneAt', () => {
  test('les bords : la zone commence à son coin et finit avant le coin opposé', () => {
    expect(zoneAt(map, 256, 32)?.type).toBe('private');
    expect(zoneAt(map, 447.9, 159.9)?.type).toBe('private');
    expect(zoneAt(map, 448, 100)).toBeNull();
    expect(zoneAt(map, 300, 160)).toBeNull();
    expect(zoneAt(map, 255.9, 100)).toBeNull();
    expect(zoneAt(map, 300, 31.9)).toBeNull();
  });

  test('chaque bureau a sa zone', () => {
    const ids = [c(4, 11), c(11, 11), c(18, 11)].map((p) => zoneAt(map, ...p)?.id);
    expect(ids).toEqual(['2', '3', '4']);
    expect(zoneAt(map, ...c(7, 11))).toBeNull();   // entre deux bureaux
  });

  test('types : par défaut private et desk, sinon ceux qu\'on demande', () => {
    expect(zoneAt(map, ...c(10, 8), ['label'])).toMatchObject({ type: 'label', text: 'DEV TEAM' });
    expect(zoneAt(map, ...c(2, 7))).toBeNull();                           // l'apparition n'isole pas
    expect(zoneAt(map, ...c(2, 7), ['spawn'])?.type).toBe('spawn');
    expect(zoneAt(map, ...c(10, 2), ['desk'])).toBeNull();
    expect(zoneAt(map, ...c(10, 2), [])).toBeNull();
    expect(zoneAt(map, ...c(10, 2), ['private', 'desk'])?.type).toBe('private');
    expect(zoneAt(map, ...c(4, 11), ['private'])).toBeNull();
  });

  test('hors carte, ou coordonnées qui ne sont pas des nombres : aucune zone', () => {
    expect(zoneAt(map, -10, -10)).toBeNull();
    expect(zoneAt(map, Number.NaN, 100)).toBeNull();
    expect(zoneAt(map, 300, Number.NaN)).toBeNull();
  });

  test('plusieurs zones qui se recouvrent : la première de la carte gagne', () => {
    const m = withZones([
      rect({ id: 1, type: 'spawn', x: 64, y: 224 }),
      rect({ id: 2, type: 'private', name: 'Grande salle', x: 256, y: 32, width: 192, height: 128 }),
      rect({ id: 3, type: 'desk', x: 288, y: 64, width: 64, height: 64 }),
    ]);
    expect(zoneAt(parseOfficeMap(m), 300, 100)?.id).toBe('2');
  });
});

describe('buildTiledMap', () => {
  test('une carte Tiled 1.12 orthogonale de 32 px, avec les calques de la spec dans l\'ordre', () => {
    const m = devJson();
    expect(m).toMatchObject({ type: 'map', orientation: 'orthogonal', renderorder: 'right-down', infinite: false, width: 24, height: 16, tilewidth: 32, tileheight: 32 });
    expect(m.tiledversion).toMatch(/^1\.12\./);
    expect(m.layers.map((l) => [l.name, l.type])).toEqual([
      ['sol', 'tilelayer'],
      ['murs', 'tilelayer'],
      ['meubles-bas', 'tilelayer'],
      ['objets', 'objectgroup'],
      ['dessus', 'tilelayer'],
      ['collisions', 'tilelayer'],
      ['zones', 'objectgroup'],
    ]);
    // Les identifiants de calques sont uniques, et nextlayerid vient après.
    const layerIds = m.layers.map((l) => l.id);
    expect(new Set(layerIds).size).toBe(layerIds.length);
    expect(m.nextlayerid).toBe(Math.max(...(layerIds as number[])) + 1);
  });

  test('un tileset intégré, des tuiles de 32 px : celui des sols et des murs du jeu', () => {
    expect(devJson().tilesets).toEqual([
      {
        firstgid: 1,
        name: 'dev',
        image: 'tiles.png',
        imagewidth: TILESET.columns * 32,
        imageheight: Math.ceil(TILESET.tileCount / TILESET.columns) * 32,
        tilewidth: 32,
        tileheight: 32,
        tilecount: TILESET.tileCount,
        columns: TILESET.columns,
        margin: 0,
        spacing: 0,
      },
    ]);
    const other = buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'autre', image: '../dev/tiles.png' } });
    expect(other.tilesets[0]).toMatchObject({ name: 'autre', image: '../dev/tiles.png' });
  });

  test('les calques de tuiles sont en CSV (tableaux de nombres), sans compression, et visibles sauf collisions', () => {
    const m = devJson();
    for (const name of ['sol', 'murs', 'meubles-bas', 'dessus', 'collisions']) {
      const layer = tileLayer(m, name);
      expect(Array.isArray(layer.data), name).toBe(true);
      expect(layer.data, name).toHaveLength(24 * 16);
      expect(layer).toMatchObject({ width: 24, height: 16, x: 0, y: 0, opacity: 1 });
      expect(layer, name).not.toHaveProperty('compression');
      expect(layer, name).not.toHaveProperty('encoding');
      expect(layer.visible, name).toBe(name !== 'collisions');   // Phaser lit visible et opacity : ils doivent exister
    }
  });

  test('sols, murs et bureaux : une tuile de sol, de mur, de bureau, de salle de réunion et d\'espace de bureau', () => {
    const m = devJson();
    const at = (layer: string, tx: number, ty: number) => cells(m, layer)[ty * 24 + tx];
    expect(at('sol', 1, 6)).toBe(DEV_TILE.floor);      // open space
    expect(at('sol', 0, 0)).toBe(DEV_TILE.floor);      // le sol continue sous les murs
    expect(at('sol', 8, 1)).toBe(DEV_TILE.roomFloor);      // coin de la salle de réunion
    expect(at('sol', 13, 4)).toBe(DEV_TILE.roomFloor);     // coin opposé
    expect(at('sol', 14, 4)).toBe(DEV_TILE.floor);     // juste à côté, ce n'est plus la salle
    expect(at('sol', 7, 4)).toBe(DEV_TILE.floor);
    expect(at('sol', 10, 5)).toBe(DEV_TILE.floor);     // la porte est hors de la zone
    expect(at('sol', 3, 10)).toBe(DEV_TILE.deskFloor);     // espace de bureau
    expect(at('sol', 20, 12)).toBe(DEV_TILE.deskFloor);
    expect(at('sol', 21, 12)).toBe(DEV_TILE.floor);
    expect(at('sol', 4, 9)).toBe(DEV_TILE.floor);      // le bureau lui-même est au-dessus de la zone
    expect(at('sol', 9, 8)).toBe(DEV_TILE.floor);      // l'étiquette et l'apparition n'ont pas de sol à elles
    expect(at('sol', 2, 7)).toBe(DEV_TILE.floor);
    expect(at('murs', 0, 0)).toBe(DEV_TILE.wall);
    expect(at('murs', 7, 2)).toBe(DEV_TILE.wall);
    expect(at('murs', 1, 1)).toBe(0);
    expect(at('murs', 10, 5)).toBe(0);    // une porte
    expect(at('murs', 4, 9)).toBe(0);     // un bureau n'est pas un mur
    expect(at('meubles-bas', 4, 9)).toBe(DEV_TILE.desk);
    expect(at('meubles-bas', 19, 9)).toBe(DEV_TILE.desk);
    expect(at('meubles-bas', 6, 9)).toBe(0);
    expect(at('meubles-bas', 0, 0)).toBe(0);
    expect(cells(m, 'dessus').every((gid) => gid === 0)).toBe(true);
    // collisions : n'importe quelle tuile bloque, ici exactement les murs et les bureaux du plan
    const expected = DEV_OFFICE.ascii.flatMap((row) => [...row].map((ch) => ch !== '.'));
    expect(cells(m, 'collisions').map((gid) => gid > 0)).toEqual(expected);
  });

  test('objets : un calque d\'objets vide ; zones : des rectangles en pixels, ids séquentiels dans l\'ordre de saisie', () => {
    const m = devJson();
    const objets = m.layers.find((l) => l.name === 'objets') as TiledObjectLayer;
    expect(objets.objects).toEqual([]);
    expect(objets).toMatchObject({ draworder: 'topdown', opacity: 1, visible: true });
    const objects = zonesLayer(m).objects;
    expect(objects.map((o) => o.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(m.nextobjectid).toBe(7);
    expect(objects[0]).toMatchObject({ id: 1, type: 'private', name: 'Salle de réunion', x: 256, y: 32, width: 192, height: 128, rotation: 0, visible: true });
    expect(objects[1]).toMatchObject({ type: 'desk', name: '', x: 96, y: 320, width: 128, height: 96 });
    expect(objects[4]).toMatchObject({ type: 'label', x: 288, y: 256, width: 192, height: 32, properties: [{ name: 'text', type: 'string', value: 'DEV TEAM' }] });
    expect(objects[5]).toMatchObject({ type: 'spawn', x: 64, y: 224, width: 32, height: 32 });
    expect(objects[1]).not.toHaveProperty('properties');
    expect(objects[0]).not.toHaveProperty('class');
  });

  test('du JSON pur : un aller-retour par JSON ne change rien, et l\'entrée n\'est pas modifiée', () => {
    const input = { ascii: [...DEV_OFFICE.ascii], zones: DEV_OFFICE.zones.map((z) => ({ ...z })), tileset };
    const frozen = JSON.stringify(input);
    const m = buildTiledMap(input);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
    expect(JSON.stringify(input)).toBe(frozen);
    expect(buildTiledMap(input)).toEqual(m);   // déterministe
  });

  test('DEV_OFFICE : le plan de 24 × 16 et les zones de la spec', () => {
    expect(DEV_OFFICE.ascii).toEqual([
      '########################',
      '#......#......#........#',
      '#......#......#........#',
      '#......#......#........#',
      '#......#......#........#',
      '###.######.#######.#####',
      '#......................#',
      '#......................#',
      '#......................#',
      '#...TT.....TT.....TT...#',
      '#......................#',
      '#......................#',
      '#......................#',
      '#......................#',
      '#......................#',
      '########################',
    ]);
    expect(DEV_OFFICE.zones).toEqual([
      { type: 'private', name: 'Salle de réunion', x: 8, y: 1, w: 6, h: 4 },
      { type: 'desk', x: 3, y: 10, w: 4, h: 3 },
      { type: 'desk', x: 10, y: 10, w: 4, h: 3 },
      { type: 'desk', x: 17, y: 10, w: 4, h: 3 },
      { type: 'label', text: 'DEV TEAM', x: 9, y: 8, w: 6, h: 1 },
      { type: 'spawn', x: 2, y: 7, w: 1, h: 1 },
    ]);
  });

  test('un plan ASCII mal formé est refusé avec un message qui dit où', () => {
    expect(() => buildTiledMap({ ascii: [], zones: [], tileset })).toThrow(/vide/);
    expect(() => buildTiledMap({ ascii: ['###', '#.'], zones: [], tileset })).toThrow(/ligne 2/);
    expect(() => buildTiledMap({ ascii: ['###', '#x#'], zones: [], tileset })).toThrow(/« x »[^]*ligne 2[^]*colonne 2/);
    expect(() => buildTiledMap({ ascii: [''], zones: [], tileset })).toThrow(/vide/);
  });
});
