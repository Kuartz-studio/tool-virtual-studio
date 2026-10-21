import type { ChatMessage, InitPayload, PublicPlayer } from '@bureau/shared';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EventBus } from '../game/EventBus';
import { fr } from '../i18n/fr';
import type { FakeMediaClient } from '../media/fake-media-client';
import type { MediaPrefs } from '../media/media-client';
import { savePrefs } from '../media/prefs';
import { routes } from '../router';
import { useOfficeStore } from '../state/office-store';
import { fakeApi, json } from '../test/fake-api';
import { fakeAuth, resetFakeAuth, setFakeSession, type FakeUser } from '../test/fake-auth-client';
import { FakeMediaDevices, installMediaDevices } from '../test/fake-media-devices';
import type { FakeSocket } from '../test/fake-socket';
import { findOfficeFor } from '../test/office';
import { renderRoute } from '../test/render';

vi.mock('../lib/auth-client', () => import('../test/fake-auth-client'));
// Le vrai jeu a besoin d'un vrai canevas (voir test/setup.ts) : ici, un composant qui dit quelle carte on lui donne.
vi.mock('../game/PhaserGame', () => ({
  PhaserGame: ({ mapKey }: { mapKey: string }) => <div data-testid="jeu" data-map-key={mapKey} />,
}));
// La connexion au serveur : une fausse socket par page ouverte, que le test fait parler à la place du serveur.
const sockets = vi.hoisted(() => [] as FakeSocket[]);
vi.mock('../net/socket', async () => {
  const { FakeSocket } = await import('../test/fake-socket');
  return {
    createOfficeSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  };
});

// L'audio et la vidéo : un faux client média à chaque entrée dans le bureau (le vrai chargerait LiveKit). startAudio est espionné.
const mediaClients = vi.hoisted(() => [] as FakeMediaClient[]);
vi.mock('../media/create-media-client', async () => {
  const { FakeMediaClient } = await import('../media/fake-media-client');
  return {
    createMediaClient: (prefs: MediaPrefs) => {
      const client = new FakeMediaClient(prefs, { id: 'u-lea', name: 'Léa' });
      vi.spyOn(client, 'startAudio');
      mediaClients.push(client);
      return client;
    },
  };
});

const LEA = { id: 'u-lea', name: 'Léa', email: 'lea@x.fr' };
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
const init = (mapKey = 'dev-office'): InitPayload => ({ self: player('u-lea', 'Léa'), players: [player('u-bob', 'Bob')], mapKey, chatHistory: [], desks: [], closedDesks: [], deskBans: [] });
const socket = (): FakeSocket => {
  const last = sockets.at(-1);
  if (!last) throw new Error('La page n\'a pas ouvert de connexion.');
  return last;
};

// L'écran d'entrée demande le micro et la caméra : un faux navigator.mediaDevices qui les accorde.
let uninstallDevices: () => void;
beforeEach(() => {
  resetFakeAuth();
  sockets.length = 0;
  mediaClients.length = 0;
  localStorage.clear();
  useOfficeStore.getState().reset();
  uninstallDevices = installMediaDevices(new FakeMediaDevices());
});
afterEach(() => {
  uninstallDevices();
});

// Ouvre la page : l'écran d'entrée, et derrière lui la connexion préparée (ses écouteurs posés), pas encore ouverte. L'écran ne suffit
// pas : la page ne prépare la connexion que dans un effet, que React passe après avoir affiché la page, dans une autre tâche ; sur une
// machine chargée, l'écran est trouvé avant (c'était l'instabilité de ce fichier : `sockets` encore vide, « La page n'a pas ouvert de
// connexion »).
async function openPage(account: FakeUser = LEA) {
  setFakeSession(account);
  const router = renderRoute('/');
  await screen.findByRole('heading', { level: 1, name: fr.media.check.title });
  await waitFor(() => expect(sockets.at(-1)?.listenerCount()).toBeGreaterThan(0));
  return router;
}

// « Entrer » : le bureau s'affiche.
async function enter() {
  await userEvent.click(screen.getByRole('button', { name: fr.media.check.enter }));
  await findOfficeFor('Léa');
}

// « Se déconnecter » est une ligne du menu de la puce « Moi », et Admin une ligne du menu « Plus », dans la barre.
const meChip = () => screen.getByRole('button', { name: fr.me.chip });
async function chooseInMeMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(meChip());
  await user.click(screen.getByRole('menuitem', { name }));
}
const moreButton = () => screen.getByRole('button', { name: fr.office.more.toggle });

