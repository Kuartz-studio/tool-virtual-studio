import { buildOfficeTiledMap, buildTiledMap, DEV_OFFICE, GRAND_HALL, LOUNGE, LOUNGE_MUSIC_X, LOUNGE_TERRACE_WIDTH, MEETING_ROOM, parseOfficeMap, PLAZA } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { OUTSIDE_SCENE, sceneAt } from './scene-at';

// La grande carte, lue comme le serveur et le jeu la lisent.
const map = parseOfficeMap(buildOfficeTiledMap());
// Le milieu d'une case, en pixels.
const px = (tile: number) => tile * map.tileSize + map.tileSize / 2;
const at = (tx: number, ty: number) => sceneAt(map, 'office', px(tx), px(ty));

describe('l\'ambiance de chaque endroit du bureau', () => {
  test('hors du bureau (la connexion, l\'écran d\'entrée), c\'est la salle d\'attente', () => {
    expect(sceneAt(null, null, 0, 0)).toBe('lobby');
    expect(OUTSIDE_SCENE).toBe('lobby');
  });

  test('un bureau : du chill pour travailler', () => {
    for (const desk of map.zones.filter((zone) => zone.type === 'desk')) {
      expect(sceneAt(map, 'office', desk.x + desk.width / 2, desk.y + desk.height / 2), desk.name ?? '').toBe('focus');
    }
  });

  test('la salle de réunion aussi, la grande salle est étrange et planante', () => {
    expect(at(MEETING_ROOM.x + 3, MEETING_ROOM.y + 3)).toBe('focus');
    expect(at(GRAND_HALL.x + 3, GRAND_HALL.y + 3)).toBe('drift');
  });

  test('la zone détente, d\'ouest en est : la piscine au soleil, le salon au crépuscule, le coin musique en expédition', () => {
    const y = LOUNGE.y + 6;
    expect(at(LOUNGE.x, y)).toBe('sunny');
    expect(at(LOUNGE.x + LOUNGE_TERRACE_WIDTH - 1, y)).toBe('sunny');
    expect(at(LOUNGE.x + LOUNGE_TERRACE_WIDTH, y)).toBe('dusk');
    expect(at(LOUNGE_MUSIC_X - 1, y)).toBe('dusk');
    expect(at(LOUNGE_MUSIC_X, y)).toBe('quest');
    expect(at(LOUNGE.x + LOUNGE.w - 1, y)).toBe('quest');
  });

  test('la place centrale, café compris, est au soleil, arche de la zone détente comprise', () => {
    expect(at(PLAZA.x + 15, PLAZA.y + 6)).toBe('sunny');
    // L'arche entre la place et la terrasse : la musique ne change pas en la traversant.
    expect(at(18, LOUNGE.y - 1)).toBe('sunny');
    expect(at(18, LOUNGE.y + 1)).toBe('sunny');
  });

  test('le couloir et l\'accueil, où l\'on apparaît, sont la salle d\'attente', () => {
    expect(at(10, 12)).toBe('lobby');
    expect(sceneAt(map, 'office', map.spawn.x, map.spawn.y)).toBe('lobby');
    expect(at(60, 40)).toBe('lobby');
  });

  test('chaque ambiance a son endroit : les six sont jouées quelque part sur la carte', () => {
    const heard = new Set<string>();
    for (let ty = 0; ty < map.heightTiles; ty++) {
      for (let tx = 0; tx < map.widthTiles; tx++) heard.add(at(tx, ty));
    }
    expect([...heard].sort()).toEqual(['dusk', 'drift', 'focus', 'lobby', 'quest', 'sunny'].sort());
  });

  test('une autre carte (celle des tests) n\'a que la concentration', () => {
    const small = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
    expect(sceneAt(small, 'dev-office', small.spawn.x, small.spawn.y)).toBe('focus');
  });
});
