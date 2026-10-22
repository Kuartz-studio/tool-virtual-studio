import { fabricateLudo, ludo, type LudoState } from '@bureau/shared/games/ludo';
import { rngFromDice, scriptedRng } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { audioEngine } from '../../audio/audio';
import { useOfficeStore } from '../../state/office-store';
import { FakeSocket } from '../../test/fake-socket';
import { loadGameModule } from '../game-ui';
import { BASTIEN, SELF, applyWorld, chair, match, table } from '../games-test-kit';
import { GamePanel } from '../GamePanel';
import ludoUi from './index';

// Le module des petits chevaux dans le vrai panneau de la plateforme : le chargement par `game-ui.ts` (le registre partagé, l'interface de ce dossier), le plateau d'aperçu, un tour,
// les sons et les annonces d'un coup qui suit le précédent, la fin de partie. Le son est espionné.
vi.mock('../../audio/audio', () => ({ audioEngine: { playSfx: vi.fn() } }));

let socket: FakeSocket;
beforeEach(() => {
  socket = new FakeSocket();
  socket.serverAccepts();
  vi.mocked(audioEngine.playSfx).mockClear();
});

const STABLE = [-1, -1, -1, -1];
const chairs = [chair(SELF), chair(BASTIEN), null, null];

function open(view: ReturnType<typeof table>) {
  applyWorld([BASTIEN], [view]);
  act(() => useOfficeStore.getState().openGame('ludo'));
  return render(<GamePanel socket={socket.asSocket()} onClose={() => undefined} />);
}
const update = (view: ReturnType<typeof table>) => act(() => useOfficeStore.getState().setGameTable(view));
const sentCommands = () => socket.sent.filter(([event]) => event === 'game:do').map(([, payload]) => payload);
// Une partie en cours entre Moi (siège 0, rouge) et Bastien (siège 1, jaune) : cet état, cette version.
const playing = (state: LudoState, version: number, over: Parameters<typeof match>[2] = {}) => table('ludo', version, { chairs, match: match([SELF, BASTIEN], state, over) });

describe('le module est chargé par la plateforme', () => {
  test('loadGameModule(\'ludo\') rend les règles du registre partagé et l\'interface de ce dossier', async () => {
    const loaded = await loadGameModule('ludo');
    expect(loaded?.def.id).toBe('ludo');
    expect(loaded?.def.label).toBe('Petits chevaux');
    expect(loaded?.ui).toBe(ludoUi);
  });

  test('le GameUi est complet : un plateau, des pastilles, une fin de partie, des annonces, des sons, de quatre à huit règles', () => {
    expect(typeof ludoUi.Board).toBe('function');
    for (const name of ['seatLabel', 'describeResult', 'announce', 'sounds'] as const) expect(typeof ludoUi[name]).toBe('function');
    expect(ludoUi.rules.length).toBeGreaterThanOrEqual(4);
    expect(ludoUi.rules.length).toBeLessThanOrEqual(8);
  });
});

