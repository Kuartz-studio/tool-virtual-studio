import { backgammon, backgammonStateFrom, STARTING_LAYOUT, type BackgammonEvent, type BackgammonLayout, type BackgammonState } from '@bureau/shared/games/backgammon';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { audioEngine } from '../../audio/audio';
import { fr } from '../../i18n/fr';
import { useOfficeStore } from '../../state/office-store';
import { FakeSocket } from '../../test/fake-socket';
import { BASTIEN, CLAIRE, SELF, applyWorld, chair, match, table } from '../games-test-kit';
import { GamePanel } from '../GamePanel';
import ui from './index';

// Le jeu dans le panneau de la plateforme, avec le vrai module (règles et interface) à la place du faux jeu des tests de la plateforme : le plateau d'aperçu, une partie jouée à la
// souris (le coup part avec la version de la table), les sons et l'annonce d'un lot d'événements, la pastille de chaque siège, la fin de partie avec son gammon.
vi.mock('../game-ui', async () => {
  const shared = await import('@bureau/shared/games/backgammon');
  const module = await import('./index');
  return { loadGameModule: async (game: string) => (game === 'backgammon' ? { def: shared.backgammon, ui: module.default } : null) };
});
vi.mock('../../audio/audio', () => ({ audioEngine: { playSfx: vi.fn() } }));

let socket: FakeSocket;
beforeEach(() => {
  socket = new FakeSocket();
  socket.serverAccepts();
  vi.mocked(audioEngine.playSfx).mockClear();
});

const position = (layout: BackgammonLayout): BackgammonState => backgammonStateFrom(layout);
const start = (dice?: number[], turn: 0 | 1 = 0): BackgammonState => position({ white: STARTING_LAYOUT, red: STARTING_LAYOUT, turn, ...(dice ? { dice } : {}) });

function open(view: ReturnType<typeof table>) {
  applyWorld([BASTIEN, CLAIRE], [view]);
  act(() => useOfficeStore.getState().openGame('backgammon'));
  return render(<GamePanel socket={socket.asSocket()} onClose={() => undefined} />);
}
const update = (view: ReturnType<typeof table>) => act(() => useOfficeStore.getState().setGameTable(view));
const sentCommands = () => socket.sent.filter(([event]) => event === 'game:do').map(([, payload]) => payload);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const click = (name: string | RegExp) => fireEvent.click(button(name));

// Une partie entre Moi (siège 0, les Blancs) et Bastien (siège 1, les Rouges), dans cet état, à cette version.
const playing = (state: BackgammonState, version: number, over: Parameters<typeof match>[2] = {}) =>
  table('backgammon', version, { chairs: [chair(SELF), chair(BASTIEN)], match: match([SELF, BASTIEN], state, over) });

