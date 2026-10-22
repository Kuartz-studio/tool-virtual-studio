import { DEV_OFFICE, OFFICE, buildTiledMap, parseOfficeMap, type DeskAck, type DeskInfo, type PublicPlayer } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { DeskPanel } from './DeskPanel';

// Le réglage de la pièce d'un bureau qui n'a rien de particulier.
const DEFAULT_ROOM = { floor: 'parquet-clair', wall: 'creme', items: [] };

const map = parseOfficeMap(buildTiledMap({ ...OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));

const player = (id: string, name: string, at = { x: 80, y: 400 }): PublicPlayer => ({
  id,
  name,
  avatarKey: null,
  ...at,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
});
const free = (key: string): DeskInfo => ({ key, ownerId: null, ownerName: null, name: null, locked: false, closedByState: false, ...DEFAULT_ROOM });
const owned = (key: string, ownerId: string, ownerName: string, more: Partial<DeskInfo> = {}): DeskInfo => ({
  ...free(key),
  ownerId,
  ownerName,
  ...more,
});

// Le panneau, pour la personne « moi », avec ces places, ces autres joueurs et ceux qu'elle a exclus.
function setup({
  desks,
  others = [],
  bans = [],
  withMap = true,
}: {
  desks: DeskInfo[];
  others?: PublicPlayer[];
  bans?: Array<{ id: string; name: string }>;
  withMap?: boolean;
}) {
  const socket = new FakeSocket();
  socket.serverAccepts();
  act(() => {
    useOfficeStore.getState().applyInit({
      self: player('moi', 'Léa'),
      players: others,
      mapKey: 'office',
      chatHistory: [],
      desks,
      closedDesks: [],
      deskBans: bans,
    });
    if (withMap) useOfficeStore.getState().setOfficeMap(map);
  });
  let closed = 0;
  const view = render(<DeskPanel socket={socket.asSocket()} onClose={() => closed++} onDecorate={() => {}} />);
  return { socket, view, closed: () => closed };
}

// Le serveur répond à la dernière commande envoyée.
async function ack(socket: FakeSocket, response: DeskAck = { ok: true }) {
  await act(async () => socket.serverAcks('desk:do', response));
}

beforeEach(() => {
  useOfficeStore.getState().reset();
});

describe('sans bureau', () => {
  test('les places libres se prennent d\'un clic (claim)', async () => {
    const user = userEvent.setup();
    const { socket } = setup({ desks: [owned('A1', 'bob', 'Bob'), free('A2'), free('A3')] });
    expect(screen.getByText(fr.desk.none)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Prendre la place/ }).map((b) => b.textContent)).toEqual(['Prendre la place A2', 'Prendre la place A3']);
    await user.click(screen.getByRole('button', { name: 'Prendre la place A3' }));
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'claim', key: 'A3' }]);
    await ack(socket);
  });

  test('toutes les places prises : on le dit', () => {
    setup({ desks: [owned('A1', 'bob', 'Bob')] });
    expect(screen.getByText(fr.desk.pickEmpty)).toBeTruthy();
  });

  test('place prise entre-temps : l\'erreur du serveur s\'affiche', async () => {
    const user = userEvent.setup();
    const { socket } = setup({ desks: [free('A2')] });
    await user.click(screen.getByRole('button', { name: 'Prendre la place A2' }));
    await ack(socket, { ok: false, error: 'taken' });
    expect(screen.getByRole('alert').textContent).toBe(fr.desk.errors.taken);
  });
});

