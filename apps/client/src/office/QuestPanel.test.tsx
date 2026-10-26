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

const progress = (over: Partial<MyProgress> = {}): MyProgress => ({ xp: 12_340, kuartzons: 1450, streak: 3, todoXpLeft: 100, owned: [], ...over });

beforeEach(() => {
  useOfficeStore.getState().reset();
  act(() => {
    useOfficeStore.getState().applyInit({ self, players: [], mapKey: 'office', chatHistory: [], desks: [], closedDesks: [], deskBans: [], progress: progress() });
  });
});

describe('le panneau Missions', () => {
  test('en tête, sa fiche : son nom, son grade, la pastille de son niveau, et l\'expérience du niveau en cours en dix cases', () => {
    render(<QuestPanel onClose={() => {}} />);
    const hero = document.querySelector('.sheet-hero') as HTMLElement;
    expect(hero.dataset.grade).toBe('stagiaire');
    expect(within(hero).getByText('Bob')).toBeTruthy();
    expect(within(hero).getByText('Stagiaire')).toBeTruthy();
    expect(within(hero).getByText(t(fr.progress.level, { level: 12 }))).toBeTruthy();
    expect(hero.textContent).toContain('Encore 660 XP avant le niveau 13');
    // 340 XP sur 1 000 dans le niveau : trois cases pleines, la quatrième aux deux cinquièmes.
    const bar = within(hero).getByRole('progressbar', { name: fr.sheet.xpBar });
    expect(bar.getAttribute('aria-valuetext')?.replace(/\u00a0/g, ' ')).toBe('340 / 1 000 XP');
    expect([...bar.querySelectorAll<HTMLElement>('.sheet-seg-fill')].map((fill) => fill.style.width)).toEqual(['100%', '100%', '100%', '40%', '0%', '0%', '0%', '0%', '0%', '0%']);
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

  test('une mission qu\'on s\'est donnée : « Ta propre mission », et on l\'abandonne au lieu de la rendre', async () => {
    const own = mission('m1', { giver: { id: 'bob', name: 'Bob' }, seen: true });
    vi.mocked(progressApi.declineMission).mockResolvedValueOnce({ ...own, status: 'declined', doneAt: '2026-10-24T09:00:00.000Z' });
    act(() => useOfficeStore.getState().setTasks([own]));
    const user = userEvent.setup();
    render(<QuestPanel onClose={() => {}} />);
    const received = screen.getByRole('region', { name: fr.missions.received });
    expect(within(received).getByText(fr.missions.fromSelf)).toBeTruthy();
    expect(within(received).queryByText(fr.missions.new)).toBeNull();
    await user.click(within(received).getByRole('button', { name: fr.missions.giveUp }));
    expect(received.textContent).toContain(fr.missions.giveUpConfirm);
    await user.click(within(received).getByRole('button', { name: fr.missions.giveUpYes }));
    expect(progressApi.declineMission).toHaveBeenCalledWith('m1');
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

  test('le plafond du jour atteint (le serveur le compte, dans le fuseau de la personne) : ses tâches ne rapportent plus rien, et le panneau le dit', () => {
    act(() => {
      useOfficeStore.getState().setTasks([task('t1')]);
      useOfficeStore.getState().setProgress(progress({ todoXpLeft: 0 }));
    });
    render(<QuestPanel onClose={() => {}} />);
    expect(screen.getByText(fr.missions.todoCapped)).toBeTruthy();
    expect(document.querySelector('[data-task="t1"] .todo-xp')?.textContent).toBe('0 XP');
  });

  test('presque au plafond : une tâche rapporte ce qui reste (« +10 XP »)', () => {
    act(() => {
      useOfficeStore.getState().setTasks([task('t1')]);
      useOfficeStore.getState().setProgress(progress({ todoXpLeft: 10 }));
    });
    render(<QuestPanel onClose={() => {}} />);
    expect(screen.queryByText(fr.missions.todoCapped)).toBeNull();
    expect(document.querySelector('[data-task="t1"] .todo-xp')?.textContent).toBe(t(fr.missions.todoXp, { xp: 10 }));
  });

  test('à l\'ouverture, sa progression relue ; une réponse arrivée après une plus récente (le temps réel) est ignorée', async () => {
    let answer: (p: MyProgress) => void = () => {};
    vi.mocked(progressApi.fetchMyProgress).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    render(<QuestPanel onClose={() => {}} />);
    act(() => useOfficeStore.getState().setProgress(progress({ xp: 13_000 })));
    await act(async () => answer(progress({ xp: 12_340 })));
    expect(useOfficeStore.getState().progress?.xp).toBe(13_000);
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
    expect(await screen.findByText(fr.sheet.memberSince)).toBeTruthy();
    expect(screen.getByText('19 oct. 2026')).toBeTruthy();
    expect(screen.getByText(fr.sheet.authority)).toBeTruthy();
    expect(screen.getByText('2 sur 5')).toBeTruthy();
    expect(screen.getByText('Refaire le logo')).toBeTruthy();
  });

  test('l\'onglet « Caractéristiques » ne redit pas le niveau : l\'essentiel et l\'activité en lignes, chaque valeur en face de son nom', async () => {
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
      history: [],
    });
    const user = userEvent.setup();
    render(<QuestPanel onClose={() => {}} />);
    await user.click(screen.getByRole('tab', { name: fr.missions.sheet }));
    await screen.findByText(fr.sheet.totalXp);

    // Le niveau n'est dit qu'une fois : l'en-tête du panneau, au-dessus des onglets ; la fiche de l'onglet n'en a pas d'autre.
    expect(document.querySelectorAll('.sheet-hero')).toHaveLength(1);
    expect(document.querySelectorAll('.level-badge')).toHaveLength(1);
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getByRole('tabpanel').querySelector('.sheet-hero')).toBeNull();

    // Chaque ligne : son nom, et sa valeur en face. L'essentiel (surligné), puis l'activité.
    const valueOf = (label: string) => screen.getByText(label).closest('.sheet-row')?.querySelector('dd')?.textContent?.replace(/\u00a0/g, ' ');
    const labels = (selector: string) => [...document.querySelectorAll(`${selector} .sheet-row-label`)].map((label) => label.textContent);
    expect(labels('.sheet-stats.is-key')).toEqual([fr.sheet.totalXp, fr.sheet.authority, fr.sheet.kuartzons]);
    expect(labels('.sheet-stats:not(.is-key)')).toEqual([fr.sheet.missionsDone, fr.sheet.missionsGiven, fr.sheet.todosDone, fr.sheet.streak, fr.sheet.games, fr.sheet.memberSince]);
    expect(valueOf(fr.sheet.totalXp)).toBe('12 340 XP');
    expect(valueOf(fr.sheet.authority)).toBe('12');
    expect(valueOf(fr.sheet.kuartzons)).toBe('1 450');
    expect(valueOf(fr.sheet.missionsGiven)).toBe('1');
    expect(valueOf(fr.sheet.streak)).toBe('3 jours');
    expect(valueOf(fr.sheet.games)).toBe('2 sur 5');
    expect(valueOf(fr.sheet.memberSince)).toBe('19 oct. 2026');

    // Les missions par difficulté : une colonne par difficulté, à sa teinte (data-tier).
    expect([...document.querySelectorAll<HTMLElement>('.sheet-tier')].map((tier) => tier.dataset.tier)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  });
});
