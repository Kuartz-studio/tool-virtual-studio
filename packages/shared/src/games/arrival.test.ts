import { describe, expect, test } from 'vitest';
import { buildOfficeTiledMap } from '../map/office';
import { parseOfficeMap } from '../map/parse-map';
import { placeAt, placeByKey } from '../map/places';
import { avatarBodyFits } from '../map/queries';
import { GAME_ARRIVAL_RING_TILES } from '../constants';
import { arrivalSpot } from './arrival';

const map = parseOfficeMap(buildOfficeTiledMap());
const chess = map.tables.find((table) => table.game === 'chess')!;
const tile = map.tileSize;
const apart = 2 * tile;

// L'anneau autour de la table : son rectangle élargi de GAME_ARRIVAL_RING_TILES cases de chaque côté.
const ring = {
  left: chess.rect.x - GAME_ARRIVAL_RING_TILES * tile,
  right: chess.rect.x + chess.rect.width + GAME_ARRIVAL_RING_TILES * tile,
  top: chess.rect.y - GAME_ARRIVAL_RING_TILES * tile,
  bottom: chess.rect.y + chess.rect.height + GAME_ARRIVAL_RING_TILES * tile,
};
const inRing = (point: { x: number; y: number }) => point.x >= ring.left && point.x < ring.right && point.y >= ring.top && point.y < ring.bottom;
const inTable = (point: { x: number; y: number }) =>
  point.x >= chess.rect.x && point.x < chess.rect.x + chess.rect.width && point.y >= chess.rect.y && point.y < chess.rect.y + chess.rect.height;

