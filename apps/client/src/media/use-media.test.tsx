import type { InitPayload, MediaJoinPayload } from '@bureau/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { mediaDebug } from '../game/debug';
import { EventBus } from '../game/EventBus';
import type { OfficeSocket } from '../net/socket';
import { FakeSocket } from '../test/fake-socket';
import { FakeMediaClient } from './fake-media-client';
import type { MediaPrefs } from './media-client';
import { useMedia } from './use-media';

const payload = (room: string, token = `jeton-${room}`): MediaJoinPayload => ({ url: 'wss://livekit.test', room, token });

const INIT: InitPayload = {
  self: {
    id: 'moi',
    name: 'Moi',
    avatarKey: null,
    x: 80,
    y: 240,
    dir: 'down',
    moving: false,
    status: 'available',
    media: { mic: false, cam: false, screen: false },
  },
  players: [],
  mapKey: 'dev-office',
  chatHistory: [],
};

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  mediaDebug.room = null;
});

// La socket connectée (poignée de main faite), le faux client et le hook qui les relie.
function setup(prefs?: MediaPrefs) {
  const socket = new FakeSocket();
  socket.serverAccepts();
  const client = new FakeMediaClient(prefs);
  const hook = renderHook(() => useMedia(client, socket.asSocket()));
  return { socket, client, hook };
}

// Attend que le client ait fini ce qu'on lui a demandé : ses opérations passent l'une après l'autre, et le hook ne les attend pas.
async function settle(client: FakeMediaClient): Promise<void> {
  await act(() => client.idle());
}

// Le serveur envoie une consigne, et le client la suit jusqu'au bout.
async function serverSays(socket: FakeSocket, client: FakeMediaClient, room: string | null): Promise<void> {
  act(() => {
    if (room === null) socket.receive('media:leave');
    else socket.receive('media:join', payload(room));
  });
  await settle(client);
}

// Ce que le bus du jeu reçoit en `media:speaking`, dans l'ordre.
function speakingOnBus(): string[][] {
  const calls: string[][] = [];
  const listener = (ids: string[]) => calls.push(ids);
  EventBus.on('media:speaking', listener);
  cleanups.push(() => EventBus.off('media:speaking', listener));
  return calls;
}

describe('les consignes du serveur', () => {
  test('media:join → client.join(payload)', async () => {
    const { socket, client, hook } = setup();
    const join = vi.spyOn(client, 'join');
    act(() => socket.receive('media:join', payload('r1')));
    expect(join).toHaveBeenCalledExactlyOnceWith(payload('r1'));
    await settle(client);
    expect(client.journal).toEqual(['join:r1']);
    expect(hook.result.current.room).toBe('r1');
  });

  test('deuxième media:join → leave puis join, dans cet ordre', async () => {
    const { socket, client, hook } = setup();
    await serverSays(socket, client, 'r1');
    await serverSays(socket, client, 'r2');
    expect(client.journal).toEqual(['join:r1', 'leave', 'join:r2']);
    expect(hook.result.current.room).toBe('r2');
  });

  test('deuxième media:join pendant que la première room se connecte : toujours leave puis join, sans se croiser', async () => {
    const { socket, client, hook } = setup();
    const release = client.holdConnections();
    act(() => socket.receive('media:join', payload('r1')));
    act(() => socket.receive('media:join', payload('r2')));
    release();
    await settle(client);
    expect(client.journal).toEqual(['join:r1', 'leave', 'join:r2']);
    expect(hook.result.current.room).toBe('r2');
  });

  test('media:leave → client.leave()', async () => {
    const { socket, client, hook } = setup();
    await serverSays(socket, client, 'r1');
    const leave = vi.spyOn(client, 'leave');
    act(() => socket.receive('media:leave'));
    expect(leave).toHaveBeenCalledOnce();
    await settle(client);
    expect(client.journal).toEqual(['join:r1', 'leave']);
    expect(hook.result.current.room).toBeNull();
  });

  test('media:join pour la room où l\'on est déjà (la socket revenue après une coupure, jeton neuf) : rien ne change', async () => {
    const { socket, client, hook } = setup();
    await serverSays(socket, client, 'r1');
    act(() => socket.receive('media:join', payload('r1', 'jeton-neuf')));
    await settle(client);
    expect(client.journal).toEqual(['join:r1']);
    expect(hook.result.current.room).toBe('r1');
  });

  test('media:join pour la room que l\'on est en train de rejoindre : une seule connexion', async () => {
    const { socket, client } = setup();
    const release = client.holdConnections();
    act(() => socket.receive('media:join', payload('r1')));
    act(() => socket.receive('media:join', payload('r1', 'jeton-neuf')));
    release();
    await settle(client);
    expect(client.journal).toEqual(['join:r1']);
  });

  test('media:leave hors de toute room : rien', async () => {
    const { socket, client } = setup();
    await serverSays(socket, client, null);
    expect(client.journal).toEqual([]);
  });

  test('session:replaced (un autre onglet a pris la place) : la room est quittée, micro et caméra s\'arrêtent ici', async () => {
    const { socket, client, hook } = setup();
    await serverSays(socket, client, 'r1');
    act(() => socket.receive('session:replaced'));
    await settle(client);
    expect(client.journal).toEqual(['join:r1', 'leave']);
    expect(hook.result.current.room).toBeNull();
  });
});

