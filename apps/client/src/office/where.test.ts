import type { DeskInfo, OfficeMap, Zone } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { fr } from '../i18n/fr';
import { placeAt } from './where';

// Une carte réduite à ses zones (en pixels).
const zone = (id: string, type: Zone['type'], x: number, y: number, width: number, height: number, extra: Partial<Zone> = {}): Zone => ({
  id,
  type,
  name: null,
  text: null,
  x,
  y,
  width,
  height,
  ...extra,
});

const map = {
  widthTiles: 20,
  heightTiles: 20,
  tileSize: 32,
  blocked: new Uint8Array(400),
  spawn: { x: 48, y: 48 },
  switches: [],
  zones: [
    zone('1', 'label', 64, 320, 192, 32, { text: 'ACCUEIL' }),
    zone('2', 'label', 320, 320, 96, 32),
    zone('3', 'desk', 0, 0, 160, 128, { name: 'A1' }),
    zone('4', 'private', 320, 0, 160, 160, { name: 'Salle de réunion' }),
    zone('5', 'label', 336, 128, 96, 32, { text: 'GRANDE SALLE' }),
    zone('6', 'door', 64, 128, 32, 64, { name: 'A1' }),
  ],
} as unknown as OfficeMap;

const desk = (over: Partial<DeskInfo>): DeskInfo => ({ key: 'A1', ownerId: null, ownerName: null, name: null, locked: false, closedByState: false, floor: '', wall: '', ...over }) as DeskInfo;

describe('le nom du lieu', () => {
  test('sans carte, rien', () => {
    expect(placeAt(null, [], 100, 100)).toBeNull();
  });

  test('la zone label qui contient le point donne son texte, écrit comme une phrase', () => {
    expect(placeAt(map, [], 100, 330)).toBe('Accueil');
    // Une zone contient son bord haut et gauche, pas son bord bas et droit.
    expect(placeAt(map, [], 64, 320)).toBe('Accueil');
    expect(placeAt(map, [], 256, 330)).toBe(fr.office.where.hallway);
    expect(placeAt(map, [], 100, 352)).toBe(fr.office.where.hallway);
  });

  test('une étiquette sans texte ne nomme rien', () => {
    expect(placeAt(map, [], 330, 330)).toBe(fr.office.where.hallway);
  });

  test('ailleurs, « Couloir »', () => {
    expect(placeAt(map, [], 600, 500)).toBe('Couloir');
  });

  test('l\'étiquette passe avant le nom de la pièce ; le reste de la pièce prend le nom de la pièce', () => {
    expect(placeAt(map, [], 340, 140)).toBe('Grande salle');
    expect(placeAt(map, [], 340, 20)).toBe('Salle de réunion');
  });

  test('un bureau : « Bureau de <nom> », ou le nom que son occupant lui a donné ; libre, « Place <clé> »', () => {
    expect(placeAt(map, [desk({ ownerName: 'Léa' })], 40, 40)).toBe('Bureau de Léa');
    expect(placeAt(map, [desk({ ownerName: 'Léa', name: 'Le QG' })], 40, 40)).toBe('Le QG');
    expect(placeAt(map, [], 40, 40)).toBe('Place A1');
  });
});
