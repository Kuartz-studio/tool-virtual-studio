import type { ChatMessage, MediaJoinPayload, PublicPlayer } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import { FakeMediaClient } from '../media/fake-media-client';
import { useOfficeStore } from '../state/office-store';
import { fakeApi, json } from '../test/fake-api';
import { FakeSocket } from '../test/fake-socket';
import { OfficeShell } from './OfficeShell';

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

const payload = (room: string): MediaJoinPayload => ({ url: 'wss://livekit.test', room, token: `jeton-${room}` });
const clients: FakeMediaClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.leave();
});

beforeEach(() => {
  useOfficeStore.getState().reset();
  fakeApi({
    'GET /api/members': () =>
      json(200, [
        { id: 'moi', name: 'Léa', avatarKey: null },
        { id: 'bob', name: 'Bob', avatarKey: null },
      ]),
  });
});

interface Options {
  signingOut?: boolean;
  connecting?: boolean;
  reconnecting?: boolean;
  errors?: string[];
  onSignOut?: () => void;
  onUseHere?: () => void;
  onReconnect?: () => void;
  init?: boolean;
}

// Le bureau, avec une socket connectée et un faux client média (hors conversation). `init` : le serveur a envoyé l'état de départ.
function renderShell({
  signingOut = false,
  connecting = false,
  reconnecting = false,
  errors = [],
  onSignOut = () => {},
  onUseHere = () => {},
  onReconnect = () => {},
  init = true,
}: Options = {}) {
  const socket = new FakeSocket();
  socket.serverAccepts();
  const client = new FakeMediaClient({ mic: true, cam: false }, { id: 'moi', name: 'Léa' });
  clients.push(client);
  if (init) act(() => useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [player('bob', 'Bob')], mapKey: 'dev-office', chatHistory: [] }));
  const shell = () => (
    <OfficeShell
      user={{ name: 'Léa' }}
      socket={socket.asSocket()}
      media={{ client, snapshot: client.getSnapshot() }}
      onReconnect={onReconnect}
      onSignOut={onSignOut}
      signingOut={signingOut}
      onUseHere={onUseHere}
      connecting={connecting}
      reconnecting={reconnecting}
      errors={errors}
    >
      <div data-testid="jeu" />
    </OfficeShell>
  );
  const view = render(shell());
  // Le client a changé (la page le suit par useMedia) : la page se redessine.
  const refresh = () => view.rerender(shell());
  return { socket, client, refresh, ...view };
}

const bar = () => screen.getByRole('group', { name: fr.office.barLabel });
const toggle = () => within(bar()).getByRole('button', { name: fr.office.people.toggle }) as HTMLButtonElement;
const chatToggle = () => within(bar()).getByRole('button', { name: /^Chat/ }) as HTMLButtonElement;
const chatPanel = () => screen.getByRole('complementary', { name: fr.chat.title });
const chatInput = () => screen.getByRole('textbox') as HTMLInputElement;
const chatMessage = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  channel: 'all',
  userId: 'bob',
  name: 'Bob',
  text: `message ${id}`,
  sentAt: '2026-10-20T10:00:00.000Z',
  ...over,
});

