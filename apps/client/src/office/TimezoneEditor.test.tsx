import type { PublicPlayer } from '@bureau/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fr } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { fakeApi, json, sentBody } from '../test/fake-api';
import { FakeSocket } from '../test/fake-socket';
import { MeChip } from './MeChip';
import type { PanelControls } from './panels';

// Le samedi 24 octobre 2026, 16 h 42 UTC : 18:42 à Paris (encore l'heure d'été), 12:42 à Montréal, 01:42 le lendemain à Tokyo.
const NOW = Date.parse('2026-10-24T16:42:00Z');
const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

const me = (timezone = 'Europe/Paris'): PublicPlayer => ({
  id: 'moi',
  name: 'Léa',
  avatarKey: null,
  x: 80,
  y: 240,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
  timezone,
});

const panels: PanelControls = { open: null, toggle: vi.fn(), show: vi.fn(), idOf: (id) => `panneau-${id}`, ready: true, unread: 0, admin: false, sim: false };

// Le fuseau que le navigateur dit être celui de l'appareil (Intl.DateTimeFormat().resolvedOptions().timeZone).
function deviceZoneIs(timezone: string): void {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...realResolvedOptions.call(this), timeZone: timezone };
  });
}

beforeEach(() => {
  useOfficeStore.getState().reset();
  // Seule l'horloge est figée : les minuteries restent vraies, pour userEvent.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  deviceZoneIs('Europe/Paris');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderChip(timezone = 'Europe/Paris') {
  const socket = new FakeSocket();
  socket.serverAccepts();
  act(() => useOfficeStore.getState().applyInit({ self: me(timezone), players: [], mapKey: 'dev-office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }));
  render(<MeChip name="Léa" email="lea@exemple.fr" socket={socket.asSocket()} panels={panels} onSignOut={() => {}} signingOut={false} />);
  return socket;
}

const chip = () => screen.getByRole('button', { name: fr.me.chip });
const line = () => screen.getByRole('menuitem', { name: /^Fuseau horaire/ });
const editor = () => screen.getByRole('dialog', { name: fr.me.timezoneTitle });
const zones = () => within(editor()).getByRole('list', { name: fr.me.timezoneList });
const option = (place: RegExp) => within(zones()).getByRole('button', { name: place });

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(chip());
  await user.click(line());
  return editor();
}

describe('la ligne « Fuseau horaire » du menu « Moi »', () => {
  test('elle dit la ville de son fuseau et l\'heure qu\'il est chez soi', async () => {
    const user = userEvent.setup();
    renderChip('America/Montreal');
    await user.click(chip());
    expect(line().getAttribute('aria-label')).toBe('Fuseau horaire : Montréal, 12:42');
    expect(line().textContent).toContain('Montréal · 12:42');
  });

  test('par défaut, l\'heure de Paris', async () => {
    const user = userEvent.setup();
    renderChip();
    await user.click(chip());
    expect(line().getAttribute('aria-label')).toBe('Fuseau horaire : Paris, 18:42');
  });
});

describe('le choix du fuseau', () => {
  test('il s\'ouvre dans le menu : l\'heure de chez soi, le focus dans la recherche, son fuseau coché ; « Revenir » rend la liste, le focus sur la ligne', async () => {
    const user = userEvent.setup();
    renderChip();
    const dialog = await openEditor(user);
    expect(within(dialog).getByText('Chez toi, il est 18:42 (Paris, France).')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('searchbox', { name: fr.me.timezoneSearch }));
    const checked = within(zones()).getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'true');
    expect(checked.map((button) => button.getAttribute('aria-label'))).toEqual(['Paris, France, UTC+2, il y est 18:42']);

    await user.click(within(dialog).getByRole('button', { name: fr.me.timezoneBack }));
    expect(screen.getByRole('menu')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(line()));
  });

  test('la liste va d\'ouest en est, chaque ligne avec son décalage et l\'heure qu\'il y est', async () => {
    const user = userEvent.setup();
    renderChip();
    await openEditor(user);
    const names = within(zones()).getAllByRole('button').map((button) => button.getAttribute('aria-label')!);
    expect(names[0]).toMatch(/^Honolulu, Hawaï, UTC−10, il y est 06:42$/);
    expect(names.at(-1)).toBe('Auckland, Nouvelle-Zélande, UTC+13, il y est 05:42');
    expect(names).toContain('Montréal, Canada, UTC−4, il y est 12:42');
    expect(names).toContain('Bombay, Inde, UTC+5:30, il y est 22:12');
  });

  test('la recherche ne tient compte ni des accents ni des majuscules, et trouve aussi les villes du même fuseau et les décalages', async () => {
    const user = userEvent.setup();
    renderChip();
    const dialog = await openEditor(user);
    const search = within(dialog).getByRole('searchbox');
    const found = () => within(zones()).getAllByRole('button').map((button) => button.querySelector('.tz-option-city')?.textContent);

    await user.type(search, 'MONTREAL');
    expect(found()).toEqual(['Montréal']);
    await user.clear(search);
    await user.type(search, 'reunion');
    expect(found()).toEqual(['Saint-Denis']);
    await user.clear(search);
    await user.type(search, 'lyon');
    expect(found()).toEqual(['Paris']);
    await user.clear(search);
    await user.type(search, 'utc+9');
    expect(found()).toEqual(['Séoul', 'Tokyo']);
    await user.clear(search);
    await user.type(search, 'atlantide');
    expect(within(dialog).queryByRole('list')).toBeNull();
    expect(within(dialog).getByText(fr.me.timezoneEmpty)).toBeTruthy();
  });

  test('choisir un fuseau l\'enregistre (PATCH /api/me), le magasin le prend, et le menu revient avec la nouvelle heure', async () => {
    const user = userEvent.setup();
    const fetchMock = fakeApi({
      'PATCH /api/me': () => json(200, { id: 'moi', name: 'Léa', avatarKey: null, timezone: 'America/Montreal' }),
    });
    renderChip();
    const dialog = await openEditor(user);
    await user.type(within(dialog).getByRole('searchbox'), 'montréal');
    await user.click(option(/^Montréal/));

    expect(sentBody(fetchMock, 'PATCH /api/me')).toEqual({ timezone: 'America/Montreal' });
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    expect(useOfficeStore.getState().self?.timezone).toBe('America/Montreal');
    expect(line().getAttribute('aria-label')).toBe('Fuseau horaire : Montréal, 12:42');
  });

  test('Entrée dans la recherche choisit la première ligne trouvée ; ↓ va dans la liste', async () => {
    const user = userEvent.setup();
    const fetchMock = fakeApi({ 'PATCH /api/me': () => json(200, { id: 'moi', name: 'Léa', avatarKey: null, timezone: 'Asia/Tokyo' }) });
    renderChip();
    const dialog = await openEditor(user);
    const search = within(dialog).getByRole('searchbox');
    await user.type(search, 'japon');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(option(/^Tokyo/));
    search.focus();
    await user.keyboard('{Enter}');
    expect(sentBody(fetchMock, 'PATCH /api/me')).toEqual({ timezone: 'Asia/Tokyo' });
  });

  test('choisir son propre fuseau ne renvoie rien, et revient au menu', async () => {
    const user = userEvent.setup();
    const fetchMock = fakeApi({});
    renderChip();
    await openEditor(user);
    await user.click(option(/^Paris/));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  test('un échec se dit, et le choix reste ouvert', async () => {
    const user = userEvent.setup();
    fakeApi({ 'PATCH /api/me': () => json(500, { error: 'internal' }) });
    renderChip();
    const dialog = await openEditor(user);
    await user.click(option(/^Tokyo/));
    expect(await within(dialog).findByText(fr.me.timezoneFailed)).toBeTruthy();
    expect(editor()).toBeTruthy();
    expect(useOfficeStore.getState().self?.timezone).toBe('Europe/Paris');
  });

  test('Échap vide d\'abord la recherche, puis revient au menu sans le fermer', async () => {
    const user = userEvent.setup();
    renderChip();
    const dialog = await openEditor(user);
    const search = within(dialog).getByRole('searchbox') as HTMLInputElement;
    await user.type(search, 'tokyo');
    await user.keyboard('{Escape}');
    expect(search.value).toBe('');
    expect(editor()).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  test('le fuseau de l\'appareil est proposé en tête quand il n\'est pas déjà le sien, et s\'enregistre d\'un clic', async () => {
    const user = userEvent.setup();
    deviceZoneIs('Asia/Tokyo');
    const fetchMock = fakeApi({ 'PATCH /api/me': () => json(200, { id: 'moi', name: 'Léa', avatarKey: null, timezone: 'Asia/Tokyo' }) });
    renderChip();
    const dialog = await openEditor(user);
    const device = within(dialog).getByRole('button', { name: /^L'heure de cet appareil/ });
    expect(device.textContent).toContain('Tokyo, Japon, 01:42');
    await user.click(device);
    expect(sentBody(fetchMock, 'PATCH /api/me')).toEqual({ timezone: 'Asia/Tokyo' });
  });

  test('un fuseau qui n\'est pas dans la liste (celui d\'un navigateur ailleurs) y entre sous le nom de sa ville, coché', async () => {
    const user = userEvent.setup();
    renderChip('America/Argentina/Salta');
    await openEditor(user);
    expect(option(/^Salta/).getAttribute('aria-current')).toBe('true');
  });
});
