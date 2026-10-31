import { buildOfficeTiledMap, parseOfficeMap, type DeskInfo, type OfficeMap, type PublicPlayer, type Zone } from '@bureau/shared';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { EventBus } from '../game/EventBus';
import { fr } from '../i18n/fr';
import { emitOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { useInMyDesk, usePlace } from './use-here';

const zone = (id: string, type: Zone['type'], x: number, y: number, width: number, height: number, extra: Partial<Zone> = {}): Zone => ({ id, type, name: null, text: null, x, y, width, height, ...extra });

// Une carte réduite à ses zones : un accueil (étiquette), une salle de réunion (pièce à part), le bureau A1.
const map = {
  widthTiles: 30,
  heightTiles: 30,
  tileSize: 32,
  blocked: new Uint8Array(900),
  spawn: { x: 48, y: 48 },
  switches: [],
  places: [],
  coffees: [],
  speakers: [],
  tables: [],
  signs: [], arena: null,
  zones: [
    zone('1', 'label', 0, 320, 320, 64, { text: 'ACCUEIL' }),
    zone('2', 'private', 640, 0, 320, 320, { name: 'Salle de réunion' }),
    zone('3', 'desk', 0, 0, 288, 224, { name: 'A1' }),
  ],
} as unknown as OfficeMap;

const player = (id: string, name: string, x: number, y: number): PublicPlayer => ({
  id,
  name,
  avatarKey: null,
  x,
  y,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
});

const desk = (key: string, ownerId: string | null, ownerName: string | null): DeskInfo =>
  ({ key, ownerId, ownerName, name: null, locked: false, closedByState: false, floor: '', wall: '', items: [] }) as DeskInfo;

const init = (self: PublicPlayer, mapKey = 'dev-office', desks: DeskInfo[] = []) =>
  act(() => useOfficeStore.getState().applyInit({ self, players: [], mapKey, chatHistory: [], desks, closedDesks: [], deskBans: [] }));
const walkTo = (x: number, y: number) => act(() => void emitOnBus(EventBus, 'local:move', { x, y, dir: 'up', moving: true }));

beforeEach(() => {
  useOfficeStore.getState().reset();
});

describe('usePlace : le lieu où l\'on est', () => {
  test('sans carte (le jeu n\'est pas là), rien', () => {
    init(player('moi', 'Léa', 100, 340));
    expect(renderHook(() => usePlace()).result.current).toBeNull();
  });

  test('le nom du lieu où l\'on arrive, puis où l\'on marche (les pieds que le jeu envoie)', () => {
    init(player('moi', 'Léa', 100, 340));
    act(() => useOfficeStore.getState().setOfficeMap(map));
    const { result } = renderHook(() => usePlace());
    expect(result.current).toBe('Accueil');
    walkTo(700, 100);
    expect(result.current).toBe('Salle de réunion');
    walkTo(500, 100);
    expect(result.current).toBe(fr.office.where.hallway);
  });

  test('sans arrivée ni pas (le magasin ne sait pas où l\'on est), le point d\'apparition de la carte : ici dans la pièce de A1', () => {
    act(() => useOfficeStore.getState().setOfficeMap(map));
    expect(renderHook(() => usePlace()).result.current).toBe('Place A1');
  });

  test('il ne garde plus l\'oreille au jeu une fois démonté', () => {
    init(player('moi', 'Léa', 100, 340));
    act(() => useOfficeStore.getState().setOfficeMap(map));
    const { unmount } = renderHook(() => usePlace());
    const before = EventBus.listenerCount('local:move');
    unmount();
    expect(EventBus.listenerCount('local:move')).toBe(before - 1);
  });

  test('sur la grande carte (celle du magasin), les grandes pièces : l\'accueil à l\'arrivée, puis la cafétéria', () => {
    const office = parseOfficeMap(buildOfficeTiledMap());
    init(player('moi', 'Léa', office.spawn.x, office.spawn.y), 'office');
    act(() => useOfficeStore.getState().setOfficeMap(office));
    const { result } = renderHook(() => usePlace());
    expect(result.current).toBe('Accueil');
    walkTo(44 * 32 + 16, 25 * 32 + 16);
    expect(result.current).toBe('Cafétéria');
  });

  test('le bureau de quelqu\'un porte son nom, et le suit quand il change de main', () => {
    init(player('moi', 'Léa', 100, 100), 'dev-office', [desk('A1', null, null)]);
    act(() => useOfficeStore.getState().setOfficeMap(map));
    const { result } = renderHook(() => usePlace());
    expect(result.current).toBe('Place A1');
    act(() => useOfficeStore.getState().setDesk(desk('A1', 'bob', 'Bob')));
    expect(result.current).toBe('Bureau de Bob');
  });
});

describe('useInMyDesk : est-on dans son bureau', () => {
  test('non sans bureau à soi, sans carte, ni dans le bureau de quelqu\'un d\'autre ; oui dans le sien, et le bureau rendu, non', () => {
    init(player('moi', 'Léa', 100, 100), 'dev-office', [desk('A1', 'bob', 'Bob')]);
    const { result } = renderHook(() => useInMyDesk());
    expect(result.current).toBe(false);
    act(() => useOfficeStore.getState().setOfficeMap(map));
    expect(result.current).toBe(false);
    act(() => useOfficeStore.getState().setDesk(desk('A1', 'moi', 'Léa')));
    expect(result.current).toBe(true);
    walkTo(500, 500);
    expect(result.current).toBe(false);
    walkTo(100, 100);
    expect(result.current).toBe(true);
    act(() => useOfficeStore.getState().setDesk(desk('A1', null, null)));
    expect(result.current).toBe(false);
  });
});
