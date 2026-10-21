import { buildOfficeTiledMap, GRAND_HALL, LOUNGE, LOUNGE_MUSIC_X, LOUNGE_TERRACE_WIDTH, MEETING_ROOM, parseOfficeMap, PLAZA, type DeskInfo, type OfficeMap, type Zone } from '@bureau/shared';
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
    expect(placeAt(null, null, [], 100, 100)).toBeNull();
  });

  test('la zone label qui contient le point donne son texte, écrit comme une phrase', () => {
    expect(placeAt(map, 'dev-office', [], 100, 330)).toBe('Accueil');
    // Une zone contient son bord haut et gauche, pas son bord bas et droit.
    expect(placeAt(map, 'dev-office', [], 64, 320)).toBe('Accueil');
    expect(placeAt(map, 'dev-office', [], 256, 330)).toBe(fr.office.where.hallway);
    expect(placeAt(map, 'dev-office', [], 100, 352)).toBe(fr.office.where.hallway);
  });

  test('une étiquette sans texte ne nomme rien', () => {
    expect(placeAt(map, 'dev-office', [], 330, 330)).toBe(fr.office.where.hallway);
  });

  test('ailleurs, « Couloir »', () => {
    expect(placeAt(map, 'dev-office', [], 600, 500)).toBe('Couloir');
  });

  test('l\'étiquette passe avant le nom de la pièce ; le reste de la pièce prend le nom de la pièce', () => {
    expect(placeAt(map, 'dev-office', [], 340, 140)).toBe('Grande salle');
    expect(placeAt(map, 'dev-office', [], 340, 20)).toBe('Salle de réunion');
  });

  test('un bureau : « Bureau de <nom> », ou le nom que son occupant lui a donné ; libre, « Place <clé> »', () => {
    expect(placeAt(map, 'dev-office', [desk({ ownerName: 'Léa' })], 40, 40)).toBe('Bureau de Léa');
    expect(placeAt(map, 'dev-office', [desk({ ownerName: 'Léa', name: 'Le QG' })], 40, 40)).toBe('Le QG');
    expect(placeAt(map, 'dev-office', [], 40, 40)).toBe('Place A1');
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

// La grande carte : ses zones `label` ne sont que des bandes d'une case (« CAFÉ », « ACCUEIL »), et la zone détente est d'un seul tenant. Les grandes
// pièces sont reconnues d'après les mêmes rectangles que l'ambiance de chaque endroit (audio/scene-at.ts).
describe('les grandes pièces de la grande carte', () => {
  const office = parseOfficeMap(buildOfficeTiledMap());
  // Le milieu d'une case, en pixels.
  const px = (tile: number) => tile * office.tileSize + office.tileSize / 2;
  const at = (tx: number, ty: number, desks: DeskInfo[] = []) => placeAt(office, 'office', desks, px(tx), px(ty));

  test('le café est la place centrale, loin de sa bande d\'une case : on y est « Café », et non « Couloir »', () => {
    expect(at(PLAZA.x + 15, PLAZA.y + 6)).toBe('Café');
    // Pas sur la bande « CAFÉ » (y 24, x 18 à 29) : n'importe où sur la place.
    expect(at(PLAZA.x + 1, PLAZA.y + 1)).toBe('Café');
    expect(at(PLAZA.x + PLAZA.w - 1, PLAZA.y + PLAZA.h - 1)).toBe('Café');
    // L'arche de la zone détente en fait partie, comme pour l'ambiance.
    expect(at(18, LOUNGE.y - 1)).toBe('Café');
  });

  test('l\'accueil, où l\'on apparaît, n\'est pas le couloir', () => {
    expect(placeAt(office, 'office', [], office.spawn.x, office.spawn.y)).toBe('Accueil');
    expect(at(60, 40)).toBe('Accueil');
    expect(at(44, 44)).toBe('Accueil');
    expect(at(64, 33)).toBe('Accueil');
  });

  test('la zone détente, d\'ouest en est : la piscine, le salon, le coin musique', () => {
    const y = LOUNGE.y + 6;
    expect(at(LOUNGE.x, y)).toBe('Piscine');
    expect(at(LOUNGE.x + LOUNGE_TERRACE_WIDTH - 1, y)).toBe('Piscine');
    expect(at(LOUNGE.x + LOUNGE_TERRACE_WIDTH, y)).toBe('Salon');
    expect(at(LOUNGE_MUSIC_X - 1, y)).toBe('Salon');
    expect(at(LOUNGE_MUSIC_X, y)).toBe('Coin musique');
    expect(at(LOUNGE.x + LOUNGE.w - 1, y)).toBe('Coin musique');
    // Plus de « Zone détente » (le nom de la zone entière, et de sa bande du bas) : chaque endroit a le sien.
    expect(at(22, 43)).toBe('Salon');
  });

  test('la grande salle et la salle de réunion', () => {
    expect(at(GRAND_HALL.x + 3, GRAND_HALL.y + 3)).toBe('Grande salle');
    expect(at(MEETING_ROOM.x + 3, MEETING_ROOM.y + 3)).toBe('Salle de réunion');
  });

  test('un bureau garde son nom ; le couloir, au nord comme au sud, est « Couloir »', () => {
    const slot = office.zones.find((zone) => zone.type === 'desk' && zone.name === 'A3')!;
    const mine = { key: 'A3', ownerId: 'moi', ownerName: 'Léa', name: null, locked: false, closedByState: false, floor: '', wall: '' } as unknown as DeskInfo;
    expect(placeAt(office, 'office', [mine], slot.x + 40, slot.y + 40)).toBe('Bureau de Léa');
    expect(at(30, 12)).toBe('Couloir');
    expect(at(5, 29)).toBe('Couloir');
    expect(at(56, 29)).toBe('Couloir');
  });

  test('chaque case de la carte a un lieu : les pièces, les places et le couloir, et rien d\'autre', () => {
    const names = new Set<string>();
    for (let ty = 0; ty < office.heightTiles; ty++) {
      for (let tx = 0; tx < office.widthTiles; tx++) names.add(at(tx, ty) ?? '?');
    }
    expect([...names].sort()).toEqual(['Accueil', 'Café', 'Coin musique', 'Couloir', 'Grande salle', 'Piscine', 'Place A1', 'Place A2', 'Place A3', 'Place A4', 'Place A5', 'Place A6', 'Salle de réunion', 'Salon'].sort());
  });

  test('une autre carte (celle des tests) n\'a pas ces pièces : ses zones seules nomment, et « Couloir » faute d\'étiquette', () => {
    // Les mêmes pieds, mais la carte n'est pas « office » : seules ses zones parlent.
    expect(placeAt(office, 'dev-office', [], px(PLAZA.x + 15), px(PLAZA.y + 6))).toBe('Couloir');
    expect(placeAt(office, null, [], office.spawn.x, office.spawn.y)).toBe('Couloir');
  });

  test('sans carte, rien ; la clé de la carte n\'y change rien', () => {
    expect(placeAt(null, 'office', [], 100, 100)).toBeNull();
  });
});
