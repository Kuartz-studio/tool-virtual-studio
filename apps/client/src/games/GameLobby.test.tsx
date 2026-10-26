import { buildOfficeTiledMap, parseOfficeMap } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import { FakeSocket } from '../test/fake-socket';
import { BASTIEN, CLAIRE, SELF, applyWorld, chair, match, morpion, player, table, tictactoe } from './games-test-kit';
import { GameLobby, RematchBar } from './GameLobby';

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

  test('après une partie, la chaise garde « Se lever » (« Revanche » est dans la barre de la revanche), dit « veut la revanche » de qui l\'a acceptée, sans seconde phrase', () => {
    setup([chair(SELF), chair(BASTIEN, { ready: true })], { rematch: true });
    expect(screen.queryByRole('button', { name: fr.games.lobby.ready })).toBeNull();
    expect(screen.queryByRole('button', { name: fr.games.actions.rematch })).toBeNull();
    expect(screen.getByRole('button', { name: fr.games.lobby.stand })).toBeTruthy();
    const rows = screen.getAllByRole('listitem').filter((row) => row.classList.contains('game-chair'));
    expect(within(rows[1]!).getByText(fr.games.rematch.accepted)).toBeTruthy();
    expect(document.querySelector('.game-lobby-hint')).toBeNull();
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

describe('la barre de la revanche', () => {
  // Une partie finie à cette table (ces chaises), et sa barre de la revanche, vue par moi ; `body` : la barre est dans le corps d'un panneau, sous la phrase de fin.
  function rematchBar(chairs: Array<ReturnType<typeof chair> | null>, options: { body?: boolean } = {}) {
    const players = chairs.flatMap((seated) => (seated ? [seated.userId] : []));
    const view = table('connect4', 9, { chairs, match: match(players, morpion([0, 3]), { status: 'ended', turnMs: null }) });
    applyWorld([BASTIEN, CLAIRE], [view]);
    const bar = <RematchBar game="connect4" table={view} minPlayers={2} selfId={SELF} socket={socket.asSocket()} settled onMessage={vi.fn()} />;
    return render(
      options.body ? (
        <div className="drawer-body">
          <p className="game-status">Fin</p>
          {bar}
        </div>
      ) : (
        bar
      ),
    );
  }
  const rematchButton = () => screen.getByRole('button', { name: fr.games.actions.rematch });
  const line = () => document.querySelector('.game-rematch-line')?.textContent;

  test('personne ne l\'a acceptée : « Revanche », pas enfoncé, et la règle ; un clic la demande (`ready`)', async () => {
    rematchBar([chair(SELF), chair(BASTIEN)]);
    expect(rematchButton().getAttribute('aria-pressed')).toBe('false');
    expect(line()).toBe(fr.games.rematch.open);
    await userEvent.click(rematchButton());
    expect(sent()).toEqual([{ type: 'ready', game: 'connect4', ready: true }]);
  });

  test('Bastien l\'a demandée : la phrase le dit, et qu\'on n\'attend plus que moi', () => {
    rematchBar([chair(SELF), chair(BASTIEN, { ready: true })]);
    expect(line()).toBe(t(fr.games.rematch.askedBy, { names: 'Bastien' }));
    expect(rematchButton().getAttribute('aria-pressed')).toBe('false');
  });

  test('je l\'ai demandée : le bouton reste enfoncé, avec une coche et ce qu\'un second clic ferait ; la phrase dit qui on attend ; un clic l\'annule', async () => {
    rematchBar([chair(SELF, { ready: true }), chair(BASTIEN)]);
    const button = rematchButton();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('title')).toBe(fr.games.rematch.cancelTip);
    expect(button.querySelector('svg')).toBeTruthy();
    expect(line()).toBe(t(fr.games.rematch.asked, { names: 'Bastien' }));
    await userEvent.click(button);
    expect(sent()).toEqual([{ type: 'ready', game: 'connect4', ready: false }]);
  });

  test('un spectateur n\'a pas de barre : il n\'a pas de revanche à demander', () => {
    const { container } = rematchBar([chair(BASTIEN), chair(CLAIRE)]);
    expect(container.querySelector('.game-rematch')).toBeNull();
  });

  // Le corps du panneau et ce qu'il contient, aux places que donne `boxes` (par classe) : happy-dom ne met rien en page.
  function placeBoxes(boxes: Record<string, { top: number; bottom: number }>) {
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const found = Object.entries(boxes).find(([name]) => this.classList.contains(name));
      const { top, bottom } = found?.[1] ?? { top: 0, bottom: 0 };
      return { top, bottom, left: 0, right: 400, width: 400, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
  }

  test('sous le pli, le corps du panneau défile juste ce qu\'il faut pour la montrer (et sa marge de 12 px) ; au-dessus, pour la montrer avec la phrase de fin', async () => {
    const boxes = placeBoxes({ 'drawer-body': { top: 100, bottom: 700 }, 'game-status': { top: 760, bottom: 790 }, 'game-rematch': { top: 800, bottom: 880 } });
    const view = rematchBar([chair(SELF), chair(BASTIEN)], { body: true });
    const body = document.querySelector('.drawer-body') as HTMLElement;
    await vi.waitFor(() => expect(body.scrollTop).toBe(880 + 12 - 700));
    view.unmount();

    // Défilé trop loin : la barre est au-dessus, la phrase de fin aussi ; on remonte jusqu'à la phrase.
    boxes.mockRestore();
    placeBoxes({ 'drawer-body': { top: 100, bottom: 700 }, 'game-status': { top: 20, bottom: 50 }, 'game-rematch': { top: 60, bottom: 140 } });
    rematchBar([chair(SELF), chair(BASTIEN)], { body: true });
    const again = document.querySelector('.drawer-body') as HTMLElement;
    again.scrollTop = 500;
    await vi.waitFor(() => expect(again.scrollTop).toBe(500 + 20 - 12 - 100));
    vi.restoreAllMocks();
  });

  test('déjà visible, elle ne fait rien défiler', async () => {
    placeBoxes({ 'drawer-body': { top: 100, bottom: 700 }, 'game-status': { top: 300, bottom: 330 }, 'game-rematch': { top: 340, bottom: 420 } });
    rematchBar([chair(SELF), chair(BASTIEN)], { body: true });
    const body = document.querySelector('.drawer-body') as HTMLElement;
    const scrolled = vi.spyOn(body, 'scrollTo');
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrolled).not.toHaveBeenCalled();
    expect(body.scrollTop).toBe(0);
    vi.restoreAllMocks();
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
