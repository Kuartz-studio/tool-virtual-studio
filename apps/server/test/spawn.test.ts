import { DEV_OFFICE, buildTiledMap, parseOfficeMap } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { chooseSpawn } from '../src/realtime/spawn';

// La carte de développement : l'apparition est en (80, 240) ; la salle de réunion (zone private) couvre x de 256 à 447 et y de 32
// à 159 ; les trois bureaux (zones desk) sont sur les lignes 10 à 12 ; une étiquette (zone label) couvre x de 288 à 479, y de 256 à 287.
const map = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
const roomId = map.zones.find((z) => z.type === 'private')!.id;
const deskIds = map.zones.filter((z) => z.type === 'desk').map((z) => z.id);
const labelId = map.zones.find((z) => z.type === 'label')!.id;
const spawn = { x: 80, y: 240 };

type Point = { x: number; y: number };

// ---- Le tableau de la brief ---------------------------------------------------------------------------------------------

test.each<[string, Point | null, string[], Point]>([
  ['position enregistrée valide', { x: 400, y: 400 }, [], { x: 400, y: 400 }],
  ['dans la salle, salle occupée', { x: 336, y: 80 }, [roomId], spawn],
  ['dans la salle, salle libre', { x: 336, y: 80 }, [], { x: 336, y: 80 }],
  ['aucune position', null, [], spawn],
  ['position sur un mur', { x: 16, y: 16 }, [], spawn],
])('chooseSpawn : %s', (_name, saved, busyZoneIds, expected) => {
  expect(chooseSpawn(map, saved, new Set(busyZoneIds))).toEqual(expected);
});

test('la carte de développement a bien les zones que ces tests supposent', () => {
  expect(map.spawn).toEqual(spawn);
  expect(deskIds).toHaveLength(3);
  expect(new Set([roomId, ...deskIds, labelId]).size).toBe(5);
});

// ---- Autres cas -----------------------------------------------------------------------------------------------------------

describe('chooseSpawn : autres cas', () => {
  test('dans un bureau occupé : l\'apparition ; dans un bureau libre : la position enregistrée', () => {
    const inFirstDesk = { x: 160, y: 360 };   // ligne 11, colonne 5 : du sol, dans la zone du premier bureau
    expect(chooseSpawn(map, inFirstDesk, new Set([deskIds[0]!]))).toEqual(spawn);
    expect(chooseSpawn(map, inFirstDesk, new Set())).toEqual(inFirstDesk);
  });

  test('seule la zone où se trouve la position compte : une autre zone occupée ne change rien', () => {
    const inFirstDesk = { x: 160, y: 360 };
    const inRoom = { x: 336, y: 80 };
    expect(chooseSpawn(map, inFirstDesk, new Set([roomId, deskIds[1]!, deskIds[2]!]))).toEqual(inFirstDesk);
    expect(chooseSpawn(map, inRoom, new Set(deskIds))).toEqual(inRoom);
  });

  test('hors de toute zone, même quand toutes les zones sont occupées : la position enregistrée', () => {
    const inTheOpen = { x: 600, y: 240 };   // ligne 7, colonne 18 : l'open space, hors des zones
    expect(chooseSpawn(map, inTheOpen, new Set([roomId, ...deskIds, labelId]))).toEqual(inTheOpen);
  });

  test('une étiquette n\'isole pas : sa zone « occupée » n\'écarte personne', () => {
    const underLabel = { x: 336, y: 270 };   // ligne 8, colonne 10 : dans la zone label
    expect(chooseSpawn(map, underLabel, new Set([labelId]))).toEqual(underLabel);
  });

  test.each<[string, Point]>([
    ['sur un bureau', { x: 144, y: 304 }],
    ['au-dessus de la carte', { x: 80, y: -1 }],
    ['à gauche de la carte', { x: -5, y: 100 }],
    ['au-delà du bord droit', { x: 768, y: 240 }],
    ['très loin', { x: 5_000, y: 5_000 }],
    ['NaN', { x: Number.NaN, y: Number.NaN }],
  ])('position enregistrée %s : l\'apparition', (_name, saved) => {
    expect(chooseSpawn(map, saved, new Set())).toEqual(spawn);
  });

  test('le résultat est un objet neuf : le modifier ne change ni la carte ni la position enregistrée', () => {
    const saved = { x: 400, y: 400 };
    const kept = chooseSpawn(map, saved, new Set());
    expect(kept).not.toBe(saved);
    kept.x = 1;
    expect(saved).toEqual({ x: 400, y: 400 });

    const fallback = chooseSpawn(map, null, new Set());
    expect(fallback).not.toBe(map.spawn);
    fallback.x = 1;
    expect(map.spawn).toEqual(spawn);
  });
});
