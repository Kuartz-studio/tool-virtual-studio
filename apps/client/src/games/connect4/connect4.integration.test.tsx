import { playColumns, type Connect4Event } from '@bureau/shared/games/connect4';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { audioEngine } from '../../audio/audio';
import { fr, t } from '../../i18n/fr';
import { useOfficeStore } from '../../state/office-store';
import { FakeSocket } from '../../test/fake-socket';
import { GAME_SOUND_GAP_MS } from '../GameFrame';
import { GamePanel } from '../GamePanel';
import { BASTIEN, SELF, applyWorld, chair, match, table } from '../games-test-kit';

// Le Puissance 4 dans le panneau de la plateforme, avec son vrai module (celui que `game-ui.ts` charge) et non un faux jeu : le plateau reçoit l'état de la table, l'accusé du serveur
// rend la main, les événements font tomber le jeton et jouer le son, la fin se lit dans la ligne d'état.

vi.mock('../../audio/audio', () => ({ audioEngine: { playSfx: vi.fn() } }));

let socket: FakeSocket;
beforeEach(() => {
  socket = new FakeSocket();
  socket.serverAccepts();
  vi.mocked(audioEngine.playSfx).mockClear();
});

const drop = (seat: 0 | 1, col: number, row: number): Connect4Event => ({ type: 'drop', seat, col, row });
const sentCommands = () => socket.sent.filter(([event]) => event === 'game:do').map(([, payload]) => payload);
const update = (view: ReturnType<typeof table>) => act(() => useOfficeStore.getState().setGameTable(view));
const column = (n: number) => screen.getByRole('button', { name: new RegExp(`^Colonne ${n} :`) }) as HTMLButtonElement;
const board = () => screen.getByRole('group', { name: 'Colonnes' }).closest('.game-connect4') as HTMLElement;
const falling = () => [...board().querySelectorAll('.game-connect4-token[data-falling]')];

// Une partie entre Moi (siège 0) et Bastien (siège 1), à cette étape (les colonnes jouées, à partir du siège 0).
const playing = (columns: number[], version: number, over: Parameters<typeof match>[2] = {}) =>
  table('connect4', version, { chairs: [chair(SELF), chair(BASTIEN)], match: match([SELF, BASTIEN], playColumns(0, columns), over) });

async function open(view: ReturnType<typeof table>) {
  applyWorld([BASTIEN], [view]);
  act(() => useOfficeStore.getState().openGame('connect4'));
  render(<GamePanel socket={socket.asSocket()} onClose={() => {}} />);
  await screen.findByRole('group', { name: 'Colonnes' });
}

describe('avant la partie', () => {
  test('le panneau s\'appelle Puissance 4, et montre la grille de départ, où rien n\'est cliquable', async () => {
    await open(table('connect4', 5));
    expect(screen.getByRole('complementary', { name: 'Puissance 4' })).toBeTruthy();
    expect(board().dataset.preview).toBe('true');
    expect(screen.getAllByRole('button', { name: /^Colonne \d :/ })).toHaveLength(7);
    for (let n = 1; n <= 7; n++) expect(column(n).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(fr.games.status.waiting)).toBeTruthy();
  });

  test('« Règles » ouvre l\'aide du Puissance 4, écrite par le jeu', async () => {
    await open(table('connect4', 5));
    await userEvent.click(screen.getByRole('button', { name: fr.games.rules }));
    const region = screen.getByRole('region', { name: fr.games.rulesTitle });
    expect(within(region).getAllByRole('listitem').length).toBeGreaterThanOrEqual(4);
    expect(region.textContent).toMatch(/quatre/i);
  });
});

describe('une partie en cours', () => {
  test('chaque joueur est son camp : Rouge pour le siège 0, Jaune pour le siège 1, avec la pastille de la couleur du jeton', async () => {
    await open(playing([], 7));
    const rows = screen.getAllByRole('listitem').filter((row) => row.classList.contains('game-player'));
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Rouge')).toBeTruthy();
    expect(within(rows[1]!).getByText('Jaune')).toBeTruthy();
    const dots = rows.map((row) => row.querySelector<HTMLElement>('.game-seat-dot')!.style.background);
    expect(dots[0]).not.toBe(dots[1]);
    expect(dots.every((dot) => dot !== '')).toBe(true);
  });

  test('à moi de jouer : un clic sur une colonne envoie le coup avec la version de la table ; en attendant le serveur, plus rien ne se joue', async () => {
    await open(playing([], 7));
    expect(column(4).getAttribute('aria-disabled')).toBe('false');
    await userEvent.click(column(4));
    expect(sentCommands().at(-1)).toEqual({ type: 'move', game: 'connect4', version: 7, move: { col: 3 } });
    for (let n = 1; n <= 7; n++) expect(column(n).getAttribute('aria-disabled'), `colonne ${n}`).toBe('true');
    // Un second clic pendant l'attente ne part pas.
    const sent = sentCommands().length;
    await userEvent.click(column(2));
    expect(sentCommands()).toHaveLength(sent);
  });

  test('le jeton de l\'autre arrive avec son événement : il tombe, le son part, le lecteur d\'écran l\'entend, et la main me revient', async () => {
    await open(playing([3], 8));
    expect(column(1).getAttribute('aria-disabled')).toBe('true');
    update(playing([3, 4], 9, { events: [drop(1, 4, 0)] }));
    await vi.waitFor(() => expect(column(1).getAttribute('aria-disabled')).toBe('false'));
    expect(falling()).toHaveLength(1);
    expect(falling()[0]!.getAttribute('data-col')).toBe('4');
    expect(audioEngine.playSfx).toHaveBeenCalledWith('piece');
    expect(await screen.findByText(new RegExp(`Bastien joue en colonne 5\\. ${fr.games.status.yourTurn}`))).toBeTruthy();
    expect(column(5).getAttribute('aria-label')).toBe('Colonne 5 : jaune ; 5 places libres');
  });

  test('au tour de l\'autre : rien ne se joue, et il n\'y a pas de fantôme au-dessus des colonnes', async () => {
    await open(playing([3], 8));
    expect(board().querySelector('.game-connect4-ghost')).toBeNull();
    for (let n = 1; n <= 7; n++) expect(column(n).getAttribute('aria-disabled')).toBe('true');
  });

  test('une version qui saute (la connexion revient) : l\'état est posé tel quel, rien ne tombe, aucun son', async () => {
    await open(playing([3, 4], 8, { events: [drop(1, 4, 0)] }));
    update(playing([3, 4, 3, 4], 12, { events: [drop(1, 4, 1)] }));
    await vi.waitFor(() => expect(column(4).getAttribute('aria-label')).toContain('rouge, rouge'));
    expect(falling()).toHaveLength(0);
    expect(audioEngine.playSfx).not.toHaveBeenCalled();
  });
});