describe('le module du jeu dans le panneau', () => {
  test('le module a tout ce que la plateforme lui demande : un plateau, une pastille par siège, une fin, une annonce, des sons, de quatre à huit phrases de règles', () => {
    expect(typeof ui.Board).toBe('function');
    expect(ui.seatLabel(0, start()).name).toBe('Blancs');
    expect(ui.seatLabel(1, start()).name).toBe('Rouges');
    expect(typeof ui.describeResult).toBe('function');
    expect(typeof ui.announce).toBe('function');
    expect(typeof ui.sounds).toBe('function');
    expect(ui.rules.length).toBeGreaterThanOrEqual(4);
    expect(ui.rules.length).toBeLessThanOrEqual(8);
  });

  test('avant la première partie : le plateau d\'aperçu, le départ, où rien n\'est cliquable, avec « Règles » dans l\'en-tête', async () => {
    open(table('backgammon', 3));
    expect(await screen.findByRole('grid', { name: 'Tablier de backgammon' })).toBeTruthy();
    expect(button('Point 24 : 2 pions blancs').getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('button', { name: /jouable/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lancer les dés' })).toBeNull();
    expect(screen.getByText(fr.games.status.waiting)).toBeTruthy();
    // « Règles » ouvre l'aide du jeu, en français, huit phrases au plus.
    fireEvent.click(button(fr.games.rules));
    const rules = screen.getByRole('region', { name: fr.games.rulesTitle });
    expect(within(rules).getAllByRole('listitem').length).toBeLessThanOrEqual(8);
    expect(within(rules).getByText(/Gammon et backgammon/)).toBeTruthy();
  });

  test('chaque joueur a la pastille de son camp : Blancs pour le siège 0, Rouges pour le siège 1', async () => {
    open(playing(start(), 7));
    await screen.findByRole('grid', { name: 'Tablier de backgammon' });
    const rows = screen.getAllByRole('listitem').filter((row) => row.classList.contains('game-player'));
    expect(within(rows[0]!).getByText('Blancs')).toBeTruthy();
    expect(within(rows[1]!).getByText('Rouges')).toBeTruthy();
  });
});

describe('une partie jouée à la souris', () => {
  test('« Lancer les dés » envoie `roll` avec la version de la table', async () => {
    open(playing(start(), 7));
    await screen.findByRole('grid', { name: 'Tablier de backgammon' });
    click('Lancer les dés');
    expect(sentCommands().at(-1)).toEqual({ type: 'move', game: 'backgammon', version: 7, move: { type: 'roll' } });
  });

  test('le tour construit étape par étape part en un seul coup `play`, quand il est complet, avec la version de la table', async () => {
    open(playing(start([3, 1]), 9));
    await screen.findByRole('grid', { name: 'Tablier de backgammon' });
    click('Point 8 : 3 pions blancs, jouable');
    click('Point 5 : vide, arrivée possible');
    click(/^Point 6 : 5 pions blancs, jouable/);
    click(/^Point 5 : 1 pion blanc, (jouable, )?arrivée possible/);
    expect(sentCommands().filter((command) => (command as { type: string }).type === 'move')).toHaveLength(0);
    click('Valider');
    const moves = sentCommands().filter((command) => (command as { type: string }).type === 'move');
    expect(moves).toEqual([
      {
        type: 'move',
        game: 'backgammon',
        version: 9,
        move: {
          type: 'play',
          steps: [
            { from: 8, to: 5, die: 3 },
            { from: 6, to: 5, die: 1 },
          ],
        },
      },
    ]);
  });

  test('en attendant la réponse du serveur, le plateau est inerte ; la réponse (une nouvelle version) rend la main à l\'autre', async () => {
    open(playing(start(), 7));
    await screen.findByRole('grid', { name: 'Tablier de backgammon' });
    click('Lancer les dés');
    expect(screen.queryByRole('button', { name: 'Lancer les dés' })).toBeNull();
    const rolled = backgammon.apply(start(), 0, { type: 'roll' }, () => 0.5);
    if (!rolled.ok) throw new Error(rolled.error);
    update(playing(rolled.state, 8, { events: rolled.events }));
    // Les dés sont tombés sur 4 et 4 (0,5 donne un 4) : un doublé, quatre étapes à jouer, et le plateau est de nouveau à moi.
    expect(await screen.findByRole('button', { name: /^Point 13 : 5 pions blancs, jouable/ })).toBeTruthy();
  });
});

describe('les événements : sons et annonces', () => {
  test('un lancer de l\'adversaire : le son des dés part, le lecteur d\'écran entend « Bastien lance 6 et 1. », puis les dés roulent sur le plateau', async () => {
    open(playing(start(undefined, 1), 7));
    await screen.findByRole('grid', { name: 'Tablier de backgammon' });
    const events: BackgammonEvent[] = [{ type: 'dice', seat: 1, values: [6, 1] }];
    update(playing(start([6, 1], 1), 8, { events }));
    await vi.waitFor(() => expect(audioEngine.playSfx).toHaveBeenCalledWith('dice'));
    expect(await screen.findByText(/Bastien lance 6 et 1\./)).toBeTruthy();
  });

  test('un tour joué par l\'autre : un son de pion par étape, et la phrase de ses étapes, avec « et frappe » s\'il a frappé', async () => {
    // Les Blancs ont un pion seul sur leur point 8, qui est le point 17 des Rouges : le pion rouge du point 22 le frappe avec un 5.
    const blot = position({ white: { 13: 14, 8: 1 }, red: { 22: 1, 6: 14 }, turn: 1, dice: [5, 1] });
    open(playing(blot, 7));
    await screen.findByRole('grid', { name: 'Tablier de backgammon' });
    const played = backgammon.apply(blot, 1, { type: 'play', steps: [{ from: 22, to: 17, die: 5 }, { from: 6, to: 5, die: 1 }] }, () => 0.5);
    if (!played.ok) throw new Error(played.error);
    update(playing(played.state, 8, { events: played.events }));
    await vi.waitFor(() => expect(vi.mocked(audioEngine.playSfx).mock.calls.filter(([id]) => id === 'piece')).toHaveLength(2));
    expect(await screen.findByText(/Bastien joue 22 vers 17, 6 vers 5, et frappe\./)).toBeTruthy();
  });

  test('une version qui saute (le panneau s\'ouvre, un message manqué) : aucun son, aucune annonce de tour', async () => {
    const rolled = backgammon.apply(start(), 0, { type: 'roll' }, () => 0.5);
    if (!rolled.ok) throw new Error(rolled.error);
    open(playing(rolled.state, 8, { events: rolled.events }));
    await screen.findByRole('grid', { name: 'Tablier de backgammon' });
    expect(audioEngine.playSfx).not.toHaveBeenCalled();
    expect(screen.queryByText(/lance/)).toBeNull();
  });
});

describe('la fin d\'une partie', () => {
  const ended = (state: BackgammonState, version: number, over: Parameters<typeof match>[2]) => playing(state, version, { status: 'ended', turnMs: null, ...over });

  test('les quinze pions sortis, le perdant n\'a rien sorti : « Gammon ! » est dit, avec les changements de note, et le son de la victoire part pour qui gagne', async () => {
    const last = position({ white: { 13: 1 }, whiteOff: 14, red: { 6: 15 }, dice: [5, 5], turns: 5 });
    open(playing(last, 11));
    await screen.findByRole('grid', { name: 'Tablier de backgammon' });
    const finished = backgammon.apply(last, 0, { type: 'play', steps: [{ from: 13, to: 8, die: 5 }, { from: 8, to: 3, die: 5 }, { from: 3, to: 'off', die: 5 }] }, () => 0.5);
    if (!finished.ok) throw new Error(finished.error);
    update(
      ended(finished.state, 12, {
        result: backgammon.result(finished.state),
        ranked: true,
        ratings: [{ userId: SELF, before: 1200, after: 1216 }, { userId: BASTIEN, before: 1200, after: 1184 }],
        events: finished.events,
      }),
    );
    expect((await screen.findAllByText('Moi a sorti tous ses pions. Gammon !')).length).toBeGreaterThan(0);
    expect(screen.getByText('Moi : 1200 → 1216 (+16)')).toBeTruthy();
    expect(screen.getByText('Bastien : 1200 → 1184 (−16)')).toBeTruthy();
    // La victoire sonne après le dernier pion (la plateforme espace les sons d'un lot de GAME_SOUND_GAP_MS).
    await vi.waitFor(() => expect(audioEngine.playSfx).toHaveBeenCalledWith('win'), { timeout: 3000 });
    // Le plateau est inerte, la salle d'attente (avec « Revanche ») est revenue.
    expect(screen.queryByRole('button', { name: /jouable/ })).toBeNull();
    expect(screen.getByRole('button', { name: fr.games.actions.rematch })).toBeTruthy();
  });

  test('un backgammon, une victoire simple, un abandon : chacun sa phrase (l\'abandon est dit par la plateforme, jamais comme un gammon)', async () => {
    const base = position({ white: { 13: 1 }, whiteOff: 14, red: { 6: 15 }, dice: [5, 5], turns: 5 });
    open(playing(base, 11));
    await screen.findByRole('grid', { name: 'Tablier de backgammon' });
    update(ended(base, 12, { result: { ranking: [[1], [0]], reason: 'bearoff', detail: { kind: 'backgammon' } }, ranked: true }));
    expect((await screen.findAllByText('Bastien a sorti tous ses pions. Backgammon !')).length).toBeGreaterThan(0);
    update(ended(base, 13, { result: { ranking: [[0], [1]], reason: 'bearoff', detail: { kind: 'simple' } }, ranked: true }));
    expect((await screen.findAllByText('Moi a sorti tous ses pions.')).length).toBeGreaterThan(0);
    update(ended(base, 14, { result: { ranking: [[1], [0]], reason: 'resign', detail: { kind: 'simple' } }, ranked: false }));
    expect((await screen.findAllByText('Moi abandonne. Bastien gagne.')).length).toBeGreaterThan(0);
  });
});

describe('l\'accessibilité', () => {
  test('une seule région d\'annonce (aria-live) dans le panneau, le plateau n\'en ajoute aucune', async () => {
    open(playing(start([3, 1]), 7));
    await screen.findByRole('grid', { name: 'Tablier de backgammon' });
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
  });
});
