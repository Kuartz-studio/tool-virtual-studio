import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { audioEngine } from '../audio/audio';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { BASTIEN, CLAIRE, SELF, applyWorld, chair, match, morpion, table } from './games-test-kit';
import { GAME_SOUND_GAP_MS } from './GameFrame';
import { GamePanel } from './GamePanel';

// Le panneau d'une table avec un faux jeu complet (le morpion) : le module du jeu est celui de games-test-kit.tsx. Le son est espionné.
vi.mock('./game-ui', async () => {
  const kit = await import('./games-test-kit');
  return { loadGameModule: async (game: string) => (game === 'connect4' ? kit.tictactoeModule : null) };
});
vi.mock('../audio/audio', () => ({ audioEngine: { playSfx: vi.fn() } }));

let socket: FakeSocket;
let closed = 0;
beforeEach(() => {
  socket = new FakeSocket();
  socket.serverAccepts();
  closed = 0;
  vi.mocked(audioEngine.playSfx).mockClear();
});

// Le panneau ouvert sur cette table (Puissance 4, où joue le morpion), avec le monde au magasin.
function open(view = table('connect4', 5), game: 'connect4' | 'chess' = 'connect4') {
  applyWorld([BASTIEN, CLAIRE], [view, table('chess', 1)]);
  act(() => useOfficeStore.getState().openGame(game));
  return render(<GamePanel socket={socket.asSocket()} onClose={() => closed++} />);
}
const update = (view: ReturnType<typeof table>) => act(() => useOfficeStore.getState().setGameTable(view));
const sentCommands = () => socket.sent.filter(([event]) => event === 'game:do').map(([, payload]) => payload);
const answerWith = (ack: unknown) => act(() => socket.pendingAcks.at(-1)!.callback(null, ack));
const cell = (n: number) => screen.getByRole('button', { name: `case ${n}` }) as HTMLButtonElement;
const board = () => screen.getByRole('grid', { name: 'Plateau de morpion' });

// Une partie en cours entre Moi (siège 0) et Bastien, à cette étape (les cases jouées).
const playing = (cells: number[], version: number, over: Parameters<typeof match>[2] = {}) =>
  table('connect4', version, { chairs: [chair(SELF), chair(BASTIEN)], match: match([SELF, BASTIEN], morpion(cells), over) });

describe('l\'ouverture', () => {
  test('le titre est le nom du jeu ; le panneau regarde la table (`watch`) à l\'ouverture, et ne la regarde plus (`unwatch`) à la fermeture', async () => {
    const view = open();
    expect(await screen.findByRole('complementary', { name: 'Puissance 4' })).toBeTruthy();
    await vi.waitFor(() => expect(sentCommands()).toEqual([{ type: 'watch', game: 'connect4' }]));
    view.unmount();
    expect(sentCommands()).toEqual([{ type: 'watch', game: 'connect4' }, { type: 'unwatch', game: 'connect4' }]);
  });

  test('« Fermer » ferme le panneau', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: fr.ui.close }));
    expect(closed).toBe(1);
  });

  test('un jeu sans module (« Bientôt ») : on le dit, la salle d\'attente reste là, et pas de bouton « Règles »', async () => {
    open(table('chess', 1), 'chess');
    expect(await screen.findByText(fr.games.soon)).toBeTruthy();
    expect(screen.getByText(fr.games.soonHint)).toBeTruthy();
    expect(screen.getByRole('region', { name: fr.games.lobby.title })).toBeTruthy();
    expect(screen.queryByRole('button', { name: fr.games.rules })).toBeNull();
  });

  test('avant la première partie : le plateau d\'aperçu, où rien n\'est cliquable', async () => {
    open();
    expect(await screen.findByRole('grid', { name: 'Plateau de morpion' })).toBeTruthy();
    expect(board().getAttribute('data-preview')).toBe('true');
    for (const n of [1, 5, 9]) expect(cell(n).disabled).toBe(true);
    expect(screen.getByText(fr.games.status.waiting)).toBeTruthy();
  });

  test('« Règles » ouvre l\'aide du jeu, et la referme', async () => {
    open();
    const button = await screen.findByRole('button', { name: fr.games.rules });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(button);
    expect(screen.getByRole('region', { name: fr.games.rulesTitle })).toBeTruthy();
    expect(screen.getByText('Trois pions alignés gagnent.')).toBeTruthy();
    await userEvent.click(button);
    expect(screen.queryByRole('region', { name: fr.games.rulesTitle })).toBeNull();
  });

  test('deux onglets, « Partie » et « Classement » : le second demande le classement', async () => {
    open();
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Partie', 'Classement']);
    await userEvent.click(screen.getByRole('tab', { name: 'Classement' }));
    expect(socket.sent.some(([event, payload]) => event === 'game:ladder' && (payload as { game: string }).game === 'connect4')).toBe(true);
    await userEvent.click(screen.getByRole('tab', { name: 'Partie' }));
    expect(await screen.findByRole('grid', { name: 'Plateau de morpion' })).toBeTruthy();
  });
});

