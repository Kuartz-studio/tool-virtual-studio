import { TILE_SIZE } from '@bureau/shared';
import { expect, test } from 'vitest';
import { DECOR_DEPTH } from './decor-layout';
import { layoutProps, propImages } from './prop-layer';

// Un objet du calque `props` de la carte : le nom est la clé, la position et la taille celles de l'empreinte, en pixels.
const object = (name: string, x: number, y: number, claim: number, w = 1) => ({ name, x: x * TILE_SIZE, y: y * TILE_SIZE, width: w * TILE_SIZE, height: claim * TILE_SIZE });

test('le bas de l\'image est le bas de l\'empreinte, et la profondeur aussi : qui est plus bas est devant', () => {
  const [treadmill] = layoutProps([object('treadmill', 5, 6, 2, 2)]);
  // Un tapis de course : 2 × 3 cases d'image, 2 rangées au sol (y 6 et 7) : le bas de l'image est au bas de la rangée 7.
  expect(treadmill).toMatchObject({ key: 'treadmill', left: 5 * TILE_SIZE, bottom: 8 * TILE_SIZE, depth: 8 * TILE_SIZE });
  expect(treadmill!.prop.frames).toBe(12);
});

test('un objet sans empreinte (une bougie au mur) se dessine juste au-dessus des murs, le bas de son image à la rangée donnée', () => {
  const [candle] = layoutProps([object('wall-candle', 8, 3, 0)]);
  expect(candle).toMatchObject({ key: 'wall-candle', left: 8 * TILE_SIZE, bottom: 3 * TILE_SIZE, depth: DECOR_DEPTH.wall });
});

test('un objet inconnu est ignoré, les autres gardent leur ordre', () => {
  const placements = layoutProps([object('nope', 1, 1, 1), object('coffee', 37, 3, 1), object('candle', 17, 33, 1)]);
  expect(placements.map((p) => p.key)).toEqual(['coffee', 'candle']);
});

test('un objet posé sur un meuble dit sa profondeur (propriété `depth`) : elle prime sur celle de son empreinte', () => {
  const onTop = { ...object('coffee', 37, 3, 1), properties: [{ name: 'depth', type: 'float', value: 160.5 }] };
  const [machine] = layoutProps([onTop]);
  // Le bas de son image reste le bas de son empreinte (4 × 32) ; seule sa profondeur change.
  expect(machine).toMatchObject({ key: 'coffee', bottom: 4 * TILE_SIZE, depth: 160.5 });
  // `offsetY` abaisse l'image (il la pose sur le plateau d'un meuble) : le bas de l'image descend, la profondeur ne change pas.
  const lowered = { ...object('coffee', 37, 3, 1), properties: [{ name: 'depth', type: 'float', value: 160.5 }, { name: 'offsetY', type: 'int', value: 12 }] };
  expect(layoutProps([lowered])[0]).toMatchObject({ bottom: 4 * TILE_SIZE + 12, depth: 160.5 });
  // Phaser peut aussi donner les propriétés d'un objet Tiled en table (nom → valeur).
  expect(layoutProps([{ ...object('coffee', 37, 3, 1), properties: { depth: 99.5 } }])[0]!.depth).toBe(99.5);
  // Une propriété qui n'est pas un nombre est ignorée.
  const odd = { ...object('coffee', 37, 3, 1), properties: [{ name: 'depth', type: 'string', value: 'haut' }, { name: 'autre', value: 3 }] };
  expect(layoutProps([odd])[0]!.depth).toBe(4 * TILE_SIZE);
});

test('propImages : le rectangle de l\'image entière, en pixels de la carte, pour les lumières de la nuit', () => {
  const [machine] = propImages(layoutProps([object('coffee', 37, 3, 1)]));
  // Une machine à café : 1 × 2 cases d'image, posée sur la rangée 3 : son image va de la rangée 2 à la rangée 3.
  expect(machine).toEqual({ key: 'coffee', x: 37 * TILE_SIZE, y: 2 * TILE_SIZE, w: TILE_SIZE, h: 2 * TILE_SIZE });
});
