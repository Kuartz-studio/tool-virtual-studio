import type { LadderRow } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { fr, t } from '../i18n/fr';
import { FakeSocket } from '../test/fake-socket';
import { Ladder } from './Ladder';

let socket: FakeSocket;
beforeEach(() => {
  socket = new FakeSocket();
  socket.serverAccepts();
});

const row = (rank: number, userId: string, rating: number, over: Partial<LadderRow> = {}): LadderRow => ({ rank, userId, name: userId[0]!.toUpperCase() + userId.slice(1), rating, games: 5, wins: 3, losses: 1, draws: 1, ...over });
const answer = (ack: unknown, index = socket.pendingAcks.length - 1) => act(() => socket.pendingAcks[index]!.callback(null, ack));

function setup(selfId: string | null = 'moi', refreshKey = 'a') {
  const view = render(<Ladder game="chess" socket={socket.asSocket()} refreshKey={refreshKey} selfId={selfId} />);
  return { ...view, again: (key: string) => view.rerender(<Ladder game="chess" socket={socket.asSocket()} refreshKey={key} selfId={selfId} />) };
}

describe('le classement', () => {
  test('à l\'ouverture, il demande le classement de ce jeu, et attend', () => {
    setup();
    expect(socket.sent).toEqual([['game:ladder', { game: 'chess' }]]);
    expect(screen.getByText(fr.games.ladder.loading)).toBeTruthy();
  });

  test('les meilleurs, du premier au dernier : rang, nom, note, parties, victoires / nulles / défaites ; la table a un titre pour les lecteurs d\'écran (P30)', async () => {
    setup();
    answer({ ok: true, top: [row(1, 'ana', 1300), row(2, 'bob', 1250, { wins: 1, draws: 2, losses: 3, games: 6 })], me: null });
    const table = await screen.findByRole('table', { name: t(fr.games.ladder.table, { game: 'Échecs' }) });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['1', '1300', '5', '3 / 1 / 1']);
    expect(within(rows[0]!).getByRole('rowheader').textContent).toBe('Ana');
    expect(within(rows[1]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['2', '1250', '6', '1 / 2 / 3']);
  });

  test('sa propre ligne est repérée (« toi », aria-current) quand elle est parmi les premiers', async () => {
    setup('bob');
    answer({ ok: true, top: [row(1, 'ana', 1300), row(2, 'bob', 1250)], me: row(2, 'bob', 1250) });
    const mine = (await screen.findByText(`(${fr.games.you})`)).closest('tr')!;
    expect(mine.getAttribute('aria-current')).toBe('true');
    expect(within(mine).getByRole('rowheader').textContent).toContain('Bob');
    // Elle n'est pas répétée en bas.
    expect(screen.getAllByText('Bob')).toHaveLength(1);
  });

  test('sa ligne au-delà des premiers : après une coupure « … », avec son vrai rang', async () => {
    setup('lou');
    answer({ ok: true, top: [row(1, 'ana', 1300), row(2, 'bob', 1250)], me: row(12, 'lou', 1100) });
    const mine = (await screen.findByText(`(${fr.games.you})`)).closest('tr')!;
    expect(within(mine).getAllByRole('cell')[0]!.textContent).toBe('12');
    expect(mine.getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('…')).toBeTruthy();
  });

  test('personne n\'est classé : on le dit', async () => {
    setup();
    answer({ ok: true, top: [], me: null });
    expect(await screen.findByText(fr.games.ladder.empty)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  test('une lecture qui échoue : on le dit, avec « Réessayer » qui redemande', async () => {
    setup();
    answer({ ok: false, error: 'unavailable' });
    expect(await screen.findByRole('alert')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: fr.games.ladder.retry }));
    expect(socket.sent).toHaveLength(2);
    answer({ ok: true, top: [row(1, 'ana', 1300)], me: null });
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  test('une clé qui change (la fin d\'une partie à cette table) : le classement est relu', async () => {
    const { again } = setup('moi', 'm1:playing');
    answer({ ok: true, top: [row(1, 'ana', 1300)], me: null });
    await screen.findByRole('table');
    again('m1:ended');
    expect(socket.sent).toHaveLength(2);
    answer({ ok: true, top: [row(1, 'ana', 1316)], me: null });
    expect(await screen.findByText('1316')).toBeTruthy();
  });

  test('la réponse à une demande dépassée, arrivée après celle de la nouvelle, est ignorée', async () => {
    const { again } = setup('moi', 'a');
    again('b');
    // La nouvelle répond d'abord ; l'ancienne, plus lente, arrive ensuite : elle ne doit pas la remplacer.
    answer({ ok: true, top: [row(1, 'neuf', 2222)], me: null }, 1);
    expect(await screen.findByText('Neuf')).toBeTruthy();
    answer({ ok: true, top: [row(1, 'vieux', 1111)], me: null }, 0);
    // La réponse se lit dans une promesse : on la laisse passer avant de regarder.
    await act(async () => {});
    expect(screen.queryByText('Vieux')).toBeNull();
    expect(screen.getByText('Neuf')).toBeTruthy();
  });
});