describe('une partie en cours', () => {
  test('à moi de jouer : « À toi de jouer », le plateau est actif, et un clic envoie le coup avec la version de la table (P30)', async () => {
    open(playing([], 7));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    expect(screen.getAllByText(fr.games.status.yourTurn).length).toBeGreaterThan(0);
    expect(cell(5).disabled).toBe(false);
    expect(board().getAttribute('data-preview')).toBeNull();
    // Pendant la partie, la salle d'attente n'est pas là : elle revient à la fin.
    expect(screen.queryByRole('region', { name: fr.games.lobby.title })).toBeNull();
    await userEvent.click(cell(5));
    expect(sentCommands().at(-1)).toEqual({ type: 'move', game: 'connect4', version: 7, move: { cell: 4 } });
  });

  test('pendant l\'attente de la réponse, rien d\'autre n\'est jouable ; la réponse du serveur (une nouvelle version) rend la main', async () => {
    open(playing([], 7));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    await userEvent.click(cell(5));
    expect(cell(1).disabled).toBe(true);
    update(playing([4], 8));
    expect(cell(1).disabled).toBe(true);   // c'est à Bastien maintenant
    expect(cell(5).textContent).toBe('X');
    // Il joue : c'est de nouveau à moi, et rien n'attend plus la réponse du serveur.
    update(playing([4, 0], 9, { events: [{ type: 'placed', seat: 1, cell: 0 }] }));
    await vi.waitFor(() => expect(cell(2).disabled).toBe(false));
  });

  test('un coup refusé : la raison est montrée, le plateau reprend la main ; « stale » se tait', async () => {
    open(playing([], 7));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    await userEvent.click(cell(5));
    answerWith({ ok: false, error: 'illegal' });
    expect(await screen.findByText(fr.games.errors.illegal)).toBeTruthy();
    await vi.waitFor(() => expect(cell(1).disabled).toBe(false));
    await userEvent.click(cell(1));
    answerWith({ ok: false, error: 'stale' });
    await vi.waitFor(() => expect(cell(2).disabled).toBe(false));
    expect(screen.queryByText(fr.games.errors.stale)).toBeNull();
  });

  test('au tour de l\'autre : le plateau n\'est pas actif et la ligne d\'état dit qui joue', async () => {
    open(playing([4], 8));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    for (const n of [1, 2, 9]) expect(cell(n).disabled).toBe(true);
    expect(screen.getByText(t(fr.games.status.turnOf, { name: 'Bastien' }))).toBeTruthy();
  });

  test('un spectateur : rien n\'est jouable, et la ligne d\'état dit qui joue ; il lit qu\'il regarde', async () => {
    applyWorld([BASTIEN, CLAIRE], [table('connect4', 5, { chairs: [chair(BASTIEN), chair(CLAIRE)], match: match([BASTIEN, CLAIRE], morpion([]), {}) })]);
    act(() => useOfficeStore.getState().openGame('connect4'));
    render(<GamePanel socket={socket.asSocket()} onClose={() => closed++} />);
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    expect(cell(1).disabled).toBe(true);
    expect(screen.getByText(t(fr.games.status.turnOf, { name: 'Bastien' }))).toBeTruthy();
    expect(screen.getByText(fr.games.status.watching)).toBeTruthy();
    // Un spectateur n'a ni « Abandonner » ni salle d'attente avec « Prêt » pendant la partie.
    expect(screen.queryByRole('button', { name: fr.games.actions.resign })).toBeNull();
  });

  test('chaque joueur : son nom, sa couleur dite par le jeu, « toi » pour soi, et le trait', async () => {
    open(playing([], 7));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    const rows = screen.getAllByRole('listitem').filter((row) => row.classList.contains('game-player'));
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Croix')).toBeTruthy();
    expect(within(rows[0]!).getByText(`(${fr.games.you})`)).toBeTruthy();
    expect(within(rows[0]!).getByText(fr.games.turn)).toBeTruthy();
    expect(within(rows[1]!).getByText('Ronds')).toBeTruthy();
    expect(within(rows[1]!).queryByText(fr.games.turn)).toBeNull();
  });

  test('les spectateurs sont nommés', async () => {
    open(playing([], 7, {}));
    update({ ...playing([], 8), spectators: [{ id: CLAIRE, name: 'Claire' }] });
    expect(await screen.findByText(t(fr.games.spectators.one, { names: 'Claire' }))).toBeTruthy();
    update({ ...playing([], 9), spectators: [{ id: CLAIRE, name: 'Claire' }, { id: 'dan', name: 'Dan' }] });
    expect(await screen.findByText(t(fr.games.spectators.many, { count: 2, names: 'Claire, Dan' }))).toBeTruthy();
  });
});