// La page ouverte, et le bureau, après « Entrer ».
async function openOffice(account?: FakeUser) {
  const router = await openPage(account);
  await enter();
  return router;
}

const payload = (token = 'jeton') => ({ url: 'wss://livekit.test', room: 'r1', token });

// La connexion ne s'ouvre qu'à « Entrer » : ouverte dès l'écran d'entrée, elle plaçait au bureau quelqu'un qui n'y est pas entré (vu
// « Disponible », pris dans un groupe, des collègues seuls dans une room LiveKit), et un deuxième onglet laissé sur l'écran d'entrée
// coupait le premier (`session:replaced`) en pleine conversation.
test('l\'écran d\'entrée d\'abord : la connexion est préparée mais pas ouverte, ni barre, ni jeu, ni audio ; « Entrer » l\'ouvre', async () => {
  await openPage();
  expect(socket().connectCalls).toBe(0);
  expect(socket().active).toBe(false);
  expect(screen.queryByRole('group', { name: fr.office.barLabel })).toBeNull();
  expect(screen.queryByTestId('jeu')).toBeNull();
  expect(mediaClients).toHaveLength(0);
  // Rien ne l'ouvre plus tard non plus : la personne peut rester sur cet écran.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(socket().connectCalls).toBe(0);

  await enter();
  expect(socket().connectCalls).toBe(1);
  expect(screen.queryByRole('heading', { level: 1, name: fr.media.check.title })).toBeNull();
  expect(mediaClients).toHaveLength(1);
  // Le jeu attend la carte, que dit l'init.
  expect(screen.queryByTestId('jeu')).toBeNull();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
  });
  expect(await screen.findByTestId('jeu')).toBeTruthy();
});

test('« Entrer » : le client média reçoit les préférences de l\'écran d\'entrée, et le son est lancé dans le clic même (startAudio)', async () => {
  savePrefs({ mic: false, cam: true });
  await openPage();
  await enter();
  const [client] = mediaClients;
  expect(client!.getSnapshot().local).toEqual({ mic: false, cam: true, screen: false });
  expect(client!.startAudio).toHaveBeenCalledOnce();
});

test('« Connexion perdue, reconnexion… » quand la connexion tombe après l\'arrivée, jusqu\'à l\'init du retour', async () => {
  await openOffice();
  // Avant la première arrivée, c'est « Connexion au bureau… ».
  expect(screen.queryByText(fr.office.reconnecting)).toBeNull();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
  });
  expect(screen.queryByText(fr.office.reconnecting)).toBeNull();

  act(() => socket().connectionDrops());
  expect(screen.getByRole('status').textContent).toBe(fr.office.reconnecting);
  // Reconnectée, mais le serveur ne nous a pas encore replacés.
  act(() => socket().serverAccepts());
  expect(screen.getByText(fr.office.reconnecting)).toBeTruthy();
  act(() => socket().receive('init', init()));
  expect(screen.queryByText(fr.office.reconnecting)).toBeNull();
});

test('pas de « Connexion perdue » quand un autre onglet a pris la place, ni pendant qu\'on se déconnecte', async () => {
  await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
  });
  let finishSignOut!: () => void;
  fakeAuth.signOut.mockImplementationOnce(
    () => new Promise((resolve) => (finishSignOut = () => resolve({ data: { success: true }, error: null }))),
  );
  await chooseInMeMenu(userEvent.setup(), fr.office.signOut);
  expect(socket().active).toBe(false);
  expect(screen.queryByText(fr.office.reconnecting)).toBeNull();
  finishSignOut();
  await waitFor(() => expect(screen.queryByRole('group', { name: fr.office.barLabel })).toBeNull());
});

test('la connexion audio et vidéo a échoué : « Reconnecter » ferme et rouvre la connexion au bureau, et la consigne redite la rétablit', async () => {
  await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
  });
  const [client] = mediaClients;
  client!.failConnections();
  act(() => socket().receive('media:join', payload('jeton-1')));
  await act(() => client!.idle());

  await userEvent.click(await screen.findByRole('button', { name: fr.media.reconnect }));
  expect(socket().disconnectCalls).toBe(1);
  expect(socket().connectCalls).toBe(2);
  client!.failConnections(false);
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
    socket().receive('media:join', payload('jeton-2'));
  });
  await act(() => client!.idle());
  expect(client!.getSnapshot().room).toBe('r1');
  expect(screen.queryByRole('button', { name: fr.media.reconnect })).toBeNull();
});

