import type { CharacterStats, PublicPlayer } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import * as progressApi from '../lib/progress-api';
import { useOfficeStore } from '../state/office-store';
import { SheetPanel } from './CharacterSheet';

const self: PublicPlayer = { id: 'bob', name: 'Bob', avatarKey: null, x: 80, y: 240, dir: 'down', moving: false, status: 'available', media: { mic: false, cam: false, screen: false } };

// La fiche de quelqu'un d'autre : ni ses kuartzons ni son journal (le serveur ne les donne qu'à elle).
const ana: CharacterStats = {
  id: 'ana',
  name: 'Ana',
  avatarKey: null,
  memberSince: '2026-10-20T08:00:00.000Z',
  timezone: 'America/Montreal',
  xp: 45_200,
  missionsDone: 0,
  missionsByTier: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  missionsGiven: 2,
  todosDone: 7,
  streak: 1,
  gamesPlayed: 3,
  gamesWon: 1,
};

beforeEach(() => {
  useOfficeStore.getState().reset();
  act(() => {
    useOfficeStore.getState().applyInit({ self, players: [], mapKey: 'office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] });
  });
});

describe('la fiche de quelqu\'un d\'autre', () => {
  test('en tête, son portrait, son nom, son grade à sa teinte, son niveau et son expérience ; puis ses lignes, sans ses kuartzons ni son journal', async () => {
    vi.mocked(progressApi.fetchStats).mockResolvedValueOnce(ana);
    render(<SheetPanel userId="ana" name="Ana" onClose={() => {}} />);

    const hero = (await screen.findByText('Spécialiste')).closest('.sheet-hero') as HTMLElement;
    expect(hero.dataset.grade).toBe('specialiste');
    expect(within(hero).getByText('Ana')).toBeTruthy();
    expect(within(hero).getByText(t(fr.progress.level, { level: 45 }))).toBeTruthy();
    expect(within(hero).getByRole('progressbar', { name: fr.sheet.xpBar }).getAttribute('aria-valuenow')).toBe('200');
    expect(hero.textContent).toContain('Encore 800 XP avant le niveau 46');

    const labels = [...document.querySelectorAll('.sheet-stats.is-key .sheet-row-label')].map((label) => label.textContent);
    expect(labels).toEqual([fr.sheet.totalXp, fr.sheet.authority]);
    expect(screen.queryByText(fr.sheet.kuartzons)).toBeNull();
    expect(screen.queryByText(fr.sheet.history)).toBeNull();
    // Aucune mission accomplie : une phrase plutôt qu'un graphique vide.
    expect(screen.getByText(fr.sheet.byTierEmpty)).toBeTruthy();
    expect(document.querySelector('.sheet-tiers')).toBeNull();
  });

  test('au niveau maximal, la barre est pleine et l\'en-tête prend l\'or de la Légende', async () => {
    vi.mocked(progressApi.fetchStats).mockResolvedValueOnce({ ...ana, xp: 250_000 });
    render(<SheetPanel userId="ana" name="Ana" onClose={() => {}} />);

    const hero = (await screen.findByText(fr.progress.grades.legende)).closest('.sheet-hero') as HTMLElement;
    expect(hero.dataset.grade).toBe('legende');
    expect([...hero.querySelectorAll<HTMLElement>('.sheet-seg-fill')].every((fill) => fill.style.width === '100%')).toBe(true);
    expect(hero.textContent).toContain(fr.progress.maxed);
  });
});