describe('dans le panneau', () => {
  test('avant la première partie : le plateau d\'aperçu, huit chevaux à l\'écurie pour deux assis, rien de cliquable', async () => {
    open(table('ludo', 1, { chairs }));
    expect(await screen.findByRole('img', { name: 'Plateau des petits chevaux' })).toBeTruthy();
    const horses = [...document.querySelectorAll('.ludo-horse')];
    expect(horses).toHaveLength(8);
    expect(horses.every((horse) => horse.getAttribute('data-advance') === '-1')).toBe(true);
    expect(document.querySelectorAll('.ludo-roll, .ludo-move, .ludo-hit')).toHaveLength(0);
    expect(screen.getByText('En attente de la partie')).toBeTruthy();
  });

  test('chaque joueur a la couleur que dit le jeu : à deux, rouge et jaune (le siège 1 est jaune)', async () => {
    open(playing(ludo.create({ seats: 2, first: 0 }, () => 0.5).state, 7));
    await screen.findByRole('img', { name: 'Plateau des petits chevaux' });
    const rows = screen.getAllByRole('listitem').filter((row) => row.classList.contains('game-player'));
    expect(within(rows[0]!).getByText('Rouge')).toBeTruthy();
    expect(within(rows[1]!).getByText('Jaune')).toBeTruthy();
  });

  test('à moi de lancer : « Lancer le dé » envoie le coup { type: \'roll\' } avec la version de la table', async () => {
    open(playing(ludo.create({ seats: 2, first: 0 }, () => 0.5).state, 7));
    await userEvent.click(await screen.findByRole('button', { name: 'Lancer le dé' }));
    expect(sentCommands().at(-1)).toEqual({ type: 'move', game: 'ludo', version: 7, move: { type: 'roll' } });
    // En attendant la réponse du serveur, rien d'autre n'est jouable.
    expect(screen.getByRole('button', { name: 'Lancer le dé' }).getAttribute('aria-disabled')).toBe('true');
  });

  test('le coup d\'un cheval : un bouton par coup possible, qui envoie { type: \'move\', horse }', async () => {
    const state = fabricateLudo({ horses: [[-1, 10, 50, -1], [5, -1, -1, -1]], die: 6 });
    open(playing(state, 9));
    await userEvent.click(await screen.findByRole('button', { name: 'Cheval 3 : arrivée' }));
    expect(sentCommands().at(-1)).toEqual({ type: 'move', game: 'ludo', version: 9, move: { type: 'move', horse: 2 } });
  });

  test('un lancer d\'un autre qui suit le précédent : le son « dice », l\'annonce du lecteur d\'écran, et le dé qui finit sur la valeur du serveur', async () => {
    const before = fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]], turn: 1 });
    open(playing(before, 7));
    await screen.findByRole('img', { name: 'Plateau des petits chevaux' });
    const rolled = ludo.apply(before, 1, { type: 'roll' }, scriptedRng(rngFromDice([4])));
    if (!rolled.ok) throw new Error('lancer refusé');
    update(playing(rolled.state, 8, { events: rolled.events }));
    await vi.waitFor(() => expect(audioEngine.playSfx).toHaveBeenCalledWith('dice'));
    expect(await screen.findByText(/Bastien lance un 4\./)).toBeTruthy();
    await vi.waitFor(() => expect(screen.getByRole('img', { name: 'Dé : 4' })).toBeTruthy());
  });

  test('un coup avec prise : le son « piece », et l\'annonce dit le coup et la prise', async () => {
    // À deux, le siège 1 est jaune (départ en case 26) : son cheval à l'avancée 40 est en case (26 + 40) mod 52 = 14, où le rouge arrive en avançant de 10 à 14.
    const before = fabricateLudo({ horses: [[-1, 10, -1, -1], [40, -1, -1, -1]], die: 4 });
    open(playing(before, 7));
    await screen.findByRole('button', { name: 'Cheval 2 : avancer de 4, prise !' });
    const played = ludo.apply(before, 0, { type: 'move', horse: 1 }, () => 0.5);
    if (!played.ok) throw new Error('coup refusé');
    update(playing(played.state, 8, { events: played.events }));
    await vi.waitFor(() => expect(audioEngine.playSfx).toHaveBeenCalledWith('piece'));
    expect(await screen.findByText(/Moi avance le cheval 2 de 4\. Moi prend un cheval de Bastien\./)).toBeTruthy();
  });

  test('la partie finie : la phrase de fin du jeu, le classement complet avec les avancées, et les notes de la plateforme', async () => {
    const start = fabricateLudo({ horses: [[56, 56, 56, 55], [20, 21, -1, -1]], die: 1, moves: 5 });
    const ended = ludo.apply(start, 0, { type: 'move', horse: 3 }, () => 0.5);
    if (!ended.ok) throw new Error('coup refusé');
    open(
      playing(ended.state, 9, {
        status: 'ended',
        result: ended.state.result,
        events: ended.events,
        turnMs: null,
        ranked: true,
        ratings: [{ userId: SELF, before: 1200, after: 1216 }, { userId: BASTIEN, before: 1200, after: 1184 }],
      }),
    );
    expect(await screen.findByText('Moi a ramené ses quatre chevaux.')).toBeTruthy();
    const standings = screen.getByRole('list', { name: 'Classement de la partie' });
    expect(within(standings).getAllByRole('listitem').map((row) => row.textContent)).toEqual(['1. Moi, rouge : avancée 228 sur 228', '2. Bastien, jaune : avancée 43 sur 228']);
    expect(screen.getByText(/Moi : 1200 → 1216 \(\+16\)/)).toBeTruthy();
    expect(screen.getByText(/Bastien : 1200 → 1184 \(−16\)/)).toBeTruthy();
  });

  test('« Règles » ouvre l\'aide du jeu', async () => {
    open(table('ludo', 1, { chairs }));
    await userEvent.click(await screen.findByRole('button', { name: 'Règles' }));
    const region = screen.getByRole('region', { name: 'Règles du jeu' });
    expect(within(region).getAllByRole('listitem').map((item) => item.textContent)).toEqual(ludoUi.rules);
  });
});

test('un état de la plateforme avec un siège sorti ne fait pas lever le plateau', async () => {
  const state = ludo.forfeit(fabricateLudo({ horses: [STABLE, STABLE, STABLE] }), 2, 'resign').state;
  applyWorld([BASTIEN], [table('ludo', 5, { chairs: [chair(SELF), chair(BASTIEN), chair('claire'), null], match: match([SELF, BASTIEN, 'claire'], state, {}) })]);
  act(() => useOfficeStore.getState().openGame('ludo'));
  render(<GamePanel socket={socket.asSocket()} onClose={() => undefined} />);
  expect(await screen.findByRole('img', { name: 'Plateau des petits chevaux' })).toBeTruthy();
  expect(document.querySelector('.ludo-yard[data-color="2"]')?.getAttribute('data-out')).toBe('true');
});
