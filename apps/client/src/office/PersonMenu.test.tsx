import type { ActivityState, DeskInfo, OfficeMap, PublicPlayer, Zone } from '@bureau/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { listenOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { PersonMenu, placeAtPoint } from './PersonMenu';
import { useToasts } from './Toasts';

const zone = (id: string, type: Zone['type'], x: number, y: number, width: number, height: number, extra: Partial<Zone> = {}): Zone => ({ id, type, name: null, text: null, x, y, width, height, ...extra });

// Une carte réduite à ses zones : les pièces des bureaux A1 (le mien) et A2, en pixels.
const map = {
  widthTiles: 30,
  heightTiles: 20,
  tileSize: 32,
  blocked: new Uint8Array(600),
  spawn: { x: 48, y: 400 },
  switches: [],
  places: [],
  coffees: [],
  speakers: [],
  tables: [],
  signs: [],
  arena: null,
  clerks: [],
  zones: [zone('1', 'desk', 0, 0, 288, 224, { name: 'A1' }), zone('2', 'desk', 320, 0, 288, 224, { name: 'A2' })],
} as unknown as OfficeMap;

const player = (id: string, name: string, x: number, y: number, extra: Partial<PublicPlayer> = {}): PublicPlayer => ({
  id,
  name,
  avatarKey: null,
  x,
  y,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
  ...extra,
});
const desk = (key: string, ownerId: string | null, ownerName: string | null): DeskInfo =>
  ({ key, ownerId, ownerName, name: null, locked: false, closedByState: false, floor: '', wall: '', items: [] }) as DeskInfo;
const focus: ActivityState = { id: 's1', label: 'Concentration', color: '#6d28d9', icon: 'headphones', allowEntry: false, hear: true, heard: true };

// Léa (moi) est dans son bureau A1, en (100, 100) ; Bob y est aussi, à 3 cases ; Zoé est dans le bureau A2, à 10 cases.
function arrive(players: PublicPlayer[] = [player('bob', 'Bob', 196, 100), player('zoe', 'Zoé', 420, 100)]) {
  act(() =>
    useOfficeStore.getState().applyInit({
      self: player('moi', 'Léa', 100, 100),
      players,
      mapKey: 'office',
      chatHistory: [],
      desks: [desk('A1', 'moi', 'Léa'), desk('A2', 'zoe', 'Zoé')],
      closedDesks: [],
      deskBans: [],
    }),
  );
  act(() => useOfficeStore.getState().setOfficeMap(map));
}

