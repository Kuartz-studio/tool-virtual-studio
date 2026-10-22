import { describe, expect, test } from 'vitest';
import { MapCanvas, isWalkableTile, parseOfficeMap, placeAt, type OfficeMap, type TiledObjectLayer } from '../src';

// Une petite carte de 30 × 20 cases, sol gris, avec un point d'apparition.
function canvas(): MapCanvas {
  const c = new MapCanvas(30, 20, 'gris');
  c.zone({ type: 'spawn', x: 1, y: 1, w: 1, h: 1 });
  return c;
}
const parse = (c: MapCanvas): OfficeMap => parseOfficeMap(c.toTiled());
const blockedAt = (c: MapCanvas, x: number, y: number): boolean => c.blocked[y * c.width + x] === 1;
const layer = (c: MapCanvas, name: string) => c.toTiled().layers.find((l) => l.name === name) as TiledObjectLayer | undefined;

describe('MapCanvas.put : un décalage vertical, en pixels, pour une chaise rentrée sous sa table', () => {
  test('sans décalage l\'objet n\'a pas de propriété ; avec, il porte offsetY, et rien d\'autre ne change (empreinte, collisions)', () => {
    const c = canvas();
    c.put('ki-0-13', 5, 6);
    c.put('ki-1-13', 7, 6, { offsetY: 16 });
    const objects = layer(c, 'objets')!.objects;
    expect(objects.map(({ name, x, y, width, height, properties }) => ({ name, x, y, width, height, properties }))).toEqual([
      { name: 'ki-0-13', x: 5 * 32, y: 6 * 32, width: 32, height: 32, properties: undefined },
      { name: 'ki-1-13', x: 7 * 32, y: 6 * 32, width: 32, height: 32, properties: [{ name: 'offsetY', type: 'int', value: 16 }] },
    ]);
    expect(blockedAt(c, 5, 6)).toBe(false);
    expect(blockedAt(c, 7, 6)).toBe(false);
  });
});

describe('MapCanvas.prop : un objet animé posé sur la carte', () => {
  test('un prop solide bloque son empreinte (les rangées du bas), pas le reste de son image', () => {
    const c = canvas();
    c.prop('treadmill', 5, 6);   // 2 × 3 cases d'image, 2 rangées au sol : x 5 et 6, y 6 et 7
    for (const [x, y] of [[5, 6], [6, 6], [5, 7], [6, 7]] as const) expect(blockedAt(c, x, y), `${x},${y}`).toBe(true);
    // La rangée du haut de l'image (y 5) dépasse derrière lui : on peut s'y tenir.
    for (const [x, y] of [[5, 5], [6, 5], [4, 6], [7, 6], [5, 8]] as const) expect(blockedAt(c, x, y), `${x},${y}`).toBe(false);
    expect(c.ascii()[6]!.slice(5, 7)).toBe('TT');
  });

  test('un prop qui ne bloque pas se traverse', () => {
    const c = canvas();
    c.prop('candle', 3, 4);
    expect(blockedAt(c, 3, 4)).toBe(false);
  });

  test('un prop posé sur un mur ou sur un meuble solide est refusé, la case est dite', () => {
    const c = canvas();
    c.block(5, 6, 1, 1);
    expect(() => c.prop('treadmill', 5, 6)).toThrow(/5, 6/);
    c.prop('coffee', 10, 10);
    expect(() => c.prop('amplifier', 10, 10)).toThrow(/10, 10/);
  });

  test('un prop inconnu ou hors de la carte est refusé', () => {
    const c = canvas();
    expect(() => c.prop('nope', 1, 1)).toThrow(/nope/);
    expect(() => c.prop('treadmill', 29, 6)).toThrow(/hors de la carte/);
  });

  test('le calque `props` : le nom est la clé, la position et la taille sont celles de l\'empreinte, en pixels', () => {
    const c = canvas();
    c.prop('treadmill', 5, 6);
    c.prop('wall-candle', 8, 3);   // sans empreinte : tenu au mur, le bas de l'image à la rangée 3
    const props = layer(c, 'props')!;
    expect(props.objects.map(({ name, type, x, y, width, height }) => ({ name, type, x, y, width, height }))).toEqual([
      { name: 'treadmill', type: 'prop', x: 5 * 32, y: 6 * 32, width: 2 * 32, height: 2 * 32 },
      { name: 'wall-candle', type: 'prop', x: 8 * 32, y: 3 * 32, width: 32, height: 0 },
    ]);
    // Entre les meubles et les zones, sous les noms : l'ordre des calques ne change pas pour ceux qui existaient.
    const names = c.toTiled().layers.map((l) => l.name);
    expect(names).toEqual(['sol', 'murs', 'meubles-bas', 'objets', 'props', 'dessus', 'collisions', 'zones']);
  });

  test('un prop solide est aussi dans les collisions que lit le serveur', () => {
    const c = canvas();
    c.prop('punching-bag-left', 12, 12);
    const map = parse(c);
    expect(isWalkableTile(map, 12, 12)).toBe(false);
    expect(isWalkableTile(map, 13, 12)).toBe(false);
    expect(isWalkableTile(map, 12, 13)).toBe(true);
  });
});

