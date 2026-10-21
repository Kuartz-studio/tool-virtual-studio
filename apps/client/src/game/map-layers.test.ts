import { DEV_OFFICE, buildTiledMap, type TiledMapJson } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { DEPTH, tilesetImages, tilesetTextureKey } from './map-layers';

const devMap = (image: string): TiledMapJson => buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image } });

test('profondeurs : le sol, les murs et les meubles bas sous les avatars (profondeur = y des pieds), le dessus, la nuit et les noms au-dessus', () => {
  expect(DEPTH).toEqual({ sol: 0, murs: 1, meublesBas: 2, dessus: 1_000_000, night: 1_000_000.5, nameTags: 1_000_001 });
});

describe('tilesetImages', () => {
  test('l\'image d\'un tileset s\'écrit relativement au fichier de la carte, comme dans Tiled', () => {
    // La carte de développement : maps/dev-office.json cite ../dev/tiles.png.
    expect(tilesetImages(devMap('../dev/tiles.png'), 'https://bureau.test/assets/maps/dev-office.json')).toEqual([
      { key: tilesetTextureKey('dev'), url: 'https://bureau.test/assets/dev/tiles.png' },
    ]);
    // Un fichier à côté de la carte, ou dans un sous-dossier.
    expect(tilesetImages(devMap('tiles.png'), 'https://bureau.test/assets/maps/dev-office.json')[0]?.url).toBe('https://bureau.test/assets/maps/tiles.png');
    expect(tilesetImages(devMap('tuiles/dev.png'), 'https://bureau.test/assets/maps/dev-office.json')[0]?.url).toBe('https://bureau.test/assets/maps/tuiles/dev.png');
  });

  test('l\'adresse de la carte peut être relative à la page', () => {
    // La page des tests est http://bureau.test (vite.config.ts).
    expect(tilesetImages(devMap('../dev/tiles.png'), '/assets/maps/dev-office.json')[0]?.url).toBe('http://bureau.test/assets/dev/tiles.png');
  });

  test('un tileset sans image (collection d\'images) ou externe n\'a rien à charger', () => {
    const json = devMap('../dev/tiles.png');
    const embedded = json.tilesets[0]!;
    if ('source' in embedded) throw new Error('tileset intégré attendu');
    const { image: _image, ...collection } = embedded;
    json.tilesets = [collection, { firstgid: 100, source: 'externe.tsx' }, embedded];
    expect(tilesetImages(json, 'https://bureau.test/assets/maps/dev-office.json')).toHaveLength(1);
  });

  test('un JSON qui n\'est pas une carte n\'a rien à charger, sans planter', () => {
    expect(tilesetImages({} as TiledMapJson, 'https://bureau.test/assets/maps/dev-office.json')).toEqual([]);
  });
});
