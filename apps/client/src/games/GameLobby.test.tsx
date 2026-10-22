import { buildOfficeTiledMap, parseOfficeMap } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import { FakeSocket } from '../test/fake-socket';
import { BASTIEN, CLAIRE, SELF, applyWorld, chair, player, table, tictactoe } from './games-test-kit';
import { GameLobby } from './GameLobby';

let socket: FakeSocket;
beforeEach(() => {
  socket = new FakeSocket();
  socket.serverAccepts();
});

function setup(chairs: Array<ReturnType<typeof chair> | null>, options: { rematch?: boolean; others?: string[] } = {}) {
  const view = table('connect4', 3, { chairs });
  applyWorld(options.others ?? [BASTIEN, CLAIRE], [view]);
  const onMessage = vi.fn();
  render(<GameLobby game="connect4" table={view} def={tictactoe as never} selfId={SELF} socket={socket.asSocket()} rematch={options.rematch ?? false} onMessage={onMessage} />);
  return { onMessage };
}

// Le premier bouton « S'asseoir à la chaise n ».
const sitButton = () => screen.getAllByRole('button', { name: /^S'asseoir/ })[0]!;

// La réponse que le serveur donne à la dernière commande envoyée.
const serverAnswers = (ack: unknown) => act(() => socket.pendingAcks.at(-1)!.callback(null, ack));
const sent = () => socket.sent.map(([, payload]) => payload);

describe('les chaises', () => {
  test('chaque chaise : qui y est assis, s\'il est prêt, ou « Libre » avec son bouton « S\'asseoir »', async () => {
    setup([chair(BASTIEN, { ready: true }), null]);
    const rows = screen.getAllByRole('listitem').filter((row) => row.classList.contains('game-chair'));
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Bastien')).toBeTruthy();
    expect(within(rows[0]!).getByText('prêt')).toBeTruthy();
    expect(within(rows[1]!).getByText(fr.games.lobby.free)).toBeTruthy();
    // La chaise libre propose de s'y asseoir, et dit laquelle ; celle de Bastien n'a pas de bouton.
    expect(within(rows[0]!).queryByRole('button')).toBeNull();
    await userEvent.click(within(rows[1]!).getByRole('button', { name: t(fr.games.lobby.sitAt, { n: 2 }) }));
    expect(sent()).toEqual([{ type: 'sit', game: 'connect4', chair: 1 }]);
  });

  test('un déconnecté est dit déconnecté, et pas prêt', () => {
    setup([chair(BASTIEN, { connected: false }), null]);
    expect(screen.getByText(fr.games.lobby.disconnected)).toBeTruthy();
  });

  test('assis à une chaise, on n\'a plus de bouton « S\'asseoir » : celle des autres est vue, la sienne a « Prêt » et « Se lever »', () => {
    setup([chair(SELF), null]);
    expect(screen.queryByRole('button', { name: new RegExp(`^${fr.games.lobby.sit}`) })).toBeNull();
    const mine = screen.getAllByRole('listitem')[0]!;
    expect(within(mine).getByText(`(${fr.games.you})`)).toBeTruthy();
    expect(within(mine).getByRole('button', { name: fr.games.lobby.ready })).toBeTruthy();
    expect(within(mine).getByRole('button', { name: fr.games.lobby.stand })).toBeTruthy();
  });
});

describe('« Prêt », « Revanche » et « Se lever »', () => {
  test('« Prêt » est un bouton à bascule : il envoie l\'état contraire de celui qu\'on voit', async () => {
    setup([chair(SELF), chair(BASTIEN)]);
    const button = screen.getByRole('button', { name: fr.games.lobby.ready });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(button);
    expect(sent()).toEqual([{ type: 'ready', game: 'connect4', ready: true }]);
  });

  test('prêt, le bouton est enfoncé et renvoie « pas prêt »', async () => {
    setup([chair(SELF, { ready: true }), chair(BASTIEN)]);
    const button = screen.getByRole('button', { name: fr.games.lobby.ready });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(button);
    expect(sent()).toEqual([{ type: 'ready', game: 'connect4', ready: false }]);
  });

  test('après une partie, « Prêt » s\'appelle « Revanche »', () => {
    setup([chair(SELF), chair(BASTIEN)], { rematch: true });
    expect(screen.getByRole('button', { name: fr.games.actions.rematch })).toBeTruthy();
    expect(screen.queryByRole('button', { name: fr.games.lobby.ready })).toBeNull();
  });

  test('« Se lever » envoie `stand`', async () => {
    setup([chair(SELF), null]);
    await userEvent.click(screen.getByRole('button', { name: fr.games.lobby.stand }));
    expect(sent()).toEqual([{ type: 'stand', game: 'connect4' }]);
  });

  test('un refus du serveur est dit (onMessage), un succès efface le message, et « stale » se tait', async () => {
    const { onMessage } = setup([null, null]);
    await userEvent.click(sitButton());
    serverAnswers({ ok: false, error: 'too_far' });
    await vi.waitFor(() => expect(onMessage).toHaveBeenLastCalledWith(fr.games.errors.too_far));
    await userEvent.click(sitButton());
    serverAnswers({ ok: false, error: 'stale' });
    await userEvent.click(sitButton());
    serverAnswers({ ok: true });
    await vi.waitFor(() => expect(onMessage).toHaveBeenLastCalledWith(null));
    expect(onMessage).not.toHaveBeenCalledWith(fr.games.errors.stale);
  });
});

describe('la phrase d\'aide', () => {
  test('pas assis : s\'asseoir ou regarder', () => {
    setup([chair(BASTIEN), null]);
    expect(screen.getByText(fr.games.lobby.sitHint)).toBeTruthy();
  });

  test('assis seul : il faut des joueurs en plus', () => {
    setup([chair(SELF), null]);
    expect(screen.getByText(t(fr.games.lobby.needMore, { count: 2 }))).toBeTruthy();
  });

  test('assis à deux, l\'un pas prêt : on attend lui', () => {
    setup([chair(SELF, { ready: true }), chair(BASTIEN)]);
    expect(screen.getByText(t(fr.games.lobby.waitingFor, { names: 'Bastien' }))).toBeTruthy();
  });

  test('tout le monde prêt : la partie commence', () => {
    setup([chair(SELF, { ready: true }), chair(BASTIEN, { ready: true })]);
    expect(screen.getByText(fr.games.lobby.allReady)).toBeTruthy();
  });
});

describe('inviter quelqu\'un', () => {
  test('pas assis : pas de bouton « Inviter »', () => {
    setup([chair(BASTIEN), null]);
    expect(screen.queryByRole('button', { name: fr.games.invite.toggle })).toBeNull();
  });

  test('assis : la liste des personnes en ligne qui ne sont pas à la table, chacune avec son bouton (P30)', async () => {
    setup([chair(SELF), chair(BASTIEN)], { others: [BASTIEN, CLAIRE, 'dan'] });
    const toggle = screen.getByRole('button', { name: fr.games.invite.toggle });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // Bastien est déjà assis : il n'est pas proposé.
    expect(screen.queryByRole('button', { name: t(fr.games.invite.sendLabel, { name: 'Bastien' }) })).toBeNull();
    expect(screen.getByRole('button', { name: t(fr.games.invite.sendLabel, { name: 'Claire' }) })).toBeTruthy();
    expect(screen.getByRole('button', { name: t(fr.games.invite.sendLabel, { name: 'Dan' }) })).toBeTruthy();
  });

  test('inviter envoie `invite`, et le dit ; refusée, la raison est montrée', async () => {
    const { onMessage } = setup([chair(SELF), null], { others: [CLAIRE] });
    await userEvent.click(screen.getByRole('button', { name: fr.games.invite.toggle }));
    await userEvent.click(screen.getByRole('button', { name: t(fr.games.invite.sendLabel, { name: 'Claire' }) }));
    expect(sent()).toEqual([{ type: 'invite', game: 'connect4', userId: CLAIRE }]);
    serverAnswers({ ok: true });
    expect(await screen.findByText(t(fr.games.invite.sent, { name: 'Claire' }))).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: t(fr.games.invite.sendLabel, { name: 'Claire' }) }));
    serverAnswers({ ok: false, error: 'busy' });
    await vi.waitFor(() => expect(onMessage).toHaveBeenLastCalledWith(fr.games.errors.busy));
  });

  test('qui ne veut pas être dérangé n\'a pas de bouton actif : « Ne pas déranger », un mode qui ferme la porte ou qui conduit ailleurs', async () => {
    const view = table('connect4', 3, { chairs: [chair(SELF), null] });
    applyWorld([], [view]);
    const { useOfficeStore } = await import('../state/office-store');
    act(() => {
      useOfficeStore.getState().upsertPlayer(player('dan', { status: 'dnd' }));
      useOfficeStore.getState().upsertPlayer(player('eve', { activity: { id: 'a', label: 'Concentration', color: '#6d28d9', allowEntry: false, hear: true, heard: true } }));
      useOfficeStore.getState().upsertPlayer(player('fay', { activity: { id: 'b', label: 'Sport', color: '#f97316', allowEntry: true, hear: false, heard: false, place: 'gym' } }));
      useOfficeStore.getState().upsertPlayer(player('gus', { status: 'busy' }));
    });
    render(<GameLobby game="connect4" table={view} def={tictactoe as never} selfId={SELF} socket={socket.asSocket()} rematch={false} onMessage={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: fr.games.invite.toggle }));
    for (const name of ['Dan', 'Eve', 'Fay']) expect((screen.getByRole('button', { name: t(fr.games.invite.sendLabel, { name }) }) as HTMLButtonElement).disabled, name).toBe(true);
    expect((screen.getByRole('button', { name: t(fr.games.invite.sendLabel, { name: 'Gus' }) }) as HTMLButtonElement).disabled).toBe(false);
  });

  test('un mode dont l\'emplacement est la salle de la table (la salle de jeu) laisse inviter ; celui d\'une autre salle, non', async () => {
    const view = table('connect4', 3, { chairs: [chair(SELF), null] });
    applyWorld([], [view]);
    const { useOfficeStore } = await import('../state/office-store');
    act(() => {
      useOfficeStore.getState().setOfficeMap(parseOfficeMap(buildOfficeTiledMap()));
      useOfficeStore.getState().upsertPlayer(player('hal', { activity: { id: 'a', label: 'Jeux', color: '#22c55e', allowEntry: true, hear: true, heard: true, place: 'game' } }));
      useOfficeStore.getState().upsertPlayer(player('ida', { activity: { id: 'b', label: 'Muscu', color: '#f97316', allowEntry: true, hear: true, heard: true, place: 'gym' } }));
    });
    render(<GameLobby game="connect4" table={view} def={tictactoe as never} selfId={SELF} socket={socket.asSocket()} rematch={false} onMessage={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: fr.games.invite.toggle }));
    expect((screen.getByRole('button', { name: t(fr.games.invite.sendLabel, { name: 'Hal' }) }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: t(fr.games.invite.sendLabel, { name: 'Ida' }) }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('personne d\'autre en ligne : on le dit', async () => {
    setup([chair(SELF), null], { others: [] });
    await userEvent.click(screen.getByRole('button', { name: fr.games.invite.toggle }));
    expect(screen.getByText(fr.games.invite.nobody)).toBeTruthy();
  });
});