describe('MapCanvas.prop avec onTop : un objet animé posé sur un meuble', () => {
  test('il ne bloque rien de plus (le meuble bloque déjà), et son objet dit la profondeur qui le met devant le meuble', () => {
    const c = canvas();
    c.put('ki-12-21', 5, 5);   // un comptoir de 4 × 2 cases au sol : x 5 à 8, y 5 et 6
    const before = Array.from(c.blocked);
    c.prop('coffee', 6, 5, { onTop: true });
    expect(Array.from(c.blocked)).toEqual(before);
    const [object] = layer(c, 'props')!.objects;
    expect(object).toMatchObject({ name: 'coffee', type: 'prop', x: 6 * 32, y: 5 * 32 });
    // Le bas du comptoir (la rangée 6 se termine à 7 × 32) plus un demi : devant lui, derrière ce qui est plus bas.
    expect(object!.properties).toEqual([{ name: 'depth', type: 'float', value: 7 * 32 + 0.5 }]);
  });

  test('offsetY : de combien de pixels on l\'abaisse, pour qu\'il pose sur le plateau du meuble et non sur le bord haut de sa case', () => {
    const c = canvas();
    c.put('ki-12-21', 5, 5);
    c.prop('coffee', 6, 5, { onTop: true, offsetY: 12 });
    expect(layer(c, 'props')!.objects[0]!.properties).toEqual([
      { name: 'depth', type: 'float', value: 7 * 32 + 0.5 },
      { name: 'offsetY', type: 'int', value: 12 },
    ]);
  });

  test('sans meuble solide dessous, c\'est refusé : la case est dite', () => {
    const c = canvas();
    expect(() => c.prop('coffee', 6, 5, { onTop: true })).toThrow(/6, 5/);
    c.put('of-8-38', 12, 5);   // un meuble, mais à côté
    expect(() => c.prop('coffee', 6, 5, { onTop: true })).toThrow(/aucun meuble/);
  });

  test('un objet posé à même le sol n\'a pas de profondeur à lui : celle de son empreinte suffit', () => {
    const c = canvas();
    c.prop('coffee', 6, 5);
    expect(layer(c, 'props')!.objects[0]!.properties).toBeUndefined();
  });
});

describe('MapCanvas : les zones des lieux, du café, des enceintes, des jeux et des panneaux', () => {
  function furnished(): OfficeMap {
    const c = canvas();
    c.place('cafe', 'Café', { x: 2, y: 2, w: 10, h: 6 }, { kind: 'open', scene: 'sunny', music: true });
    c.place('salle', 'Salle', { x: 14, y: 2, w: 6, h: 6 });
    c.speaker('cafe', 3, 3);
    c.coffee(5, 4);
    c.table('chess', { x: 8, y: 11, w: 3, h: 2 });
    c.seat('chess', 2, 9, 13);
    c.seat('chess', 1, 9, 10);
    c.sign('EN TRAVAUX', 15, 4);
    return parse(c);
  }

  test('un lieu : sa clé, son nom, son genre, son ambiance, sa musique, en pixels', () => {
    const map = furnished();
    expect(map.places).toEqual([
      { key: 'cafe', label: 'Café', kind: 'open', rects: [{ x: 64, y: 64, width: 320, height: 192 }], scene: 'sunny', music: true, destination: false },
      // Sans options : une pièce, l'ambiance du hall, sans musique ni destination.
      { key: 'salle', label: 'Salle', kind: 'room', rects: [{ x: 448, y: 64, width: 192, height: 192 }], scene: 'lobby', music: false, destination: false },
    ]);
    expect(placeAt(map, 5 * 32 + 16, 4 * 32 + 16)?.key).toBe('cafe');
  });

  test('un lieu de destination : l\'option est lue', () => {
    const c = canvas();
    c.place('sport', 'Sport', { x: 2, y: 2, w: 5, h: 5 }, { scene: 'quest', music: true, destination: true });
    expect(parse(c).places[0]).toMatchObject({ key: 'sport', scene: 'quest', music: true, destination: true });
  });

  test('l\'enceinte, la case du café, la table et ses sièges (dans l\'ordre de leur numéro), le panneau', () => {
    const map = furnished();
    expect(map.speakers).toEqual([{ x: 3 * 32 + 16, y: 3 * 32 + 16, place: 'cafe' }]);
    expect(map.coffees).toEqual([{ x: 5 * 32 + 16, y: 4 * 32 + 16 }]);
    expect(map.tables).toEqual([
      {
        game: 'chess',
        rect: { x: 256, y: 352, width: 96, height: 64 },
        seats: [{ x: 9 * 32 + 16, y: 10 * 32 + 16 }, { x: 9 * 32 + 16, y: 13 * 32 + 16 }],
      },
    ]);
    expect(map.signs).toEqual([{ x: 480, y: 128, width: 32, height: 32, text: 'EN TRAVAUX' }]);
  });

  test('une enceinte dont le lieu n\'existe pas est refusée à la lecture', () => {
    const c = canvas();
    c.speaker('nulle-part', 3, 3);
    expect(() => parse(c)).toThrow(/nulle-part/);
  });
});
