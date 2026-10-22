import type { GameInvite, GameNotice } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { Toasts, useToasts } from '../office/Toasts';
import { BASTIEN, CLAIRE, applyWorld, player } from './games-test-kit';

// Les invitations à une table, dans la file de toasts : « Bastien t'invite aux échecs », « Accepter » et « Refuser », un compte à rebours de 60 s, les avis de réponse.

let socket: FakeSocket;
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  socket = new FakeSocket();
  socket.serverAccepts();
  useToasts.getState().clear();
  applyWorld([BASTIEN, CLAIRE], []);
});
afterEach(() => {
  vi.useRealTimers();
  useToasts.getState().clear();
});

const invite = (id: string, over: Partial<GameInvite> = {}): GameInvite => ({ id, game: 'chess', from: { id: BASTIEN, name: 'Bastien', avatarKey: null }, ttlMs: 60_000, ...over });
const receive = (given: GameInvite) => act(() => useOfficeStore.getState().addGameInvite(given));
const setup = () => render(<Toasts socket={socket.asSocket()} />);
const toast = () => screen.getByText(t(fr.games.invitation, { name: 'Bastien', game: fr.games.invitedTo.chess })).closest('.toast') as HTMLElement;
const answerWith = (ack: unknown) => act(() => socket.pendingAcks.at(-1)!.callback(null, ack));

