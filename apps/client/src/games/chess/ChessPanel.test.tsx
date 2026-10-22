import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { audioEngine } from '../../audio/audio';
import { fr } from '../../i18n/fr';
import { useOfficeStore } from '../../state/office-store';
import { FakeSocket } from '../../test/fake-socket';
import { BASTIEN, CLAIRE, SELF, applyWorld, chair, match, table } from '../games-test-kit';
import { GamePanel } from '../GamePanel';
import { fromFen, play, square, squaresOnScreen, startState } from './chess-test-kit';

// Le plateau dans son vrai cadre : le panneau d'une table (GamePanel, GameFrame) avec le vrai module des échecs (ses règles et son interface). On vérifie ce que la plateforme et le jeu
// se disent : le plateau reçoit les propriétés de la plateforme, le coup part avec la version de la table, les lignes des joueurs, la ligne d'état, les sons et les annonces sont ceux du jeu.
vi.mock('../game-ui', async () => {
  const { chess } = await import('@bureau/shared/games/chess');
  const { default: ui } = await import('./index');
  return { loadGameModule: async (game: string) => (game === 'chess' ? { def: chess, ui } : null) };
});
vi.mock('../../audio/audio', () => ({ audioEngine: { playSfx: vi.fn() } }));

let socket: FakeSocket;
beforeEach(() => {
  socket = new FakeSocket();
  socket.serverAccepts();
  vi.mocked(audioEngine.playSfx).mockClear();
});

function open(view: ReturnType<typeof table>) {
  applyWorld([BASTIEN, CLAIRE], [view]);
  act(() => useOfficeStore.getState().openGame('chess'));
  return render(<GamePanel socket={socket.asSocket()} onClose={() => undefined} />);
}
const update = (view: ReturnType<typeof table>) => act(() => useOfficeStore.getState().setGameTable(view));
const sentCommands = () => socket.sent.filter(([event]) => event === 'game:do').map(([, payload]) => payload);
const grid = () => screen.findByRole('grid', { name: 'Échiquier' });

// Une partie entre Moi et Bastien : `white` est le joueur qui a les Blancs (0 : Moi, 1 : Bastien).
const playing = (state: ReturnType<typeof startState>, version: number, over: Parameters<typeof match>[2] = {}, order: string[] = [SELF, BASTIEN]) =>
  table('chess', version, { chairs: order.map((id) => chair(id)), match: match(order, state, over) });

describe('avant la partie', () => {
  test('l\'aperçu : l\'échiquier de départ, les Blancs en bas, rien de cliquable ; la salle d\'attente est au-dessus', async () => {
    open(table('chess', 1, { chairs: [chair(SELF), null] }));
    await grid();
    expect(document.querySelector('.game-chess')!.getAttribute('data-preview')).toBe('true');
    expect(squaresOnScreen()[0]).toBe('a8');
    expect(square('e2').getAttribute('aria-label')).toBe('e2, pion blanc');
    await userEvent.click(square('e2'));
    expect(square('e2').getAttribute('aria-label')).toBe('e2, pion blanc');
    expect(screen.getByText(fr.games.status.waiting)).toBeTruthy();
    expect(screen.getByRole('region', { name: fr.games.lobby.title })).toBeTruthy();
    // Le jeu a un bouton « Règles », qui montre l'aide du jeu.
    await userEvent.click(screen.getByRole('button', { name: fr.games.rules }));
    expect(screen.getByRole('region', { name: fr.games.rulesTitle })).toBeTruthy();
    expect(screen.getAllByText(/échec et mat/i).length).toBeGreaterThan(0);
  });
});

