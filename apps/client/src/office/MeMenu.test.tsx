import { CURRENT_RELEASE, STATUSES, TREADMILL_ID, type ActivityState, type OfficeMap, type PlacedItem, type PublicPlayer, type Status } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { bindKeyboard, DirectionInput } from '../game/input';
import { fr, t } from '../i18n/fr';
import * as activityApi from '../lib/activity-api';
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
  vi.clearAllMocks();
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
const manage = () => entry(fr.modes.create);
const pencil = (label: string) => entry(t(fr.modes.edit, { label }));
const dotOf = (element: HTMLElement) => element.querySelector('[data-status]');
const group = (name: string) => screen.getByRole('group', { name });
// Les lignes qu'on choisit dans cette zone (statuts, modes, leurs crayons et autres), dans l'ordre de la page, par leur nom.
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
    // La pastille du portrait prend aussi la couleur du mode (comme le point au-dessus de l'avatar) ; le statut ordinaire reste dit par data-status.
    const dot = trigger().querySelector('.portrait-dot') as HTMLElement;
    expect(dot.style.backgroundColor).toMatch(PURPLE);
    expect(dot.getAttribute('data-activity')).toBe('s1');
    expect(dot.getAttribute('data-status')).toBe('busy');
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

  test('le menu a, dans l\'ordre, l\'apparence, le nom, une seule liste (Disponible, puis les modes, chacun suivi de son crayon, puis « Nouveau mode »), le fuseau horaire et la déconnexion', async () => {
    const user = userEvent.setup();
    renderChip({ states: [focus, lunch] });
    await user.click(trigger());
    expect(linesOf(screen.getByRole('menu'))).toEqual([
      'Changer d\'apparence',
      'Changer de nom',
      'Disponible',
      'En focus',
      t(fr.modes.edit, { label: 'En focus' }),
      'À table',
      t(fr.modes.edit, { label: 'À table' }),
      fr.modes.create,
      expect.stringMatching(/^Fuseau horaire : Paris, \d\d:\d\d$/),
      t(fr.whatsNew.menuItemLabel, { version: CURRENT_RELEASE }),
      'Se déconnecter',
    ]);
    // Une seule section : plus de « Statut » à part, ni de « Mes modes ».
    expect(screen.getAllByRole('group').map((section) => section.getAttribute('aria-labelledby') && document.getElementById(section.getAttribute('aria-labelledby')!)?.textContent)).toEqual([fr.me.mode]);
  });
});