describe('une invitation reçue', () => {
  test('un toast « Bastien t\'invite aux échecs », avec « Accepter » et « Refuser » nommés pour un lecteur d\'écran (P30)', () => {
    setup();
    receive(invite('i1'));
    const shown = toast();
    expect(within(shown).getByRole('button', { name: t(fr.games.acceptLabel, { name: 'Bastien' }) }).textContent).toBe(fr.games.accept);
    expect(within(shown).getByRole('button', { name: t(fr.games.declineLabel, { name: 'Bastien' }) }).textContent).toBe(fr.games.decline);
  });

  test('chaque jeu a son texte (aux échecs, au backgammon, au Puissance 4, aux petits chevaux)', () => {
    setup();
    receive(invite('i1', { game: 'backgammon' }));
    expect(screen.getByText(t(fr.games.invitation, { name: 'Bastien', game: 'au backgammon' }))).toBeTruthy();
  });

  test('« Accepter » répond au serveur (answer, accept: true), retire l\'invitation et ouvre le panneau de la table', async () => {
    setup();
    receive(invite('i1'));
    await userEvent.click(within(toast()).getByRole('button', { name: t(fr.games.acceptLabel, { name: 'Bastien' }) }));
    expect(socket.sent).toEqual([['game:do', { type: 'answer', invite: 'i1', accept: true }]]);
    expect(useOfficeStore.getState().gameInvites).toEqual([]);
    answerWith({ ok: true });
    await vi.waitFor(() => expect(useOfficeStore.getState().gameOpen).toBe('chess'));
  });

  test('« Accepter » refusé par le serveur (l\'invitation est tombée) : le panneau ne s\'ouvre pas, et on le dit', async () => {
    setup();
    receive(invite('i1'));
    await userEvent.click(within(toast()).getByRole('button', { name: t(fr.games.acceptLabel, { name: 'Bastien' }) }));
    answerWith({ ok: false, error: 'expired' });
    expect(await screen.findByText(fr.games.errors.expired)).toBeTruthy();
    expect(useOfficeStore.getState().gameOpen).toBeNull();
  });

  test('« Refuser » répond au serveur (accept: false) et retire le toast, sans ouvrir de panneau', async () => {
    setup();
    receive(invite('i1'));
    await userEvent.click(within(toast()).getByRole('button', { name: t(fr.games.declineLabel, { name: 'Bastien' }) }));
    expect(socket.sent).toEqual([['game:do', { type: 'answer', invite: 'i1', accept: false }]]);
    answerWith({ ok: true });
    await vi.waitFor(() => expect(screen.queryByText(t(fr.games.invitation, { name: 'Bastien', game: 'aux échecs' }))).toBeNull());
    expect(useOfficeStore.getState().gameOpen).toBeNull();
  });

  test('le toast reste ce qu\'il reste à vivre à l\'invitation (60 s), puis s\'éteint, et le magasin ne la garde plus', () => {
    setup();
    receive(invite('i1'));
    act(() => void vi.advanceTimersByTime(59_000));
    expect(toast()).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1_500));
    expect(screen.queryByText(t(fr.games.invitation, { name: 'Bastien', game: 'aux échecs' }))).toBeNull();
    expect(useOfficeStore.getState().gameInvites).toEqual([]);
  });

  test('une autre invitation qui arrive ne rend pas de temps à la première : son échéance est absolue', () => {
    setup();
    receive(invite('i1'));
    act(() => void vi.advanceTimersByTime(40_000));
    receive(invite('i2', { from: { id: CLAIRE, name: 'Claire', avatarKey: null }, game: 'ludo' }));
    act(() => void vi.advanceTimersByTime(21_000));
    expect(screen.queryByText(t(fr.games.invitation, { name: 'Bastien', game: 'aux échecs' }))).toBeNull();
    expect(screen.getByText(t(fr.games.invitation, { name: 'Claire', game: 'aux petits chevaux' }))).toBeTruthy();
    expect(useOfficeStore.getState().gameInvites.map((entry) => entry.id)).toEqual(['i2']);
  });

  test('une invitation restée de l\'init, avec ce qu\'il lui reste (25 s), part au bout de ce temps', () => {
    setup();
    act(() => {
      useOfficeStore.getState().applyInit({
        self: player('moi'),
        players: [player(BASTIEN)],
        mapKey: 'office',
        chatHistory: [],
        desks: [],
        closedDesks: [],
        deskBans: [],
        gameInvites: [invite('i1', { ttlMs: 25_000 })],
      });
    });
    expect(toast()).toBeTruthy();
    act(() => void vi.advanceTimersByTime(26_000));
    expect(screen.queryByText(t(fr.games.invitation, { name: 'Bastien', game: 'aux échecs' }))).toBeNull();
  });

  test('le serveur retire l\'invitation (l\'invitante s\'est levée) : le toast part', () => {
    setup();
    receive(invite('i1'));
    expect(toast()).toBeTruthy();
    act(() => useOfficeStore.getState().removeGameInvite('i1'));
    expect(screen.queryByText(t(fr.games.invitation, { name: 'Bastien', game: 'aux échecs' }))).toBeNull();
  });

  test('la même invitation redite ne double pas le toast', () => {
    setup();
    receive(invite('i1'));
    receive(invite('i1'));
    expect(screen.getAllByText(t(fr.games.invitation, { name: 'Bastien', game: 'aux échecs' }))).toHaveLength(1);
  });
});

describe('les avis de réponse à ses propres invitations', () => {
  const notice = (kind: GameNotice['kind']): GameNotice => ({ kind, game: 'connect4', user: { id: BASTIEN, name: 'Bastien' } });

  test.each([
    ['accepted', 'Bastien a rejoint la table de Puissance 4.'],
    ['declined', 'Bastien a refusé ton invitation.'],
    ['expired', 'Bastien n\'a pas répondu à ton invitation.'],
    ['gone', 'Bastien a quitté le bureau.'],
  ] as const)('« %s » : un toast court', (kind, text) => {
    setup();
    act(() => EventBus.emit('game:notice', notice(kind)));
    expect(screen.getByText(text)).toBeTruthy();
  });

  test('l\'avis d\'une même personne remplace le précédent au lieu de s\'empiler', () => {
    setup();
    act(() => EventBus.emit('game:notice', notice('expired')));
    act(() => EventBus.emit('game:notice', notice('accepted')));
    expect(screen.queryByText('Bastien n\'a pas répondu à ton invitation.')).toBeNull();
    expect(screen.getByText('Bastien a rejoint la table de Puissance 4.')).toBeTruthy();
  });
});
