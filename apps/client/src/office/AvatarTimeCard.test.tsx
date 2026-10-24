import type { PublicPlayer } from '@bureau/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EventBus } from '../game/EventBus';
import { emitOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { AvatarTimeCard } from './AvatarTimeCard';
import { LOCAL_TIME_HOVER_MS } from './LocalTime';

// Le samedi 24 octobre 2026, 16:42 UTC : 01:42 le lendemain à Tokyo.
const NOW = Date.parse('2026-10-24T16:42:00Z');

const player = (id: string, name: string, timezone: string): PublicPlayer => ({
  id,
  name,
  avatarKey: null,
  x: 80,
  y: 240,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
  timezone,
});

beforeEach(() => {
  useOfficeStore.getState().reset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  act(() =>
    useOfficeStore.getState().applyInit({
      self: player('moi', 'Moi', 'Europe/Paris'),
      players: [player('aiko', 'Aiko', 'Asia/Tokyo')],
      mapKey: 'dev-office',
      chatHistory: [],
      desks: [],
      closedDesks: [],
      deskBans: [],
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

test('au survol d\'un avatar, après le délai : la carte de l\'heure qu\'il est chez cette personne ; elle part avec la souris', () => {
  render(<AvatarTimeCard />);
  act(() => emitOnBus(EventBus, 'avatar:hover', { id: 'aiko', x: 400, y: 300 }));
  expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => vi.advanceTimersByTime(LOCAL_TIME_HOVER_MS));
  const card = screen.getByRole('tooltip');
  expect(card.textContent).toContain('Chez Aiko');
  expect(card.textContent).toContain('01:42');
  expect(card.textContent).toContain('Tokyo, Japon');
  act(() => emitOnBus(EventBus, 'avatar:hover', null));
  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('passer sur un avatar sans s\'y arrêter ne montre rien ; une personne inconnue non plus', () => {
  render(<AvatarTimeCard />);
  act(() => emitOnBus(EventBus, 'avatar:hover', { id: 'aiko', x: 400, y: 300 }));
  act(() => vi.advanceTimersByTime(LOCAL_TIME_HOVER_MS / 2));
  act(() => emitOnBus(EventBus, 'avatar:hover', null));
  act(() => vi.advanceTimersByTime(LOCAL_TIME_HOVER_MS));
  expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => emitOnBus(EventBus, 'avatar:hover', { id: 'fantome', x: 400, y: 300 }));
  act(() => vi.advanceTimersByTime(LOCAL_TIME_HOVER_MS));
  expect(screen.queryByRole('tooltip')).toBeNull();
});