let socket: FakeSocket;
const heard: Array<string | null> = [];
const stops: Array<() => void> = [];
beforeEach(() => {
  useOfficeStore.getState().reset();
  useToasts.getState().clear();
  socket = new FakeSocket();
  socket.connect();
  socket.serverAccepts();
  heard.length = 0;
  stops.push(listenOnBus(EventBus, 'local:follow', ({ id }) => heard.push(id)));
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

const open = (userId: string, extra: { name?: string; opener?: HTMLElement } = {}) => act(() => useOfficeStore.getState().openPersonMenu({ userId, x: 40, y: 50, ...extra }));
const lines = () => screen.queryAllByRole('menuitem').map((item) => item.textContent);
const renderMenu = () => render(<PersonMenu socket={socket.asSocket()} />);

describe('les lignes du menu', () => {
  test('quelqu\'un à moins de 5 cases : Profil et Suivre ; déjà dans mon bureau, pas d\'invitation', () => {
    arrive();
    renderMenu();
    open('bob');
    expect(screen.getByRole('menu', { name: t(fr.person.menu, { name: 'Bob' }) })).toBeTruthy();
    expect(lines()).toEqual([fr.person.profile, fr.person.follow]);
    // Le focus va à la première ligne.
    expect(document.activeElement?.textContent).toBe(fr.person.profile);
  });

  test('quelqu\'un plus loin : Rejoindre ; je suis dans mon bureau et pas elle : Inviter dans le bureau', () => {
    arrive();
    renderMenu();
    open('zoe');
    expect(lines()).toEqual([fr.person.profile, fr.person.join, fr.person.invite]);
  });

  test('hors de mon bureau, pas d\'invitation ; la distance est celle de mes derniers pas', () => {
    arrive();
    renderMenu();
    // Sous le bureau A2, à moins de 5 cases de Zoé (150 px), hors du mien.
    act(() => void EventBus.emit('local:move', { x: 420, y: 250, dir: 'down', moving: false }));
    open('zoe');
    expect(lines()).toEqual([fr.person.profile, fr.person.follow]);
  });

  test('soi-même, ou quelqu\'un hors ligne : Profil seulement', () => {
    arrive();
    renderMenu();
    open('moi');
    expect(lines()).toEqual([fr.person.profile]);
    open('parti', { name: 'Paul' });
    expect(lines()).toEqual([fr.person.profile]);
    expect(screen.getByRole('menu', { name: t(fr.person.menu, { name: 'Paul' }) })).toBeTruthy();
  });

  test('celle qu\'on suit déjà : Arrêter de suivre', async () => {
    arrive();
    renderMenu();
    act(() => useOfficeStore.getState().setFollowing('bob'));
    open('bob');
    expect(lines()).toEqual([fr.person.profile, fr.person.unfollow]);
    await userEvent.click(screen.getByRole('menuitem', { name: fr.person.unfollow }));
    expect(heard).toEqual([null]);
  });

  test('qui ne veut pas être dérangé : l\'invitation est inactive, et dit pourquoi (son mode)', () => {
    arrive([player('zoe', 'Zoé', 420, 100, { activity: focus })]);
    renderMenu();
    open('zoe');
    const invite = screen.getByRole('menuitem', { name: new RegExp(fr.person.invite) });
    expect((invite as HTMLButtonElement).disabled).toBe(true);
    expect(invite.textContent).toContain('Concentration');
  });
});

describe('ce que font les lignes', () => {
  test('Suivre : le jeu l\'apprend (local:follow), et le menu se ferme', async () => {
    arrive();
    renderMenu();
    open('bob');
    await userEvent.click(screen.getByRole('menuitem', { name: fr.person.follow }));
    expect(heard).toEqual(['bob']);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('Rejoindre : la demande part au serveur (person:join) ; un refus se dit dans un message passager', async () => {
    arrive();
    renderMenu();
    open('zoe');
    await userEvent.click(screen.getByRole('menuitem', { name: fr.person.join }));
    expect(socket.sentOf('person:join')).toEqual([{ userId: 'zoe' }]);
    await act(async () => socket.serverAcks('person:join', { ok: false, error: 'no_spot' }));
    expect(useToasts.getState().items.map((item) => item.text)).toEqual([fr.person.joinErrors.no_spot]);
  });

  test('Inviter dans le bureau : desk:do invite ; accepté par le serveur, « Invitation envoyée à Zoé. »', async () => {
    arrive();
    renderMenu();
    open('zoe');
    await userEvent.click(screen.getByRole('menuitem', { name: fr.person.invite }));
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'invite', userId: 'zoe' }]);
    await act(async () => socket.serverAcks('desk:do', { ok: true }));
    expect(useToasts.getState().items.map((item) => item.text)).toEqual([t(fr.person.inviteSent, { name: 'Zoé' })]);
  });

  test('Profil : ses caractéristiques ; les miennes, l\'onglet Caractéristiques des missions', async () => {
    arrive();
    renderMenu();
    open('bob');
    await userEvent.click(screen.getByRole('menuitem', { name: fr.person.profile }));
    expect(useOfficeStore.getState().panelRequest).toEqual({ panel: 'sheet', userId: 'bob' });
    open('moi');
    await userEvent.click(screen.getByRole('menuitem', { name: fr.person.profile }));
    expect(useOfficeStore.getState().panelRequest).toEqual({ panel: 'missions', tab: 'sheet' });
  });

  test('Échap ferme et rend le focus à ce qui l\'a ouvert ; un clic ailleurs ferme', async () => {
    arrive();
    render(
      <>
        <button type="button">Ligne de Bob</button>
        <PersonMenu socket={socket.asSocket()} />
      </>,
    );
    const row = screen.getByRole('button', { name: 'Ligne de Bob' });
    open('bob', { opener: row });
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe(fr.person.follow);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(row);

    open('bob');
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('placeAtPoint', () => {
  const viewport = { width: 800, height: 600 };
  test('sous le point et à sa droite ; trop près d\'un bord : de l\'autre côté du point', () => {
    expect(placeAtPoint({ x: 100, y: 100 }, { width: 200, height: 150 }, viewport)).toEqual({ left: 100, top: 100 });
    expect(placeAtPoint({ x: 700, y: 500 }, { width: 200, height: 150 }, viewport)).toEqual({ left: 500, top: 350 });
    expect(placeAtPoint({ x: 100, y: 590 }, { width: 200, height: 700 }, viewport)).toEqual({ left: 100, top: 8 });
  });
});