test('le bureau ouvre la connexion au serveur, écouteurs posés avant connect(), et attend son init', async () => {
  await openOffice();
  expect(sockets).toHaveLength(1);
  expect(socket().connectCalls).toBe(1);
  expect(socket().listenersAtConnect[0]).toBeGreaterThan(0);
  expect(screen.getByText('Connexion au bureau…')).toBeTruthy();
  expect(screen.queryByTestId('jeu')).toBeNull();
});

test('le jeu démarre au premier init, avec la carte du serveur ; la barre du bureau reste par-dessus', async () => {
  await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init('bureau-du-serveur'));
  });
  // Le jeu est chargé à part (React.lazy) : il arrive après l'init.
  expect((await screen.findByTestId('jeu')).getAttribute('data-map-key')).toBe('bureau-du-serveur');
  expect(screen.queryByText('Connexion au bureau…')).toBeNull();
  expect(await findOfficeFor('Léa')).toBeTruthy();
  // L'init est arrivé jusqu'au magasin (le jeu y lit qui est là).
  expect(Object.keys(useOfficeStore.getState().players)).toEqual(['u-bob']);
});

test('le jeu envoie ses mouvements au serveur par le bus', async () => {
  await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
  });
  const move = { x: 82, y: 240, dir: 'right', moving: true } as const;
  EventBus.emit('local:move', move);
  expect(socket().sentOf('move')).toEqual([move]);
});

test.each(['unauthorized', 'disabled'])('connexion refusée (%s) : retour à la page de connexion', async (refusal) => {
  const router = await openOffice();
  act(() => socket().serverRefuses(refusal));
  await waitFor(() => expect(router.state.location.pathname).toBe('/connexion'));
  expect(socket().active).toBe(false);
});

test('connexion refusée (forbidden_origin) : un message, sans nouvel essai', async () => {
  await openOffice();
  act(() => socket().serverRefuses('forbidden_origin'));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Le bureau refuse la connexion depuis cette page : ouvre l\'appli à son adresse habituelle.',
  );
  expect(socket().connectCalls).toBe(1);
});

test('un autre onglet a pris la place : « Ouvert dans un autre onglet »', async () => {
  await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
    socket().receive('session:replaced');
    socket().serverDisconnects();
  });
  expect(await screen.findByText('Ouvert dans un autre onglet')).toBeTruthy();
  expect(screen.getByRole('dialog', { name: 'Ouvert dans un autre onglet' })).toBeTruthy();
  // La page ne se reconnecte pas toute seule.
  expect(socket().connectCalls).toBe(1);
});

test('« Utiliser ici » relance la connexion ; le serveur répond (init) et l\'écran disparaît', async () => {
  await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
    socket().receive('session:replaced');
    socket().serverDisconnects();
  });
  await userEvent.click(await screen.findByRole('button', { name: 'Utiliser ici' }));
  expect(socket().connectCalls).toBe(2);
  expect(socket().active).toBe(true);
  // Tant que le serveur n'a pas répondu, l'écran reste.
  expect(screen.getByRole('dialog')).toBeTruthy();

  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  // La même socket, la même veille : un seul écouteur de chaque, et les mouvements repartent.
  expect(sockets).toHaveLength(1);
  const move = { x: 82, y: 240, dir: 'right', moving: true } as const;
  EventBus.emit('local:move', move);
  expect(socket().sentOf('move')).toEqual([move]);
});

test('« Utiliser ici » : le serveur refuse (indisponible), la page réessaie seule, et la session expirée renvoie à la connexion', async () => {
  const router = await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
    socket().receive('session:replaced');
    socket().serverDisconnects();
  });
  await userEvent.click(await screen.findByRole('button', { name: 'Utiliser ici' }));
  act(() => socket().serverRefuses('unauthorized'));
  await waitFor(() => expect(router.state.location.pathname).toBe('/connexion'));
});

