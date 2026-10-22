import { NORMAL_COLOR, PRESET_MODES, type ActivityState } from '@bureau/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { fr } from '../i18n/fr';
import { ModePresets } from './ModePresets';

const mine = (id: string, label: string, over: Partial<ActivityState> = {}): ActivityState => ({ id, label, color: '#0ea5e9', allowEntry: true, hear: true, heard: true, ...over });
const PAUSE = mine('u-1', 'Pause', { icon: 'coffee', color: '#f59e0b' });
const MUSCU = mine('u-2', 'Muscu', { icon: 'dumbbell', place: 'gym' });

const props = (over: Partial<Parameters<typeof ModePresets>[0]> = {}) => ({ activity: null, myStates: [PAUSE, MUSCU], enabled: true, onChoose: () => undefined, onManage: () => undefined, ...over });
const tile = (name: string) => screen.getByRole('menuitemradio', { name: new RegExp(`^${name}`) });
const tiles = () => screen.getAllByRole('menuitemradio').map((button) => button.textContent);

test('Normal, Concentration, Sport, puis « Mes modes » : ses propres modes, et le bouton pour en créer un', () => {
  render(<ModePresets {...props()} />);
  expect(tiles()).toEqual([fr.modes.normal, 'Concentration', 'Sport', 'Pause', 'Muscu']);
  expect(screen.getByText(fr.modes.mine)).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: fr.modes.create })).toBeTruthy();
});

test('sans mode à soi : « Mes modes » n\'a que le bouton « Créer un mode »', () => {
  render(<ModePresets {...props({ myStates: [] })} />);
  expect(tiles()).toEqual([fr.modes.normal, 'Concentration', 'Sport']);
  expect(screen.getByRole('menuitem', { name: fr.modes.create })).toBeTruthy();
});

test('Normal est coché quand on n\'a aucun mode ; un mode pris est coché seul', () => {
  const { rerender } = render(<ModePresets {...props()} />);
  expect(tile(fr.modes.normal).getAttribute('aria-checked')).toBe('true');
  expect(screen.getAllByRole('menuitemradio').filter((button) => button.getAttribute('aria-checked') === 'true')).toHaveLength(1);
  rerender(<ModePresets {...props({ activity: PRESET_MODES.find((mode) => mode.id === 'preset:sport')! })} />);
  expect(tile('Sport').getAttribute('aria-checked')).toBe('true');
  expect(tile(fr.modes.normal).getAttribute('aria-checked')).toBe('false');
  rerender(<ModePresets {...props({ activity: MUSCU })} />);
  expect(tile('Muscu').getAttribute('aria-checked')).toBe('true');
  expect(screen.getAllByRole('menuitemradio').filter((button) => button.getAttribute('aria-checked') === 'true')).toHaveLength(1);
});

test('choisir une tuile rend son mode (le tout prêt avec son identifiant preset:) ; Normal rend null', async () => {
  const onChoose = vi.fn();
  render(<ModePresets {...props({ onChoose, activity: PAUSE })} />);
  await userEvent.click(tile('Sport'));
  expect(onChoose).toHaveBeenLastCalledWith(PRESET_MODES.find((mode) => mode.id === 'preset:sport'));
  await userEvent.click(tile('Concentration'));
  expect(onChoose).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'preset:focus', label: 'Concentration' }));
  await userEvent.click(tile('Muscu'));
  expect(onChoose).toHaveBeenLastCalledWith(MUSCU);
  await userEvent.click(tile(fr.modes.normal));
  expect(onChoose).toHaveBeenLastCalledWith(null);
});

test('« Créer un mode » ouvre le panneau des modes', async () => {
  const onManage = vi.fn();
  render(<ModePresets {...props({ onManage })} />);
  await userEvent.click(screen.getByRole('menuitem', { name: fr.modes.create }));
  expect(onManage).toHaveBeenCalledOnce();
});

test('sans connexion prête, tout est inactif', () => {
  render(<ModePresets {...props({ enabled: false })} />);
  for (const button of [...screen.getAllByRole('menuitemradio'), screen.getByRole('menuitem', { name: fr.modes.create })]) expect((button as HTMLButtonElement).disabled).toBe(true);
});

test('chaque tuile prend la couleur de son mode : le disque vert de Normal, le violet de Concentration, l\'orange de Sport, la sienne pour le sien', () => {
  render(<ModePresets {...props()} />);
  const colorOf = (name: string) => tile(name).style.getPropertyValue('--tile');
  expect(colorOf(fr.modes.normal)).toBe(NORMAL_COLOR);
  expect(colorOf('Concentration')).toBe('#6d28d9');
  expect(colorOf('Sport')).toBe('#f97316');
  expect(colorOf('Pause')).toBe('#f59e0b');
});

test('un mode a une icône dans son disque, ou à défaut le point de sa couleur ; les tuiles tout prêtes ont leur infobulle', () => {
  render(<ModePresets {...props({ myStates: [mine('u-3', 'Sans icône')] })} />);
  expect(within(tile('Sport')).getByText('Sport')).toBeTruthy();
  expect(tile('Sport').getAttribute('title')).toBe(fr.modes.presetHints.sport);
  expect(tile('Concentration').getAttribute('title')).toBe(fr.modes.presetHints.focus);
  expect(tile(fr.modes.normal).getAttribute('title')).toBe(fr.modes.normalHint);
  expect(tile('Sans icône').querySelector('.status-dot, .activity-icon')).not.toBeNull();
});