describe('les événements, les sons et les annonces', () => {
  test('une version qui suit la précédente : le plateau reçoit les événements, le son du jeu part, le lecteur d\'écran entend le coup', async () => {
    open(playing([], 7));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    expect(board().getAttribute('data-events')).toBe('0');
    update(playing([4], 8, { events: [{ type: 'placed', seat: 0, cell: 4 }] }));
    await vi.waitFor(() => expect(board().getAttribute('data-events')).toBe('1'));
    expect(audioEngine.playSfx).toHaveBeenCalledWith('piece');
    expect(await screen.findByText(/Moi joue la case 5\./)).toBeTruthy();
  });

  // Le moteur audio écarte un même effet rejoué avant son délai (un pion : 120 ms) : les quatre pions d'un doublet joués d'un coup ne feraient qu'un bruit.
  test('plusieurs sons d\'un même lot sont joués à la suite, espacés de GAME_SOUND_GAP_MS', async () => {
    const playedAt: Array<[string, number]> = [];
    vi.mocked(audioEngine.playSfx).mockImplementation((id) => void playedAt.push([id, performance.now()]));
    open(playing([], 7));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    const placed = (cell: number) => ({ type: 'placed' as const, seat: 0, cell });
    update(playing([4], 8, { events: [placed(4), placed(0), placed(8)] }));
    await vi.waitFor(() => expect(playedAt).toHaveLength(3), { timeout: 3000 });
    expect(playedAt.map(([id]) => id)).toEqual(['piece', 'piece', 'piece']);
    const gaps = [playedAt[1]![1] - playedAt[0]![1], playedAt[2]![1] - playedAt[1]![1]];
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(GAME_SOUND_GAP_MS - 40);
      expect(gap).toBeLessThan(GAME_SOUND_GAP_MS * 3);
    }
    vi.mocked(audioEngine.playSfx).mockReset();
  });

  test('une nouvelle version coupe les sons du lot d\'avant qui n\'ont pas encore joué', async () => {
    vi.mocked(audioEngine.playSfx).mockReset();
    open(playing([], 7));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    const placed = (cell: number) => ({ type: 'placed' as const, seat: 0, cell });
    update(playing([4], 8, { events: [placed(4), placed(0), placed(8)] }));
    await vi.waitFor(() => expect(audioEngine.playSfx).toHaveBeenCalledTimes(1));
    // Une version qui saute : ni événement ni son, et les deux pions qui restaient à jouer ne sonnent plus.
    update(playing([4, 0, 8, 1], 10));
    await new Promise((resolve) => setTimeout(resolve, GAME_SOUND_GAP_MS * 3));
    expect(audioEngine.playSfx).toHaveBeenCalledTimes(1);
  });

  test('une version qui saute (le panneau s\'ouvre, la connexion revient, un message manqué) : aucun événement, aucun son', async () => {
    open(playing([4], 8, { events: [{ type: 'placed', seat: 0, cell: 4 }] }));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    expect(board().getAttribute('data-events')).toBe('0');
    update(playing([4, 0], 10, { events: [{ type: 'placed', seat: 1, cell: 0 }] }));
    await vi.waitFor(() => expect(cell(1).textContent).toBe('O'));
    expect(board().getAttribute('data-events')).toBe('0');
    expect(audioEngine.playSfx).not.toHaveBeenCalled();
  });

  test('« À toi de jouer » est annoncé quand le trait passe à soi', async () => {
    open(playing([4], 8));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    update(playing([4, 0], 9, { events: [{ type: 'placed', seat: 1, cell: 0 }] }));
    expect(await screen.findByText(new RegExp(`Bastien joue la case 1\\. ${fr.games.status.yourTurn}`))).toBeTruthy();
  });
});

