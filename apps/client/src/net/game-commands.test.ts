import type { GameCommand } from '@bureau/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { FakeSocket } from '../test/fake-socket';
import { GAME_ACK_TIMEOUT_MS, fetchLadder, sendGameCommand } from './game-commands';

let socket: FakeSocket;
beforeEach(() => {
  socket = new FakeSocket();
});

const sit: GameCommand = { type: 'sit', game: 'chess' };

describe('sendGameCommand', () => {
  test('envoie la commande par `game:do`, avec le délai d\'attente de GAME_ACK_TIMEOUT_MS, et rend la réponse du serveur', async () => {
    socket.connected = true;
    const pending = sendGameCommand(socket.asSocket(), sit);
    expect(socket.sent).toEqual([['game:do', sit]]);
    expect(socket.pendingAcks[0]?.timeoutMs).toBe(GAME_ACK_TIMEOUT_MS);
    socket.pendingAcks[0]!.callback(null, { ok: false, error: 'too_far' });
    expect(await pending).toEqual({ ok: false, error: 'too_far' });
  });

  test('une réponse « ok » est rendue telle quelle', async () => {
    socket.connected = true;
    const pending = sendGameCommand(socket.asSocket(), sit);
    socket.pendingAcks[0]!.callback(null, { ok: true });
    expect(await pending).toEqual({ ok: true });
  });

  test('une socket absente ou coupée : unavailable, sans rien envoyer', async () => {
    expect(await sendGameCommand(null, sit)).toEqual({ ok: false, error: 'unavailable' });
    expect(await sendGameCommand(socket.asSocket(), sit)).toEqual({ ok: false, error: 'unavailable' });
    expect(socket.sent).toEqual([]);
  });

  test('un délai écoulé sans réponse : unavailable, jamais une attente sans fin', async () => {
    socket.connected = true;
    const pending = sendGameCommand(socket.asSocket(), sit);
    socket.pendingAcks[0]!.callback(new Error('timeout'));
    expect(await pending).toEqual({ ok: false, error: 'unavailable' });
  });
});

describe('fetchLadder', () => {
  test('demande le classement du jeu par `game:ladder` et rend la réponse', async () => {
    socket.connected = true;
    const pending = fetchLadder(socket.asSocket(), 'chess');
    expect(socket.sent).toEqual([['game:ladder', { game: 'chess' }]]);
    const answer = { ok: true as const, top: [], me: null };
    socket.pendingAcks[0]!.callback(null, answer);
    expect(await pending).toEqual(answer);
  });

  test('une socket coupée, ou un délai écoulé : unavailable', async () => {
    expect(await fetchLadder(null, 'chess')).toEqual({ ok: false, error: 'unavailable' });
    socket.connected = true;
    const pending = fetchLadder(socket.asSocket(), 'ludo');
    socket.pendingAcks[0]!.callback(new Error('timeout'));
    expect(await pending).toEqual({ ok: false, error: 'unavailable' });
  });
});
