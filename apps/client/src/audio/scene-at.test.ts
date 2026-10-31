import { buildOfficeTiledMap, buildTiledMap, DEV_OFFICE, parseOfficeMap, placeAt, placeByKey } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { OUTSIDE_SCENE, sceneAt, soundAt } from './scene-at';

// La grande carte, lue comme le serveur et le jeu la lisent.
const map = parseOfficeMap(buildOfficeTiledMap());
// Le milieu d'une case, en pixels.
const px = (tile: number) => tile * map.tileSize + map.tileSize / 2;
const at = (tx: number, ty: number) => sceneAt(map, px(tx), px(ty));
// Un point au milieu d'un lieu de la carte.
const inPlace = (key: string) => {
  const rect = placeByKey(map, key)!.rects[0]!;
  return sceneAt(map, rect.x + rect.width / 2, rect.y + rect.height / 2);
};
// Le milieu de la première case hors de tout lieu (un mur entre deux pièces), en lisant la carte ligne après ligne.
const aWall = (): { x: number; y: number } => {
  for (let ty = 0; ty < map.heightTiles; ty++) {
    for (let tx = 0; tx < map.widthTiles; tx++) if (placeAt(map, px(tx), px(ty)) === null) return { x: px(tx), y: px(ty) };
  }
  throw new Error('La carte n\'a aucune case hors de tout lieu.');
};

describe('l\'ambiance de chaque endroit du bureau', () => {
  test('hors du bureau (la connexion, l\'écran d\'entrée), c\'est la salle d\'attente', () => {
    expect(sceneAt(null, 0, 0)).toBe('lobby');
    expect(OUTSIDE_SCENE).toBe('lobby');
  });

  test('un bureau : du chill pour travailler', () => {
    for (const desk of map.zones.filter((zone) => zone.type === 'desk')) {
      expect(sceneAt(map, desk.x + desk.width / 2, desk.y + desk.height / 2), desk.name ?? '').toBe('focus');
    }
  });

  test('chaque lieu a l\'ambiance que la carte lui donne : la conférence en « drift », le sport et l\'octogone en « quest », le jeu en « dusk », le café en « sunny »', () => {
    expect(inPlace('arena')).toBe('quest');
    expect(inPlace('conference')).toBe('drift');
    expect(inPlace('gym')).toBe('quest');
    expect(inPlace('game')).toBe('dusk');
    expect(inPlace('cafe')).toBe('sunny');
  });

  test('l\'accueil, où l\'on apparaît, le hall, la rue, le jardin et les terrasses sont la salle d\'attente', () => {
    expect(sceneAt(map, map.spawn.x, map.spawn.y)).toBe('lobby');
    for (const key of ['reception', 'hall', 'street', 'garden', 'terrace']) expect(inPlace(key), key).toBe('lobby');
  });

  test('un point hors de tout lieu (un mur) : la salle d\'attente', () => {
    const wall = aWall();
    expect(sceneAt(map, wall.x, wall.y)).toBe('lobby');
  });

  test('passer une porte, c\'est changer d\'ambiance : le café à l\'ouest, la salle de jeu à l\'est (sa porte, case 62 de la ligne 25)', () => {
    expect(at(60, 25)).toBe('sunny');
    expect(at(64, 25)).toBe('dusk');
  });

  test('chaque ambiance a son endroit : les six sont jouées quelque part sur la carte', () => {
    const heard = new Set<string>();
    for (let ty = 0; ty < map.heightTiles; ty++) {
      for (let tx = 0; tx < map.widthTiles; tx++) heard.add(at(tx, ty));
    }
    expect([...heard].sort()).toEqual(['dusk', 'drift', 'focus', 'lobby', 'quest', 'sunny'].sort());
  });

  test('une autre carte (celle des tests, sans lieux) n\'a que la concentration', () => {
    const small = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
    expect(small.places).toEqual([]);
    expect(sceneAt(small, small.spawn.x, small.spawn.y)).toBe('focus');
  });
});

// Où l'on est pour le son : l'ambiance par défaut de l'endroit, et la clé de la pièce dont on peut régler la musique (celles qui ont une enceinte), sinon null.
describe('soundAt : l\'ambiance d\'un endroit, et la pièce dont on y règle la musique', () => {
  const inside = (key: string) => {
    const rect = placeByKey(map, key)!.rects[0]!;
    return soundAt(map, rect.x + rect.width / 2, rect.y + rect.height / 2);
  };

  test('hors du bureau : la salle d\'attente, sans pièce à régler', () => {
    expect(soundAt(null, 0, 0)).toEqual({ scene: 'lobby', key: null, outside: false });
  });

  test('chaque pièce à enceinte donne sa clé et son ambiance par défaut', () => {
    expect(inside('game')).toEqual({ scene: 'dusk', key: 'game', outside: false });
    expect(inside('gym')).toEqual({ scene: 'quest', key: 'gym', outside: false });
    expect(inside('conference')).toEqual({ scene: 'drift', key: 'conference', outside: false });
    expect(inside('arena')).toEqual({ scene: 'quest', key: 'arena', outside: false });
    expect(inside('reception')).toEqual({ scene: 'lobby', key: 'reception', outside: false });
  });

  test('le café : le sien, avec son enceinte', () => {
    expect(inside('cafe')).toEqual({ scene: 'sunny', key: 'cafe', outside: false });
  });

  test('le hall et la rue n\'ont pas d\'enceinte : leur ambiance par défaut, aucune pièce à régler', () => {
    expect(inside('hall')).toEqual({ scene: 'lobby', key: null, outside: false });
    expect(inside('street')).toEqual({ scene: 'lobby', key: null, outside: false });
  });

  test('un bureau : « focus », et sa pièce est celle du bureau (desk:<clé>)', () => {
    for (const desk of map.zones.filter((zone) => zone.type === 'desk')) {
      expect(soundAt(map, desk.x + desk.width / 2, desk.y + desk.height / 2), desk.name ?? '').toEqual({ scene: 'focus', key: `desk:${desk.name}`, outside: false });
    }
  });

  test('un point hors de tout lieu (un mur) : la salle d\'attente, sans pièce à régler', () => {
    const wall = aWall();
    expect(soundAt(map, wall.x, wall.y)).toEqual({ scene: 'lobby', key: null, outside: false });
  });

  test('l\'ambiance est toujours celle de sceneAt', () => {
    for (let ty = 0; ty < map.heightTiles; ty += 3) {
      for (let tx = 0; tx < map.widthTiles; tx += 3) expect(soundAt(map, px(tx), px(ty)).scene).toBe(sceneAt(map, px(tx), px(ty)));
    }
  });

  test('la carte des tests (sans lieux) : la concentration partout, aucune pièce à régler hors des bureaux', () => {
    const small = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
    expect(soundAt(small, small.spawn.x, small.spawn.y)).toEqual({ scene: 'focus', key: null, outside: false });
  });

  test('le jardin et les terrasses : dehors, sans enceinte (la musique du lieu s\'y tait, la nature s\'entend)', () => {
    expect(inside('garden')).toEqual({ scene: 'lobby', key: null, outside: true });
    expect(inside('terrace')).toEqual({ scene: 'lobby', key: null, outside: true });
    expect(soundAt(map, map.spawn.x, map.spawn.y).outside).toBe(false);
  });
});