describe('l\'état local, envoyé au serveur (media:state)', () => {
  test('couper le micro envoie media:state { mic: false, cam: true, screen: false }', async () => {
    const { socket, client } = setup();
    act(() => void client.setMic(false));
    await settle(client);
    expect(socket.sentOf('media:state').at(-1)).toEqual({ mic: false, cam: true, screen: false });
  });

  test('à l\'ouverture, puis à chaque changement de l\'état local ; jamais deux fois le même de suite', async () => {
    const { socket, client } = setup();
    expect(socket.sentOf('media:state')).toEqual([{ mic: true, cam: true, screen: false }]);

    act(() => void client.setMic(false));
    await settle(client);
    act(() => void client.setMic(false));
    await settle(client);
    // Entrer dans une room, d'autres qui arrivent : l'état local ne change pas, rien ne part.
    await serverSays(socket, client, 'r1');
    act(() => client.addRemote({ id: 'ana', name: 'Ana' }));
    act(() => void client.setCam(false));
    await settle(client);
    act(() => void client.setScreenShare(true));
    await settle(client);

    expect(socket.sentOf('media:state')).toEqual([
      { mic: true, cam: true, screen: false },
      { mic: false, cam: true, screen: false },
      { mic: false, cam: false, screen: false },
      { mic: false, cam: false, screen: true },
    ]);
  });

  test('pendant une coupure, rien ne part ; à l\'init du retour, l\'état du moment (le serveur a pu l\'oublier), même inchangé', async () => {
    const { socket, client } = setup();
    act(() => socket.connectionDrops());
    act(() => void client.setMic(false));
    await settle(client);
    expect(socket.sentOf('media:state')).toHaveLength(1);

    // Reconnectée, mais pas encore d'init : le serveur ne nous a pas encore placés, il ignorerait l'état.
    act(() => socket.serverAccepts());
    expect(socket.sentOf('media:state')).toHaveLength(1);
    act(() => socket.receive('init', INIT));
    expect(socket.sentOf('media:state')).toEqual([
      { mic: true, cam: true, screen: false },
      { mic: false, cam: true, screen: false },
    ]);

    // Un autre init (« Utiliser ici », ou une arrivée après le délai de grâce, qui remet l'état du serveur à zéro) : renvoyé.
    act(() => socket.receive('init', INIT));
    expect(socket.sentOf('media:state')).toHaveLength(3);
    expect(socket.sentOf('media:state').at(-1)).toEqual({ mic: false, cam: true, screen: false });
  });

  test('une socket pas encore connectée au montage : rien avant son init', () => {
    const socket = new FakeSocket();
    const client = new FakeMediaClient({ mic: false, cam: true });
    renderHook(() => useMedia(client, socket.asSocket()));
    expect(socket.sentOf('media:state')).toEqual([]);
    act(() => socket.serverAccepts());
    act(() => socket.receive('init', INIT));
    expect(socket.sentOf('media:state')).toEqual([{ mic: false, cam: true, screen: false }]);
  });
});