describe('une partie en cours', () => {
  test('mon coup part avec la version de la table : « e2 » puis « e4 » envoient { from, to }', async () => {
    open(playing(startState(0), 7));
    await grid();
    expect(screen.getAllByText(fr.games.status.yourTurn).length).toBeGreaterThan(0);
    await userEvent.click(square('e2'));
    await userEvent.click(square('e4'));
    expect(sentCommands().at(-1)).toEqual({ type: 'move', game: 'chess', version: 7, move: { from: 'e2', to: 'e4' } });
  });

  test('en attendant la réponse du serveur, le plateau ne joue plus ; la réponse (la table passe à la version suivante) rend la main au bon moment', async () => {
    open(playing(startState(0), 7));
    await grid();
    await userEvent.click(square('e2'));
    await userEvent.click(square('e4'));
    await userEvent.click(square('g1'));
    expect(square('g1').getAttribute('aria-label')).toBe('g1, cavalier blanc');
    const afterMine = play(startState(0), 'e2e4');
    update(playing(afterMine.state, 8, { events: afterMine.events }));
    expect(square('e4').getAttribute('aria-label')).toBe('e4, pion blanc, dernier coup');
    // C'est à Bastien : toujours rien à jouer.
    await userEvent.click(square('g1'));
    expect(square('g1').getAttribute('aria-label')).toBe('g1, cavalier blanc');
    const afterHis = play(afterMine.state, 'e7e5');
    update(playing(afterHis.state, 9, { events: afterHis.events }));
    await vi.waitFor(async () => {
      await userEvent.click(square('g1'));
      expect(square('g1').getAttribute('aria-label')).toBe('g1, cavalier blanc, sélectionnée');
    });
  });

  test('les lignes des joueurs disent leur couleur d\'après le siège qui a les Blancs, et le trait', async () => {
    open(playing(startState(0), 7));
    await grid();
    const rows = screen.getAllByRole('listitem').filter((row) => row.classList.contains('game-player'));
    expect(within(rows[0]!).getByText('Blancs')).toBeTruthy();
    expect(within(rows[0]!).getByText(fr.games.turn)).toBeTruthy();
    expect(within(rows[1]!).getByText('Noirs')).toBeTruthy();
    expect((rows[0]!.querySelector('.game-seat-dot') as HTMLElement).style.background).toMatch(/f2ead8|242, 234, 216/i);
  });

  test('avec les Noirs (le siège 1) : le plateau est retourné, et mon premier coup n\'est pas possible avant que les Blancs aient joué', async () => {
    open(playing(startState(0), 7, {}, [BASTIEN, SELF]));
    await grid();
    expect(squaresOnScreen()[0]).toBe('h1');
    expect(screen.getByText('Au tour de Bastien')).toBeTruthy();
    await userEvent.click(square('e7'));
    expect(square('e7').getAttribute('aria-label')).toBe('e7, pion noir');
    const afterHis = play(startState(0), 'e2e4');
    update(playing(afterHis.state, 8, { events: afterHis.events }, [BASTIEN, SELF]));
    await vi.waitFor(async () => {
      await userEvent.click(square('e7'));
      expect(square('e7').getAttribute('aria-label')).toBe('e7, pion noir, sélectionnée');
    });
    await userEvent.click(square('e5'));
    expect(sentCommands().at(-1)).toEqual({ type: 'move', game: 'chess', version: 8, move: { from: 'e7', to: 'e5' } });
  });

  test('une promotion passe par le choix, et la pièce choisie part avec le coup', async () => {
    open(playing(fromFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 0), 7));
    await grid();
    await userEvent.click(square('a7'));
    await userEvent.click(square('a8'));
    expect(sentCommands().some((command) => (command as { type: string }).type === 'move')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Cavalier' }));
    expect(sentCommands().at(-1)).toEqual({ type: 'move', game: 'chess', version: 7, move: { from: 'a7', to: 'a8', promotion: 'n' } });
  });

  test('un spectateur voit les mêmes coups, sans pouvoir rien jouer, avec les Blancs en bas', async () => {
    const afterOne = play(startState(0), 'e2e4');
    applyWorld([BASTIEN, CLAIRE], [table('chess', 5, { chairs: [chair(BASTIEN), chair(CLAIRE)], match: match([BASTIEN, CLAIRE], afterOne.state) })]);
    act(() => useOfficeStore.getState().openGame('chess'));
    render(<GamePanel socket={socket.asSocket()} onClose={() => undefined} />);
    await grid();
    expect(squaresOnScreen()[0]).toBe('a8');
    expect(square('e4').getAttribute('aria-label')).toBe('e4, pion blanc, dernier coup');
    await userEvent.click(square('e7'));
    expect(square('e7').getAttribute('aria-label')).toBe('e7, pion noir');
    expect(sentCommands().some((command) => (command as { type: string }).type === 'move')).toBe(false);
  });

  test('le coup de l\'autre : le son d\'une pièce part, et le lecteur d\'écran l\'entend avec « À toi de jouer »', async () => {
    open(playing(startState(0), 7));
    await grid();
    const moved = play(startState(0), 'e2e4');
    update(playing(moved.state, 8, { events: moved.events }));
    const answered = play(moved.state, 'e7e5');
    update(playing(answered.state, 9, { events: answered.events }));
    expect(await screen.findByText(new RegExp(`Bastien : pion en e5\\. ${fr.games.status.yourTurn}`))).toBeTruthy();
    expect(audioEngine.playSfx).toHaveBeenCalledWith('piece');
  });

  test('le plateau d\'une partie qui saute (version manquée, reconnexion) : l\'état final, sans glisser, sans son', async () => {
    const jumped = play(startState(0), 'e2e4 e7e5 g1f3');
    open(playing(jumped.state, 12, { events: jumped.events }));
    await grid();
    expect(document.querySelectorAll('[data-slide]')).toHaveLength(0);
    expect(audioEngine.playSfx).not.toHaveBeenCalled();
    expect(square('f3').getAttribute('aria-label')).toBe('f3, cavalier blanc, dernier coup');
  });
});

