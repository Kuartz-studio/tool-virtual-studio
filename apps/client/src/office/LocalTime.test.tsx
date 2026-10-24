import type { PublicPlayer } from '@bureau/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fr } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { fakeApi, json } from '../test/fake-api';
import { LOCAL_TIME_HOVER_MS, LocalTimeCard, placeBeside } from './LocalTime';
import { PeoplePanel } from './PeoplePanel';

// Le samedi 24 octobre 2026, 16:42:30 UTC : 18:42 à Paris, 12:42 à Montréal, 01:42 le lendemain à Tokyo.
const NOW = Date.parse('2026-10-24T16:42:30Z');

const player = (id: string, name: string, timezone?: string): PublicPlayer => ({
  id,
  name,
  avatarKey: null,
  x: 80,
  y: 240,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
  ...(timezone ? { timezone } : {}),
});

function arrive(others: PublicPlayer[] = [], self = player('moi', 'Moi', 'Europe/Paris')): void {
  act(() => useOfficeStore.getState().applyInit({ self, players: others, mapKey: 'dev-office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }));
}

beforeEach(() => {
  useOfficeStore.getState().reset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const card = () => screen.getByRole('tooltip');
const textOf = (element: Element) => element.textContent ?? '';

describe('la carte de l\'heure locale', () => {
  test('chez quelqu\'un : son heure, le moment de sa journée, sa ville, son décalage et l\'écart avec la mienne', () => {
    arrive();
    render(<LocalTimeCard timezone="America/Montreal" name="Tom" />);
    expect(screen.getByText('Chez Tom')).toBeTruthy();
    expect(screen.getByText('12:42')).toBeTruthy();
    expect(screen.getByText(fr.time.parts.afternoon)).toBeTruthy();
    expect(screen.getByText('Montréal, Canada')).toBeTruthy();
    expect(screen.getByText('UTC−4')).toBeTruthy();
    expect(screen.getByText('6 h de retard sur toi')).toBeTruthy();
  });

  test('déjà demain chez elle : « demain », et la nuit', () => {
    arrive();
    const { container } = render(<LocalTimeCard timezone="Asia/Tokyo" name="Aiko" />);
    expect(screen.getByText('01:42')).toBeTruthy();
    expect(screen.getByText(fr.time.tomorrow)).toBeTruthy();
    expect(container.querySelector('.time-card')?.getAttribute('data-part')).toBe('night');
    expect(screen.getByText('7 h d\'avance sur toi')).toBeTruthy();
  });

  test('chez soi : « Chez toi », sans écart ; le même fuseau qu\'un autre : « Même heure que toi »', () => {
    arrive();
    const { unmount } = render(<LocalTimeCard timezone="Europe/Paris" name="Moi" self />);
    expect(screen.getByText(fr.time.atYou)).toBeTruthy();
    expect(screen.queryByText(fr.time.sameTime)).toBeNull();
    unmount();
    render(<LocalTimeCard timezone="Europe/Brussels" name="Zoé" />);
    expect(screen.getByText(fr.time.sameTime)).toBeTruthy();
  });

  test('l\'écart se compte depuis mon fuseau à moi, pas celui de l\'appareil', () => {
    arrive([], player('moi', 'Moi', 'Asia/Tokyo'));
    render(<LocalTimeCard timezone="Europe/Paris" name="Léa" />);
    expect(screen.getByText('7 h de retard sur toi')).toBeTruthy();
    expect(screen.getByText(fr.time.yesterday)).toBeTruthy();
  });

  test('l\'heure avance toute seule, à la minute ronde', () => {
    arrive();
    render(<LocalTimeCard timezone="Europe/Paris" name="Moi" self />);
    expect(screen.getByText('18:42')).toBeTruthy();
    act(() => vi.advanceTimersByTime(29_000));
    expect(screen.getByText('18:42')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1_100));
    expect(screen.getByText('18:43')).toBeTruthy();
    act(() => vi.advanceTimersByTime(60 * 60_000));
    expect(screen.getByText('19:43')).toBeTruthy();
  });
});

describe('où poser la carte', () => {
  const viewport = { width: 1280, height: 800 };
  const size = { width: 216, height: 110 };

  test('à gauche de la ligne (le panneau est à droite), centrée sur elle', () => {
    expect(placeBeside({ left: 940, right: 1260, top: 300, bottom: 354 }, size, viewport)).toEqual({ left: 940 - 10 - 216, top: 327 - 55 });
  });

  test('gardée dans la page en hauteur', () => {
    expect(placeBeside({ left: 940, right: 1260, top: 0, bottom: 20 }, size, viewport).top).toBe(12);
    expect(placeBeside({ left: 940, right: 1260, top: 780, bottom: 800 }, size, viewport).top).toBe(800 - 12 - 110);
  });

  test('sur un téléphone (la ligne prend toute la largeur) : au-dessus de la ligne, sinon au-dessous', () => {
    const phone = { width: 375, height: 812 };
    expect(placeBeside({ left: 8, right: 367, top: 500, bottom: 554 }, size, phone)).toEqual({ left: 12, top: 500 - 10 - 110 });
    expect(placeBeside({ left: 8, right: 367, top: 40, bottom: 94 }, size, phone)).toEqual({ left: 12, top: 104 });
  });
});

describe('au survol d\'une personne, dans le panneau Personnes', () => {
  // Les membres que le serveur connaît, avec leur fuseau : Tom est hors ligne, à Montréal.
  const MEMBERS = [
    { id: 'moi', name: 'Moi', avatarKey: null, lastSeenAt: null, timezone: 'Europe/Paris' },
    { id: 'aiko', name: 'Aiko', avatarKey: null, lastSeenAt: null, timezone: 'Europe/Paris' },
    { id: 'tom', name: 'Tom', avatarKey: null, lastSeenAt: '2026-10-24T10:00:00.000Z', timezone: 'America/Montreal' },
  ];

  async function renderPanel() {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('aiko', 'Aiko', 'Asia/Tokyo')]);
    const view = render(<PeoplePanel place={null} onClose={() => {}} />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    return view;
  }

  const row = (id: string) => document.querySelector<HTMLElement>(`.person[data-user="${id}"]`)!;

  test('la carte paraît après un court délai, à côté de la ligne ; elle part avec le pointeur', async () => {
    await renderPanel();
    fireEvent.pointerEnter(row('aiko'), { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(LOCAL_TIME_HOVER_MS));
    expect(textOf(card())).toContain('Chez Aiko');
    // En ligne, son fuseau est celui que le temps réel dit (Tokyo), pas celui de la liste chargée à l'ouverture.
    expect(textOf(card())).toContain('01:42');
    expect(textOf(card())).toContain('Tokyo, Japon');
    expect(row('aiko').getAttribute('aria-describedby')).toBe(card().id);
    fireEvent.pointerLeave(row('aiko'), { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('traverser la liste sans s\'arrêter ne montre rien', async () => {
    await renderPanel();
    fireEvent.pointerEnter(row('aiko'), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(LOCAL_TIME_HOVER_MS / 2));
    fireEvent.pointerLeave(row('aiko'), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(LOCAL_TIME_HOVER_MS));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('hors ligne aussi : le fuseau vient de la liste des membres', async () => {
    await renderPanel();
    fireEvent.pointerEnter(row('tom'), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(LOCAL_TIME_HOVER_MS));
    expect(textOf(card())).toContain('Chez Tom');
    expect(textOf(card())).toContain('12:42');
    expect(textOf(card())).toContain('6 h de retard sur toi');
  });

  test('au clavier : le focus d\'une ligne montre la carte tout de suite ; Échap la ferme sans fermer le panneau', async () => {
    const onClose = vi.fn();
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    arrive([player('aiko', 'Aiko', 'Asia/Tokyo')]);
    render(<PeoplePanel place={null} onClose={onClose} />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(row('moi').tabIndex).toBe(0);
    act(() => row('moi').focus());
    expect(textOf(card())).toContain(fr.time.atYou);
    fireEvent.keyDown(row('moi'), { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    act(() => row('moi').blur());
  });

  test('un fuseau qui change pendant le survol : la carte suit', async () => {
    await renderPanel();
    fireEvent.pointerEnter(row('aiko'), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(LOCAL_TIME_HOVER_MS));
    act(() => useOfficeStore.getState().setProfile({ id: 'aiko', name: 'Aiko', avatarKey: null, timezone: 'America/Montreal' }));
    expect(textOf(card())).toContain('Montréal, Canada');
  });
});
