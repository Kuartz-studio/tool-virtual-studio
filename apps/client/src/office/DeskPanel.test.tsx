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
  test('le plan des places : les libres se prennent d\'un clic (claim), les prises disent qui les a', async () => {
    const user = userEvent.setup();
    const { socket } = setup({ desks: [free('A3'), owned('A1', 'bob', 'Bob'), free('A2')] });
    expect(screen.getByText(fr.desk.none)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Prendre la place/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Prendre la place A2', 'Prendre la place A3']);
    expect(screen.getByRole('img', { name: 'Place A1, prise par Bob' })).toBeTruthy();
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
  test('le nom, sur place : proposé par défaut en indice, borné à 40 caractères, enregistré avec Entrée (en quittant le champ)', async () => {
    const user = userEvent.setup();
    const { socket } = setup({ desks: [owned('A1', 'moi', 'Léa'), free('A2')] });
    const input = screen.getByLabelText(fr.desk.nameLabel) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Bureau de Léa');
    expect(input.maxLength).toBe(40);
    // Quitter le champ sans rien changer n'envoie rien.
    await user.click(input);
    await user.tab();
    expect(socket.sentOf('desk:do')).toEqual([]);
    await user.type(input, 'Le labo{Enter}');
    expect(document.activeElement).not.toBe(input);
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'rename', name: 'Le labo' }]);
    await ack(socket);
    expect(screen.getByRole('status').textContent).toBe(fr.desk.nameSaved);
  });

  test('le nom : Échap rend celui du serveur sans fermer le panneau ; un second Échap ferme', async () => {
    const user = userEvent.setup();
    const { socket, closed } = setup({ desks: [owned('A1', 'moi', 'Léa', { name: 'Atelier' })] });
    const input = screen.getByLabelText(fr.desk.nameLabel) as HTMLInputElement;
    await user.type(input, ' 2');
    await user.keyboard('{Escape}');
    expect(input.value).toBe('Atelier');
    expect(closed()).toBe(0);
    await user.keyboard('{Escape}');
    expect(closed()).toBe(1);
    expect(socket.sentOf('desk:do')).toEqual([]);
  });

  test('le nom du serveur remplit le champ (un autre onglet l\'a changé)', () => {
    setup({ desks: [owned('A1', 'moi', 'Léa', { name: 'Atelier' })] });
    expect((screen.getByLabelText(fr.desk.nameLabel) as HTMLInputElement).value).toBe('Atelier');
  });

  test('la porte : un interrupteur qui dit son état ; allumé, lock true ; éteint, lock false', async () => {
    const user = userEvent.setup();
    const { socket } = setup({ desks: [owned('A1', 'moi', 'Léa')] });
    const door = screen.getByRole('switch', { name: fr.desk.lockSwitch });
    expect(door.getAttribute('aria-checked')).toBe('false');
    expect(door.textContent).toContain(fr.desk.doorOpen);
    await user.click(door);
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'lock', locked: true }]);
    await ack(socket);
    act(() => useOfficeStore.getState().setDesk(owned('A1', 'moi', 'Léa', { locked: true })));
    expect(door.getAttribute('aria-checked')).toBe('true');
    expect(door.textContent).toContain(fr.desk.doorLocked);
    await user.click(door);
    expect(socket.sentOf('desk:do').at(-1)).toEqual({ type: 'lock', locked: false });
  });

  test('porte fermée par l\'état d\'activité : le panneau le dit', () => {
    setup({ desks: [owned('A1', 'moi', 'Léa', { closedByState: true, ...DEFAULT_ROOM })] });
    expect(screen.getByText(fr.desk.closedByState)).toBeTruthy();
  });

  test('y aller (goto) ; rendre mon bureau demande confirmation, qu\'Échap annule', async () => {
    const user = userEvent.setup();
    const { socket, closed } = setup({ desks: [owned('A1', 'moi', 'Léa')] });
    await user.click(screen.getByRole('button', { name: fr.desk.gotoShort }));
    await ack(socket);
    await user.click(screen.getByRole('button', { name: fr.desk.release }));
    // La confirmation : le focus est sur « Annuler » ; Échap y renonce sans fermer le panneau, et rend le focus au bouton.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: fr.desk.releaseNo }));
    await user.keyboard('{Escape}');
    expect(closed()).toBe(0);
    expect(screen.queryByRole('button', { name: fr.desk.releaseYes })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: fr.desk.release }));
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'goto' }]);
    await user.click(screen.getByRole('button', { name: fr.desk.release }));
    await user.click(screen.getByRole('button', { name: fr.desk.releaseYes }));
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'goto' }, { type: 'release' }]);
  });

  test('qui est dans le bureau (d\'après les positions) : « Exclure » envoie kick ; les autres n\'y figurent pas', async () => {
    const user = userEvent.setup();
    // A1 : pièce des cases x 26 à 34, y 7 à 13 ; le point (976, 304) y est, (656, 560) est dans la rue au sud.
    const { socket } = setup({
      desks: [owned('A1', 'moi', 'Léa')],
      others: [player('bob', 'Bob', { x: 976, y: 304 }), player('zoe', 'Zoé', { x: 656, y: 560 })],
    });
    const inside = screen.getByRole('region', { name: fr.desk.insideTitle });
    expect(within(inside).getAllByRole('listitem').map((li) => li.querySelector('.desk-person-name')?.textContent)).toEqual(['Bob']);
    await user.click(within(inside).getByRole('button', { name: t(fr.desk.kickLabel, { name: 'Bob' }) }));
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'kick', userId: 'bob' }]);
  });

  test('les positions relues : quelqu\'un qui entre apparaît dans la liste', async () => {
    const { view } = setup({ desks: [owned('A1', 'moi', 'Léa')], others: [player('bob', 'Bob', { x: 656, y: 560 })] });
    expect(screen.getByText(fr.desk.insideEmpty)).toBeTruthy();
    useOfficeStore.getState().positions.set('bob', { x: 976, y: 304, dir: 'up', moving: false });
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

  test('déménager : le plan des places s\'ouvre (la sienne, « Toi »), en choisir une libre envoie claim et le referme', async () => {
    const user = userEvent.setup();
    const { socket } = setup({ desks: [owned('A1', 'moi', 'Léa'), free('A2'), owned('A3', 'bob', 'Bob')] });
    expect(screen.queryByRole('button', { name: 'Prendre la place A2' })).toBeNull();
    await user.click(screen.getByRole('button', { name: fr.desk.moveTitle }));
    expect(screen.getByRole('img', { name: 'Place A1, la tienne' })).toBeTruthy();
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
    expect((screen.getByRole('switch', { name: fr.desk.lockSwitch }) as HTMLButtonElement).disabled).toBe(true);
    expect(socket.sentOf('desk:do')).toEqual([]);
  });
});

// La carte de développement n'a pas de nom de place : la clé est le numéro de la zone.
test('la carte de développement : aucune erreur sans carte dans le magasin', () => {
  expect(parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } })).zones.length).toBeGreaterThan(0);
  setup({ desks: [owned('2', 'moi', 'Léa')], withMap: false, others: [player('bob', 'Bob')] });
  expect(screen.getByText(fr.desk.insideEmpty)).toBeTruthy();
});
