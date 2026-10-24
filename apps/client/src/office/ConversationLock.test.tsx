import type { ConversationAck, ConversationLock, PublicPlayer } from '@bureau/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { ConversationLockBar } from './ConversationLock';
import { useToasts } from './Toasts';

const player = (id: string, name: string): PublicPlayer => ({
  id,
  name,
  avatarKey: null,
  x: 80,
  y: 240,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
});

const lockBy = (id: string, name: string): ConversationLock => ({ id: 'g1', members: ['bob', 'moi'], by: { id, name }, at: 1 });

function setup() {
  const socket = new FakeSocket();
  socket.serverAccepts();
  act(() =>
    useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [player('bob', 'Bob')], mapKey: 'dev-office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }),
  );
  render(<ConversationLockBar socket={socket.asSocket()} />);
  return socket;
}

const ack = (socket: FakeSocket, response: ConversationAck = { ok: true }) => act(async () => socket.serverAcks('conversation:do', response));
const toggle = () => screen.getAllByRole('button')[0]!;

beforeEach(() => {
  useOfficeStore.getState().reset();
  useToasts.getState().clear();
});

describe('le verrou de la conversation', () => {
  test('pas verrouillée : « Verrouiller », une bascule relâchée ; le clic le demande au serveur, et rien ne change avant son annonce', async () => {
    const socket = setup();
    const button = screen.getByRole('button', { name: fr.media.lock.lock });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('title')).toBe(fr.media.lock.lockHint);
    expect(screen.queryByRole('button', { name: fr.media.lock.leave })).toBeNull();
    await userEvent.click(button);
    expect(socket.sentOf('conversation:do')).toEqual([{ type: 'lock' }]);
    expect((button as HTMLButtonElement).disabled).toBe(true);   // en attendant la réponse
    await ack(socket);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');   // le serveur ne l'a pas encore annoncée
    act(() => useOfficeStore.getState().setConversationLock(lockBy('moi', 'Léa')));
    expect(screen.getByRole('button', { name: fr.media.lock.lockedBySelf }).getAttribute('aria-pressed')).toBe('true');
  });

  test('verrouillée par un autre : son nom ; un clic la déverrouille (pour tous), « Quitter » en sort seul', async () => {
    const socket = setup();
    act(() => useOfficeStore.getState().setConversationLock(lockBy('bob', 'Bob')));
    const button = screen.getByRole('button', { name: t(fr.media.lock.lockedBy, { name: 'Bob' }) });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('title')).toBe(fr.media.lock.unlockLabel);
    expect(button.getAttribute('data-sfx')).toBe('none');   // le bruit du verrou vient de l'annonce du serveur
    await userEvent.click(button);
    await ack(socket);
    await userEvent.click(screen.getByRole('button', { name: fr.media.lock.leave }));
    await ack(socket);
    expect(socket.sentOf('conversation:do')).toEqual([{ type: 'unlock' }, { type: 'leave' }]);
  });

  test('une commande refusée, ou sans réponse : un message passager qui dit pourquoi', async () => {
    const socket = setup();
    await userEvent.click(toggle());
    await ack(socket, { ok: false, error: 'no_group' });
    expect(useToasts.getState().items.map((item) => item.text)).toEqual([fr.media.lock.errors.no_group]);
    await userEvent.click(toggle());
    await act(async () => socket.ackTimesOut('conversation:do'));
    expect(useToasts.getState().items.map((item) => item.text)).toEqual([fr.media.lock.errors.unavailable]);
  });

  test('sans connexion : rien ne part, et le message le dit', async () => {
    useOfficeStore.getState().reset();
    render(<ConversationLockBar socket={null} />);
    await userEvent.click(screen.getByRole('button', { name: fr.media.lock.lock }));
    expect(useToasts.getState().items.map((item) => item.text)).toEqual([fr.media.lock.errors.unavailable]);
  });
});
