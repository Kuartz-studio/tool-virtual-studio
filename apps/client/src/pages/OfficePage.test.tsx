import type { InitPayload, PublicPlayer } from '@bureau/shared';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { EventBus } from '../game/EventBus';
import { routes } from '../router';
import { useOfficeStore } from '../state/office-store';
import { fakeAuth, resetFakeAuth, setFakeSession } from '../test/fake-auth-client';
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
const init = (mapKey = 'dev-office'): InitPayload => ({ self: player('u-lea', 'Léa'), players: [player('u-bob', 'Bob')], mapKey, chatHistory: [] });
const socket = (): FakeSocket => {
  const last = sockets.at(-1);
  if (!last) throw new Error('La page n\'a pas ouvert de connexion.');
  return last;
};

beforeEach(() => {
  resetFakeAuth();
  sockets.length = 0;
  useOfficeStore.getState().reset();
});

// Ouvre le bureau, et attend que la page ait ouvert sa connexion. La barre ne suffit pas : la page n'ouvre la connexion que dans un
// effet, que React passe après avoir affiché la page, dans une autre tâche ; sur une machine chargée, la barre est trouvée avant
// (c'était l'instabilité de ce fichier : `sockets` encore vide, « La page n'a pas ouvert de connexion »).
async function openOffice() {
  setFakeSession(LEA);
  const router = renderRoute('/');
  await findOfficeFor('Léa');
  await waitFor(() => expect(sockets.at(-1)?.connectCalls).toBe(1));
  return router;
}

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

test('le menu des statuts envoie status:set par la connexion de la page, et le point suit la confirmation du serveur', async () => {
  const user = userEvent.setup();
  await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
  });
  await user.click(await screen.findByRole('button', { name: 'Statut : Disponible' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Ne pas déranger' }));
  expect(socket().sentOf('status:set')).toEqual(['dnd']);
  // Le serveur confirme à tout le monde, nous compris.
  act(() => socket().receive('status:changed', { id: 'u-lea', status: 'dnd' }));
  expect(screen.getByRole('button', { name: 'Statut : Ne pas déranger' })).toBeTruthy();
});

test('le statut ne se change pas avant que le serveur ait répondu, ni connexion coupée', async () => {
  await openOffice();
  expect((screen.getByRole('button', { name: 'Statut' }) as HTMLButtonElement).disabled).toBe(true);
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
  });
  const trigger = await screen.findByRole('button', { name: 'Statut : Disponible' });
  expect((trigger as HTMLButtonElement).disabled).toBe(false);
  act(() => socket().connectionDrops());
  expect((trigger as HTMLButtonElement).disabled).toBe(true);
});

test('on peut se déconnecter avant le premier init (le serveur ne répond pas)', async () => {
  const router = await openOffice();
  expect(screen.getByText('Connexion au bureau…')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
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
  await userEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/connexion'));
  expect(officeOpenAtSignOut).toBe(false);
});

test('la déconnexion échoue : le message, et la connexion au bureau est rouverte', async () => {
  const router = await openOffice();
  fakeAuth.signOut.mockResolvedValueOnce({ data: null, error: { status: 500 } });
  await userEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Une erreur est survenue. Réessaie dans un instant.');
  expect(router.state.location.pathname).toBe('/');
  expect(socket().connectCalls).toBe(2);
  expect(socket().active).toBe(true);
});

test('quitter le bureau : connexion fermée, écouteurs retirés, magasin vidé', async () => {
  await openOffice();
  act(() => {
    socket().serverAccepts();
    socket().receive('init', init());
  });
  expect(useOfficeStore.getState().mapKey).toBe('dev-office');
  const listenersOnBus = EventBus.listenerCount('local:move');
  expect(listenersOnBus).toBe(1);
  cleanup();
  expect(socket().active).toBe(false);
  expect(socket().listenerCount()).toBe(0);
  expect(EventBus.listenerCount('local:move')).toBe(0);
  expect(useOfficeStore.getState().mapKey).toBeNull();
});

// En développement, StrictMode monte la page, la démonte, puis la remonte : deux connexions sont créées l'une après l'autre. Seule la
// dernière doit rester ouverte, et la barre doit parler à celle-là (la connexion de la page est un état, que le second montage remplace).
test('StrictMode (développement) : la dernière connexion est la seule ouverte, et le menu des statuts lui parle', async () => {
  const user = userEvent.setup();
  setFakeSession(LEA);
  render(
    <StrictMode>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />
    </StrictMode>,
  );
  await findOfficeFor('Léa');

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
  await user.click(await screen.findByRole('button', { name: 'Statut : Disponible' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Ne pas déranger' }));
  expect(second.sentOf('status:set')).toEqual(['dnd']);
  expect(first.sent).toEqual([]);
});