test('le menu « Moi » envoie status:set par la connexion de la page, et la puce suit la confirmation du serveur', async () => {
  const user = userEvent.setup();
  await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
  });
  await waitFor(() => expect(within(meChip()).getByText(fr.status.available)).toBeTruthy());
  await user.click(meChip());
  await user.click(screen.getByRole('menuitemradio', { name: 'Ne pas déranger' }));
  expect(socket().sentOf('status:set')).toEqual(['dnd']);
  // Le serveur confirme à tout le monde, nous compris.
  act(() => socket().receive('status:changed', { id: 'u-lea', status: 'dnd' }));
  expect(within(meChip()).getByText('Ne pas déranger')).toBeTruthy();
});

test('le statut ne se change pas avant que le serveur ait répondu, ni connexion coupée (la puce, elle, s\'ouvre : on doit pouvoir se déconnecter)', async () => {
  const user = userEvent.setup();
  await openOffice();
  expect((meChip() as HTMLButtonElement).disabled).toBe(false);
  await user.click(meChip());
  const busy = () => screen.getByRole('menuitemradio', { name: 'Occupé' }) as HTMLButtonElement;
  expect(busy().disabled).toBe(true);
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
  });
  expect(busy().disabled).toBe(false);
  act(() => socket().connectionDrops());
  expect(busy().disabled).toBe(true);
});

test('on peut se déconnecter avant le premier init (le serveur ne répond pas)', async () => {
  const router = await openOffice();
  expect(screen.getByText('Connexion au bureau…')).toBeTruthy();
  await chooseInMeMenu(userEvent.setup(), 'Se déconnecter');
  await waitFor(() => expect(router.state.location.pathname).toBe('/connexion'));
  expect(socket().active).toBe(false);
});

test('se déconnecter ferme d\'abord la connexion au bureau, puis la session', async () => {
  const router = await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
  });
  let officeOpenAtSignOut: boolean | null = null;
  fakeAuth.signOut.mockImplementationOnce(async () => {
    officeOpenAtSignOut = socket().active;
    setFakeSession(null);
    return { data: { success: true }, error: null };
  });
  await chooseInMeMenu(userEvent.setup(), 'Se déconnecter');
  await waitFor(() => expect(router.state.location.pathname).toBe('/connexion'));
  expect(officeOpenAtSignOut).toBe(false);
});

test('la déconnexion échoue : le message, et la connexion au bureau est rouverte', async () => {
  const router = await openOffice();
  fakeAuth.signOut.mockResolvedValueOnce({ data: null, error: { status: 500 } });
  await chooseInMeMenu(userEvent.setup(), 'Se déconnecter');
  expect((await screen.findByRole('alert')).textContent).toBe('Une erreur est survenue. Réessaie dans un instant.');
  expect(router.state.location.pathname).toBe('/');
  expect(socket().connectCalls).toBe(2);
  expect(socket().active).toBe(true);
});

test('quitter le bureau : connexion fermée, écouteurs retirés, magasin vidé, room audio et vidéo quittée', async () => {
  await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
    socket().receive('media:join', payload());
  });
  const [client] = mediaClients;
  await act(() => client!.idle());
  expect(useOfficeStore.getState().mapKey).toBe('dev-office');
  // Celui de la connexion (qui envoie les pas au serveur), et celui du son (qui règle le volume d'après ma place) : en conversation.
  const listenersOnBus = EventBus.listenerCount('local:move');
  expect(listenersOnBus).toBe(2);
  cleanup();
  expect(socket().active).toBe(false);
  expect(socket().listenerCount()).toBe(0);
  expect(EventBus.listenerCount('local:move')).toBe(0);
  expect(useOfficeStore.getState().mapKey).toBeNull();
  await client!.idle();
  expect(client!.journal).toEqual(['join:r1', 'leave']);
});