describe('la mise en page', () => {
  test('le jeu occupe la page, sous le reste ; la page a son titre', () => {
    const { container } = renderShell();
    const main = container.querySelector('main.office')!;
    expect(main.querySelector(':scope > [data-testid="jeu"]')).toBeTruthy();
    // Le reste (vignettes, panneaux, barre) est une couche par-dessus, qui ne contient pas le jeu.
    const ui = main.querySelector(':scope > .office-ui')!;
    expect(ui).toBeTruthy();
    expect(ui.querySelector('[data-testid="jeu"]')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: fr.common.appName })).toBeTruthy();
  });

  test('en haut, les vignettes de la conversation : rien hors conversation ; la sienne et celles des autres dedans', async () => {
    const { container, client, refresh } = renderShell();
    const top = container.querySelector('.office-ui > .office-top')!;
    expect(top.childElementCount).toBe(0);
    await act(() => client.join(payload('r1')));
    act(() => client.addRemote({ id: 'bob', name: 'Bob' }));
    refresh();
    const tiles = within(top as HTMLElement).getByRole('list', { name: fr.media.tiles.label });
    expect(within(tiles).getAllByRole('listitem')).toHaveLength(2);
    expect(within(tiles).getByRole('button', { name: new RegExp(`^${t(fr.media.tiles.camera, { name: 'Bob' })}`) })).toBeTruthy();
  });

  test('la barre du bas : le nom, le statut, micro, caméra et partage d\'écran, puis Chat, Personnes et Se déconnecter', () => {
    renderShell();
    const names = within(bar()).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual(['Statut : Disponible', 'Micro', 'Caméra', 'Partager l\'écran', 'Chat', 'Personnes', 'Se déconnecter']);
    expect(within(bar()).getByText('Léa')).toBeTruthy();
  });

  test('les commandes de la barre parlent au client média', async () => {
    const user = userEvent.setup();
    const { client, refresh } = renderShell();
    await user.click(within(bar()).getByRole('button', { name: fr.media.controls.mic }));
    expect(client.getSnapshot().local.mic).toBe(false);
    refresh();
    expect(within(bar()).getByRole('button', { name: fr.media.controls.mic }).getAttribute('aria-pressed')).toBe('false');
  });

  test('« Connexion perdue, reconnexion… » quand la connexion est tombée après l\'arrivée', () => {
    renderShell({ reconnecting: true });
    expect(screen.getByRole('status').textContent).toBe(fr.office.reconnecting);
  });

  test('la connexion audio et vidéo a échoué : « Reconnecter », en haut, appelle onReconnect', async () => {
    const user = userEvent.setup();
    const onReconnect = vi.fn();
    const { client, refresh } = renderShell({ onReconnect });
    client.failConnections();
    await act(() => client.join(payload('r1')));
    refresh();
    await user.click(screen.getByRole('button', { name: fr.media.reconnect }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  test('le nom affiché est celui de la session avant l\'init, puis celui que le serveur donne (un changement de nom suit)', () => {
    renderShell({ init: false });
    expect(within(bar()).getByText('Léa')).toBeTruthy();
    act(() => useOfficeStore.getState().applyInit({ self: player('moi', 'Léa Martin'), players: [], mapKey: 'dev-office', chatHistory: [] }));
    expect(within(bar()).getByText('Léa Martin')).toBeTruthy();
    act(() => useOfficeStore.getState().setProfile({ id: 'moi', name: 'Léa M.', avatarKey: null }));
    expect(within(bar()).getByText('Léa M.')).toBeTruthy();
  });

  test('« Connexion au bureau… » en attendant le serveur', () => {
    renderShell({ connecting: true, init: false });
    expect(screen.getByRole('status').textContent).toBe(fr.office.connecting);
  });

  test('pas de message de connexion une fois connecté', () => {
    renderShell({ connecting: false });
    expect(screen.queryByText(fr.office.connecting)).toBeNull();
  });

  test('les erreurs : chacune est une alerte', () => {
    renderShell({ errors: ['Première', 'Seconde'] });
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['Première', 'Seconde']);
  });
});

describe('Se déconnecter', () => {
  test('le bouton appelle onSignOut', async () => {
    const onSignOut = vi.fn();
    renderShell({ onSignOut });
    await userEvent.click(within(bar()).getByRole('button', { name: fr.office.signOut }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  test('pendant la déconnexion : « Déconnexion… », inactif', () => {
    renderShell({ signingOut: true });
    const button = within(bar()).getByRole('button', { name: fr.office.signingOut }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test('il marche avant l\'init (le serveur ne répond pas) : on doit pouvoir se déconnecter', async () => {
    const onSignOut = vi.fn();
    renderShell({ init: false, connecting: true, onSignOut });
    await userEvent.click(within(bar()).getByRole('button', { name: fr.office.signOut }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('le statut', () => {
  test('« Ne pas déranger » part au serveur (status:set) par la socket de la page', async () => {
    const user = userEvent.setup();
    const { socket } = renderShell();
    await user.click(within(bar()).getByRole('button', { name: /^Statut/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Ne pas déranger' }));
    expect(socket.sentOf('status:set')).toEqual(['dnd']);
  });
});

describe('le panneau Personnes', () => {
  test('fermé au départ ; le bouton l\'ouvre et le ferme, et le dit (aria-expanded, aria-controls)', async () => {
    const user = userEvent.setup();
    renderShell();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().hasAttribute('aria-controls')).toBe(false);

    await user.click(toggle());
    const panel = screen.getByRole('complementary', { name: fr.office.people.title });
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.id).not.toBe('');

    await user.click(toggle());
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  test('il s\'ouvre dans la couche par-dessus le jeu : le jeu ne bouge pas (pas de décalage, même élément)', async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    const game = screen.getByTestId('jeu');
    await user.click(toggle());
    const panel = screen.getByRole('complementary');
    expect(container.querySelector('.office-ui .office-side')?.contains(panel)).toBe(true);
    expect(game.parentElement?.matches('main.office')).toBe(true);
    expect(screen.getByTestId('jeu')).toBe(game);
    await user.click(toggle());
    expect(screen.getByTestId('jeu')).toBe(game);
  });

  test('à l\'ouverture le focus passe au panneau (son titre) ; Échap le ferme et rend le focus au bouton', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(toggle());
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: fr.office.people.title }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  test('le bouton Fermer du panneau le ferme aussi, focus rendu au bouton', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(toggle());
    await user.click(screen.getByRole('button', { name: fr.office.people.close }));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  test('au clavier : Entrée ouvre le panneau, et Tab y entre', async () => {
    const user = userEvent.setup();
    renderShell();
    toggle().focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('complementary')).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: fr.office.people.close }));
  });

  test('il liste les gens (l\'appel à /api/members part à l\'ouverture)', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(toggle());
    expect(await screen.findByRole('heading', { name: 'En ligne (2)' })).toBeTruthy();
  });

  test('il est inactif tant que le serveur n\'a pas dit qui est là (avant l\'init)', () => {
    renderShell({ init: false });
    expect(toggle().disabled).toBe(true);
  });
});

describe('le panneau Chat', () => {
  test('fermé au départ ; le bouton l\'ouvre et le ferme, et le dit (aria-expanded, aria-controls)', async () => {
    const user = userEvent.setup();
    renderShell();
    // Fermé, il n'est pas dans la page pour un lecteur d'écran ni pour le clavier.
    expect(screen.queryByRole('complementary', { name: fr.chat.title })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(chatToggle().getAttribute('aria-expanded')).toBe('false');
    expect(chatToggle().hasAttribute('aria-controls')).toBe(false);

    await user.click(chatToggle());
    expect(chatToggle().getAttribute('aria-expanded')).toBe('true');
    expect(chatToggle().getAttribute('aria-controls')).toBe(chatPanel().id);
    expect(chatPanel().id).not.toBe('');

    await user.click(chatToggle());
    expect(screen.queryByRole('complementary', { name: fr.chat.title })).toBeNull();
    expect(chatToggle().getAttribute('aria-expanded')).toBe('false');
    expect(chatToggle().hasAttribute('aria-controls')).toBe(false);
  });

  test('il s\'ouvre dans la couche par-dessus le jeu, à droite : le jeu ne bouge pas', async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    const game = screen.getByTestId('jeu');
    await user.click(chatToggle());
    expect(container.querySelector('.office-ui .office-side')?.contains(chatPanel())).toBe(true);
    expect(screen.getByTestId('jeu')).toBe(game);
    await user.click(chatToggle());
    expect(screen.getByTestId('jeu')).toBe(game);
  });

  test('à l\'ouverture le focus passe au champ du message ; Échap ferme et rend le focus au bouton, à chaque fois', async () => {
    const user = userEvent.setup();
    renderShell();
    for (let times = 0; times < 2; times++) {
      await user.click(chatToggle());
      expect(document.activeElement).toBe(chatInput());
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('complementary', { name: fr.chat.title })).toBeNull();
      expect(document.activeElement).toBe(chatToggle());
    }
  });

  test('le bouton Fermer du panneau le ferme aussi, focus rendu au bouton', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(chatToggle());
    await user.click(screen.getByRole('button', { name: fr.chat.close }));
    expect(screen.queryByRole('complementary', { name: fr.chat.title })).toBeNull();
    expect(document.activeElement).toBe(chatToggle());
  });

  test('au clavier : Entrée ouvre le panneau, le focus est dans le champ', async () => {
    const user = userEvent.setup();
    renderShell();
    chatToggle().focus();
    await user.keyboard('{Enter}');
    expect(chatPanel()).toBeTruthy();
    expect(document.activeElement).toBe(chatInput());
  });

  test('fermé, le panneau garde le brouillon et l\'onglet : on les retrouve à la réouverture', async () => {
    const user = userEvent.setup();
    const { client, refresh } = renderShell();
    await act(() => client.join(payload('r1')));
    refresh();
    await user.click(chatToggle());
    await user.click(screen.getByRole('tab', { name: fr.chat.tabs.nearby }));
    await user.type(chatInput(), 'Pas fini');
    await user.keyboard('{Escape}');
    await user.click(chatToggle());
    expect(screen.getByRole('tab', { name: fr.chat.tabs.nearby }).getAttribute('aria-selected')).toBe('true');
    expect(chatInput().value).toBe('Pas fini');
    expect(document.activeElement).toBe(chatInput());
  });

  test('il liste les messages, ceux de l\'historique et ceux qui arrivent, et envoie par la socket de la page', async () => {
    const user = userEvent.setup();
    const { socket } = renderShell();
    act(() => useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [player('bob', 'Bob')], mapKey: 'dev-office', chatHistory: [chatMessage('m1')] }));
    await user.click(chatToggle());
    expect(within(screen.getByRole('log')).getAllByRole('listitem')).toHaveLength(1);
    act(() => useOfficeStore.getState().addChatMessage(chatMessage('m2')));
    expect(within(screen.getByRole('log')).getAllByRole('listitem')).toHaveLength(2);

    await user.type(chatInput(), 'Salut{Enter}');
    expect(socket.sentOf('chat:send')).toEqual([{ channel: 'all', text: 'Salut' }]);
  });

  test('« À proximité » s\'ouvre avec la room du client média : en conversation seulement', async () => {
    const user = userEvent.setup();
    const { client, refresh } = renderShell();
    await user.click(chatToggle());
    const nearby = () => screen.getByRole('tab', { name: fr.chat.tabs.nearby }) as HTMLButtonElement;
    expect(nearby().disabled).toBe(true);
    await act(() => client.join(payload('r1')));
    refresh();
    expect(nearby().disabled).toBe(false);
    await act(() => client.leave());
    refresh();
    expect(nearby().disabled).toBe(true);
  });

  test('il est inactif tant que le serveur n\'a pas dit qui est là (avant l\'init)', () => {
    renderShell({ init: false });
    expect(chatToggle().disabled).toBe(true);
  });

  test('Chat et Personnes peuvent être ouverts ensemble, Personnes au-dessus', async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await user.click(chatToggle());
    await user.click(toggle());
    const side = container.querySelector('.office-ui .office-side')!;
    expect([...side.querySelectorAll(':scope > aside')].map((panel) => panel.querySelector('h2')?.textContent)).toEqual([fr.office.people.title, fr.chat.title]);
    await user.click(toggle());
    expect(chatPanel()).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: fr.office.people.title })).toBeNull();
  });

  test('la colonne de droite sait si le chat est ouvert (Personnes lui laisse alors de la place)', async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    const side = container.querySelector('.office-side')!;
    expect(side.hasAttribute('data-chat-open')).toBe(false);
    await user.click(chatToggle());
    expect(side.getAttribute('data-chat-open')).toBe('true');
    await user.click(chatToggle());
    expect(side.hasAttribute('data-chat-open')).toBe(false);
  });

  test('l\'écran « Ouvert dans un autre onglet » rend le panneau inerte avec le reste', async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await user.click(chatToggle());
    act(() => useOfficeStore.getState().setReplaced(true));
    expect(container.querySelector('.office-ui')?.contains(chatPanel())).toBe(true);
    expect(container.querySelector('.office-ui')?.hasAttribute('inert')).toBe(true);
  });

  describe('le badge de non-lus', () => {
    const badge = () => chatToggle().querySelector('.bar-badge');

    test('rien tant qu\'il n\'y a rien de nouveau ; l\'historique de l\'arrivée est lu', () => {
      renderShell({ init: false });
      act(() =>
        useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [], mapKey: 'dev-office', chatHistory: [chatMessage('m1'), chatMessage('m2')] }),
      );
      expect(badge()).toBeNull();
      expect(chatToggle().getAttribute('aria-label')).toBeNull();
      expect(chatToggle().textContent).toBe('Chat');
    });

    test('sur le bouton fermé : le nombre de nouveaux messages « Tout le monde » des autres, et un nom accessible qui le dit', () => {
      renderShell();
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m1')));
      expect(badge()?.textContent).toBe('1');
      expect(chatToggle().getAttribute('aria-label')).toBe('Chat, 1 nouveau message');
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m2')));
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m3')));
      expect(badge()?.textContent).toBe('3');
      expect(chatToggle().getAttribute('aria-label')).toBe('Chat, 3 nouveaux messages');
      // Le badge est décoratif : le nom accessible dit déjà le nombre.
      expect(badge()?.getAttribute('aria-hidden')).toBe('true');
      expect(screen.getByRole('button', { name: 'Chat, 3 nouveaux messages' })).toBeTruthy();
    });

    test('ni les siens, ni « À proximité » ne comptent', () => {
      renderShell();
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m1', { userId: 'moi', name: 'Léa' })));
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('n1', { channel: 'nearby' })));
      expect(badge()).toBeNull();
    });

    test('au-delà de 99, « 99+ » (le nom accessible, lui, donne le nombre)', () => {
      renderShell();
      for (let i = 1; i <= 120; i++) act(() => useOfficeStore.getState().addChatMessage(chatMessage(`m${i}`)));
      expect(badge()?.textContent).toBe('99+');
      expect(chatToggle().getAttribute('aria-label')).toBe('Chat, 120 nouveaux messages');
    });

    test('l\'ouverture les lit : le badge disparaît, et ne revient pas pour ce qui arrive panneau ouvert, ni à la fermeture', async () => {
      const user = userEvent.setup();
      renderShell();
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m1')));
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m2')));
      expect(badge()?.textContent).toBe('2');

      await user.click(chatToggle());
      expect(badge()).toBeNull();
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m3')));
      expect(badge()).toBeNull();
      await user.click(chatToggle());
      expect(badge()).toBeNull();

      // Fermé de nouveau : on compte ce qui est arrivé depuis.
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m4')));
      expect(badge()?.textContent).toBe('1');
    });

    test('pas de badge sur le bouton ouvert, même pour des messages que l\'onglet affiché ne montre pas (À proximité) ; à la fermeture ils comptent', async () => {
      const user = userEvent.setup();
      const { client, refresh } = renderShell();
      await act(() => client.join(payload('r1')));
      refresh();
      await user.click(chatToggle());
      await user.click(screen.getByRole('tab', { name: fr.chat.tabs.nearby }));
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m1')));
      expect(badge()).toBeNull();
      await user.click(chatToggle());
      expect(badge()?.textContent).toBe('1');
    });

    test('le message « Tout le monde » lu en direct panneau ouvert est lu : il ne revient pas en badge', async () => {
      const user = userEvent.setup();
      renderShell();
      await user.click(chatToggle());
      act(() => useOfficeStore.getState().addChatMessage(chatMessage('m1')));
      await user.click(chatToggle());
      expect(badge()).toBeNull();
    });
  });
});

describe('ouvert dans un autre onglet', () => {
  test('l\'écran couvre le bureau, dont la couche est inerte ; « Utiliser ici » relance la connexion', async () => {
    const onUseHere = vi.fn();
    const { container } = renderShell({ onUseHere });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('.office-ui')?.hasAttribute('inert')).toBe(false);

    act(() => useOfficeStore.getState().setReplaced(true));
    expect(screen.getByRole('dialog', { name: fr.office.replaced })).toBeTruthy();
    expect(container.querySelector('.office-ui')?.hasAttribute('inert')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: fr.office.useHere }));
    expect(onUseHere).toHaveBeenCalledTimes(1);
  });

  test('l\'écran disparaît quand le serveur répond (l\'init rend la main)', () => {
    const { container } = renderShell();
    act(() => useOfficeStore.getState().setReplaced(true));
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [], mapKey: 'dev-office', chatHistory: [] }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('.office-ui')?.hasAttribute('inert')).toBe(false);
  });

  test('le jeu reste monté dessous : même élément', () => {
    renderShell();
    const game = screen.getByTestId('jeu');
    act(() => useOfficeStore.getState().setReplaced(true));
    expect(screen.getByTestId('jeu')).toBe(game);
  });
});
