import type { PublicPlayer } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fr } from '../i18n/fr';
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
  errors?: string[];
  onSignOut?: () => void;
  onUseHere?: () => void;
  init?: boolean;
}

// Le bureau, avec une socket connectée. `init` : le serveur a envoyé l'état de départ.
function renderShell({ signingOut = false, connecting = false, errors = [], onSignOut = () => {}, onUseHere = () => {}, init = true }: Options = {}) {
  const socket = new FakeSocket();
  socket.serverAccepts();
  if (init) act(() => useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [player('bob', 'Bob')], mapKey: 'dev-office', chatHistory: [] }));
  const view = render(
    <OfficeShell
      user={{ name: 'Léa' }}
      socket={socket.asSocket()}
      onSignOut={onSignOut}
      signingOut={signingOut}
      onUseHere={onUseHere}
      connecting={connecting}
      errors={errors}
    >
      <div data-testid="jeu" />
    </OfficeShell>,
  );
  return { socket, ...view };
}

const bar = () => screen.getByRole('group', { name: fr.office.barLabel });
const toggle = () => within(bar()).getByRole('button', { name: fr.office.people.toggle }) as HTMLButtonElement;

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

  test('un emplacement vide en haut pour les vignettes vidéo, et une zone vide au milieu de la barre pour ses commandes (tâche 20)', () => {
    const { container } = renderShell();
    const top = container.querySelector('.office-ui > [data-slot="video-tiles"]')!;
    expect(top).toBeTruthy();
    expect(top.childElementCount).toBe(0);
    const middle = bar().querySelector('[data-slot="controls"]')!;
    expect(middle).toBeTruthy();
    expect(middle.childElementCount).toBe(0);
  });

  test('la barre du bas : le nom, le statut, puis Personnes et Se déconnecter', () => {
    renderShell();
    const names = within(bar()).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual(['Statut : Disponible', 'Personnes', 'Se déconnecter']);
    expect(within(bar()).getByText('Léa')).toBeTruthy();
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