describe('arrivalSpot : où poser quelqu\'un qui arrive à une table', () => {
  test('la carte a bien des chaises praticables, de part et d\'autre de la table des échecs', () => {
    expect(chess.seats).toHaveLength(2);
    for (const seat of chess.seats) expect(avatarBodyFits(map, seat.x, seat.y)).toBe(true);
  });

  test('sa chaise, si elle est libre : le centre de la case de la chaise', () => {
    expect(arrivalSpot(map, chess, 0, [])).toEqual(chess.seats[0]);
    expect(arrivalSpot(map, chess, 1, [])).toEqual(chess.seats[1]);
  });

  test('sa chaise est refusée quand quelqu\'un se tient à moins de 2 cases : une case de l\'anneau autour de la table, à 2 cases au moins de tous', () => {
    const near = { x: chess.seats[0]!.x + tile, y: chess.seats[0]!.y };
    const spot = arrivalSpot(map, chess, 0, [near])!;
    expect(spot).not.toBeNull();
    expect(spot).not.toEqual(chess.seats[0]);
    expect(Math.hypot(spot.x - near.x, spot.y - near.y)).toBeGreaterThanOrEqual(apart);
    expect(inRing(spot)).toBe(true);
    expect(avatarBodyFits(map, spot.x, spot.y)).toBe(true);
  });

  test('quelqu\'un à une seule case de distance dans la diagonale compte aussi comme trop près (l\'écart se mesure sur le plus grand des deux axes)', () => {
    const diagonal = { x: chess.seats[0]!.x + tile, y: chess.seats[0]!.y + tile };
    expect(arrivalSpot(map, chess, 0, [diagonal])).not.toEqual(chess.seats[0]);
    const far = { x: chess.seats[0]!.x + 2 * tile, y: chess.seats[0]!.y };
    expect(arrivalSpot(map, chess, 0, [far])).toEqual(chess.seats[0]);
  });

  test('une chaise où l\'on ne peut pas tenir (une case bloquante) est refusée : une case de l\'anneau', () => {
    // Une « chaise » posée sur la table elle-même : la case est bloquée.
    const onTheTable = { x: chess.rect.x + chess.rect.width / 2, y: chess.rect.y + chess.rect.height / 2 };
    expect(avatarBodyFits(map, onTheTable.x, onTheTable.y)).toBe(false);
    const spot = arrivalSpot(map, { ...chess, seats: [onTheTable] }, 0, [])!;
    expect(spot).not.toBeNull();
    expect(spot).not.toEqual(onTheTable);
    expect(avatarBodyFits(map, spot.x, spot.y)).toBe(true);
  });

  test('l\'anneau ne sort jamais de la salle : une table contre le mur ouest, dont l\'anneau déborde sur la salle de sport voisine', () => {
    const room = placeByKey(map, 'game')!;
    const gym = placeByKey(map, 'gym')!;
    const flush = { game: 'chess' as const, rect: { x: room.rects[0]!.x, y: 1152, width: 96, height: 64 }, seats: [] };
    const around = { left: flush.rect.x - GAME_ARRIVAL_RING_TILES * tile, right: flush.rect.x + flush.rect.width + GAME_ARRIVAL_RING_TILES * tile, top: flush.rect.y - GAME_ARRIVAL_RING_TILES * tile, bottom: flush.rect.y + flush.rect.height + GAME_ARRIVAL_RING_TILES * tile };
    // Quelqu'un sur chaque case de la salle que l'anneau couvre : il ne reste de libres, dans l'anneau, que celles de la salle de sport.
    const taken: Array<{ x: number; y: number }> = [];
    let gymCellsFree = 0;
    for (let ty = Math.floor(around.top / tile); ty < Math.ceil(around.bottom / tile); ty++) {
      for (let tx = Math.floor(around.left / tile); tx < Math.ceil(around.right / tile); tx++) {
        const point = { x: tx * tile + tile / 2, y: ty * tile + tile / 2 };
        if (placeAt(map, point.x, point.y)?.key === room.key) taken.push(point);
        else if (placeAt(map, point.x, point.y)?.key === gym.key && avatarBodyFits(map, point.x, point.y)) gymCellsFree++;
      }
    }
    expect(gymCellsFree).toBeGreaterThan(0);
    const spot = arrivalSpot(map, flush, null, taken)!;
    expect(spot).not.toBeNull();
    expect(placeAt(map, spot.x, spot.y)?.key).toBe(room.key);
  });

  test('sans chaise (spectateur, ou table pleine) : une case de l\'anneau autour de la table, jamais sur la table', () => {
    const spot = arrivalSpot(map, chess, null, [])!;
    expect(spot).not.toBeNull();
    expect(inRing(spot)).toBe(true);
    expect(inTable(spot)).toBe(false);
    expect(avatarBodyFits(map, spot.x, spot.y)).toBe(true);
    expect(placeAt(map, spot.x, spot.y)?.key).toBe('game');
  });

  test('un numéro de chaise qui n\'existe pas vaut « sans chaise »', () => {
    expect(arrivalSpot(map, chess, 7, [])).toEqual(arrivalSpot(map, chess, null, []));
    expect(arrivalSpot(map, chess, -1, [])).toEqual(arrivalSpot(map, chess, null, []));
  });

  test('deux arrivants à la suite ne se posent jamais à moins de 2 cases l\'un de l\'autre', () => {
    const taken: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 6; i++) {
      const spot = arrivalSpot(map, chess, null, taken);
      expect(spot, `arrivant ${i}`).not.toBeNull();
      for (const other of taken) expect(Math.hypot(spot!.x - other.x, spot!.y - other.y)).toBeGreaterThanOrEqual(apart);
      taken.push(spot!);
    }
  });

  test('l\'anneau plein : une case de la salle de jeu, loin de la table, à 2 cases au moins des autres', () => {
    const room = placeByKey(map, 'game')!;
    // Quelqu'un sur chaque case praticable de l'anneau : plus aucune case de l'anneau n'est libre.
    const taken: Array<{ x: number; y: number }> = [];
    for (let ty = Math.floor(ring.top / tile); ty < Math.ceil(ring.bottom / tile); ty++) {
      for (let tx = Math.floor(ring.left / tile); tx < Math.ceil(ring.right / tile); tx++) {
        const point = { x: tx * tile + tile / 2, y: ty * tile + tile / 2 };
        if (avatarBodyFits(map, point.x, point.y)) taken.push(point);
      }
    }
    const spot = arrivalSpot(map, chess, null, taken)!;
    expect(spot).not.toBeNull();
    expect(placeAt(map, spot.x, spot.y)?.key).toBe(room.key);
    for (const other of taken) expect(Math.hypot(spot.x - other.x, spot.y - other.y)).toBeGreaterThanOrEqual(apart);
    expect(inRing(spot)).toBe(false);
  });

  test('la salle pleine : null, la personne reste où elle est', () => {
    const room = placeByKey(map, 'game')!;
    const taken: Array<{ x: number; y: number }> = [];
    for (const rect of room.rects) {
      for (let ty = Math.floor(rect.y / tile); ty < Math.ceil((rect.y + rect.height) / tile); ty++) {
        for (let tx = Math.floor(rect.x / tile); tx < Math.ceil((rect.x + rect.width) / tile); tx++) taken.push({ x: tx * tile + tile / 2, y: ty * tile + tile / 2 });
      }
    }
    expect(arrivalSpot(map, chess, null, taken)).toBeNull();
    expect(arrivalSpot(map, chess, 0, taken)).toBeNull();
  });
});
