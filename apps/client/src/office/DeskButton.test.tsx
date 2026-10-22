import type { DeskInfo, OfficeMap, PublicPlayer, Zone } from '@bureau/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EventBus } from '../game/EventBus';
import { fr } from '../i18n/fr';
import { emitOnBus, listenOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { DeskButton } from './DeskButton';
import type { PanelControls } from './panels';

const zone = (id: string, type: Zone['type'], x: number, y: number, width: number, height: number, extra: Partial<Zone> = {}): Zone => ({ id, type, name: null, text: null, x, y, width, height, ...extra });

// Une carte réduite à ses zones : les pièces des bureaux A1 et A2 (en pixels), et du couloir autour.
const map = {
  widthTiles: 30,
  heightTiles: 20,
  tileSize: 32,
  blocked: new Uint8Array(600),
  spawn: { x: 48, y: 400 },
  switches: [],
  places: [],
  coffees: [],
  speakers: [],
  tables: [],
  signs: [],
  zones: [zone('1', 'desk', 0, 0, 288, 224, { name: 'A1' }), zone('2', 'desk', 320, 0, 288, 224, { name: 'A2' })],
} as unknown as OfficeMap;

const player = (id: string, name: string, x: number, y: number): PublicPlayer => ({
  id,
  name,
  avatarKey: null,
  x,
  y,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
});

const desk = (key: string, ownerId: string | null, ownerName: string | null): DeskInfo =>
  ({ key, ownerId, ownerName, name: null, locked: false, closedByState: false, floor: '', wall: '', items: [] }) as DeskInfo;

// La personne est « moi » (Léa, bureau A1), aux pieds donnés ; `desks` : les places, A1 est la sienne par défaut.
function arrive(x: number, y: number, desks: DeskInfo[] = [desk('A1', 'moi', 'Léa'), desk('A2', 'autre', 'Bob')]) {
  act(() => useOfficeStore.getState().applyInit({ self: player('moi', 'Léa', x, y), players: [], mapKey: 'dev-office', chatHistory: [], desks, closedDesks: [], deskBans: [] }));
  act(() => useOfficeStore.getState().setOfficeMap(map));
}

function fakePanels(over: Partial<PanelControls> = {}): PanelControls {
  return { open: null, toggle: vi.fn(), show: vi.fn(), idOf: (id) => `panneau-${id}`, ready: true, unread: 0, admin: false, sim: false, ...over };
}

// Ce que le jeu entendrait de l'interface : chaque événement émis, dans l'ordre.
let heard: string[] = [];
const stops: Array<() => void> = [];
beforeEach(() => {
  useOfficeStore.getState().reset();
  heard = [];
  stops.push(listenOnBus(EventBus, 'local:walk-to-desk', () => heard.push('walk-to-desk')));
  stops.push(listenOnBus(EventBus, 'local:walk-cancel', () => heard.push('walk-cancel')));
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

const walkTo = (x: number, y: number) => act(() => void emitOnBus(EventBus, 'local:move', { x, y, dir: 'down', moving: true }));
const walking = (on: boolean) => act(() => void emitOnBus(EventBus, 'walk:state', { walking: on }));

test('sans bureau à soi, pas de bouton', () => {
  arrive(100, 100, [desk('A1', null, null), desk('A2', 'autre', 'Bob')]);
  render(<DeskButton panels={fakePanels()} />);
  expect(screen.queryByRole('button')).toBeNull();
});

test('sans carte (le jeu n\'est pas là), il garde « Aller à mon bureau » : on n\'est dans aucune pièce', () => {
  act(() => useOfficeStore.getState().applyInit({ self: player('moi', 'Léa', 100, 100), players: [], mapKey: 'dev-office', chatHistory: [], desks: [desk('A1', 'moi', 'Léa')], closedDesks: [], deskBans: [] }));
  render(<DeskButton panels={fakePanels()} />);
  expect(screen.getByRole('button', { name: fr.desk.goto })).toBeTruthy();
});

test('hors de son bureau : « Aller à mon bureau », et le clic demande au jeu de faire marcher l\'avatar', async () => {
  arrive(100, 400);
  render(<DeskButton panels={fakePanels()} />);
  const button = screen.getByRole('button', { name: 'Aller à mon bureau' });
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(button.querySelector('svg.lucide-door-open')).not.toBeNull();
  await userEvent.click(button);
  expect(heard).toEqual(['walk-to-desk']);
});

test('dans le bureau de quelqu\'un d\'autre, on n\'est pas chez soi : « Aller à mon bureau »', () => {
  arrive(400, 100);
  render(<DeskButton panels={fakePanels()} />);
  expect(screen.getByRole('button', { name: 'Aller à mon bureau' })).toBeTruthy();
});

test('pendant la marche (walk:state) le bouton est enfoncé, et un second clic l\'annule', async () => {
  arrive(100, 400);
  render(<DeskButton panels={fakePanels()} />);
  const button = screen.getByRole('button', { name: 'Aller à mon bureau' });
  await userEvent.click(button);
  walking(true);
  expect(button.getAttribute('aria-pressed')).toBe('true');
  await userEvent.click(button);
  expect(heard).toEqual(['walk-to-desk', 'walk-cancel']);
  // Le jeu dit que l'avatar ne marche plus : le bouton est relâché.
  walking(false);
  expect(button.getAttribute('aria-pressed')).toBe('false');
  await userEvent.click(button);
  expect(heard).toEqual(['walk-to-desk', 'walk-cancel', 'walk-to-desk']);
});

test('dans son bureau : « Réglages du bureau », qui ouvre le panneau du bureau', async () => {
  arrive(100, 100);
  const panels = fakePanels();
  render(<DeskButton panels={panels} />);
  expect(screen.queryByRole('button', { name: 'Aller à mon bureau' })).toBeNull();
  const button = screen.getByRole('button', { name: 'Réglages du bureau' });
  expect(button.querySelector('svg.lucide-sliders-horizontal')).not.toBeNull();
  await userEvent.click(button);
  expect(panels.toggle).toHaveBeenCalledWith('desk', button);
  expect(heard).toEqual([]);
});

test('le panneau du bureau ouvert, le bouton est enfoncé et le désigne ; ouvert ailleurs, non', () => {
  arrive(100, 100);
  const { rerender } = render(<DeskButton panels={fakePanels({ open: 'desk' })} />);
  const button = screen.getByRole('button', { name: 'Réglages du bureau' });
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.getAttribute('aria-controls')).toBe('panneau-desk');
  rerender(<DeskButton panels={fakePanels({ open: 'chat' })} />);
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(button.getAttribute('aria-controls')).toBeNull();
});

test('entrer dans son bureau, ou en sortir, change le bouton tout de suite : c\'est le même bouton', () => {
  arrive(100, 400);
  render(<DeskButton panels={fakePanels()} />);
  const button = screen.getByRole('button');
  expect(button.getAttribute('aria-label')).toBe('Aller à mon bureau');
  walkTo(100, 100);
  expect(screen.getByRole('button')).toBe(button);
  expect(button.getAttribute('aria-label')).toBe('Réglages du bureau');
  walkTo(100, 400);
  expect(button.getAttribute('aria-label')).toBe('Aller à mon bureau');
});

test('rendre son bureau, ou en prendre un : le bouton paraît ou disparaît', () => {
  arrive(100, 100);
  render(<DeskButton panels={fakePanels()} />);
  expect(screen.getByRole('button', { name: 'Réglages du bureau' })).toBeTruthy();
  act(() => useOfficeStore.getState().setDesk(desk('A1', null, null)));
  expect(screen.queryByRole('button')).toBeNull();
  act(() => useOfficeStore.getState().setDesk(desk('A1', 'moi', 'Léa')));
  expect(screen.getByRole('button', { name: 'Réglages du bureau' })).toBeTruthy();
});

test('il n\'écoute plus le jeu une fois démonté', () => {
  arrive(100, 400);
  const moves = EventBus.listenerCount('local:move');
  const states = EventBus.listenerCount('walk:state');
  const { unmount } = render(<DeskButton panels={fakePanels()} />);
  expect(EventBus.listenerCount('walk:state')).toBe(states + 1);
  unmount();
  expect(EventBus.listenerCount('local:move')).toBe(moves);
  expect(EventBus.listenerCount('walk:state')).toBe(states);
});