// En développement, StrictMode monte la page, la démonte, puis la remonte : deux connexions sont créées l'une après l'autre. Seule la
// dernière doit rester ouverte, et la barre doit parler à celle-là (la connexion de la page est un état, que le second montage remplace).
test('StrictMode (développement) : la dernière connexion est la seule ouverte, et le menu « Moi » lui parle', async () => {
  const user = userEvent.setup();
  setFakeSession(LEA);
  render(
    <StrictMode>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />
    </StrictMode>,
  );
  await screen.findByRole('heading', { level: 1, name: fr.media.check.title });
  await waitFor(() => expect(sockets).toHaveLength(2));
  await enter();

  expect(sockets).toHaveLength(2);
  const [first, second] = sockets as [FakeSocket, FakeSocket];
  expect(first.active).toBe(false);
  expect(first.listenerCount()).toBe(0);
  expect(second.active).toBe(true);
  expect(EventBus.listenerCount('local:move')).toBe(1);

  act(() => {
    second.serverAccepts();
    second.receive('init', init());
  });
  await waitFor(() => expect(within(meChip()).getByText(fr.status.available)).toBeTruthy());
  await user.click(meChip());
  await user.click(screen.getByRole('menuitemradio', { name: 'Ne pas déranger' }));
  expect(second.sentOf('status:set')).toEqual(['dnd']);
  expect(first.sent).toEqual([]);
});

// ---- Le chat, de la connexion au panneau ----------------------------------------------------------------------------------------

const chatMessage = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  channel: 'all',
  userId: 'u-bob',
  name: 'Bob',
  text: `message ${id}`,
  sentAt: '2026-10-20T10:00:00.000Z',
  ...over,
});
const chatTexts = () => within(screen.getByRole('log')).queryAllByRole('listitem').map((item) => item.querySelector('.chat-text')?.textContent);
// Le bouton du panneau Chat : son nom devient « Chat, N nouveaux messages » quand il y en a de non lus.
const openChat = () => userEvent.click(screen.getByRole('button', { name: /^Chat/ }));

test('le chat : l\'historique de l\'init et les messages reçus sont dans le panneau ; un message écrit part au serveur, et revient par chat:message', async () => {
  const user = userEvent.setup();
  await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', { ...init(), chatHistory: [chatMessage('m1', { text: 'Bonjour' })] });
  });
  await openChat();
  expect(chatTexts()).toEqual(['Bonjour']);
  act(() => socket().receive('chat:message', chatMessage('m2', { text: 'Du nouveau' })));
  expect(chatTexts()).toEqual(['Bonjour', 'Du nouveau']);

  await user.type(screen.getByRole('textbox'), 'Salut{Enter}');
  expect(socket().sentOf('chat:send')).toEqual([{ channel: 'all', text: 'Salut' }]);
  // Le serveur renvoie le message à tout le monde, l'émetteur compris, puis répond.
  act(() => {
    socket().receive('chat:message', chatMessage('m3', { userId: 'u-lea', name: 'Léa', text: 'Salut' }));
    socket().serverAcks('chat:send', { ok: true });
  });
  expect(chatTexts()).toEqual(['Bonjour', 'Du nouveau', 'Salut']);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
});

test('le chat : un message reçu panneau fermé fait un badge sur le bouton, que l\'ouverture efface', async () => {
  await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', { ...init(), chatHistory: [chatMessage('m1')] });
  });
  expect(screen.getByRole('button', { name: fr.chat.toggle })).toBeTruthy();
  act(() => socket().receive('chat:message', chatMessage('m2')));
  expect(screen.getByRole('button', { name: 'Chat, 1 nouveau message' })).toBeTruthy();
  await openChat();
  expect(screen.getByRole('button', { name: fr.chat.toggle })).toBeTruthy();
});

test('le chat : l\'onglet À proximité s\'ouvre avec la room du serveur (media:join), et se ferme avec elle (media:leave)', async () => {
  await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
  });
  const [client] = mediaClients;
  await openChat();
  const nearby = () => screen.getByRole('tab', { name: fr.chat.tabs.nearby }) as HTMLButtonElement;
  expect(nearby().disabled).toBe(true);

  act(() => socket().receive('media:join', payload()));
  await act(() => client!.idle());
  expect(nearby().disabled).toBe(false);
  await userEvent.click(nearby());
  act(() => socket().receive('chat:message', chatMessage('n1', { channel: 'nearby', text: 'psst' })));
  expect(chatTexts()).toEqual(['psst']);
  await userEvent.type(screen.getByRole('textbox'), 'Oui{Enter}');
  expect(socket().sentOf('chat:send')).toEqual([{ channel: 'nearby', text: 'Oui' }]);

  act(() => socket().receive('media:leave'));
  await act(() => client!.idle());
  // Choisi, l'onglet reste lisible, mais on n'y écrit plus.
  expect(chatTexts()).toEqual(['psst']);
  expect(screen.getByText(fr.chat.noConversation)).toBeTruthy();
  await userEvent.click(screen.getByRole('tab', { name: fr.chat.tabs.all }));
  expect(nearby().disabled).toBe(true);
});

