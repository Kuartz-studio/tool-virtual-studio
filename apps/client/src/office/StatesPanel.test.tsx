import { ACTIVITY_ICONS, ACTIVITY_MAX_PER_USER, buildOfficeTiledMap, parseOfficeMap, type ActivityInput, type ActivityState } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import * as activityApi from '../lib/activity-api';
import { ApiError } from '../lib/api';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { StatesPanel } from './StatesPanel';

const api = vi.mocked(activityApi);

const focus: ActivityState = { id: 's1', label: 'En focus', color: '#6d28d9', allowEntry: false, hear: true, heard: false };
const lunch: ActivityState = { id: 's2', label: 'À table', color: '#f59e0b', allowEntry: true, hear: false, heard: false };

beforeEach(() => {
  useOfficeStore.getState().reset();
  api.createActivityState.mockReset();
  api.updateActivityState.mockReset();
  api.deleteActivityState.mockReset();
});

function setup(states: ActivityState[] = [], current: ActivityState | null = null) {
  const socket = new FakeSocket();
  socket.serverAccepts();
  act(() => {
    useOfficeStore.getState().applyInit({
      self: { id: 'moi', name: 'Léa', avatarKey: null, x: 0, y: 0, dir: 'down', moving: false, status: 'available', media: { mic: false, cam: false, screen: false }, activity: current },
      players: [],
      mapKey: 'office',
      chatHistory: [],
      desks: [],
      closedDesks: [],
      deskBans: [],
    });
    useOfficeStore.getState().setMyStates(states);
  });
  let closed = 0;
  render(<StatesPanel socket={socket.asSocket()} onClose={() => closed++} />);
  return { socket, closed: () => closed };
}

const labelInput = () => screen.getByLabelText(fr.states.label) as HTMLInputElement;
const switchOf = (name: string) => screen.getByRole('switch', { name }) as HTMLInputElement;
// La grille des icônes du formulaire, et l'une de ses icônes par son nom français.
const iconGrid = () => screen.getByRole('group', { name: fr.states.icon });
const iconButton = (name: string) => within(iconGrid()).getByRole('button', { name }) as HTMLButtonElement;

describe('la liste', () => {
  test('sans état : on le dit ; avec, chacun a son nom, un résumé de ce qu\'il change et ses trois boutons', () => {
    setup([]);
    expect(screen.getByText(fr.states.empty)).toBeTruthy();
    useOfficeStore.getState().setMyStates([]);
  });

  test('ce que chaque état change, en résumé', () => {
    setup([focus, lunch]);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('En focus')).toBeTruthy();
    expect(within(rows[0]!).getByText('porte fermée · entend · pas entendu')).toBeTruthy();
    expect(within(rows[1]!).getByText('porte ouverte · n\'entend pas · pas entendu')).toBeTruthy();
    for (const label of ['En focus', 'À table']) {
      expect(screen.getByRole('button', { name: t(fr.states.takeLabel, { label }) })).toBeTruthy();
      expect(screen.getByRole('button', { name: t(fr.states.editLabel, { label }) })).toBeTruthy();
      expect(screen.getByRole('button', { name: t(fr.states.removeLabel, { label }) })).toBeTruthy();
    }
  });

  test('chaque état montre son icône à la place de son point ; sans icône, le point de sa couleur', () => {
    setup([{ ...focus, icon: 'headphones' }, lunch]);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]!.querySelector('svg.lucide-headphones')).toBeTruthy();
    expect(rows[0]!.querySelector('.status-dot')).toBeNull();
    expect(rows[1]!.querySelector('svg')).toBeNull();
    expect((rows[1]!.querySelector('.status-dot') as HTMLElement).style.backgroundColor).toMatch(/^(#f59e0b|rgb\(245, 158, 11\))$/i);
  });

  test('« Prendre » envoie state:set, retient le choix, et oublie le statut choisi ; l\'état en cours n\'a plus de bouton Prendre', async () => {
    const user = userEvent.setup();
    const { socket } = setup([focus, lunch], lunch);
    useOfficeStore.getState().setChosenStatus('busy');
    expect(screen.queryByRole('button', { name: t(fr.states.takeLabel, { label: 'À table' }) })).toBeNull();
    expect(screen.getByText(fr.states.current)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: t(fr.states.takeLabel, { label: 'En focus' }) }));
    expect(socket.sentOf('state:set')).toEqual(['s1']);
    expect(useOfficeStore.getState().chosenActivityId).toBe('s1');
    expect(useOfficeStore.getState().chosenStatus).toBeNull();
  });
});