describe('ce que le hook rend et annonce', () => {
  test('rend l\'état du client, à jour à chaque changement', async () => {
    const { socket, client, hook } = setup({ mic: true, cam: false });
    expect(hook.result.current).toEqual({ room: null, participants: [], local: { mic: true, cam: false, screen: false }, error: null });

    await serverSays(socket, client, 'r1');
    act(() => client.addRemote({ id: 'ana', name: 'Ana', cam: true }));
    expect(hook.result.current.participants).toEqual([
      { id: 'moi', name: 'Moi', isLocal: true, mic: true, cam: false, screen: false, speaking: false },
      { id: 'ana', name: 'Ana', isLocal: false, mic: false, cam: true, screen: false, speaking: false },
    ]);
  });

  test('qui parle, sur le bus du jeu (media:speaking) : à chaque changement seulement, puis personne en quittant la room', async () => {
    const speaking = speakingOnBus();
    const { socket, client } = setup();
    await serverSays(socket, client, 'r1');
    act(() => {
      client.addRemote({ id: 'ana', name: 'Ana' });
      client.addRemote({ id: 'bob', name: 'Bob' });
    });
    act(() => client.setSpeaking('ana'));
    act(() => client.setSpeaking('ana'));
    act(() => client.setSpeaking('ana', 'moi'));
    // Un autre changement, sans rien changer à qui parle : rien de plus.
    act(() => client.updateRemote('bob', { mic: true }));
    act(() => client.setSpeaking());
    act(() => client.setSpeaking('bob'));
    await serverSays(socket, client, null);

    expect(speaking).toEqual([['ana'], ['moi', 'ana'], [], ['bob'], []]);
  });

  test('la room que lisent les tests de bout en bout (window.__office.media.room) suit celle du client', async () => {
    const { socket, client, hook } = setup();
    expect(mediaDebug.room).toBeNull();
    await serverSays(socket, client, 'r1');
    expect(mediaDebug.room).toBe('r1');
    await serverSays(socket, client, null);
    expect(mediaDebug.room).toBeNull();
    await serverSays(socket, client, 'r2');
    expect(mediaDebug.room).toBe('r2');
    hook.unmount();
    expect(mediaDebug.room).toBeNull();
  });
});

describe('le cycle de vie', () => {
  test('démonté : plus aucun écouteur, la room est quittée, et plus personne ne parle', async () => {
    const speaking = speakingOnBus();
    const { socket, client, hook } = setup();
    await serverSays(socket, client, 'r1');
    act(() => client.setSpeaking('moi'));
    const sent = socket.sentOf('media:state').length;

    hook.unmount();
    await settle(client);
    expect(socket.listenerCount()).toBe(0);
    expect(client.journal).toEqual(['join:r1', 'leave']);
    expect(speaking).toEqual([['moi'], []]);

    // Plus rien n'est suivi : ni les consignes, ni l'état local.
    act(() => socket.receive('media:join', payload('r2')));
    act(() => void client.setMic(false));
    await settle(client);
    expect(client.journal).toEqual(['join:r1', 'leave']);
    expect(socket.sentOf('media:state')).toHaveLength(sent);
  });

  test('sans socket : rien n\'est écouté ni envoyé ; la socket arrivée, tout se branche', async () => {
    const client = new FakeMediaClient();
    const socket = new FakeSocket();
    socket.serverAccepts();
    const { result, rerender } = renderHook(({ s }) => useMedia(client, s), {
      initialProps: { s: null as OfficeSocket | null },
    });
    expect(result.current.room).toBeNull();

    rerender({ s: socket.asSocket() });
    expect(socket.sentOf('media:state')).toEqual([{ mic: true, cam: true, screen: false }]);
    await serverSays(socket, client, 'r1');
    expect(client.journal).toEqual(['join:r1']);
  });

  test('une autre socket : l\'ancienne n\'est plus écoutée, et la room n\'est pas quittée (la nouvelle redira la même après son init)', async () => {
    const client = new FakeMediaClient();
    const first = new FakeSocket();
    const second = new FakeSocket();
    first.serverAccepts();
    second.serverAccepts();
    const { rerender } = renderHook(({ s }) => useMedia(client, s.asSocket()), { initialProps: { s: first } });
    await serverSays(first, client, 'r1');

    rerender({ s: second });
    expect(first.listenerCount()).toBe(0);
    await serverSays(second, client, 'r1');
    expect(client.journal).toEqual(['join:r1']);
  });
});
