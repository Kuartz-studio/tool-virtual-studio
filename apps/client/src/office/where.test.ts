import { buildOfficeTiledMap, parseOfficeMap, type DeskInfo, type OfficeMap, type Zone } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { fr } from '../i18n/fr';
import { deskKeyAt, placeAt } from './where';

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
  places: [],
  coffees: [],
  speakers: [],
  tables: [],
  signs: [], arena: null,
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

describe('la clé du bureau où l\'on est', () => {
  test('celle de la pièce qui contient le point ; ailleurs, ou sans carte, rien', () => {
    expect(deskKeyAt(map, 40, 40)).toBe('A1');
    // Une pièce contient son bord haut et gauche, pas son bord bas et droit.
    expect(deskKeyAt(map, 0, 0)).toBe('A1');
    expect(deskKeyAt(map, 160, 40)).toBeNull();
    expect(deskKeyAt(map, 600, 500)).toBeNull();
    expect(deskKeyAt(null, 40, 40)).toBeNull();
  });

  test('la porte d\'un bureau n\'est pas sa pièce', () => {
    expect(deskKeyAt(map, 70, 140)).toBeNull();
  });
});

// La grande carte : ses lieux (zones `place`) nomment les pièces ; un bureau garde son nom, une rue est « Couloir ».
describe('les lieux de la grande carte', () => {
  const office = parseOfficeMap(buildOfficeTiledMap());
  // Le milieu d'une case, en pixels.
  const px = (tile: number) => tile * office.tileSize + office.tileSize / 2;
  const at = (tx: number, ty: number, desks: DeskInfo[] = []) => placeAt(office, desks, px(tx), px(ty));

  test('le café est le café, la place autour de lui la place centrale', () => {
    expect(at(40, 5)).toBe('Café');
    expect(at(33, 3)).toBe('Café');
    expect(at(46, 8)).toBe('Café');
    expect(at(31, 5)).toBe('Place centrale');
  });

  test('l\'accueil, où l\'on apparaît, n\'est pas le couloir', () => {
    expect(placeAt(office, [], office.spawn.x, office.spawn.y)).toBe('Accueil');
    expect(at(33, 17)).toBe('Accueil');
    expect(at(47, 24)).toBe('Accueil');
  });

  test('les salles : réunion, octogone, conférence, sport, jeu, détente et piscine', () => {
    expect(at(55, 5)).toBe('Salle de réunion');
    expect(at(70, 5)).toBe('Octogone');
    expect(at(60, 20)).toBe('Salle de conférence');
    expect(at(5, 38)).toBe('Salle de sport');
    expect(at(20, 38)).toBe('Salle de jeu');
    expect(at(45, 33)).toBe('Détente et piscine');
    expect(at(75, 40)).toBe('Détente et piscine');
  });

  test('un bureau garde son nom ; une rue, au nord, au sud et à l\'est, est « Couloir »', () => {
    const slot = office.zones.find((zone) => zone.type === 'desk' && zone.name === 'A3')!;
    const mine = { key: 'A3', ownerId: 'moi', ownerName: 'Léa', name: null, locked: false, closedByState: false, floor: '', wall: '' } as unknown as DeskInfo;
    expect(placeAt(office, [mine], slot.x + 40, slot.y + 40)).toBe('Bureau de Léa');
    expect(at(30, 12)).toBe('Couloir');
    expect(at(5, 28)).toBe('Couloir');
    expect(at(76, 20)).toBe('Couloir');
    // La rue traverse la place : on y est dans le couloir, pas sur la place.
    expect(at(40, 12)).toBe('Couloir');
  });

  test('un bureau libre se nomme « Place <clé> »', () => {
    const slot = office.zones.find((zone) => zone.type === 'desk' && zone.name === 'A5')!;
    expect(placeAt(office, [], slot.x + 40, slot.y + 40)).toBe('Place A5');
  });

  test('chaque case de la carte a un lieu : les pièces, les places et le couloir, et rien d\'autre', () => {
    const names = new Set<string>();
    for (let ty = 0; ty < office.heightTiles; ty++) {
      for (let tx = 0; tx < office.widthTiles; tx++) names.add(at(tx, ty) ?? '?');
    }
    expect([...names].sort()).toEqual(
      ['Accueil', 'Café', 'Couloir', 'Détente et piscine', 'Place centrale', 'Place A1', 'Place A2', 'Place A3', 'Place A4', 'Place A5', 'Place A6', 'Octogone', 'Salle de conférence', 'Salle de jeu', 'Salle de réunion', 'Salle de sport'].sort(),
    );
  });

  test('sans carte, rien', () => {
    expect(placeAt(null, [], 100, 100)).toBeNull();
  });
});
