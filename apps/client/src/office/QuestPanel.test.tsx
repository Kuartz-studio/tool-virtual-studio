import type { MyProgress, PublicPlayer, TaskView } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import * as progressApi from '../lib/progress-api';
import { useOfficeStore } from '../state/office-store';
import { QuestPanel } from './QuestPanel';

const self: PublicPlayer = { id: 'bob', name: 'Bob', avatarKey: null, x: 80, y: 240, dir: 'down', moving: false, status: 'available', media: { mic: false, cam: false, screen: false } };

const task = (id: string, over: Partial<TaskView> = {}): TaskView => ({
  id,
  kind: 'todo',
  title: `Tâche ${id}`,
  notes: null,
  tier: null,
  xp: 20,
  status: 'open',
  createdAt: '2026-10-24T08:00:00.000Z',
  doneAt: null,
  owner: { id: 'bob', name: 'Bob' },
  giver: null,
  seen: true,
  ...over,
});

const mission = (id: string, over: Partial<TaskView> = {}): TaskView =>
  task(id, { kind: 'mission', title: `Mission ${id}`, tier: 5, xp: 500, giver: { id: 'ana', name: 'Ana' }, seen: false, ...over });

const progress = (over: Partial<MyProgress> = {}): MyProgress => ({ xp: 12_340, kuartzons: 1450, streak: 3, owned: [], ...over });

beforeEach(() => {
  useOfficeStore.getState().reset();
  act(() => {
    useOfficeStore.getState().applyInit({ self, players: [], mapKey: 'office', chatHistory: [], desks: [], closedDesks: [], deskBans: [], progress: progress() });
  });
});