describe('Disponible, en tête de la liste', () => {
  // Un statut laissé par une version d'avant (Ne pas déranger) : Disponible le quitte.
  test('« Disponible » envoie status:set available, et rien d\'autre', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ status: 'dnd' });
    await user.click(trigger());
    await user.click(item('available'));
    expect(socket.sent).toEqual([['status:set', 'available']]);
  });

  test('Occupé, Absent et Ne pas déranger ne se choisissent plus dans la liste', async () => {
    const user = userEvent.setup();
    renderChip({ status: 'available' });
    await user.click(trigger());
    for (const status of ['busy', 'away', 'dnd'] as const) expect(screen.queryByRole('menuitemradio', { name: fr.status[status] })).toBeNull();
  });

  test('Disponible d\'abord, avec son libellé écrit et sans crayon ; avec un statut d\'avant (Absent), il n\'est pas coché', async () => {
    const user = userEvent.setup();
    renderChip({ status: 'away' });
    await user.click(trigger());
    const first = within(group(fr.me.mode)).getAllByRole('menuitemradio')[0]!;
    expect(first.getAttribute('aria-label')).toBe('Disponible');
    expect(first.textContent).toBe('Disponible');
    expect(first.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('menuitem', { name: t(fr.modes.edit, { label: 'Disponible' }) })).toBeNull();
  });

  test('le point de Disponible a la couleur du statut', async () => {
    const user = userEvent.setup();
    renderChip({ status: 'available' });
    await user.click(trigger());
    const dot = dotOf(item('available')) as HTMLElement;
    expect(dot.getAttribute('data-status')).toBe('available');
    expect(dot.style.backgroundColor).toBe(statusCssColor('available'));
  });

  test('choisir le statut en cours n\'envoie rien, et ferme le menu', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ status: 'available' });
    await user.click(trigger());
    await user.click(item('available'));
    expect(socket.sent).toEqual([]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // La connexion le redit au serveur après chaque init qui ne le dit pas (un serveur redémarré l'a oublié) : office-connection.ts.
  test('le statut choisi est retenu au magasin (chosenStatus), même s\'il est déjà celui en cours', async () => {
    const user = userEvent.setup();
    renderChip({ status: 'busy' });
    expect(useOfficeStore.getState().chosenStatus).toBeNull();
    await user.click(trigger());
    await user.click(item('available'));
    expect(useOfficeStore.getState().chosenStatus).toBe('available');
    act(() => useOfficeStore.getState().setStatus('moi', 'available'));
    act(() => useOfficeStore.getState().setChosenStatus(null));
    await user.click(trigger());
    await user.click(item('available'));
    expect(useOfficeStore.getState().chosenStatus).toBe('available');
  });

  test('le statut change quand le serveur le confirme, pas avant', async () => {
    const user = userEvent.setup();
    renderChip({ status: 'away' });
    await user.click(trigger());
    await user.click(item('available'));
    expect(trigger().querySelector('.me-mode')?.textContent).toBe('Absent');
    act(() => useOfficeStore.getState().setStatus('moi', 'available'));
    expect(trigger().querySelector('.me-mode')?.textContent).toBe('Disponible');
  });

  test('choisir ferme le menu et rend le focus à la puce', async () => {
    const user = userEvent.setup();
    renderChip({ status: 'away' });
    await user.click(trigger());
    await user.click(item('available'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});

describe('les modes, dans la même liste', () => {
  test('sans mode : Disponible coché, puis « Nouveau mode » ; ses modes (ceux par défaut compris) viennent entre les deux, chacun avec le point de sa couleur', async () => {
    const user = userEvent.setup();
    const { view } = renderChip();
    await user.click(trigger());
    expect(linesOf(group(fr.me.mode))).toEqual(['Disponible', fr.modes.create]);
    expect(item('available').getAttribute('aria-checked')).toBe('true');
    view.unmount();

    renderChip({ states: [focus, lunch] });
    await user.click(trigger());
    expect((mode('En focus').querySelector('.status-dot') as HTMLElement).style.backgroundColor).toMatch(PURPLE);
    expect(mode('En focus').getAttribute('aria-checked')).toBe('false');
  });

  test('un mode qui conduit quelque part dit la pièce, à côté de son nom ; son nom accessible reste le sien', async () => {
    const user = userEvent.setup();
    const sport: ActivityState = { id: 's3', label: 'Sport', color: '#f97316', icon: 'dumbbell', allowEntry: true, hear: false, heard: false, place: 'gym' };
    renderChip({ states: [sport] });
    // Une carte réduite à ce que la liste lit : ses pièces.
    act(() => useOfficeStore.getState().setOfficeMap({ places: [{ key: 'gym', label: 'Salle de sport', destination: true }] } as unknown as OfficeMap));
    await user.click(trigger());
    expect(mode('Sport').querySelector('.mode-place')?.textContent).toBe('Salle de sport');
    expect(screen.getByRole('menuitemradio', { name: 'Sport' })).toBe(mode('Sport'));
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

  test('le mode en cours : seul coché (aucun statut ne l\'est), et jamais renvoyé', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ activity: focus, states: [focus, lunch] });
    await user.click(trigger());
    expect(mode('En focus').getAttribute('aria-checked')).toBe('true');
    expect(within(group(fr.me.mode)).getAllByRole('menuitemradio', { checked: true })).toEqual([mode('En focus')]);
    await user.click(mode('En focus'));
    expect(socket.sentOf('state:set')).toEqual([]);
  });

  test('Disponible pendant un mode le quitte : status:set, même si c\'est déjà le statut (le serveur efface le mode), et le choix de l\'onglet l\'oublie', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ activity: focus, states: [focus] });
    useOfficeStore.getState().setChosenActivity('s1');
    await user.click(trigger());
    await user.click(item('available'));
    expect(socket.sentOf('status:set')).toEqual(['available']);
    expect(socket.sentOf('state:set')).toEqual([]);
    expect(useOfficeStore.getState().chosenActivityId).toBeNull();
    expect(useOfficeStore.getState().chosenStatus).toBe('available');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// Le mode Sport sur son tapis de course : sous un mode qui conduit à la salle de sport, la ligne « Mon tapis de course », quand sa propre pièce en a un.
describe('le tapis de course', () => {
  const sport: ActivityState = { id: 's3', label: 'Sport', color: '#f97316', icon: 'dumbbell', allowEntry: true, hear: false, heard: false, place: 'gym' };
  const tapis = { desk: 'A1', x: 1, y: 2 };
  const onTreadmill = () => screen.getByRole('menuitemradio', { name: 'Sport sur mon tapis de course' });
  // La carte réduite à ce que la liste lit (ses pièces), et la place A1 (à soi par défaut), avec ce qu'on y a posé.
  function setScene(items: PlacedItem[], ownerId = 'moi') {
    act(() => {
      useOfficeStore.getState().setOfficeMap({ places: [{ key: 'gym', label: 'Salle de sport', destination: true }] } as unknown as OfficeMap);
      useOfficeStore.getState().setDesk({ key: 'A1', ownerId, ownerName: ownerId.toUpperCase(), name: null, locked: false, closedByState: false, floor: 'parquet-clair', wall: 'creme', items });
    });
  }

  test('sa pièce a un tapis de course : sous « Sport », la ligne « Mon tapis de course » ; « Sport » garde son nom et dit la salle de sport', async () => {
    const user = userEvent.setup();
    renderChip({ states: [sport, focus] });
    setScene([{ id: 'of-6-10', x: 0, y: 0 }, { id: TREADMILL_ID, x: 1, y: 2 }]);
    await user.click(trigger());
    expect(linesOf(group(fr.me.mode))).toEqual([
      'Disponible',
      'Sport',
      t(fr.modes.edit, { label: 'Sport' }),
      'Sport sur mon tapis de course',
      'En focus',
      t(fr.modes.edit, { label: 'En focus' }),
      fr.modes.create,
    ]);
    expect(onTreadmill().textContent).toBe('Mon tapis de course');
    expect(onTreadmill().getAttribute('aria-checked')).toBe('false');
    expect(mode('Sport').querySelector('.mode-place')?.textContent).toBe('Salle de sport');
  });

  test('sans tapis de course dans sa pièce, ou avec un tapis dans la pièce d\'un autre : rien ne change', async () => {
    const user = userEvent.setup();
    const { view } = renderChip({ states: [sport] });
    setScene([{ id: 'of-6-10', x: 0, y: 0 }]);
    await user.click(trigger());
    expect(linesOf(group(fr.me.mode))).toEqual(['Disponible', 'Sport', t(fr.modes.edit, { label: 'Sport' }), fr.modes.create]);
    view.unmount();

    renderChip({ states: [sport] });
    setScene([{ id: TREADMILL_ID, x: 1, y: 2 }], 'autre');
    await user.click(trigger());
    expect(screen.queryByRole('menuitemradio', { name: 'Sport sur mon tapis de course' })).toBeNull();
  });

  test('« Mon tapis de course » : state:set avec le tapis, retenu comme choix de l\'onglet ; le menu se ferme', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ states: [sport] });
    setScene([{ id: TREADMILL_ID, x: 1, y: 2 }]);
    useOfficeStore.getState().setChosenStatus('available');
    await user.click(trigger());
    await user.click(onTreadmill());
    expect(socket.sentOf('state:set')).toEqual([{ id: 's3', treadmill: true }]);
    expect(useOfficeStore.getState()).toMatchObject({ chosenActivityId: 's3', chosenTreadmill: true, chosenStatus: null });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  test('elle y court (le serveur le dit) : la ligne du tapis est seule cochée, et prend le focus ; la reprendre n\'envoie rien, « Sport » l\'envoie à la salle de sport', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ activity: sport, states: [sport] });
    setScene([{ id: TREADMILL_ID, x: 1, y: 2 }]);
    act(() => useOfficeStore.getState().setTreadmill('moi', tapis));
    await user.click(trigger());
    expect(within(group(fr.me.mode)).getAllByRole('menuitemradio', { checked: true })).toEqual([onTreadmill()]);
    expect(document.activeElement).toBe(onTreadmill());
    await user.click(onTreadmill());
    expect(socket.sentOf('state:set')).toEqual([]);

    await user.click(trigger());
    await user.click(mode('Sport'));
    expect(socket.sentOf('state:set')).toEqual(['s3']);
    expect(useOfficeStore.getState()).toMatchObject({ chosenActivityId: 's3', chosenTreadmill: false });
  });

  test('à la salle de sport, ou descendue de son tapis (le mode reste) : « Sport » est coché ; « Mon tapis de course » l\'y remet', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ activity: sport, states: [sport] });
    setScene([{ id: TREADMILL_ID, x: 1, y: 2 }]);
    await user.click(trigger());
    expect(within(group(fr.me.mode)).getAllByRole('menuitemradio', { checked: true })).toEqual([mode('Sport')]);
    await user.click(onTreadmill());
    expect(socket.sentOf('state:set')).toEqual([{ id: 's3', treadmill: true }]);
  });
});