describe('avec un bureau', () => {
  test('le nom : proposé par défaut en indice, enregistré à l\'envoi, borné à 40 caractères', async () => {
    const user = userEvent.setup();
    const { socket } = setup({ desks: [owned('A1', 'moi', 'Léa'), free('A2')] });
    const input = screen.getByLabelText(fr.desk.nameLabel) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Bureau de Léa');
    expect(input.maxLength).toBe(40);
    const save = screen.getByRole('button', { name: fr.desk.nameSave });
    expect((save as HTMLButtonElement).disabled).toBe(true);   // rien n'a changé
    await user.type(input, 'Le labo');
    await user.click(save);
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'rename', name: 'Le labo' }]);
    await ack(socket);
    expect(screen.getByText(fr.desk.nameSaved)).toBeTruthy();
  });

  test('le nom du serveur remplit le champ (un autre onglet l\'a changé)', () => {
    setup({ desks: [owned('A1', 'moi', 'Léa', { name: 'Atelier' })] });
    expect((screen.getByLabelText(fr.desk.nameLabel) as HTMLInputElement).value).toBe('Atelier');
  });

  test('la porte : « Fermer la porte » (lock true), puis « Ouvrir la porte » quand elle l\'est', async () => {
    const user = userEvent.setup();
    const { socket } = setup({ desks: [owned('A1', 'moi', 'Léa')] });
    await user.click(screen.getByRole('button', { name: fr.desk.lock }));
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'lock', locked: true }]);
    await ack(socket);
    act(() => useOfficeStore.getState().setDesk(owned('A1', 'moi', 'Léa', { locked: true })));
    const unlock = screen.getByRole('button', { name: fr.desk.unlock });
    expect(unlock.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(fr.desk.lockHint)).toBeTruthy();
    await user.click(unlock);
    expect(socket.sentOf('desk:do').at(-1)).toEqual({ type: 'lock', locked: false });
  });

  test('porte fermée par l\'état d\'activité : le panneau le dit', () => {
    setup({ desks: [owned('A1', 'moi', 'Léa', { closedByState: true, ...DEFAULT_ROOM })] });
    expect(screen.getByText(fr.desk.closedByState)).toBeTruthy();
  });

  test('aller à mon bureau, rendre mon bureau', async () => {
    const user = userEvent.setup();
    const { socket } = setup({ desks: [owned('A1', 'moi', 'Léa')] });
    await user.click(screen.getByRole('button', { name: fr.desk.goto }));
    await ack(socket);
    await user.click(screen.getByRole('button', { name: fr.desk.release }));
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'goto' }, { type: 'release' }]);
  });

  test('qui est dans le bureau (d\'après les positions) : « Exclure » envoie kick ; les autres n\'y figurent pas', async () => {
    const user = userEvent.setup();
    // A1 : pièce des cases x 9 à 17, y 2 à 8 ; le point (400, 144) y est, (80, 400) est dans la rue au sud.
    const { socket } = setup({
      desks: [owned('A1', 'moi', 'Léa')],
      others: [player('bob', 'Bob', { x: 400, y: 144 }), player('zoe', 'Zoé', { x: 80, y: 400 })],
    });
    const inside = screen.getByRole('region', { name: fr.desk.insideTitle });
    expect(within(inside).getAllByRole('listitem').map((li) => li.querySelector('.person-name')?.textContent)).toEqual(['Bob']);
    await user.click(within(inside).getByRole('button', { name: t(fr.desk.kickLabel, { name: 'Bob' }) }));
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'kick', userId: 'bob' }]);
  });

  test('les positions relues : quelqu\'un qui entre apparaît dans la liste', async () => {
    const { view } = setup({ desks: [owned('A1', 'moi', 'Léa')], others: [player('bob', 'Bob', { x: 80, y: 400 })] });
    expect(screen.getByText(fr.desk.insideEmpty)).toBeTruthy();
    useOfficeStore.getState().positions.set('bob', { x: 400, y: 144, dir: 'up', moving: false });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(screen.queryByText(fr.desk.insideEmpty)).toBeNull();
    view.unmount();
  });

  test('ceux qu\'on a exclus : « Réadmettre » envoie unban', async () => {
    const user = userEvent.setup();
    const { socket } = setup({ desks: [owned('A1', 'moi', 'Léa')], bans: [{ id: 'cleo', name: 'Cléo' }] });
    const banned = screen.getByRole('region', { name: fr.desk.bannedTitle });
    await user.click(within(banned).getByRole('button', { name: t(fr.desk.unbanLabel, { name: 'Cléo' }) }));
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'unban', userId: 'cleo' }]);
  });

  test('changer de place : la liste des places libres s\'ouvre, en choisir une envoie claim et la referme', async () => {
    const user = userEvent.setup();
    const { socket } = setup({ desks: [owned('A1', 'moi', 'Léa'), free('A2'), owned('A3', 'bob', 'Bob')] });
    expect(screen.queryByRole('button', { name: 'Prendre la place A2' })).toBeNull();
    await user.click(screen.getByRole('button', { name: fr.desk.moveTitle }));
    await user.click(screen.getByRole('button', { name: 'Prendre la place A2' }));
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'claim', key: 'A2' }]);
    await ack(socket);
    expect(screen.queryByRole('button', { name: 'Prendre la place A2' })).toBeNull();
  });

  test('Échap et ✕ ferment', async () => {
    const user = userEvent.setup();
    const { closed } = setup({ desks: [owned('A1', 'moi', 'Léa')] });
    await user.click(screen.getByRole('button', { name: fr.desk.close }));
    await user.keyboard('{Escape}');
    expect(closed()).toBeGreaterThanOrEqual(1);
  });

  test('sans connexion prête, aucun bouton ne part', async () => {
    const socket = new FakeSocket();
    act(() => {
      useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [], mapKey: 'office', chatHistory: [], desks: [owned('A1', 'moi', 'Léa')], closedDesks: [], deskBans: [] });
      useOfficeStore.getState().setReady(false);
    });
    render(<DeskPanel socket={socket.asSocket()} onClose={() => {}} onDecorate={() => {}} />);
    expect((screen.getByRole('button', { name: fr.desk.lock }) as HTMLButtonElement).disabled).toBe(true);
    expect(socket.sentOf('desk:do')).toEqual([]);
  });
});

// La carte de développement n'a pas de nom de place : la clé est le numéro de la zone.
test('la carte de développement : aucune erreur sans carte dans le magasin', () => {
  expect(parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } })).zones.length).toBeGreaterThan(0);
  setup({ desks: [owned('2', 'moi', 'Léa')], withMap: false, others: [player('bob', 'Bob')] });
  expect(screen.getByText(fr.desk.insideEmpty)).toBeTruthy();
});