describe('la fin d\'une partie', () => {
  const ended = (cells: number[], version: number, result: Parameters<typeof match>[2]) => table('connect4', version, { chairs: [chair(SELF), chair(BASTIEN)], match: match([SELF, BASTIEN], morpion(cells), { status: 'ended', turnMs: null, ...result }) });

  test('la raison du jeu est dite par son module, avec les changements de note ; « Revanche » remplace « Prêt »', async () => {
    open(playing([0, 3, 1, 4], 11));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    update(
      ended([0, 3, 1, 4, 2], 12, {
        result: { ranking: [[0], [1]], reason: 'line', detail: { cells: [0, 1, 2] } },
        ranked: true,
        ratings: [{ userId: SELF, before: 1200, after: 1216 }, { userId: BASTIEN, before: 1200, after: 1184 }],
        events: [{ type: 'placed', seat: 0, cell: 2 }],
      }),
    );
    expect((await screen.findAllByText('Ligne de trois : Moi gagne.')).length).toBeGreaterThan(0);
    expect(screen.getByText('Moi : 1200 → 1216 (+16)')).toBeTruthy();
    expect(screen.getByText('Bastien : 1200 → 1184 (−16)')).toBeTruthy();
    expect(screen.getByRole('button', { name: fr.games.actions.rematch })).toBeTruthy();
    // Je suis seul en tête : le son de la victoire, après celui du dernier pion.
    await vi.waitFor(() => expect(vi.mocked(audioEngine.playSfx).mock.calls.map(([id]) => id)).toEqual(['piece', 'win']), { timeout: 3000 });
  });

  test('la revanche est juste sous la phrase de fin, seule : la salle d\'attente garde « Se lever » ; Bastien l\'accepte, la phrase et sa chaise le disent ; la partie suivante remplace tout', async () => {
    open(playing([0, 3, 1, 4], 11));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    update(ended([0, 3, 1, 4, 2], 12, { result: { ranking: [[0], [1]], reason: 'line' }, ranked: true, events: [{ type: 'placed', seat: 0, cell: 2 }] }));
    const bar = (await screen.findByRole('button', { name: fr.games.actions.rematch })).closest('.game-rematch')!;
    expect(bar.previousElementSibling?.classList.contains('game-status')).toBe(true);
    expect(screen.getAllByRole('button', { name: fr.games.actions.rematch })).toHaveLength(1);
    expect(screen.getByRole('button', { name: fr.games.lobby.stand })).toBeTruthy();
    expect(bar.textContent).toContain(fr.games.rematch.open);

    // Bastien l'accepte : la phrase me le dit, et sa chaise aussi.
    update({ ...ended([0, 3, 1, 4, 2], 13, { result: { ranking: [[0], [1]], reason: 'line' }, ranked: true }), chairs: [chair(SELF), chair(BASTIEN, { ready: true })] });
    expect(await screen.findByText(t(fr.games.rematch.askedBy, { names: 'Bastien' }))).toBeTruthy();
    expect(screen.getByText(fr.games.rematch.accepted)).toBeTruthy();

    // J'accepte : le serveur commence la partie suivante, qui remplace la fin, la barre et la salle d'attente.
    await userEvent.click(screen.getByRole('button', { name: fr.games.actions.rematch }));
    expect(sentCommands().at(-1)).toEqual({ type: 'ready', game: 'connect4', ready: true });
    update(table('connect4', 14, { chairs: [chair(SELF), chair(BASTIEN)], match: match([SELF, BASTIEN], morpion([], 1), { id: 'm2', first: 1 }) }));
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: fr.games.actions.rematch })).toBeNull());
    expect(screen.queryByRole('region', { name: fr.games.lobby.title })).toBeNull();
    expect(screen.getByText(t(fr.games.status.turnOf, { name: 'Bastien' }))).toBeTruthy();
  });

  test('une défaite : pas de son de victoire', async () => {
    open(playing([0, 3, 1, 4, 8], 11));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    update(ended([0, 3, 1, 4, 8, 5], 12, { result: { ranking: [[1], [0]], reason: 'line' }, ranked: true, events: [{ type: 'placed', seat: 1, cell: 5 }] }));
    await screen.findAllByText('Ligne de trois : Bastien gagne.');
    // Le son de la victoire, s'il y en avait un, viendrait GAME_SOUND_GAP_MS après le dernier pion : on attend plus longtemps que cela.
    await new Promise((resolve) => setTimeout(resolve, GAME_SOUND_GAP_MS * 2));
    expect(audioEngine.playSfx).toHaveBeenCalledWith('piece');
    expect(audioEngine.playSfx).not.toHaveBeenCalledWith('win');
  });

  test('un abandon est dit par la plateforme : qui abandonne, qui gagne', async () => {
    open(playing([0], 5));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    update(ended([0], 6, { result: { ranking: [[1], [0]], reason: 'resign' }, ranked: false }));
    expect((await screen.findAllByText('Moi abandonne. Bastien gagne.')).length).toBeGreaterThan(0);
    expect(screen.getByText(fr.games.end.unranked)).toBeTruthy();
  });

  test('une partie non classée ou sans notes : aucune ligne de note', async () => {
    open(playing([], 5));
    update(ended([], 6, { result: { ranking: [[1], [0]], reason: 'resign' }, ranked: false, ratings: null }));
    await screen.findAllByText('Moi abandonne. Bastien gagne.');
    expect(screen.queryByText(/→/)).toBeNull();
  });
});