test('le chat, connexion coupée puis revenue : on ne peut pas écrire entre-temps, l\'init redonne l\'historique, et À proximité reste', async () => {
  const user = userEvent.setup();
  await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', { ...init(), chatHistory: [chatMessage('m1')] });
  });
  await openChat();
  act(() => socket().receive('chat:message', chatMessage('m2')));

  act(() => socket().connectionDrops());
  const send = screen.getByRole('button', { name: fr.chat.send }) as HTMLButtonElement;
  await user.type(screen.getByRole('textbox'), 'Salut');
  expect(send.disabled).toBe(true);
  expect(screen.getByText(fr.chat.reconnecting)).toBeTruthy();

  // Revenue : le serveur redit le chat, avec ce qui s'est écrit pendant la coupure.
  act(() => {
    socket().serverAccepts();
    socket().receive('init', { ...init(), chatHistory: [chatMessage('m1'), chatMessage('m2'), chatMessage('m3')] });
  });
  expect(chatTexts()).toEqual(['message m1', 'message m2', 'message m3']);
  expect(send.disabled).toBe(false);
  await user.click(send);
  expect(socket().sentOf('chat:send')).toEqual([{ channel: 'all', text: 'Salut' }]);
});

test('StrictMode (développement) : le panneau Chat s\'ouvre sur son champ, et envoie par la dernière connexion', async () => {
  const user = userEvent.setup();
  setFakeSession(LEA);
  render(
    <StrictMode>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />
    </StrictMode>,
  );
  await screen.findByRole('heading', { level: 1, name: fr.media.check.title });
  await waitFor(() => expect(sockets).toHaveLength(2));
  await enter();
  const [first, second] = sockets as [FakeSocket, FakeSocket];
  act(() => {
    second.serverAccepts();
    second.receive('init', { ...init(), chatHistory: [chatMessage('m1')] });
  });
  await user.click(await screen.findByRole('button', { name: fr.chat.toggle }));
  expect(document.activeElement).toBe(screen.getByRole('textbox'));
  expect(chatTexts()).toEqual(['message m1']);
  await user.keyboard('Salut{Enter}');
  expect(second.sentOf('chat:send')).toEqual([{ channel: 'all', text: 'Salut' }]);
  expect(first.sent).toEqual([]);
});

// ---- Le panneau Admin, du compte à la barre -------------------------------------------------------------------------------------

// Le rôle vient de la session (Better Auth le renvoie avec le compte) : il décide si le menu « Plus » a une ligne Admin.
test('admin : le menu « Plus » a une ligne Admin, qui ouvre le panneau sur les listes du serveur, et le compte de la session s\'y reconnaît', async () => {
  const user = userEvent.setup();
  fakeApi({
    'GET /api/admin/members': () =>
      json(200, [
        { id: 'u-lea', name: 'Léa', email: 'lea@x.fr', role: 'admin' },
        { id: 'u-bob', name: 'Bob', email: 'bob@x.fr', role: 'member' },
      ]),
    'GET /api/admin/invitations': () => json(200, []),
  });
  await openOffice({ ...LEA, role: 'admin' });
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
  });

  await user.click(await screen.findByRole('button', { name: fr.office.more.toggle }));
  await user.click(screen.getByRole('menuitem', { name: fr.admin.toggle }));
  const members = await screen.findByRole('region', { name: 'Membres (2)' });
  // Léa est le compte de la session : pas de bouton pour se retirer elle-même.
  expect(within(members).getByText('Léa').closest('li')?.textContent).toContain(fr.admin.you);
  expect(within(members).queryByRole('button', { name: 'Retirer Léa' })).toBeNull();
  expect(within(members).getByRole('button', { name: 'Retirer Bob' })).toBeTruthy();
});

test('membre : ni ligne Admin dans le menu « Plus », ni requête à /api/admin', async () => {
  const api = fakeApi({});
  await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
  });
  expect(screen.getByRole('button', { name: fr.chat.toggle })).toBeTruthy();
  await userEvent.click(moreButton());
  expect(screen.queryByRole('menuitem', { name: fr.admin.toggle })).toBeNull();
  expect(api).not.toHaveBeenCalled();
});
