import { STATUSES, type PublicPlayer, type Status } from '@bureau/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { bindKeyboard, DirectionInput } from '../game/input';
import { fr } from '../i18n/fr';
import { statusCssColor } from '../lib/status';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { StatusMenu } from './StatusMenu';

const player = (id: string, status: Status = 'available'): PublicPlayer => ({
  id,
  name: id.toUpperCase(),
  avatarKey: null,
  x: 80,
  y: 240,
  dir: 'down',
  moving: false,
  status,
  media: { mic: false, cam: false, screen: false },
});

beforeEach(() => {
  useOfficeStore.getState().reset();
});

// Le serveur a envoyé l'état de départ (self avec ce statut).
function arriveWith(status: Status): void {
  act(() => useOfficeStore.getState().applyInit({ self: player('moi', status), players: [], mapKey: 'dev-office', chatHistory: [] }));
}

// Un menu des statuts avec une socket connectée, et le bureau prêt.
function renderMenu({ status = 'available' as Status, connected = true } = {}) {
  const socket = new FakeSocket();
  if (connected) socket.serverAccepts();
  arriveWith(status);
  const view = render(<StatusMenu socket={socket.asSocket()} />);
  return Object.assign(socket, { view });
}

const trigger = () => screen.getByRole('button', { name: new RegExp(`^${fr.office.statusMenu.label}`) });
const item = (status: Status) => screen.getByRole('menuitemradio', { name: fr.status[status] });
const dotOf = (element: HTMLElement) => element.querySelector('[data-status]');