describe('la nulle et l\'abandon, portés par le cadre', () => {
  test('« Proposer la nulle » envoie l\'offre ; une offre de l\'autre a ses deux réponses', async () => {
    open(playing(play(startState(0), 'e2e4 e7e5').state, 9));
    await userEvent.click(await screen.findByRole('button', { name: fr.games.draw.offer }));
    expect(sentCommands().at(-1)).toEqual({ type: 'draw', game: 'chess', action: 'offer' });
    update(playing(play(startState(0), 'e2e4 e7e5').state, 10, { drawOffer: 1 }));
    expect(await screen.findByRole('button', { name: fr.games.draw.accept })).toBeTruthy();
    expect(screen.getByRole('button', { name: fr.games.draw.decline })).toBeTruthy();
  });
});

describe('la fin de la partie', () => {
  test('l\'échec et mat : la phrase du jeu, les notes, « Revanche », le roi cerné ; le son de victoire pour qui gagne', async () => {
    const before = play(startState(0), 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6');
    open(playing(before.state, 11));
    await grid();
    const mate = play(before.state, 'h5f7');
    update(
      playing(mate.state, 12, {
        status: 'ended',
        turnMs: null,
        result: { ranking: [[0], [1]], reason: 'checkmate' },
        ranked: true,
        ratings: [{ userId: SELF, before: 1200, after: 1216 }, { userId: BASTIEN, before: 1200, after: 1184 }],
        events: mate.events,
      }),
    );
    expect((await screen.findAllByText('Échec et mat : Moi gagne.')).length).toBeGreaterThan(0);
    expect(screen.getByText('Moi : 1200 → 1216 (+16)')).toBeTruthy();
    expect(screen.getByRole('button', { name: fr.games.actions.rematch })).toBeTruthy();
    expect(square('e8').getAttribute('aria-label')).toBe('e8, roi noir, en échec');
    expect(audioEngine.playSfx).toHaveBeenCalledWith('win');
    expect(audioEngine.playSfx).toHaveBeenCalledWith('piece');
    // La partie est finie : le plateau ne joue plus.
    await userEvent.click(square('f7'));
    expect(sentCommands().some((command) => (command as { type: string }).type === 'move')).toBe(false);
  });

  test.each([
    ['stalemate', 'Pat : nulle.'],
    ['insufficient', 'Matériel insuffisant : nulle.'],
    ['threefold', 'Triple répétition : nulle.'],
    ['fifty', 'Règle des 50 coups : nulle.'],
  ])('%s : « %s », dite par le jeu', async (reason, text) => {
    open(playing(play(startState(0), 'e2e4').state, 9));
    await grid();
    update(playing(play(startState(0), 'e2e4 e7e5').state, 10, { status: 'ended', turnMs: null, result: { ranking: [[0, 1]], reason }, ranked: false }));
    expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
  });

  test('un abandon est dit par la plateforme, pas par le jeu', async () => {
    open(playing(play(startState(0), 'e2e4 e7e5').state, 9));
    await grid();
    update(playing(play(startState(0), 'e2e4 e7e5').state, 10, { status: 'ended', turnMs: null, result: { ranking: [[1], [0]], reason: 'resign' }, ranked: true }));
    expect((await screen.findAllByText('Moi abandonne. Bastien gagne.')).length).toBeGreaterThan(0);
  });
});
