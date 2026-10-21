import { STATUSES, type ActivityState, type PublicPlayer, type Status } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { bindKeyboard, DirectionInput } from '../game/input';
import { fr } from '../i18n/fr';
import { statusCssColor } from '../lib/status';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { MeChip } from './MeChip';
import type { PanelControls } from './panels';

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

// #6d28d9, écrit en hexadécimal ou en rgb() selon le moteur.
const PURPLE = /^(#6d28d9|rgb\(109, 40, 217\))$/i;
const focus: ActivityState = { id: 's1', label: 'En focus', color: '#6d28d9', allowEntry: false, hear: true, heard: false };
const lunch: ActivityState = { id: 's2', label: 'À table', color: '#f59e0b', allowEntry: true, hear: false, heard: false };

beforeEach(() => {
  useOfficeStore.getState().reset();
});

// Le serveur a envoyé l'état de départ (self avec ce statut, et peut-être un état d'activité).
function arriveWith(status: Status, activity: ActivityState | null = null): void {
  act(() =>
    useOfficeStore.getState().applyInit({ self: { ...player('moi', status), activity }, players: [], mapKey: 'dev-office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }),
  );
}

function fakePanels(over: Partial<PanelControls> = {}): PanelControls {
  return { open: null, toggle: vi.fn(), show: vi.fn(), idOf: (id) => `panneau-${id}`, ready: true, unread: 0, admin: false, sim: false, ...over };
}

interface Options {
  status?: Status;
  activity?: ActivityState | null;
  states?: ActivityState[];
  panels?: PanelControls;
  signingOut?: boolean;
}

// La puce « Moi » avec une socket connectée, et le bureau prêt (l'init reçu : ready).
function renderChip({ status = 'available', activity = null, states = [], panels = fakePanels(), signingOut = false }: Options = {}) {
  const socket = new FakeSocket();
  socket.serverAccepts();
  arriveWith(status, activity);
  if (states.length > 0) act(() => useOfficeStore.getState().setMyStates(states));
  const onSignOut = vi.fn();
  const view = render(<MeChip name="Léa" email="lea@exemple.fr" socket={socket.asSocket()} panels={panels} onSignOut={onSignOut} signingOut={signingOut} />);
  return Object.assign(socket, { view, panels, onSignOut });
}

const trigger = () => screen.getByRole('button', { name: fr.me.chip });
const item = (status: Status) => screen.getByRole('menuitemradio', { name: fr.status[status] });
const mode = (label: string) => screen.getByRole('menuitemradio', { name: label });
const entry = (name: string) => screen.getByRole('menuitem', { name }) as HTMLButtonElement;
const manage = () => entry(fr.me.modeManage);
const dotOf = (element: HTMLElement) => element.querySelector('[data-status]');
const group = (name: string) => screen.getByRole('group', { name });
// Les lignes qu'on choisit dans cette zone (statuts, modes et autres), dans l'ordre de la page, par leur nom.
const linesOf = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')).map((line) => line.getAttribute('aria-label') ?? line.textContent);

describe('la puce', () => {
  test('c\'est un bouton de menu nommé « Mon profil » : fermé au départ, annoncé comme tel', () => {
    renderChip();
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().hasAttribute('aria-controls')).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('elle montre le nom, et dessous le statut en cours, d\'après le magasin ; elle le suit', () => {
    renderChip({ status: 'available' });
    expect(trigger().textContent).toContain('Léa');
    expect(trigger().querySelector('.me-mode')?.textContent).toBe('Disponible');

    act(() => useOfficeStore.getState().setStatus('moi', 'busy'));
    expect(trigger().querySelector('.me-mode')?.textContent).toBe('Occupé');
  });

  test('un lecteur d\'écran entend, avec « Mon profil », le nom et le statut', () => {
    renderChip({ status: 'dnd' });
    expect(screen.getByRole('button', { name: fr.me.chip, description: 'Léa Ne pas déranger' })).toBe(trigger());
  });

  test('un statut d\'un autre que soi ne change rien', () => {
    renderChip({ status: 'available' });
    act(() => {
      useOfficeStore.getState().upsertPlayer(player('autre'));
      useOfficeStore.getState().setStatus('autre', 'dnd');
    });
    expect(trigger().querySelector('.me-mode')?.textContent).toBe('Disponible');
  });

  test.each(STATUSES)('la pastille du portrait dit le statut « %s » (CSS : la couleur de l\'étiquette de l\'avatar)', (status) => {
    renderChip({ status });
    expect(trigger().querySelector('.portrait-dot')?.getAttribute('data-status')).toBe(status);
  });

  test('un mode en cours passe avant le statut : son nom et sa couleur', () => {
    renderChip({ status: 'busy', activity: focus });
    const line = trigger().querySelector('.me-mode') as HTMLElement;
    expect(line.textContent).toBe('En focus');
    expect((line.querySelector('.status-dot') as HTMLElement).style.backgroundColor).toMatch(PURPLE);
    // Le statut ordinaire, dessous, reste celui de la pastille du portrait.
    expect(trigger().querySelector('.portrait-dot')?.getAttribute('data-status')).toBe('busy');
    expect(trigger().textContent).not.toContain('Occupé');
  });

  test('sans mode, le statut s\'écrit sans point de couleur (la pastille du portrait le dit)', () => {
    renderChip({ status: 'away' });
    expect(trigger().querySelector('.me-mode .status-dot')).toBeNull();
  });

  test('avant l\'init du serveur : le nom de la session, ni statut ni pastille, et la puce marche (on doit pouvoir se déconnecter)', async () => {
    const user = userEvent.setup();
    const socket = new FakeSocket();
    socket.serverAccepts();
    const onSignOut = vi.fn();
    render(<MeChip name="Léa" email="lea@exemple.fr" socket={socket.asSocket()} panels={fakePanels({ ready: false })} onSignOut={onSignOut} signingOut={false} />);
    expect(trigger().querySelector('.me-name')?.textContent).toBe('Léa');
    expect(trigger().querySelector('.me-mode')).toBeNull();
    expect(trigger().querySelector('.portrait-dot')).toBeNull();
    expect((trigger() as HTMLButtonElement).disabled).toBe(false);
    await user.click(trigger());
    await user.click(entry(fr.office.signOut));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});

describe('le menu', () => {
  test('il s\'ouvre au clic, dit son nom, et la puce dit qu\'il est ouvert (aria-expanded, aria-controls)', async () => {
    const user = userEvent.setup();
    renderChip();
    await user.click(trigger());
    expect(screen.getByRole('menu', { name: fr.me.menu })).toBeTruthy();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(screen.getByRole('menu').id);
  });

  test('en tête : le nom et l\'e-mail du compte, et « Changer d\'apparence »', async () => {
    const user = userEvent.setup();
    renderChip();
    await user.click(trigger());
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Léa', { selector: '.me-id-name' })).toBeTruthy();
    expect(within(menu).getByText('lea@exemple.fr')).toBeTruthy();
    expect(entry(fr.character.toggle).textContent).toBe('Changer d\'apparence');
  });

  test('« Changer d\'apparence » ouvre le panneau du personnage, depuis la puce (qui reprend le focus à sa fermeture), et ferme le menu', async () => {
    const user = userEvent.setup();
    const { panels } = renderChip();
    await user.click(trigger());
    await user.click(entry(fr.character.toggle));
    expect(panels.show).toHaveBeenCalledExactlyOnceWith('character', trigger());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('« + » ouvre le panneau des états depuis la puce', async () => {
    const user = userEvent.setup();
    const { panels } = renderChip();
    await user.click(trigger());
    await user.click(entry(fr.me.modeManage));
    expect(panels.show).toHaveBeenCalledExactlyOnceWith('states', trigger());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('le menu ne parle que de soi : le bureau et la musique sont dans le dock du milieu, pas ici', async () => {
    const user = userEvent.setup();
    renderChip();
    await user.click(trigger());
    expect(screen.queryByRole('menuitem', { name: fr.desk.toggle })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: fr.desk.goto })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: fr.sound.toggle })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /musique|son/i })).toBeNull();
  });

  test('« Se déconnecter » appelle onSignOut et ferme le menu ; pendant la déconnexion : « Déconnexion… », inactif', async () => {
    const user = userEvent.setup();
    const { onSignOut, view } = renderChip();
    await user.click(trigger());
    await user.click(entry(fr.office.signOut));
    expect(onSignOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    view.unmount();

    renderChip({ signingOut: true });
    await user.click(trigger());
    expect(entry(fr.office.signingOut).disabled).toBe(true);
  });

  test('le menu a, dans l\'ordre, l\'apparence, les statuts, les modes et la déconnexion', async () => {
    const user = userEvent.setup();
    renderChip({ states: [focus, lunch] });
    await user.click(trigger());
    expect(linesOf(screen.getByRole('menu'))).toEqual([
      'Changer d\'apparence',
      'Disponible',
      'Occupé',
      'Absent',
      'Ne pas déranger',
      'En focus',
      'À table',
      'Aucun',
      fr.me.modeManage,
      'Se déconnecter',
    ]);
  });
});

describe('la section « Statut »', () => {
  test('« Ne pas déranger » envoie status:set dnd', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ status: 'available' });
    await user.click(trigger());
    await user.click(screen.getByRole('menuitemradio', { name: 'Ne pas déranger' }));
    expect(socket.sentOf('status:set')).toEqual(['dnd']);
  });

  test.each(STATUSES)('choisir « %s » envoie ce statut, et rien d\'autre', async (status) => {
    const user = userEvent.setup();
    const from: Status = status === 'available' ? 'dnd' : 'available';
    const socket = renderChip({ status: from });
    await user.click(trigger());
    await user.click(item(status));
    expect(socket.sent).toEqual([['status:set', status]]);
  });

  test('les quatre statuts dans l\'ordre de la spec, avec leurs libellés français, et celui en cours est coché et nommé à droite du titre', async () => {
    const user = userEvent.setup();
    renderChip({ status: 'away' });
    await user.click(trigger());
    const tiles = within(group(fr.me.status)).getAllByRole('menuitemradio');
    expect(tiles.map((tile) => tile.getAttribute('aria-label'))).toEqual(['Disponible', 'Occupé', 'Absent', 'Ne pas déranger']);
    expect(tiles.map((tile) => tile.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false']);
    expect(within(group(fr.me.status)).getByText('Absent', { selector: 'em' })).toBeTruthy();
    // Chaque tuile a aussi son nom en infobulle : elle n'a que son point à montrer.
    expect(tiles.map((tile) => tile.getAttribute('title'))).toEqual(['Disponible', 'Occupé', 'Absent', 'Ne pas déranger']);
  });

  test.each(STATUSES)('le point de « %s » a la couleur du statut', async (status) => {
    const user = userEvent.setup();
    renderChip({ status: 'available' });
    await user.click(trigger());
    const dot = dotOf(item(status)) as HTMLElement;
    expect(dot.getAttribute('data-status')).toBe(status);
    expect(dot.style.backgroundColor).toBe(statusCssColor(status));
  });

  test('choisir le statut en cours n\'envoie rien, et ferme le menu', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ status: 'busy' });
    await user.click(trigger());
    await user.click(item('busy'));
    expect(socket.sent).toEqual([]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // La connexion le redit au serveur après chaque init qui ne le dit pas (un serveur redémarré l'a oublié) : office-connection.ts.
  test('le statut choisi est retenu au magasin (chosenStatus), même s\'il est déjà celui en cours', async () => {
    const user = userEvent.setup();
    renderChip({ status: 'available' });
    expect(useOfficeStore.getState().chosenStatus).toBeNull();
    await user.click(trigger());
    await user.click(item('dnd'));
    expect(useOfficeStore.getState().chosenStatus).toBe('dnd');
    act(() => useOfficeStore.getState().setStatus('moi', 'dnd'));
    act(() => useOfficeStore.getState().setChosenStatus(null));
    await user.click(trigger());
    await user.click(item('dnd'));
    expect(useOfficeStore.getState().chosenStatus).toBe('dnd');
  });

  test('le statut change quand le serveur le confirme, pas avant', async () => {
    const user = userEvent.setup();
    renderChip({ status: 'available' });
    await user.click(trigger());
    await user.click(item('dnd'));
    expect(trigger().querySelector('.me-mode')?.textContent).toBe('Disponible');
    act(() => useOfficeStore.getState().setStatus('moi', 'dnd'));
    expect(trigger().querySelector('.me-mode')?.textContent).toBe('Ne pas déranger');
  });

  test('choisir ferme le menu et rend le focus à la puce', async () => {
    const user = userEvent.setup();
    renderChip();
    await user.click(trigger());
    await user.click(item('away'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});

describe('la section « Mode »', () => {
  test('sans état : « Aucun », coché, et « + » ; avec des états : les siens d\'abord, chacun avec le point de sa couleur', async () => {
    const user = userEvent.setup();
    const { view } = renderChip();
    await user.click(trigger());
    expect(linesOf(group(fr.me.mode))).toEqual(['Aucun', fr.me.modeManage]);
    expect(mode('Aucun').getAttribute('aria-checked')).toBe('true');
    view.unmount();

    renderChip({ states: [focus, lunch] });
    await user.click(trigger());
    expect(linesOf(group(fr.me.mode))).toEqual(['En focus', 'À table', 'Aucun', fr.me.modeManage]);
    expect((mode('En focus').querySelector('.status-dot') as HTMLElement).style.backgroundColor).toMatch(PURPLE);
    expect(mode('En focus').getAttribute('aria-checked')).toBe('false');
  });

  test('« + » est nommé, et a la même infobulle (il n\'a que son signe à montrer)', async () => {
    const user = userEvent.setup();
    renderChip();
    await user.click(trigger());
    expect(manage().getAttribute('title')).toBe(fr.me.modeManage);
    expect(manage().textContent).toBe('');
  });

  test('prendre un mode : state:set, retenu comme choix de l\'onglet, le statut choisi oublié', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ states: [focus, lunch] });
    useOfficeStore.getState().setChosenStatus('busy');
    await user.click(trigger());
    await user.click(mode('À table'));
    expect(socket.sentOf('state:set')).toEqual(['s2']);
    expect(socket.sentOf('status:set')).toEqual([]);
    expect(useOfficeStore.getState().chosenActivityId).toBe('s2');
    expect(useOfficeStore.getState().chosenStatus).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  test('le mode en cours : coché, jamais renvoyé ; aucun statut n\'est coché, ni nommé à côté du titre', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ activity: focus, states: [focus, lunch] });
    await user.click(trigger());
    expect(mode('En focus').getAttribute('aria-checked')).toBe('true');
    expect(mode('Aucun').getAttribute('aria-checked')).toBe('false');
    expect(item('available').getAttribute('aria-checked')).toBe('false');
    expect(group(fr.me.status).querySelector('em')).toBeNull();
    await user.click(mode('En focus'));
    expect(socket.sentOf('state:set')).toEqual([]);
  });

  test('un statut ordinaire pendant un mode : envoyé même si c\'est le même statut (le serveur efface le mode)', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ activity: focus, states: [focus] });
    useOfficeStore.getState().setChosenActivity('s1');
    await user.click(trigger());
    await user.click(item('available'));
    expect(socket.sentOf('status:set')).toEqual(['available']);
    expect(useOfficeStore.getState().chosenActivityId).toBeNull();
  });

  test('« Aucun » quitte le mode (state:set null) et rend le statut de dessous, retenu pour un serveur redémarré', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ status: 'busy', activity: focus, states: [focus] });
    useOfficeStore.getState().setChosenActivity('s1');
    await user.click(trigger());
    await user.click(mode('Aucun'));
    expect(socket.sentOf('state:set')).toEqual([null]);
    expect(socket.sentOf('status:set')).toEqual([]);
    expect(useOfficeStore.getState().chosenActivityId).toBeNull();
    expect(useOfficeStore.getState().chosenStatus).toBe('busy');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('« Aucun » sans mode en cours n\'envoie rien, et ferme le menu', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ states: [focus] });
    await user.click(trigger());
    await user.click(mode('Aucun'));
    expect(socket.sent).toEqual([]);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('les icônes des modes', () => {
  const withIcon: ActivityState = { ...focus, icon: 'headphones' };

  test('la puce montre l\'icône du mode en cours à la place de son point, avec son nom', () => {
    renderChip({ status: 'busy', activity: withIcon, states: [withIcon] });
    const line = trigger().querySelector('.me-mode') as HTMLElement;
    expect(line.querySelector('svg.lucide-headphones')).toBeTruthy();
    expect(line.querySelector('.status-dot')).toBeNull();
    expect(line.textContent).toBe('En focus');
  });

  test('les pastilles du menu : l\'icône du mode, sans point ; un mode sans icône garde le point de sa couleur', async () => {
    const user = userEvent.setup();
    renderChip({ states: [withIcon, lunch] });
    await user.click(trigger());
    expect(mode('En focus').querySelector('svg.lucide-headphones')).toBeTruthy();
    expect(mode('En focus').querySelector('.status-dot')).toBeNull();
    expect(mode('À table').querySelector('svg')).toBeNull();
    expect((mode('À table').querySelector('.status-dot') as HTMLElement).style.backgroundColor).toBeTruthy();
  });

  test('l\'icône est décorative : le nom d\'une pastille reste celui du mode', async () => {
    const user = userEvent.setup();
    renderChip({ states: [withIcon] });
    await user.click(trigger());
    expect(screen.getByRole('menuitemradio', { name: 'En focus' })).toBe(mode('En focus'));
  });
});

describe('au clavier', () => {
  test('Entrée ouvre le menu, le focus va au statut en cours', async () => {
    const user = userEvent.setup();
    renderChip({ status: 'busy' });
    await user.tab();
    expect(document.activeElement).toBe(trigger());
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(item('busy'));
  });

  test('Espace ouvre aussi le menu ; Échap le referme, et rend le focus à la puce', async () => {
    const user = userEvent.setup();
    const socket = renderChip();
    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement).toBe(item('available'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(socket.sent).toEqual([]);
  });

  test('à l\'ouverture, le focus va au mode en cours', async () => {
    const user = userEvent.setup();
    renderChip({ activity: lunch, states: [focus, lunch] });
    await user.click(trigger());
    expect(document.activeElement).toBe(mode('À table'));
  });

  // Le bouton garde le focus après un choix : si ↓ ou ↑ y rouvraient le menu, l'avatar ne pourrait plus repartir vers le bas ou le haut.
  test('↓ et ↑ sur la puce ne l\'ouvrent pas : ce sont les flèches de l\'avatar, qui repart', async () => {
    const user = userEvent.setup();
    const directions = new DirectionInput();
    const unbind = bindKeyboard(directions);
    try {
      renderChip();
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

  test('après un choix à la souris, la puce a le focus, et les flèches font marcher l\'avatar', async () => {
    const user = userEvent.setup();
    const directions = new DirectionInput();
    const unbind = bindKeyboard(directions);
    try {
      renderChip({ status: 'available' });
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

  test('↓ et ↑ passent d\'une ligne à l\'autre en boucle, Début et Fin vont aux extrémités', async () => {
    const user = userEvent.setup();
    renderChip({ status: 'available' });
    await user.tab();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(item('busy'));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(item('dnd'));
    // Après les statuts : « Aucun », puis « + », puis les lignes du bas.
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(mode('Aucun'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(manage());
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(item('dnd'));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(entry(fr.character.toggle));
    // ↑ de la première ligne : la dernière.
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(entry(fr.office.signOut));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(entry(fr.character.toggle));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(entry(fr.office.signOut));
  });

  test('→ et ← passent aussi d\'une tuile ou d\'une pastille à la voisine', async () => {
    const user = userEvent.setup();
    renderChip({ status: 'available' });
    await user.tab();
    await user.keyboard('{Enter}{ArrowRight}');
    expect(document.activeElement).toBe(item('busy'));
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(document.activeElement).toBe(entry(fr.character.toggle));
  });

  test('les lignes inactives sont sautées', async () => {
    const user = userEvent.setup();
    // Le serveur n'a pas encore dit qui est là : l'apparence attend (panels.ready), et les statuts aussi. Reste « Se déconnecter » : le focus y va,
    // et les flèches n'en bougent pas.
    const socket = new FakeSocket();
    socket.serverAccepts();
    render(<MeChip name="Léa" email="lea@exemple.fr" socket={socket.asSocket()} panels={fakePanels({ ready: false })} onSignOut={() => {}} signingOut={false} />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(entry(fr.office.signOut));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(entry(fr.office.signOut));
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(entry(fr.office.signOut));
  });

  test('Entrée sur un statut le choisit', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ status: 'available' });
    await user.tab();
    await user.keyboard('{Enter}{ArrowDown}{ArrowDown}{Enter}');
    expect(socket.sentOf('status:set')).toEqual(['away']);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  test('Échap ferme le menu sans rien envoyer, et rend le focus à la puce', async () => {
    const user = userEvent.setup();
    const socket = renderChip();
    await user.tab();
    await user.keyboard('{Enter}{ArrowDown}{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(socket.sent).toEqual([]);
  });

  test('Tab ferme le menu, et le focus continue après la puce', async () => {
    const user = userEvent.setup();
    const socket = new FakeSocket();
    socket.serverAccepts();
    arriveWith('available');
    render(
      <>
        <button type="button">avant</button>
        <MeChip name="Léa" email="lea@exemple.fr" socket={socket.asSocket()} panels={fakePanels()} onSignOut={() => {}} signingOut={false} />
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
      renderChip();
      await user.tab();
      await user.keyboard('{Enter}');
      // Touche gardée enfoncée (« > ») : sans le menu pour la prendre, l'avatar marcherait tant qu'elle l'est.
      await user.keyboard('{ArrowDown>}');
      expect(document.activeElement).toBe(item('busy'));
      expect(directions.current()).toBeNull();
      await user.keyboard('{/ArrowDown}{ArrowUp>}');
      expect(document.activeElement).toBe(item('available'));
      expect(directions.current()).toBeNull();
      await user.keyboard('{/ArrowUp}{ArrowRight>}');
      expect(document.activeElement).toBe(item('busy'));
      expect(directions.current()).toBeNull();
      await user.keyboard('{/ArrowRight}');
    } finally {
      unbind();
    }
  });
});

// Après un choix, le focus revient à la puce, dont la description ne change qu'à la confirmation du serveur : un lecteur d'écran n'entendrait
// que l'ancien statut. Une zone vocale (aria-live) annonce le nouveau.
describe('annonce aux lecteurs d\'écran', () => {
  const live = (view: { container: HTMLElement }) => view.container.querySelector('[aria-live="polite"]') as HTMLElement;

  test('un changement de son statut, confirmé par le serveur, est annoncé', () => {
    const { view } = renderChip({ status: 'available' });
    expect(live(view).textContent).toBe('');
    act(() => useOfficeStore.getState().setStatus('moi', 'busy'));
    expect(live(view).textContent).toBe('Statut : Occupé');
    act(() => useOfficeStore.getState().setStatus('moi', 'dnd'));
    expect(live(view).textContent).toBe('Statut : Ne pas déranger');
  });

  test('rien n\'est annoncé à l\'arrivée au bureau, ni pour le statut d\'un autre', () => {
    const socket = new FakeSocket();
    socket.serverAccepts();
    const view = render(<MeChip name="Léa" email="lea@exemple.fr" socket={socket.asSocket()} panels={fakePanels()} onSignOut={() => {}} signingOut={false} />);
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

  test('le changement d\'état d\'activité est annoncé aussi', () => {
    const { view } = renderChip({ states: [focus] });
    act(() => useOfficeStore.getState().setActivity('moi', focus));
    expect(live(view).textContent).toBe('Statut : En focus');
  });

  test('la zone est hors de la vue, et se lit en entier', () => {
    const { view } = renderChip();
    expect(live(view).classList.contains('visually-hidden')).toBe(true);
    expect(live(view).getAttribute('aria-atomic')).toBe('true');
  });
});

describe('fermeture', () => {
  test('un clic ailleurs ferme le menu', async () => {
    const user = userEvent.setup();
    const socket = renderChip();
    await user.click(trigger());
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(socket.sent).toEqual([]);
  });

  test('un clic sur la puce le referme', async () => {
    const user = userEvent.setup();
    renderChip();
    await user.click(trigger());
    await user.click(trigger());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('un clic dans le menu, hors d\'une ligne, ne le ferme pas', async () => {
    const user = userEvent.setup();
    renderChip();
    await user.click(trigger());
    await user.click(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeTruthy();
  });
});

describe('quand on ne peut pas changer de statut', () => {
  test('sans socket (la page ne l\'a pas encore ouverte) : statuts et modes inactifs, mais la puce et le menu marchent', async () => {
    const user = userEvent.setup();
    arriveWith('available');
    render(<MeChip name="Léa" email="lea@exemple.fr" socket={null} panels={fakePanels()} onSignOut={() => {}} signingOut={false} />);
    expect((trigger() as HTMLButtonElement).disabled).toBe(false);
    await user.click(trigger());
    expect((item('busy') as HTMLButtonElement).disabled).toBe(true);
    expect((mode('Aucun') as HTMLButtonElement).disabled).toBe(true);
    expect(manage().disabled).toBe(true);
    expect(entry(fr.office.signOut).disabled).toBe(false);
  });

  test('avant l\'init du serveur (on ne sait pas encore son statut) : inactif, sauf la déconnexion', async () => {
    const user = userEvent.setup();
    const socket = new FakeSocket();
    socket.serverAccepts();
    render(<MeChip name="Léa" email="lea@exemple.fr" socket={socket.asSocket()} panels={fakePanels({ ready: false })} onSignOut={() => {}} signingOut={false} />);
    await user.click(trigger());
    for (const status of STATUSES) expect((item(status) as HTMLButtonElement).disabled).toBe(true);
    expect((mode('Aucun') as HTMLButtonElement).disabled).toBe(true);
    expect(manage().disabled).toBe(true);
    expect(entry(fr.character.toggle).disabled).toBe(true);
    expect(entry(fr.office.signOut).disabled).toBe(false);
    // Aucun statut n'est coché : on ne sait pas lequel est le sien.
    expect(within(group(fr.me.status)).queryByRole('menuitemradio', { checked: true })).toBeNull();
  });

  test('l\'apparence attend aussi que la coque ait dit qui est là (panels.ready)', async () => {
    const user = userEvent.setup();
    renderChip({ panels: fakePanels({ ready: false }) });
    await user.click(trigger());
    expect(entry(fr.character.toggle).disabled).toBe(true);
    expect(entry(fr.office.signOut).disabled).toBe(false);
  });

  test('connexion coupée (le magasin n\'est plus « prêt ») : les statuts s\'éteignent', async () => {
    const user = userEvent.setup();
    renderChip();
    await user.click(trigger());
    expect((item('busy') as HTMLButtonElement).disabled).toBe(false);
    act(() => useOfficeStore.getState().setReady(false));
    expect((item('busy') as HTMLButtonElement).disabled).toBe(true);
  });

  // Le serveur n'écoute une socket revenue qu'après l'avoir replacée (son init) : avant, status:set serait ignoré.
  test('la socket reconnectée ne suffit pas : inactif jusqu\'au nouvel init', async () => {
    const user = userEvent.setup();
    const socket = renderChip();
    await user.click(trigger());
    act(() => {
      socket.connectionDrops();
      useOfficeStore.getState().setReady(false);
    });
    act(() => socket.serverAccepts());
    expect((item('busy') as HTMLButtonElement).disabled).toBe(true);
    arriveWith('available');
    expect((item('busy') as HTMLButtonElement).disabled).toBe(false);
  });

  test('la connexion tombe menu ouvert : il reste ouvert (on peut se déconnecter), le focus passe à une ligne qui marche, et rien n\'est envoyé', async () => {
    const user = userEvent.setup();
    const socket = renderChip();
    await user.click(trigger());
    expect(document.activeElement).toBe(item('available'));
    act(() => useOfficeStore.getState().setReady(false));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement).toBe(entry(fr.character.toggle));
    await user.click(item('busy'));
    expect(socket.sent).toEqual([]);
    expect(entry(fr.office.signOut).disabled).toBe(false);
  });
});