describe('le classement suit les parties', () => {
  test('l\'onglet « Classement » est relu quand la partie de la table finit : les notes viennent de bouger', async () => {
    open(playing([0, 3, 1, 4], 11));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    await userEvent.click(screen.getByRole('tab', { name: 'Classement' }));
    const asked = () => socket.sent.filter(([event]) => event === 'game:ladder').length;
    expect(asked()).toBe(1);
    update(
      table('connect4', 12, {
        chairs: [chair(SELF), chair(BASTIEN)],
        match: match([SELF, BASTIEN], morpion([0, 3, 1, 4, 2]), { status: 'ended', turnMs: null, result: { ranking: [[0], [1]], reason: 'line' }, ranked: true }),
      }),
    );
    await vi.waitFor(() => expect(asked()).toBe(2));
  });
});

describe('abandonner', () => {
  test('« Abandonner » demande confirmation : une boîte dont le focus est sur « Annuler » ; Annuler la ferme sans rien envoyer', async () => {
    open(playing([], 7));
    await userEvent.click(await screen.findByRole('button', { name: fr.games.actions.resign }));
    const dialog = screen.getByRole('alertdialog', { name: fr.games.actions.resignTitle });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: fr.games.actions.resignCancel }));
    await userEvent.click(within(dialog).getByRole('button', { name: fr.games.actions.resignCancel }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sentCommands().some((command) => (command as { type: string }).type === 'resign')).toBe(false);
  });

  test('Échap renonce aussi, sans fermer le panneau', async () => {
    open(playing([], 7));
    await userEvent.click(await screen.findByRole('button', { name: fr.games.actions.resign }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(closed).toBe(0);
  });

  test('confirmer envoie `resign`', async () => {
    open(playing([], 7));
    await userEvent.click(await screen.findByRole('button', { name: fr.games.actions.resign }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: fr.games.actions.resignConfirm }));
    expect(sentCommands().at(-1)).toEqual({ type: 'resign', game: 'connect4' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('un spectateur n\'a pas de bouton « Abandonner »', async () => {
    applyWorld([BASTIEN, CLAIRE], [table('connect4', 5, { chairs: [chair(BASTIEN), chair(CLAIRE)], match: match([BASTIEN, CLAIRE], morpion([])) })]);
    act(() => useOfficeStore.getState().openGame('connect4'));
    render(<GamePanel socket={socket.asSocket()} onClose={() => closed++} />);
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    expect(screen.queryByRole('button', { name: fr.games.actions.resign })).toBeNull();
  });
});

describe('un joueur sorti d\'une partie qui continue sans lui', () => {
  // Les petits chevaux : celui qui a abandonné est « sorti ». Son panneau ne lui propose plus d'abandonner (le serveur répondrait qu'il n'est plus assis) ni de proposer la nulle, et lui dit que la partie continue.
  const outAt = (seats: number[], version: number) => {
    const base = match([SELF, BASTIEN], morpion([4]));
    return playing([4], version, { players: base.players.map((player, seat) => ({ ...player, out: seats.includes(seat) })) });
  };

  test('moi sorti : ni « Abandonner » ni nulle, et la partie qui continue est dite', async () => {
    open(outAt([0], 8));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    expect(screen.queryByRole('button', { name: fr.games.actions.resign })).toBeNull();
    expect(screen.queryByRole('button', { name: fr.games.draw.offer })).toBeNull();
    expect(screen.getByText(fr.games.status.out)).toBeTruthy();
  });

  test('un autre sorti : il est dit sorti dans la liste des joueurs, et mes actions restent', async () => {
    open(outAt([1], 8));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    const bastien = document.querySelector('.game-player[data-seat="1"]') as HTMLElement;
    expect(within(bastien).getByText(fr.games.out)).toBeTruthy();
    expect(within(document.querySelector('.game-player[data-seat="0"]') as HTMLElement).queryByText(fr.games.out)).toBeNull();
    expect(screen.getByRole('button', { name: fr.games.actions.resign })).toBeTruthy();
    expect(screen.queryByText(fr.games.status.out)).toBeNull();
  });

  test('sorti et déconnecté : « sorti », pas un compte à rebours de reconnexion', async () => {
    const base = match([SELF, BASTIEN], morpion([4]));
    open(playing([4], 8, { players: base.players.map((player, seat) => (seat === 1 ? { ...player, out: true, connected: false } : player)) }));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    const bastien = document.querySelector('.game-player[data-seat="1"]') as HTMLElement;
    expect(within(bastien).getByText(fr.games.out)).toBeTruthy();
    expect(within(bastien).queryByText(fr.games.lobby.disconnected)).toBeNull();
  });
});

describe('la nulle par accord', () => {
  test('« Proposer la nulle » : envoie `draw offer` ; l\'offre faite est dite, sans bouton', async () => {
    open(playing([0, 3], 9));
    await userEvent.click(await screen.findByRole('button', { name: fr.games.draw.offer }));
    expect(sentCommands().at(-1)).toEqual({ type: 'draw', game: 'connect4', action: 'offer' });
    update(playing([0, 3], 10, { drawOffer: 0 }));
    expect(await screen.findByText(fr.games.draw.offered)).toBeTruthy();
    expect(screen.queryByRole('button', { name: fr.games.draw.offer })).toBeNull();
    // Sa propre offre n'a ni « Accepter » ni « Refuser » : c'est à l'autre de répondre.
    expect(screen.queryByRole('button', { name: fr.games.draw.accept })).toBeNull();
    expect(screen.queryByRole('button', { name: fr.games.draw.decline })).toBeNull();
  });

  // Le serveur refuse (`too_early`) tant que chaque camp n'a pas joué un coup (`countedMoves` < 2) : le bouton le dit avant, au lieu de laisser cliquer pour recevoir une erreur.
  test('avant un coup de chaque camp, « Proposer la nulle » est inactif et dit pourquoi ; au deuxième coup, il s\'active', async () => {
    open(playing([4], 8));
    const button = await screen.findByRole('button', { name: fr.games.draw.offer });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('title')).toBe(fr.games.errors.too_early);
    await userEvent.click(button);
    expect(sentCommands().some((command) => (command as { type: string }).type === 'draw')).toBe(false);
    update(playing([4, 0], 9));
    const active = await screen.findByRole('button', { name: fr.games.draw.offer });
    expect((active as HTMLButtonElement).disabled).toBe(false);
    expect(active.getAttribute('title')).toBeNull();
  });

  test('une offre de l\'autre : « Accepter la nulle » et « Refuser » envoient `accept` et `decline`', async () => {
    open(playing([0, 3], 9, { drawOffer: 1 }));
    expect(await screen.findByText(t(fr.games.draw.received, { name: 'Bastien' }))).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: fr.games.draw.accept }));
    expect(sentCommands().at(-1)).toEqual({ type: 'draw', game: 'connect4', action: 'accept' });
    await userEvent.click(screen.getByRole('button', { name: fr.games.draw.decline }));
    expect(sentCommands().at(-1)).toEqual({ type: 'draw', game: 'connect4', action: 'decline' });
  });
});