describe('le bouton', () => {
  test('dit le statut en cours, d\'après le magasin, et le suit', () => {
    renderMenu({ status: 'available' });
    expect(trigger().textContent).toContain('Disponible');
    expect(trigger().getAttribute('aria-label')).toBe('Statut : Disponible');

    act(() => useOfficeStore.getState().setStatus('moi', 'busy'));
    expect(trigger().getAttribute('aria-label')).toBe('Statut : Occupé');
    expect(trigger().textContent).toContain('Occupé');
  });

  test('un statut d\'un autre que soi ne change rien', () => {
    renderMenu({ status: 'available' });
    act(() => {
      useOfficeStore.getState().upsertPlayer(player('autre'));
      useOfficeStore.getState().setStatus('autre', 'dnd');
    });
    expect(trigger().getAttribute('aria-label')).toBe('Statut : Disponible');
  });

  test.each(STATUSES)('son point est de la couleur du statut « %s » (la même que l\'étiquette de l\'avatar)', (status) => {
    renderMenu({ status });
    const dot = dotOf(trigger());
    expect(dot?.getAttribute('data-status')).toBe(status);
    expect((dot as HTMLElement).style.backgroundColor).toBe(statusCssColor(status));
  });

  test('c\'est un bouton de menu : fermé au départ, annoncé comme tel', () => {
    renderMenu();
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('le menu', () => {
  test('« Ne pas déranger » envoie status:set dnd', async () => {
    const user = userEvent.setup();
    const socket = renderMenu({ status: 'available' });
    await user.click(trigger());
    await user.click(screen.getByRole('menuitemradio', { name: 'Ne pas déranger' }));
    expect(socket.sentOf('status:set')).toEqual(['dnd']);
  });

  test.each(STATUSES)('choisir « %s » envoie ce statut, et rien d\'autre', async (status) => {
    const user = userEvent.setup();
    const from: Status = status === 'available' ? 'dnd' : 'available';
    const socket = renderMenu({ status: from });
    await user.click(trigger());
    await user.click(item(status));
    expect(socket.sent).toEqual([['status:set', status]]);
  });

  test('il liste les quatre statuts dans l\'ordre de la spec, avec leurs libellés français, et coche celui en cours', async () => {
    const user = userEvent.setup();
    renderMenu({ status: 'away' });
    await user.click(trigger());
    expect(screen.getByRole('menu', { name: fr.office.statusMenu.menu })).toBeTruthy();
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent?.replace('✓', '').trim())).toEqual(['Disponible', 'Occupé', 'Absent', 'Ne pas déranger']);
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false']);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(screen.getByRole('menu').id);
  });

  test.each(STATUSES)('le point de « %s » a la couleur du statut', async (status) => {
    const user = userEvent.setup();
    renderMenu({ status: 'available' });
    await user.click(trigger());
    const dot = dotOf(item(status)) as HTMLElement;
    expect(dot.getAttribute('data-status')).toBe(status);
    expect(dot.style.backgroundColor).toBe(statusCssColor(status));
  });

  test('choisir le statut en cours n\'envoie rien, et ferme le menu', async () => {
    const user = userEvent.setup();
    const socket = renderMenu({ status: 'busy' });
    await user.click(trigger());
    await user.click(item('busy'));
    expect(socket.sent).toEqual([]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('le statut change quand le serveur le confirme, pas avant', async () => {
    const user = userEvent.setup();
    renderMenu({ status: 'available' });
    await user.click(trigger());
    await user.click(item('dnd'));
    expect(trigger().getAttribute('aria-label')).toBe('Statut : Disponible');
    act(() => useOfficeStore.getState().setStatus('moi', 'dnd'));
    expect(trigger().getAttribute('aria-label')).toBe('Statut : Ne pas déranger');
  });

  test('choisir ferme le menu et rend le focus au bouton', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(trigger());
    await user.click(item('away'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});

describe('au clavier', () => {
  test('Entrée ouvre le menu, le focus va au statut en cours', async () => {
    const user = userEvent.setup();
    renderMenu({ status: 'busy' });
    await user.tab();
    expect(document.activeElement).toBe(trigger());
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(item('busy'));
  });

  test('Espace ouvre aussi le menu ; Échap le referme', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement).toBe(item('available'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // Le bouton garde le focus après un choix : si ↓ ou ↑ y rouvraient le menu, l'avatar ne pourrait plus repartir vers le bas ou le haut.
  test('↓ et ↑ sur le bouton ne l\'ouvrent pas : ce sont les flèches de l\'avatar, qui repart', async () => {
    const user = userEvent.setup();
    const directions = new DirectionInput();
    const unbind = bindKeyboard(directions);
    try {
      renderMenu();
      await user.tab();
      expect(document.activeElement).toBe(trigger());
      // Touche gardée enfoncée (« > ») : l'avatar marche tant qu'elle l'est.
      await user.keyboard('{ArrowDown>}');
      expect(screen.queryByRole('menu')).toBeNull();
      expect(directions.current()).toBe('down');
      await user.keyboard('{/ArrowDown}{ArrowUp>}');
      expect(screen.queryByRole('menu')).toBeNull();
      expect(directions.current()).toBe('up');
    } finally {
      unbind();
    }
  });

  test('après un choix à la souris, le bouton a le focus, et les flèches font marcher l\'avatar', async () => {
    const user = userEvent.setup();
    const directions = new DirectionInput();
    const unbind = bindKeyboard(directions);
    try {
      renderMenu({ status: 'available' });
      await user.click(trigger());
      await user.click(item('away'));
      expect(document.activeElement).toBe(trigger());
      await user.keyboard('{ArrowDown>}');
      expect(directions.current()).toBe('down');
      expect(screen.queryByRole('menu')).toBeNull();
    } finally {
      unbind();
    }
  });

  test('↓ et ↑ passent d\'un statut à l\'autre en boucle, Début et Fin vont aux extrémités', async () => {
    const user = userEvent.setup();
    renderMenu({ status: 'available' });
    await user.tab();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(item('busy'));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(item('dnd'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(item('available'));
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(item('dnd'));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(item('available'));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(item('dnd'));
  });

  test('Entrée sur un statut le choisit', async () => {
    const user = userEvent.setup();
    const socket = renderMenu({ status: 'available' });
    await user.tab();
    await user.keyboard('{Enter}{ArrowDown}{ArrowDown}{Enter}');
    expect(socket.sentOf('status:set')).toEqual(['away']);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  test('Échap ferme le menu sans rien envoyer, et rend le focus au bouton', async () => {
    const user = userEvent.setup();
    const socket = renderMenu();
    await user.tab();
    await user.keyboard('{Enter}{ArrowDown}{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(socket.sent).toEqual([]);
  });

  test('Tab ferme le menu, et le focus continue après le bouton', async () => {
    const user = userEvent.setup();
    const socket = new FakeSocket();
    socket.serverAccepts();
    arriveWith('available');
    render(
      <>
        <button type="button">avant</button>
        <StatusMenu socket={socket.asSocket()} />
        <button type="button">après</button>
      </>,
    );
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(trigger());
    await user.keyboard('{Enter}');
    await user.tab();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'après' }));
  });

  test('les flèches du menu ne font pas marcher l\'avatar : le menu les prend (preventDefault)', async () => {
    const user = userEvent.setup();
    const directions = new DirectionInput();
    const unbind = bindKeyboard(directions);
    try {
      renderMenu();
      await user.tab();
      await user.keyboard('{Enter}');
      // Touche gardée enfoncée (« > ») : sans le menu pour la prendre, l'avatar marcherait tant qu'elle l'est.
      await user.keyboard('{ArrowDown>}');
      expect(document.activeElement).toBe(item('busy'));
      expect(directions.current()).toBeNull();
      await user.keyboard('{/ArrowDown}{ArrowUp>}');
      expect(document.activeElement).toBe(item('available'));
      expect(directions.current()).toBeNull();
      await user.keyboard('{/ArrowUp}');
    } finally {
      unbind();
    }
  });
});

// Après un choix, le focus revient au bouton, dont le nom ne change qu'à la confirmation du serveur : un lecteur d'écran n'entendrait
// que l'ancien statut. Une zone vocale (aria-live) annonce le nouveau.
describe('annonce aux lecteurs d\'écran', () => {
  const live = (view: { container: HTMLElement }) => view.container.querySelector('[aria-live="polite"]') as HTMLElement;

  test('un changement de son statut, confirmé par le serveur, est annoncé', () => {
    const { view } = renderMenu({ status: 'available' });
    expect(live(view).textContent).toBe('');
    act(() => useOfficeStore.getState().setStatus('moi', 'busy'));
    expect(live(view).textContent).toBe('Statut : Occupé');
    act(() => useOfficeStore.getState().setStatus('moi', 'dnd'));
    expect(live(view).textContent).toBe('Statut : Ne pas déranger');
  });

  test('rien n\'est annoncé à l\'arrivée au bureau, ni pour le statut d\'un autre', () => {
    const socket = new FakeSocket();
    socket.serverAccepts();
    const view = render(<StatusMenu socket={socket.asSocket()} />);
    arriveWith('busy');
    expect(live(view).textContent).toBe('');
    act(() => {
      useOfficeStore.getState().upsertPlayer(player('autre'));
      useOfficeStore.getState().setStatus('autre', 'dnd');
    });
    expect(live(view).textContent).toBe('');
    // Une reconnexion qui redit le même statut non plus.
    arriveWith('busy');
    expect(live(view).textContent).toBe('');
  });

  test('la zone est hors de la vue, et se lit en entier', () => {
    const { view } = renderMenu();
    expect(live(view).classList.contains('visually-hidden')).toBe(true);
    expect(live(view).getAttribute('aria-atomic')).toBe('true');
  });
});

describe('fermeture', () => {
  test('un clic ailleurs ferme le menu', async () => {
    const user = userEvent.setup();
    const socket = renderMenu();
    await user.click(trigger());
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(socket.sent).toEqual([]);
  });

  test('un clic sur le bouton le referme', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(trigger());
    await user.click(trigger());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('un clic dans le menu, hors d\'un statut, ne le ferme pas', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(trigger());
    await user.click(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeTruthy();
  });
});

describe('quand on ne peut pas changer de statut', () => {
  test('sans socket (la page ne l\'a pas encore ouverte) : le bouton est inactif', () => {
    arriveWith('available');
    render(<StatusMenu socket={null} />);
    expect((trigger() as HTMLButtonElement).disabled).toBe(true);
  });

  test('avant l\'init du serveur (on ne sait pas encore son statut) : inactif, sans point', () => {
    const socket = new FakeSocket();
    socket.serverAccepts();
    render(<StatusMenu socket={socket.asSocket()} />);
    expect((trigger() as HTMLButtonElement).disabled).toBe(true);
    expect(trigger().getAttribute('aria-label')).toBe('Statut');
    expect(dotOf(trigger())).toBeNull();
  });

  test('connexion coupée : inactif (le message partirait, ou serait ignoré à la reconnexion) ; rétablie : actif', () => {
    const socket = renderMenu({ connected: false });
    expect((trigger() as HTMLButtonElement).disabled).toBe(true);
    act(() => socket.serverAccepts());
    expect((trigger() as HTMLButtonElement).disabled).toBe(false);
    act(() => socket.connectionDrops());
    expect((trigger() as HTMLButtonElement).disabled).toBe(true);
  });

  test('la connexion tombe menu ouvert : il se ferme, et rien n\'est envoyé', async () => {
    const user = userEvent.setup();
    const socket = renderMenu();
    await user.click(trigger());
    act(() => socket.connectionDrops());
    expect(screen.queryByRole('menu')).toBeNull();
    expect(socket.sent).toEqual([]);
  });
});