// L'éditeur d'un mode : dans le menu même, à la place de la liste (aucun panneau à droite). Les requêtes sont celles de lib/activity-api, ici simulées.
describe('l\'éditeur d\'un mode', () => {
  test('le crayon ouvre l\'éditeur du mode, rempli : le menu devient une petite fenêtre, le focus va au nom ; « Revenir » rend la liste, le focus sur le mode', async () => {
    const user = userEvent.setup();
    renderChip({ states: [focus, lunch] });
    await user.click(trigger());
    await user.click(pencil('À table'));
    const dialog = screen.getByRole('dialog', { name: fr.modes.titleEdit });
    expect(screen.queryByRole('menu')).toBeNull();
    const name = within(dialog).getByRole('textbox', { name: fr.modes.label }) as HTMLInputElement;
    expect(name.value).toBe('À table');
    expect(document.activeElement).toBe(name);
    expect((within(dialog).getByRole('switch', { name: fr.modes.allowEntry }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByRole('switch', { name: fr.modes.hear }) as HTMLInputElement).checked).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: fr.modes.back }));
    expect(screen.getByRole('menu', { name: fr.me.menu })).toBeTruthy();
    expect(document.activeElement).toBe(mode('À table'));
  });

  test('Échap dans l\'éditeur revient à la liste, sans fermer le menu ; refermé, le menu rouvre sur la liste', async () => {
    const user = userEvent.setup();
    renderChip({ states: [focus] });
    await user.click(trigger());
    await user.click(manage());
    expect(screen.getByRole('dialog', { name: fr.modes.titleCreate })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('menu', { name: fr.me.menu })).toBeTruthy();
    expect(document.activeElement).toBe(manage());
    await user.click(manage());
    await user.click(document.body);
    await user.click(trigger());
    expect(screen.getByRole('menu', { name: fr.me.menu })).toBeTruthy();
  });

  test('créer : le nom, une icône, une couleur ; « Créer » l\'envoie, le range au magasin, et la liste revient avec lui, focus dessus', async () => {
    const user = userEvent.setup();
    const created: ActivityState = { id: 's9', label: 'Pause', color: '#0d9488', icon: 'coffee', allowEntry: true, hear: true, heard: true };
    vi.mocked(activityApi.createActivityState).mockResolvedValueOnce(created);
    renderChip();
    await user.click(trigger());
    await user.click(manage());
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: fr.modes.submitCreate }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(within(dialog).getByRole('textbox', { name: fr.modes.label }), '  Pause ');
    await user.click(within(dialog).getByRole('button', { name: fr.states.icons.coffee }));
    await user.click(within(dialog).getByRole('button', { name: t(fr.modes.colorPick, { color: '#0d9488' }) }));
    await user.click(submit);
    expect(activityApi.createActivityState).toHaveBeenCalledExactlyOnceWith({ label: 'Pause', color: '#0d9488', icon: 'coffee', allowEntry: true, hear: true, heard: true });
    expect(useOfficeStore.getState().myStates).toEqual([created]);
    expect(document.activeElement).toBe(mode('Pause'));
  });

  test('modifier : « Enregistrer » remplace le mode ; choisir de nouveau son icône la retire', async () => {
    const user = userEvent.setup();
    const withIcon: ActivityState = { ...focus, icon: 'headphones' };
    vi.mocked(activityApi.updateActivityState).mockImplementationOnce(async (id, input) => ({ id, ...input }));
    renderChip({ states: [withIcon] });
    await user.click(trigger());
    await user.click(pencil('En focus'));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: fr.states.icons.headphones }));
    await user.click(within(dialog).getByRole('switch', { name: fr.modes.heard }));
    await user.click(within(dialog).getByRole('button', { name: fr.modes.submitSave }));
    expect(activityApi.updateActivityState).toHaveBeenCalledExactlyOnceWith('s1', { label: 'En focus', color: '#6d28d9', allowEntry: false, hear: true, heard: true });
    expect(useOfficeStore.getState().myStates[0]).toEqual({ id: 's1', label: 'En focus', color: '#6d28d9', allowEntry: false, hear: true, heard: true });
  });

  test('supprimer : la corbeille demande une confirmation sur place ; « Garder » n\'envoie rien, « Oui, supprimer » le supprime, et la liste revient sans lui', async () => {
    const user = userEvent.setup();
    vi.mocked(activityApi.deleteActivityState).mockResolvedValueOnce(undefined);
    renderChip({ states: [focus, lunch] });
    await user.click(trigger());
    await user.click(pencil('En focus'));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: fr.modes.remove }));
    expect(within(dialog).getByText(t(fr.modes.removeConfirm, { label: 'En focus' }))).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: fr.modes.removeKeep }));
    await user.click(within(dialog).getByRole('button', { name: fr.modes.removeKeep }));
    expect(activityApi.deleteActivityState).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: fr.modes.remove }));
    await user.click(within(dialog).getByRole('button', { name: fr.modes.remove }));
    await user.click(within(dialog).getByRole('button', { name: fr.modes.removeYes }));
    expect(activityApi.deleteActivityState).toHaveBeenCalledExactlyOnceWith('s1');
    expect(useOfficeStore.getState().myStates).toEqual([lunch]);
    expect(screen.queryByRole('menuitemradio', { name: 'En focus' })).toBeNull();
  });

  test('un nouveau mode n\'a pas de corbeille ; un échec de l\'API se dit, et l\'éditeur reste ouvert', async () => {
    const user = userEvent.setup();
    vi.mocked(activityApi.createActivityState).mockRejectedValueOnce(new Error('réseau'));
    renderChip();
    await user.click(trigger());
    await user.click(manage());
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: fr.modes.remove })).toBeNull();
    await user.type(within(dialog).getByRole('textbox', { name: fr.modes.label }), 'Pause');
    await user.click(within(dialog).getByRole('button', { name: fr.modes.submitCreate }));
    expect(within(dialog).getByRole('alert').textContent).toBe(fr.states.errors.generic);
    expect(screen.getByRole('dialog')).toBe(dialog);
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
    renderChip({ status: 'available' });
    await user.tab();
    expect(document.activeElement).toBe(trigger());
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(item('available'));
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
      renderChip({ status: 'busy' });
      await user.click(trigger());
      await user.click(item('available'));
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
    renderChip({ status: 'available', states: [focus] });
    await user.tab();
    await user.keyboard('{Enter}');
    // Après Disponible : chaque mode, puis son crayon, « Nouveau mode », puis les lignes du bas.
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(mode('En focus'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(pencil('En focus'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(manage());
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(item('available'));
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

  test('→ et ← passent aussi d\'une ligne à la voisine', async () => {
    const user = userEvent.setup();
    renderChip({ status: 'available' });
    await user.tab();
    await user.keyboard('{Enter}{ArrowRight}');
    expect(document.activeElement).toBe(manage());
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(document.activeElement).toBe(entry(fr.me.rename));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(entry(fr.character.toggle));
  });

  test('les lignes inactives sont sautées', async () => {
    const user = userEvent.setup();
    // Le serveur n'a pas encore dit qui est là : l'apparence attend (panels.ready), et les statuts aussi. Restent « Nouveautés » (les notes sont dans
    // l'appli, sans le serveur) et « Se déconnecter » : le focus va à la première, et les flèches ne passent que de l'une à l'autre.
    const socket = new FakeSocket();
    socket.serverAccepts();
    render(<MeChip name="Léa" email="lea@exemple.fr" socket={socket.asSocket()} panels={fakePanels({ ready: false })} onSignOut={() => {}} signingOut={false} />);
    await user.tab();
    await user.keyboard('{Enter}');
    const whatsNew = entry(t(fr.whatsNew.menuItemLabel, { version: CURRENT_RELEASE }));
    expect(document.activeElement).toBe(whatsNew);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(entry(fr.office.signOut));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(whatsNew);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(entry(fr.office.signOut));
    expect(whatsNew.disabled).toBe(false);
  });

  test('Entrée sur Disponible le choisit', async () => {
    const user = userEvent.setup();
    const socket = renderChip({ status: 'away' });
    await user.tab();
    await user.keyboard('{Enter}{Home}{ArrowDown}{ArrowDown}{Enter}');
    expect(socket.sentOf('status:set')).toEqual(['available']);
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
      expect(document.activeElement).toBe(manage());
      expect(directions.current()).toBeNull();
      await user.keyboard('{/ArrowDown}{ArrowUp>}');
      expect(document.activeElement).toBe(item('available'));
      expect(directions.current()).toBeNull();
      await user.keyboard('{/ArrowUp}{ArrowRight>}');
      expect(document.activeElement).toBe(manage());
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
    expect((item('available') as HTMLButtonElement).disabled).toBe(true);
    expect(manage().disabled).toBe(true);
    expect(entry(fr.office.signOut).disabled).toBe(false);
  });

  test('avant l\'init du serveur (on ne sait pas encore son statut) : inactif, sauf la déconnexion', async () => {
    const user = userEvent.setup();
    const socket = new FakeSocket();
    socket.serverAccepts();
    render(<MeChip name="Léa" email="lea@exemple.fr" socket={socket.asSocket()} panels={fakePanels({ ready: false })} onSignOut={() => {}} signingOut={false} />);
    await user.click(trigger());
    expect((item('available') as HTMLButtonElement).disabled).toBe(true);
    expect(manage().disabled).toBe(true);
    expect(entry(fr.character.toggle).disabled).toBe(true);
    expect(entry(fr.office.signOut).disabled).toBe(false);
    // Aucun statut n'est coché : on ne sait pas lequel est le sien.
    expect(within(group(fr.me.mode)).queryByRole('menuitemradio', { checked: true })).toBeNull();
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
    expect((item('available') as HTMLButtonElement).disabled).toBe(false);
    act(() => useOfficeStore.getState().setReady(false));
    expect((item('available') as HTMLButtonElement).disabled).toBe(true);
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
    expect((item('available') as HTMLButtonElement).disabled).toBe(true);
    arriveWith('available');
    expect((item('available') as HTMLButtonElement).disabled).toBe(false);
  });

  test('la connexion tombe menu ouvert : il reste ouvert (on peut se déconnecter), le focus passe à une ligne qui marche, et rien n\'est envoyé', async () => {
    const user = userEvent.setup();
    const socket = renderChip();
    await user.click(trigger());
    expect(document.activeElement).toBe(item('available'));
    act(() => useOfficeStore.getState().setReady(false));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement).toBe(entry(fr.character.toggle));
    await user.click(item('available'));
    expect(socket.sent).toEqual([]);
    expect(entry(fr.office.signOut).disabled).toBe(false);
  });
});
