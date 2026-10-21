import type { OfficeMap, PublicPlayer, Zone } from '@bureau/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { WhereChip } from './WhereChip';

const zone = (id: string, type: Zone['type'], x: number, y: number, width: number, height: number, extra: Partial<Zone> = {}): Zone => ({ id, type, name: null, text: null, x, y, width, height, ...extra });

// Une carte réduite à ses zones : un accueil (étiquette), une salle de réunion (pièce à part).
const map = {
  widthTiles: 30,
  heightTiles: 30,
  tileSize: 32,
  blocked: new Uint8Array(900),
  spawn: { x: 48, y: 48 },
  switches: [],
  zones: [zone('1', 'label', 0, 320, 320, 64, { text: 'ACCUEIL' }), zone('2', 'private', 640, 0, 320, 320, { name: 'Salle de réunion' })],
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

const init = (self: PublicPlayer, players: PublicPlayer[]) =>
  act(() => useOfficeStore.getState().applyInit({ self, players, mapKey: 'dev-office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }));

beforeEach(() => {
  useOfficeStore.getState().reset();
});
afterEach(() => {
  vi.useRealTimers();
});

const chip = () => screen.getByRole('group', { name: fr.office.where.label });

test('sans lieu (le jeu n\'est pas encore là), rien', () => {
  init(player('moi', 'Léa', 100, 330), []);
  render(<WhereChip place={null} />);
  expect(screen.queryByRole('group', { name: fr.office.where.label })).toBeNull();
});

test('le nom du lieu où l\'on est, tel que la coque le donne ; il suit ce qu\'elle donne', () => {
  init(player('moi', 'Léa', 100, 340), []);
  const { rerender } = render(<WhereChip place="Accueil" />);
  expect(chip().textContent).toContain('Accueil');
  rerender(<WhereChip place="Salle de réunion" />);
  expect(chip().textContent).toContain('Salle de réunion');
  rerender(<WhereChip place={fr.office.where.hallway} />);
  expect(chip().textContent).toContain(fr.office.where.hallway);
});

test('les autres qui sont ici : jusqu\'à trois portraits, puis « +N » ; ceux d\'ailleurs ne comptent pas', () => {
  init(player('moi', 'Léa', 100, 340), [
    player('a', 'Ana', 120, 340),
    player('b', 'Bob', 140, 340),
    player('c', 'Cléo', 160, 340),
    player('d', 'Dan', 180, 340),
    player('e', 'Eve', 200, 340),
    player('f', 'Fred', 700, 100),
  ]);
  act(() => useOfficeStore.getState().setOfficeMap(map));
  render(<WhereChip place="Accueil" />);
  expect(chip().querySelectorAll('.portrait')).toHaveLength(3);
  expect([...chip().querySelectorAll('.portrait-initials')].map((initials) => initials.textContent)).toEqual(['A', 'B', 'C']);
  expect(chip().querySelector('.where-more')?.textContent).toBe('+2');
  // Pour un lecteur d'écran : combien sont ici (les portraits et le « +N » lui sont cachés).
  expect(chip().querySelector('.visually-hidden')?.textContent).toBe(t(fr.office.where.manyPeople, { count: 5 }));
});

test('une seule personne ici, sans « +N » ; personne : rien après le nom', () => {
  init(player('moi', 'Léa', 100, 340), [player('a', 'Ana', 120, 340)]);
  act(() => useOfficeStore.getState().setOfficeMap(map));
  const { unmount } = render(<WhereChip place="Accueil" />);
  expect(chip().querySelector('.where-more')).toBeNull();
  expect(chip().querySelector('.visually-hidden')?.textContent).toBe(fr.office.where.onePerson);
  unmount();

  init(player('moi', 'Léa', 100, 340), [player('b', 'Bob', 700, 100)]);
  render(<WhereChip place="Accueil" />);
  expect(chip().querySelector('.where-stack')).toBeNull();
});

test('ceux qui sont ici sont ceux du lieu qu\'on lui donne : il change, ils changent', () => {
  init(player('moi', 'Léa', 100, 340), [player('a', 'Ana', 120, 340), player('f', 'Fred', 700, 100)]);
  act(() => useOfficeStore.getState().setOfficeMap(map));
  const { rerender } = render(<WhereChip place="Accueil" />);
  expect([...chip().querySelectorAll('.portrait-initials')].map((initials) => initials.textContent)).toEqual(['A']);
  rerender(<WhereChip place="Salle de réunion" />);
  expect([...chip().querySelectorAll('.portrait-initials')].map((initials) => initials.textContent)).toEqual(['F']);
});

test('les positions des autres, que le magasin tient sans prévenir, sont relues deux fois par seconde', () => {
  vi.useFakeTimers();
  init(player('moi', 'Léa', 100, 340), [player('a', 'Ana', 700, 100)]);
  act(() => useOfficeStore.getState().setOfficeMap(map));
  render(<WhereChip place="Accueil" />);
  expect(chip().querySelector('.where-stack')).toBeNull();

  // Ana vient à l'accueil : le magasin a sa nouvelle position, sans que rien ne soit publié.
  useOfficeStore.getState().positions.set('a', { x: 130, y: 340, dir: 'down', moving: false });
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(chip().querySelectorAll('.portrait')).toHaveLength(1);
  // Elle repart.
  useOfficeStore.getState().positions.set('a', { x: 700, y: 100, dir: 'down', moving: false });
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(chip().querySelector('.where-stack')).toBeNull();
});
