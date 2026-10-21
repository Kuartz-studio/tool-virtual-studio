import { ACTIVITY_MAX_PER_USER, type ActivityInput, type ActivityState } from '@bureau/shared';
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
  await user.click(screen.getByRole('button', { name: fr.states.close }));
  await user.keyboard('{Escape}');
  expect(closed()).toBeGreaterThanOrEqual(1);
});