describe('les délais', () => {
  test('le compte à rebours ne s\'affiche que dans la dernière minute, pour celui qui a le trait', async () => {
    open(playing([], 7, { turnMs: 120_000 }));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    expect(screen.queryByText(/Il reste \d/)).toBeNull();
    update(playing([4], 8, { turnMs: 45_000 }));
    update(playing([4, 0], 9, { turnMs: 45_000 }));
    expect(await screen.findByText(t(fr.games.countdown, { time: '0:45' }))).toBeTruthy();
  });

  test('moins d\'une minute pour soi : annoncé au lecteur d\'écran, une fois', async () => {
    open(playing([], 7, { turnMs: 30_000 }));
    expect(await screen.findByText(new RegExp(fr.games.timeWarning))).toBeTruthy();
  });

  test('un joueur déconnecté : on le dit avec ce qu\'il lui reste pour revenir', async () => {
    const view = playing([], 7);
    view.match!.players[1] = { ...view.match!.players[1]!, connected: false, reconnectMs: 72_000 };
    open(view);
    expect(await screen.findByText(t(fr.games.reconnect, { time: '1:12' }))).toBeTruthy();
  });
});

describe('une partie interrompue', () => {
  test('le serveur a redémarré en pleine partie : on le dit, jusqu\'à ce qu\'on l\'ait lu', async () => {
    applyWorld([BASTIEN], [playing([], 7)]);
    act(() => useOfficeStore.getState().applyInit({ self: { ...useOfficeStore.getState().self!, x: 0 }, players: [], mapKey: 'office', chatHistory: [], desks: [], closedDesks: [], deskBans: [], games: [table('connect4', 0)] }));
    act(() => useOfficeStore.getState().openGame('connect4'));
    render(<GamePanel socket={socket.asSocket()} onClose={() => closed++} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(fr.games.interrupted);
    await userEvent.click(within(alert).getByRole('button', { name: fr.games.dismiss }));
    expect(screen.queryByText(fr.games.interrupted)).toBeNull();
  });
});

describe('l\'accessibilité', () => {
  test('une seule région d\'annonce (aria-live), cachée à l\'écran', async () => {
    open(playing([], 7));
    await screen.findByRole('grid', { name: 'Plateau de morpion' });
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });
});