describe('le panneau Missions', () => {
  test('en tête, sa progression : le niveau, le grade, ce qu\'il reste avant le suivant, ses kuartzons et sa série', () => {
    render(<QuestPanel onClose={() => {}} />);
    const card = document.querySelector('.quest-card') as HTMLElement;
    expect(card.textContent).toContain('Niveau 12 · Stagiaire');
    expect(card.textContent).toContain('Encore 660 XP avant le niveau 13');
    expect(card.textContent?.replace(/[\u202f\u00a0]/g, ' ')).toContain('1 450 kuartzons');
    expect(card.textContent).toContain('3 jours');
  });

  test('les missions reçues d\'abord, avec qui les confie et leur difficulté, puis sa liste ; les nouvelles deviennent vues', async () => {
    act(() => useOfficeStore.getState().setTasks([task('t1'), mission('m1', { notes: 'Le K en violet' })]));
    render(<QuestPanel onClose={() => {}} />);
    const received = screen.getByRole('region', { name: fr.missions.received });
    expect(within(received).getByText('Mission m1')).toBeTruthy();
    expect(within(received).getByText(t(fr.missions.from, { name: 'Ana' }))).toBeTruthy();
    expect(within(received).getByText('Le K en violet')).toBeTruthy();
    expect(received.textContent).toContain('Difficulté 5 sur 10 · Consistante');
    expect(received.textContent).toContain('+500 XP');
    expect(within(screen.getByRole('region', { name: fr.missions.mine })).getByText('Tâche t1')).toBeTruthy();
    // Ouvert sur « À faire » : la mission nouvelle est vue, ici et au serveur.
    expect(progressApi.markMissionsSeen).toHaveBeenCalled();
    expect(useOfficeStore.getState().tasks!.find((t_) => t_.id === 'm1')!.seen).toBe(true);
  });

  test('terminer une mission : la tâche faite et la progression du serveur vont au magasin', async () => {
    const done = { task: mission('m1', { status: 'done', doneAt: '2026-10-24T09:00:00.000Z', seen: true }), progress: progress({ xp: 12_840 }) };
    vi.mocked(progressApi.completeTask).mockResolvedValueOnce(done);
    act(() => useOfficeStore.getState().setTasks([mission('m1')]));
    const user = userEvent.setup();
    render(<QuestPanel onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: t(fr.missions.finishLabel, { title: 'Mission m1' }) }));
    expect(progressApi.completeTask).toHaveBeenCalledWith('m1');
    expect(useOfficeStore.getState().tasks).toEqual([done.task]);
    expect(useOfficeStore.getState().progress?.xp).toBe(12_840);
  });

  test('rendre une mission demande confirmation', async () => {
    vi.mocked(progressApi.declineMission).mockResolvedValueOnce(mission('m1', { status: 'declined' }));
    act(() => useOfficeStore.getState().setTasks([mission('m1')]));
    const user = userEvent.setup();
    render(<QuestPanel onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: fr.missions.giveBack }));
    expect(progressApi.declineMission).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: fr.missions.giveBackYes }));
    expect(progressApi.declineMission).toHaveBeenCalledWith('m1');
    expect(screen.queryByRole('region', { name: fr.missions.received })).toBeNull();
  });

  test('ajouter une tâche à sa liste, la cocher, la supprimer', async () => {
    vi.mocked(progressApi.createTodo).mockResolvedValueOnce(task('t9', { title: 'Répondre au client' }));
    vi.mocked(progressApi.deleteTodo).mockResolvedValueOnce(undefined);
    act(() => useOfficeStore.getState().setTasks([]));
    const user = userEvent.setup();
    render(<QuestPanel onClose={() => {}} />);
    await user.type(screen.getByLabelText(fr.missions.addLabel), 'Répondre au client{Enter}');
    expect(progressApi.createTodo).toHaveBeenCalledWith({ title: 'Répondre au client' });
    expect(screen.getByRole('checkbox', { name: t(fr.missions.check, { title: 'Répondre au client' }) })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: t(fr.missions.remove, { title: 'Répondre au client' }) }));
    expect(progressApi.deleteTodo).toHaveBeenCalledWith('t9');
    expect(useOfficeStore.getState().tasks).toEqual([]);
  });

  test('le plafond du jour atteint : ses tâches ne rapportent plus rien aujourd\'hui, et le panneau le dit', () => {
    const today = new Date().toISOString();
    const doneToday = Array.from({ length: 5 }, (_, i) => task(`d${i}`, { status: 'done', doneAt: today }));
    act(() => useOfficeStore.getState().setTasks([task('t1'), ...doneToday]));
    render(<QuestPanel onClose={() => {}} />);
    expect(screen.getByText(fr.missions.todoCapped)).toBeTruthy();
    expect(document.querySelector('[data-task="t1"] .todo-xp')?.textContent).toBe('0 XP');
  });

  test('l\'onglet « Caractéristiques » montre sa fiche', async () => {
    vi.mocked(progressApi.fetchStats).mockResolvedValueOnce({
      id: 'bob',
      name: 'Bob',
      avatarKey: null,
      memberSince: '2026-10-19T08:00:00.000Z',
      timezone: 'Europe/Paris',
      xp: 12_340,
      missionsDone: 3,
      missionsByTier: [0, 0, 0, 0, 2, 0, 0, 0, 0, 1],
      missionsGiven: 1,
      todosDone: 4,
      streak: 3,
      gamesPlayed: 5,
      gamesWon: 2,
      kuartzons: 1450,
      history: [{ at: '2026-10-24T08:00:00.000Z', amount: 500, source: 'mission', label: 'Refaire le logo' }],
    });
    const user = userEvent.setup();
    render(<QuestPanel onClose={() => {}} />);
    await user.click(screen.getByRole('tab', { name: fr.missions.sheet }));
    expect(await screen.findByText('Membre depuis le 19 octobre 2026')).toBeTruthy();
    expect(screen.getByText(fr.sheet.authority)).toBeTruthy();
    expect(screen.getByText('2 sur 5')).toBeTruthy();
    expect(screen.getByText('Refaire le logo')).toBeTruthy();
  });
});
