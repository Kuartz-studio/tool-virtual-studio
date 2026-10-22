import type { PublicPlayer } from '@bureau/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { CoffeePill } from './CoffeePill';

const player = (id: string): PublicPlayer => ({
  id,
  name: id.toUpperCase(),
  avatarKey: null,
  x: 100,
  y: 100,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
});

// L'horloge de la page, que le test fait avancer : les échéances du magasin et la pastille la lisent.
let clock: number;
const advance = (ms: number) => {
  clock += ms;
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const take = (id: string, ms: number) => act(() => useOfficeStore.getState().setCoffee(id, ms));
const pill = (seconds: number) => screen.queryByRole('group', { name: t(fr.coffee.pill, { seconds }) });

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  useOfficeStore.getState().reset();
  act(() => useOfficeStore.getState().applyInit({ self: player('moi'), players: [player('a')], mapKey: 'office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('sans café, rien : la pastille n\'existe que pendant le café', () => {
  const { container } = render(<CoffeePill />);
  expect(container.firstChild).toBeNull();
});

test('le café d\'un autre ne s\'affiche pas : la pastille est celle de soi-même', () => {
  render(<CoffeePill />);
  take('a', 30_000);
  expect(screen.queryByRole('group')).toBeNull();
});

test('un café pris : « 30 s », et le nom accessible dit la même chose en toutes lettres', () => {
  render(<CoffeePill />);
  take('moi', 30_000);
  const group = pill(30)!;
  expect(group).not.toBeNull();
  expect(group.textContent).toBe(t(fr.coffee.left, { seconds: 30 }));
  expect(group.textContent).toBe('30 s');
});

test('le compte à rebours suit ce que le serveur a dit : une seconde de moins à chaque seconde', () => {
  render(<CoffeePill />);
  take('moi', 30_000);
  expect(pill(30)).not.toBeNull();
  advance(1_000);
  expect(pill(29)).not.toBeNull();
  advance(2_000);
  expect(pill(27)).not.toBeNull();
  advance(26_000);
  expect(pill(1)).not.toBeNull();
});

test('à la fin du café, la pastille disparaît', () => {
  const { container } = render(<CoffeePill />);
  take('moi', 3_000);
  advance(2_900);
  expect(pill(1)).not.toBeNull();
  advance(100);
  expect(container.firstChild).toBeNull();
});

test('le serveur le dit fini avant l\'échéance (ms: 0) : la pastille disparaît tout de suite', () => {
  const { container } = render(<CoffeePill />);
  take('moi', 30_000);
  expect(pill(30)).not.toBeNull();
  take('moi', 0);
  expect(container.firstChild).toBeNull();
});

test('un autre café remet le compte à 30 s', () => {
  render(<CoffeePill />);
  take('moi', 30_000);
  advance(20_000);
  expect(pill(10)).not.toBeNull();
  take('moi', 30_000);
  expect(pill(30)).not.toBeNull();
});

test('arriver pendant un café (l\'init le dit) : la pastille montre ce qu\'il en reste', () => {
  act(() => useOfficeStore.getState().applyInit({ self: { ...player('moi'), boost: 12_000 }, players: [], mapKey: 'office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }));
  render(<CoffeePill />);
  expect(pill(12)).not.toBeNull();
});

test('elle ne garde pas de minuteur : un seul tourne pendant le café, et plus aucun une fois fini ou démonté', () => {
  const before = vi.getTimerCount();
  const { unmount } = render(<CoffeePill />);
  expect(vi.getTimerCount()).toBe(before);
  take('moi', 3_000);
  expect(vi.getTimerCount()).toBe(before + 1);
  advance(3_000);
  expect(vi.getTimerCount()).toBe(before);
  take('moi', 30_000);
  expect(vi.getTimerCount()).toBe(before + 1);
  unmount();
  expect(vi.getTimerCount()).toBe(before);
});