describe('créer un état', () => {
  test('le nom, la couleur et les trois interrupteurs partent à l\'API ; l\'état créé entre dans la liste et le formulaire se vide', async () => {
    const user = userEvent.setup();
    setup([]);
    const created: ActivityState = { id: 'nouveau', label: 'Réunion', color: '#ef4444', allowEntry: false, hear: true, heard: true };
    api.createActivityState.mockResolvedValue(created);

    await user.type(labelInput(), '  Réunion  ');
    await user.click(screen.getByRole('button', { name: t(fr.states.colorPick, { color: '#ef4444' }) }));
    await user.click(switchOf(fr.states.allowEntry));
    await user.click(screen.getByRole('button', { name: fr.states.create }));

    expect(api.createActivityState).toHaveBeenCalledExactlyOnceWith({ label: 'Réunion', color: '#ef4444', allowEntry: false, hear: true, heard: true } satisfies ActivityInput);
    expect(useOfficeStore.getState().myStates).toEqual([created]);
    expect(labelInput().value).toBe('');
    expect(screen.getByText(fr.states.saved)).toBeTruthy();
    expect(screen.getByText('Réunion')).toBeTruthy();
  });

  test('un nom vide : le bouton est inactif ; le champ est borné à 24 caractères', async () => {
    const user = userEvent.setup();
    setup([]);
    const submit = screen.getByRole('button', { name: fr.states.create }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(labelInput().maxLength).toBe(24);
    await user.type(labelInput(), '   ');
    expect(submit.disabled).toBe(true);
    await user.type(labelInput(), 'x');
    expect(submit.disabled).toBe(false);
  });

  test('sans entendre ni être entendu : un avertissement', async () => {
    const user = userEvent.setup();
    setup([]);
    expect(screen.queryByText(fr.states.cutOff)).toBeNull();
    await user.click(switchOf(fr.states.hear));
    expect(screen.queryByText(fr.states.cutOff)).toBeNull();
    await user.click(switchOf(fr.states.heard));
    expect(screen.getByText(fr.states.cutOff)).toBeTruthy();
  });

  test('le serveur refuse (limite, nom invalide, panne) : le message dit pourquoi, et rien n\'est ajouté', async () => {
    const user = userEvent.setup();
    setup([]);
    await user.type(labelInput(), 'Test');
    api.createActivityState.mockRejectedValueOnce(new ApiError(409, 'limit'));
    await user.click(screen.getByRole('button', { name: fr.states.create }));
    expect((await screen.findByRole('alert')).textContent).toBe(t(fr.states.errors.limit, { max: ACTIVITY_MAX_PER_USER }));
    api.createActivityState.mockRejectedValueOnce(new ApiError(400, 'invalid'));
    await user.click(screen.getByRole('button', { name: fr.states.create }));
    expect((await screen.findByRole('alert')).textContent).toBe(fr.states.errors.invalid);
    api.createActivityState.mockRejectedValueOnce(new ApiError(0, 'network'));
    await user.click(screen.getByRole('button', { name: fr.states.create }));
    expect((await screen.findByRole('alert')).textContent).toBe(fr.states.errors.generic);
    expect(useOfficeStore.getState().myStates).toEqual([]);
  });

  test('au plafond (12 états) : on ne peut plus en créer, et on le dit', () => {
    setup(Array.from({ length: ACTIVITY_MAX_PER_USER }, (_, i) => ({ ...focus, id: `s${i}`, label: `État ${i}` })));
    expect((screen.getByRole('button', { name: fr.states.create }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(t(fr.states.errors.limit, { max: ACTIVITY_MAX_PER_USER }))).toBeTruthy();
  });
});

describe('l\'icône d\'un état', () => {
  test('une grille de toutes les icônes, dans l\'ordre de la liste partagée, chacune avec son nom ; aucune n\'est choisie au départ', () => {
    setup([]);
    const buttons = within(iconGrid()).getAllByRole('button');
    expect(buttons).toHaveLength(ACTIVITY_ICONS.length);
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(ACTIVITY_ICONS.map((name) => fr.states.icons[name]));
    expect(buttons.every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(buttons[0]!.querySelector('svg.lucide-headphones')).toBeTruthy();
    expect(screen.getByText(fr.states.iconHint)).toBeTruthy();
  });

  test('en choisir une la marque, et elle part à l\'API avec l\'état', async () => {
    const user = userEvent.setup();
    setup([focus]);
    const created: ActivityState = { id: 'nouveau', label: 'Pause', color: '#6d28d9', icon: 'coffee', allowEntry: true, hear: true, heard: true };
    api.createActivityState.mockResolvedValue(created);

    await user.type(labelInput(), 'Pause');
    await user.click(iconButton('Café'));
    expect(iconButton('Café').getAttribute('aria-pressed')).toBe('true');
    await user.click(iconButton('Lune'));
    expect(iconButton('Café').getAttribute('aria-pressed')).toBe('false');
    expect(iconButton('Lune').getAttribute('aria-pressed')).toBe('true');
    await user.click(iconButton('Café'));
    await user.click(screen.getByRole('button', { name: fr.states.create }));

    expect(api.createActivityState).toHaveBeenCalledExactlyOnceWith({ label: 'Pause', color: '#6d28d9', icon: 'coffee', allowEntry: true, hear: true, heard: true } satisfies ActivityInput);
    expect(useOfficeStore.getState().myStates.at(-1)).toEqual(created);
    // Le formulaire se vide : plus d'icône choisie.
    expect(within(iconGrid()).getAllByRole('button').every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  test('recliquer sur l\'icône choisie la retire : l\'état part sans icône', async () => {
    const user = userEvent.setup();
    setup([]);
    api.createActivityState.mockResolvedValue({ id: 'nouveau', label: 'Pause', color: '#6d28d9', allowEntry: true, hear: true, heard: true });
    await user.type(labelInput(), 'Pause');
    await user.click(iconButton('Casque'));
    await user.click(iconButton('Casque'));
    expect(iconButton('Casque').getAttribute('aria-pressed')).toBe('false');
    await user.click(screen.getByRole('button', { name: fr.states.create }));
    const sent = api.createActivityState.mock.calls[0]![0];
    expect(sent).toEqual({ label: 'Pause', color: '#6d28d9', allowEntry: true, hear: true, heard: true });
    expect('icon' in sent).toBe(false);
  });

  test('modifier un état qui a une icône : elle est choisie ; en prendre une autre la remplace (PUT), la retirer l\'envoie sans icône', async () => {
    const user = userEvent.setup();
    const withIcon: ActivityState = { ...focus, icon: 'headphones' };
    setup([withIcon]);
    await user.click(screen.getByRole('button', { name: t(fr.states.editLabel, { label: 'En focus' }) }));
    expect(iconButton('Casque').getAttribute('aria-pressed')).toBe('true');

    api.updateActivityState.mockResolvedValueOnce({ ...withIcon, icon: 'moon' });
    await user.click(iconButton('Lune'));
    await user.click(screen.getByRole('button', { name: fr.states.save }));
    expect(api.updateActivityState).toHaveBeenLastCalledWith('s1', { label: 'En focus', color: '#6d28d9', icon: 'moon', allowEntry: false, hear: true, heard: false });

    await user.click(screen.getByRole('button', { name: t(fr.states.editLabel, { label: 'En focus' }) }));
    expect(iconButton('Lune').getAttribute('aria-pressed')).toBe('true');
    api.updateActivityState.mockResolvedValueOnce(focus);
    await user.click(iconButton('Lune'));
    await user.click(screen.getByRole('button', { name: fr.states.save }));
    const sent = api.updateActivityState.mock.calls.at(-1)![1];
    expect('icon' in sent).toBe(false);
    expect(useOfficeStore.getState().myStates).toEqual([focus]);
  });

  test('modifier un état sans icône : rien n\'est choisi, et enregistrer n\'en invente pas', async () => {
    const user = userEvent.setup();
    setup([focus]);
    await user.click(screen.getByRole('button', { name: t(fr.states.editLabel, { label: 'En focus' }) }));
    expect(within(iconGrid()).getAllByRole('button').every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
  });
});

describe('les modes prêts à l\'emploi', () => {
  const presets = () => screen.getByRole('group', { name: fr.modes.presetsTitle });
  const duplicate = (label: string) => within(presets()).getByRole('button', { name: t(fr.modes.duplicateLabel, { label }) }) as HTMLButtonElement;

  test('Concentration et Sport, avec leur icône et ce qu\'ils changent ; ni « Modifier », ni « Supprimer », ni « Prendre » : ce ne sont pas ses états', () => {
    setup([]);
    const rows = Array.from(presets().querySelectorAll('.state-row'));
    expect(rows.map((row) => row.querySelector('.person-name')?.textContent)).toEqual(['Concentration', 'Sport']);
    expect(rows[0]!.querySelector('svg.lucide-headphones')).toBeTruthy();
    expect(rows[1]!.querySelector('svg.lucide-dumbbell')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('porte fermée · entend · entendu')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('porte ouverte · n\'entend pas · pas entendu · à gym')).toBeTruthy();
    expect(within(presets()).getAllByRole('button').map((button) => button.textContent)).toEqual([fr.modes.duplicate, fr.modes.duplicate]);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText(fr.states.empty)).toBeTruthy();
  });

  test('ils sont là même quand on a déjà des états, et la liste de ses états reste la seule liste', () => {
    setup([focus]);
    expect(Array.from(presets().querySelectorAll('.state-row'))).toHaveLength(2);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  test('« Dupliquer en mode perso » copie Sport avec son emplacement, et la copie entre dans la liste, qu\'on modifie ensuite', async () => {
    const user = userEvent.setup();
    setup([]);
    const copy: ActivityState = { id: 'copie', label: 'Sport', color: '#f97316', icon: 'dumbbell', allowEntry: true, hear: false, heard: false, place: 'gym' };
    api.createActivityState.mockResolvedValue(copy);
    await user.click(duplicate('Sport'));
    expect(api.createActivityState).toHaveBeenCalledExactlyOnceWith({ label: 'Sport', color: '#f97316', icon: 'dumbbell', allowEntry: true, hear: false, heard: false, place: 'gym' } satisfies ActivityInput);
    expect(useOfficeStore.getState().myStates).toEqual([copy]);
    expect(screen.getByText(fr.states.saved)).toBeTruthy();
    expect(screen.getByRole('button', { name: t(fr.states.editLabel, { label: 'Sport' }) })).toBeTruthy();
  });

  test('Concentration se copie sans emplacement : le champ n\'est pas dans la demande', async () => {
    const user = userEvent.setup();
    setup([]);
    api.createActivityState.mockResolvedValue({ id: 'copie', label: 'Concentration', color: '#6d28d9', icon: 'headphones', allowEntry: false, hear: true, heard: true });
    await user.click(duplicate('Concentration'));
    const sent = api.createActivityState.mock.calls[0]![0];
    expect(sent).toEqual({ label: 'Concentration', color: '#6d28d9', icon: 'headphones', allowEntry: false, hear: true, heard: true });
    expect('place' in sent).toBe(false);
  });

  test('le serveur refuse : le message dit pourquoi, rien n\'est ajouté, et on peut recommencer', async () => {
    const user = userEvent.setup();
    setup([]);
    api.createActivityState.mockRejectedValueOnce(new ApiError(0, 'network'));
    await user.click(duplicate('Sport'));
    expect((await screen.findByRole('alert')).textContent).toBe(fr.states.errors.generic);
    expect(useOfficeStore.getState().myStates).toEqual([]);
    expect(duplicate('Sport').disabled).toBe(false);
  });

  test('pendant la copie, les boutons sont inactifs : un double clic ne crée qu\'un état', async () => {
    const user = userEvent.setup();
    setup([]);
    let finish: (state: ActivityState) => void = () => {};
    api.createActivityState.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await user.click(duplicate('Concentration'));
    expect(duplicate('Sport').disabled).toBe(true);
    await user.click(duplicate('Sport'));
    expect(api.createActivityState).toHaveBeenCalledOnce();
    await act(async () => finish({ id: 'copie', label: 'Concentration', color: '#6d28d9', icon: 'headphones', allowEntry: false, hear: true, heard: true }));
  });

  test('à la limite de 12 états, les copies sont inactives', () => {
    setup(Array.from({ length: ACTIVITY_MAX_PER_USER }, (_, i) => ({ ...lunch, id: `s${i}`, label: `État ${i}` })));
    expect(duplicate('Sport').disabled).toBe(true);
    expect(duplicate('Concentration').disabled).toBe(true);
  });
});

describe('l\'emplacement d\'un état', () => {
  const office = parseOfficeMap(buildOfficeTiledMap());
  const withMap = (states: ActivityState[] = []) => {
    const view = setup(states);
    act(() => useOfficeStore.getState().setOfficeMap(office));
    return view;
  };
  const room = (name: string) => screen.getByRole('button', { name }) as unknown as SVGElement;

  test('le formulaire a une mini-carte des destinations ; sans carte, ou sans destination, le champ n\'y est pas', () => {
    setup([]);
    expect(screen.queryByText(fr.modes.place)).toBeNull();
    act(() => useOfficeStore.getState().setOfficeMap(office));
    expect(screen.getByText(fr.modes.place)).toBeTruthy();
    expect(room('Salle de sport').getAttribute('aria-pressed')).toBe('false');
    expect(room('Salle de jeu').getAttribute('aria-pressed')).toBe('false');
  });

  test('choisir une pièce la coche, la rechoisir la retire ; l\'état créé porte l\'emplacement choisi', async () => {
    const user = userEvent.setup();
    withMap();
    await user.click(room('Salle de sport'));
    expect(room('Salle de sport').getAttribute('aria-pressed')).toBe('true');
    await user.click(room('Salle de sport'));
    expect(room('Salle de sport').getAttribute('aria-pressed')).toBe('false');
    await user.click(room('Salle de jeu'));
    await user.type(labelInput(), 'Parties');
    api.createActivityState.mockResolvedValue({ id: 'n', label: 'Parties', color: '#6d28d9', allowEntry: true, hear: true, heard: true, place: 'game' });
    await user.click(screen.getByRole('button', { name: fr.states.create }));
    expect(api.createActivityState).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ label: 'Parties', place: 'game' }));
  });

  test('sans pièce choisie, la demande n\'a pas de champ « place »', async () => {
    const user = userEvent.setup();
    withMap();
    await user.type(labelInput(), 'Sans lieu');
    api.createActivityState.mockResolvedValue({ id: 'n', label: 'Sans lieu', color: '#6d28d9', allowEntry: true, hear: true, heard: true });
    await user.click(screen.getByRole('button', { name: fr.states.create }));
    expect('place' in api.createActivityState.mock.calls[0]![0]).toBe(false);
  });

  test('« Modifier » un état à emplacement coche sa pièce ; la liste dit où il conduit', async () => {
    const user = userEvent.setup();
    withMap([{ ...lunch, place: 'gym' }]);
    expect(within(screen.getAllByRole('listitem')[0]!).getByText('porte ouverte · n\'entend pas · pas entendu · à Salle de sport')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: t(fr.states.editLabel, { label: 'À table' }) }));
    expect(room('Salle de sport').getAttribute('aria-pressed')).toBe('true');
    api.updateActivityState.mockResolvedValue({ ...lunch });
    await user.click(room('Salle de sport'));
    await user.click(screen.getByRole('button', { name: fr.states.save }));
    expect('place' in api.updateActivityState.mock.calls[0]![1]).toBe(false);
  });
});

describe('modifier et supprimer', () => {
  test('« Modifier » remplit le formulaire ; enregistrer remplace l\'état (PUT) ; « Annuler » revient à un nouvel état', async () => {
    const user = userEvent.setup();
    setup([focus]);
    await user.click(screen.getByRole('button', { name: t(fr.states.editLabel, { label: 'En focus' }) }));
    expect(labelInput().value).toBe('En focus');
    expect(switchOf(fr.states.allowEntry).checked).toBe(false);
    expect(switchOf(fr.states.heard).checked).toBe(false);
    expect(screen.getByRole('heading', { name: fr.states.formEdit })).toBeTruthy();

    const updated = { ...focus, label: 'Concentré', heard: true };
    api.updateActivityState.mockResolvedValue(updated);
    await user.clear(labelInput());
    await user.type(labelInput(), 'Concentré');
    await user.click(switchOf(fr.states.heard));
    await user.click(screen.getByRole('button', { name: fr.states.save }));
    expect(api.updateActivityState).toHaveBeenCalledExactlyOnceWith('s1', { label: 'Concentré', color: '#6d28d9', allowEntry: false, hear: true, heard: true });
    expect(useOfficeStore.getState().myStates).toEqual([updated]);
    expect(screen.getByRole('heading', { name: fr.states.formCreate })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: t(fr.states.editLabel, { label: 'Concentré' }) }));
    await user.click(screen.getByRole('button', { name: fr.states.cancel }));
    expect(labelInput().value).toBe('');
    expect(screen.getByRole('heading', { name: fr.states.formCreate })).toBeTruthy();
  });

  test('« Supprimer » : DELETE, et l\'état quitte la liste ; déjà supprimé ailleurs (404) : il la quitte aussi', async () => {
    const user = userEvent.setup();
    setup([focus, lunch]);
    api.deleteActivityState.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole('button', { name: t(fr.states.removeLabel, { label: 'En focus' }) }));
    expect(api.deleteActivityState).toHaveBeenCalledWith('s1');
    expect(useOfficeStore.getState().myStates.map((s) => s.id)).toEqual(['s2']);

    api.deleteActivityState.mockRejectedValueOnce(new ApiError(404, 'not_found'));
    await user.click(screen.getByRole('button', { name: t(fr.states.removeLabel, { label: 'À table' }) }));
    expect(useOfficeStore.getState().myStates).toEqual([]);
    expect((await screen.findByRole('alert')).textContent).toBe(fr.states.errors.not_found);
  });

  test('supprimer l\'état qu\'on modifie referme le formulaire', async () => {
    const user = userEvent.setup();
    setup([focus]);
    await user.click(screen.getByRole('button', { name: t(fr.states.editLabel, { label: 'En focus' }) }));
    api.deleteActivityState.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole('button', { name: t(fr.states.removeLabel, { label: 'En focus' }) }));
    expect(screen.getByRole('heading', { name: fr.states.formCreate })).toBeTruthy();
    expect(labelInput().value).toBe('');
  });
});

test('Échap et ✕ ferment', async () => {
  const user = userEvent.setup();
  const { closed } = setup([]);
  await user.click(screen.getByRole('button', { name: fr.ui.close }));
  await user.keyboard('{Escape}');
  expect(closed()).toBeGreaterThanOrEqual(1);
});
