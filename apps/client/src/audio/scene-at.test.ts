import { buildOfficeTiledMap, buildTiledMap, DEV_OFFICE, parseOfficeMap, placeByKey } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { OUTSIDE_SCENE, sceneAt } from './scene-at';

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

  test('chaque lieu a l\'ambiance que la carte lui donne : la réunion et la salle client en « focus », la conférence en « drift », le sport en « quest », le jeu en « dusk », le café et la détente en « sunny »', () => {
    expect(inPlace('meeting')).toBe('focus');
    expect(inPlace('client')).toBe('focus');
    expect(inPlace('conference')).toBe('drift');
    expect(inPlace('gym')).toBe('quest');
    expect(inPlace('game')).toBe('dusk');
    expect(inPlace('cafe')).toBe('sunny');
    expect(inPlace('lounge')).toBe('sunny');
  });

  test('la place centrale, l\'accueil, où l\'on apparaît, et les rues sont la salle d\'attente', () => {
    expect(inPlace('plaza')).toBe('lobby');
    expect(sceneAt(map, map.spawn.x, map.spawn.y)).toBe('lobby');
    expect(at(10, 12)).toBe('lobby');
    expect(at(60, 28)).toBe('lobby');
    expect(at(76, 20)).toBe('lobby');
  });

  test('un point hors de tout lieu (un mur) : la salle d\'attente', () => {
    expect(at(0, 0)).toBe('lobby');
    expect(at(5, 30)).toBe('lobby');
  });

  test('traverser une arche, c\'est changer d\'ambiance : la rue au nord, la salle au sud', () => {
    expect(at(24, 29)).toBe('lobby');
    expect(at(24, 33)).toBe('dusk');
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