describe('la fin d\'une partie', () => {
  const ended = (columns: number[], version: number, over: Parameters<typeof match>[2]) =>
    table('connect4', version, { chairs: [chair(SELF), chair(BASTIEN)], match: match([SELF, BASTIEN], playColumns(0, columns), { status: 'ended', turnMs: null, ...over }) });

  test('quatre alignés : le jeu le dit avec le nom du gagnant, la ligne est marquée sur le plateau, les notes bougent, et la victoire joue son son', async () => {
    await open(playing([3, 4, 3, 4, 3, 4], 11));
    update(
      ended([3, 4, 3, 4, 3, 4, 3], 12, {
        result: { ranking: [[0], [1]], reason: 'four', detail: { cells: [18, 19, 20, 21] } },
        ranked: true,
        ratings: [{ userId: SELF, before: 1200, after: 1216 }, { userId: BASTIEN, before: 1200, after: 1184 }],
        events: [drop(0, 3, 3), { type: 'end', winner: 0, cells: [18, 19, 20, 21] }],
      }),
    );
    expect((await screen.findAllByText('Quatre alignés : Moi gagne.')).length).toBeGreaterThan(0);
    expect(screen.getByText('Moi : 1200 → 1216 (+16)')).toBeTruthy();
    expect(screen.getByText('Bastien : 1200 → 1184 (−16)')).toBeTruthy();
    expect(board().querySelectorAll('.game-connect4-token[data-win]')).toHaveLength(4);
    expect(audioEngine.playSfx).toHaveBeenCalledWith('piece');
    // La victoire sonne après le dernier jeton (la plateforme espace les sons d'un lot de GAME_SOUND_GAP_MS).
    await vi.waitFor(() => expect(audioEngine.playSfx).toHaveBeenCalledWith('win'), { timeout: 3000 });
    expect(screen.getByRole('button', { name: fr.games.actions.rematch })).toBeTruthy();
    for (let n = 1; n <= 7; n++) expect(column(n).getAttribute('aria-disabled')).toBe('true');
  });

  test('la grille pleine : nulle, sans ligne marquée et sans son de victoire', async () => {
    const all = '0 2 2 2 2 2 2 0 0 0 0 0 1 3 3 3 3 3 3 1 1 1 1 1 4 6 6 6 6 6 6 4 4 4 4 4 5 5 5 5 5 5'.split(' ').map(Number);
    await open(playing(all.slice(0, 41), 11));
    update(ended(all, 12, { result: { ranking: [[0, 1]], reason: 'full' }, ranked: true, events: [drop(1, 5, 5), { type: 'end', winner: null, cells: [] }] }));
    expect((await screen.findAllByText('Grille pleine : nulle.')).length).toBeGreaterThan(0);
    expect(board().querySelectorAll('.game-connect4-token[data-win]')).toHaveLength(0);
    // Le son de la victoire, s'il y en avait un, viendrait GAME_SOUND_GAP_MS après le dernier jeton : on attend plus longtemps que cela.
    await new Promise((resolve) => setTimeout(resolve, GAME_SOUND_GAP_MS * 2));
    expect(audioEngine.playSfx).toHaveBeenCalledWith('piece');
    expect(audioEngine.playSfx).not.toHaveBeenCalledWith('win');
  });

  test('un abandon est dit par la plateforme : qui abandonne, qui gagne ; la grille reste comme elle était', async () => {
    await open(playing([3, 4, 3], 9));
    update(ended([3, 4, 3], 10, { result: { ranking: [[1], [0]], reason: 'resign' }, ranked: true }));
    expect((await screen.findAllByText(t(fr.games.end.resign, { loser: 'Moi', winner: 'Bastien' }))).length).toBeGreaterThan(0);
    expect(board().querySelectorAll('.game-connect4-token')).toHaveLength(3);
  });
});
