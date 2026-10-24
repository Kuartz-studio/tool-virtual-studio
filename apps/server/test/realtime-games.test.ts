import { GAME_INVITE_RATE, GAME_INVITE_TTL_MS, GAME_RATE, type GameAck, type GameCommand, type GameId, type GameTableView, type LadderAck } from '@bureau/shared';
import { describe, expect, test, vi } from 'vitest';
import { TEST_GAMES } from './helpers/games';
import { cutNetwork, enter, nextEvent, nextInit, record, slowDatabase, sleep, startTestServer, type ClientSocket, type TestServer } from './helpers/realtime';

// Les jeux sur de vraies sockets : la vraie carte du bureau (MAP_KEY=office, avec ses tables), la vraie base (les notes s'écrivent), et le morpion à la place des jeux (il
// n'y en a pas encore au registre). Les règles fines sont dans games-*.test.ts ; ici, le fil entre la socket et le service.

// Chaque test démarre un serveur et sa base : la première ouverture d'une machine chargée (plusieurs suites en même temps) dépasse les 5 s par défaut.
vi.setConfig({ testTimeout: 20_000 });

const OFFICE = { env: { MAP_KEY: 'office', E2E: '1' }, gameDefinitions: TEST_GAMES } as const;
const IN_ROOM = { x: 800, y: 1216 };

async function person(srv: TestServer, email: string) {
  return enter(srv, await srv.inviteAndLogin(email));
}
type Person = Awaited<ReturnType<typeof person>>;

function teleport(p: Person, at: { x: number; y: number }) {
  p.socket.emit('debug:teleport', at);
  return sleep(60);
}

const command = (p: Person, c: GameCommand) => new Promise<GameAck>((resolve) => p.socket.emit('game:do', c, resolve));
const ladder = (p: Person, game: GameId) => new Promise<LadderAck>((resolve) => p.socket.emit('game:ladder', { game }, resolve));

// La dernière vue de cette table que cette socket a reçue.
function tracker(socket: ClientSocket) {
  const events = record(socket);
  return {
    events,
    table: (game: GameId = 'connect4') => ([...events.payloadsOf('game:table')] as GameTableView[]).reverse().find((view) => view.game === game),
  };
}

// Deux personnes dans la salle de jeu, chacune avec son suivi des tables.
async function twoInTheGameRoom(srv: TestServer) {
  const a = await person(srv, 'a@x.fr');
  const b = await person(srv, 'b@x.fr');
  const seenByA = tracker(a.socket);
  const seenByB = tracker(b.socket);
  await teleport(a, IN_ROOM);
  await teleport(b, { x: IN_ROOM.x + 96, y: IN_ROOM.y });
  return { a, b, seenByA, seenByB };
}

const waitFor = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condition non remplie à temps');
    await sleep(15);
  }
};

describe('l\'init', () => {
  test('la grande carte donne ses quatre tables (libres, version 0), et aucune invitation', async () => {
    const srv = await startTestServer(OFFICE);
    const a = await person(srv, 'a@x.fr');
    expect(a.init.games?.map((table) => [table.game, table.chairs.length, table.version, table.match])).toEqual([
      ['chess', 2, 0, null],
      ['backgammon', 2, 0, null],
      ['connect4', 2, 0, null],
      ['ludo', 4, 0, null],
    ]);
    expect(a.init.gameInvites).toBeUndefined();
  });

  test('la petite carte de développement n\'a pas de table : l\'init n\'en dit rien (P24)', async () => {
    const srv = await startTestServer();
    const a = await person(srv, 'a@x.fr');
    expect(a.init.games).toBeUndefined();
    expect(a.init.gameInvites).toBeUndefined();
  });
});

describe('game:do', () => {
  test('s\'asseoir : tout le bureau reçoit la table, avec la chaise et la version suivante', async () => {
    const srv = await startTestServer(OFFICE);
    const { a, b } = await twoInTheGameRoom(srv);
    const seenByB = nextEvent(b.socket, 'game:table');
    expect(await command(a, { type: 'sit', game: 'connect4' })).toEqual({ ok: true });
    const view = await seenByB;
    expect(view).toMatchObject({ game: 'connect4', version: 1 });
    expect(view.chairs[0]).toMatchObject({ userId: a.id, name: expect.any(String), ready: false, connected: true });
  });

  test('trop loin de la salle : too_far', async () => {
    const srv = await startTestServer(OFFICE);
    const a = await person(srv, 'a@x.fr');
    expect(await command(a, { type: 'sit', game: 'connect4' })).toEqual({ ok: false, error: 'too_far' });
  });

  test('avant l\'init (la socket n\'est pas encore au bureau) : la commande est ignorée, sans accusé', async () => {
    const srv = await startTestServer(OFFICE);
    const cookie = await srv.inviteAndLogin('a@x.fr');
    // La lecture du chat est lente : l'arrivée (qui la fait avec les autres lectures) attend, donc la socket est connectée mais n'a pas encore reçu son init. Les lectures
    // de la session (l'authentification) ne sont pas retenues.
    const slow = slowDatabase(srv, (sql) => /from "chat_message"/i.test(sql));
    slow.hold();
    const socket = srv.connect(cookie);
    let answered = false;
    socket.on('connect', () => socket.emit('game:do', { type: 'unwatch', game: 'chess' }, () => (answered = true)));
    await slow.reached;
    await sleep(150);
    expect(answered).toBe(false);
    slow.release();
    await nextInit(socket);
  });

  test('une commande qui n\'est pas de la bonne forme : invalid', async () => {
    const srv = await startTestServer(OFFICE);
    const a = await person(srv, 'a@x.fr');
    for (const payload of [{ type: 'sit' }, { type: 'danse', game: 'chess' }, { type: 'sit', game: 'dames' }, null, 'sit']) {
      const ack = await new Promise<GameAck>((resolve) => a.socket.emit('game:do', payload as never, resolve));
      expect(ack, JSON.stringify(payload)).toEqual({ ok: false, error: 'invalid' });
    }
  });

  test('au-delà de GAME_RATE commandes par fenêtre sur une socket : rate_limited, sans rien changer', async () => {
    const srv = await startTestServer(OFFICE);
    const a = await person(srv, 'a@x.fr');
    const acks = await Promise.all(Array.from({ length: GAME_RATE.max + 5 }, () => command(a, { type: 'unwatch', game: 'chess' })));
    expect(acks.filter((ack) => ack.ok)).toHaveLength(GAME_RATE.max);
    expect(acks.filter((ack) => !ack.ok && ack.error === 'rate_limited')).toHaveLength(5);
  });

  test('une partie jusqu\'au bout : les deux la suivent, le classement s\'écrit en base, et game:ladder le rend', async () => {
    const srv = await startTestServer(OFFICE);
    const { a, b, seenByA, seenByB } = await twoInTheGameRoom(srv);
    await command(a, { type: 'sit', game: 'connect4' });
    await command(b, { type: 'sit', game: 'connect4' });
    await command(a, { type: 'ready', game: 'connect4', ready: true });
    await command(b, { type: 'ready', game: 'connect4', ready: true });
    await waitFor(() => seenByB.table()?.match?.status === 'playing');
    const first = seenByA.table()!.match!.first;
    const [one, two] = first === 0 ? [a, b] : [b, a];

    // Celui qui commence gagne la ligne du haut : 0, 1, 2 contre 3, 4.
    for (const [who, cell] of [[one, 0], [two, 3], [one, 1], [two, 4], [one, 2]] as const) {
      const version = (who === a ? seenByA : seenByB).table()!.version;
      expect(await command(who, { type: 'move', game: 'connect4', version, move: { cell } })).toEqual({ ok: true });
      // Les deux ont reçu la table du coup avant que l'autre ne joue.
      await waitFor(() => seenByA.table()!.version > version && seenByB.table()!.version > version);
    }
    await waitFor(() => seenByB.table()?.match?.status === 'ended');
    const ended = seenByB.table()!.match!;
    expect(ended.result).toMatchObject({ reason: 'line', ranking: [[first], [1 - first]] });
    expect(ended).toMatchObject({ ranked: true });
    // Les notes suivent les sièges : 1216 pour celui qui commence (et gagne), 1184 pour l'autre.
    expect(ended.ratings).toEqual(ended.players.map((player) => ({ userId: player.userId, before: 1200, after: player.userId === one.id ? 1216 : 1184 })));

    const ack = await ladder(b, 'connect4');
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.top.map((row) => [row.userId, row.rank, row.rating, row.games, row.wins, row.losses])).toEqual([
      [one.id, 1, 1216, 1, 1, 0],
      [two.id, 2, 1184, 1, 0, 1],
    ]);
    expect(ack.me).toMatchObject({ userId: b.id });
    // Le classement d'un autre jeu est vide.
    expect(await ladder(a, 'chess')).toMatchObject({ ok: true, top: [], me: null });
  });

  test('game:ladder : un jeu inconnu, ou trop de demandes : invalid, rate_limited', async () => {
    const srv = await startTestServer(OFFICE);
    const a = await person(srv, 'a@x.fr');
    const bad = await new Promise<LadderAck>((resolve) => a.socket.emit('game:ladder', { game: 'dames' } as never, resolve));
    expect(bad).toEqual({ ok: false, error: 'invalid' });
    const acks = await Promise.all(Array.from({ length: 14 }, () => ladder(a, 'chess')));
    expect(acks.filter((ack) => !ack.ok && ack.error === 'rate_limited').length).toBeGreaterThanOrEqual(3);
  });
});

describe('les invitations', () => {
  test('inviter quelqu\'un dont la connexion est tombée (il est encore au monde, pendant le délai de grâce) : offline', async () => {
    const srv = await startTestServer({ ...OFFICE, graceMs: 5000 });
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(a, IN_ROOM);
    await command(a, { type: 'sit', game: 'connect4' });
    cutNetwork(b.socket, { reconnect: false });
    await sleep(150);
    expect(await command(a, { type: 'invite', game: 'connect4', userId: b.id })).toEqual({ ok: false, error: 'offline' });
  });

  test('au-delà de GAME_INVITE_RATE invitations en une minute : rate_limited', async () => {
    const srv = await startTestServer(OFFICE);
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(a, IN_ROOM);
    await command(a, { type: 'sit', game: 'connect4' });
    const acks: GameAck[] = [];
    for (let i = 0; i < GAME_INVITE_RATE.max + 1; i++) acks.push(await command(a, { type: 'invite', game: 'connect4', userId: b.id }));
    expect(acks.slice(0, GAME_INVITE_RATE.max).every((ack) => ack.ok)).toBe(true);
    expect(acks.at(-1)).toEqual({ ok: false, error: 'rate_limited' });
  });

  test('inviter, accepter : l\'invitée est téléportée près de la table (move:correct « teleport »), assise, et l\'invitante en est avertie (P18)', async () => {
    const srv = await startTestServer(OFFICE);
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const seenByA = tracker(a.socket);
    await teleport(a, IN_ROOM);
    // Bastien est à l'accueil, loin de la salle : il peut accepter quand même.
    await command(a, { type: 'sit', game: 'connect4' });
    const invited = nextEvent(b.socket, 'game:invite');
    expect(await command(a, { type: 'invite', game: 'connect4', userId: b.id })).toEqual({ ok: true });
    const invite = await invited;
    expect(invite).toMatchObject({ game: 'connect4', from: { id: a.id }, ttlMs: 60_000 });

    const moved = nextEvent(b.socket, 'move:correct');
    const notified = nextEvent(a.socket, 'game:notice');
    const gone = nextEvent(b.socket, 'game:invite:gone');
    expect(await command(b, { type: 'answer', invite: invite.id, accept: true })).toEqual({ ok: true });
    const correction = await moved;
    expect(correction.reason).toBe('teleport');
    expect(await notified).toMatchObject({ kind: 'accepted', game: 'connect4', user: { id: b.id } });
    expect(await gone).toEqual({ id: invite.id, reason: 'answered' });

    // Le monde a posé Bastien dans la salle, à deux cases au moins d'Alice, et il est assis à la table.
    const there = srv.realtime.world.get(b.id)!;
    expect(Math.abs(there.x - correction.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(there.y - correction.y)).toBeLessThanOrEqual(1);
    const alice = srv.realtime.world.get(a.id)!;
    expect(Math.hypot(there.x - alice.x, there.y - alice.y)).toBeGreaterThanOrEqual(64);
    expect(there.x).toBeGreaterThanOrEqual(448);
    expect(there.y).toBeGreaterThanOrEqual(1024);
    await waitFor(() => seenByA.table()?.chairs[1]?.userId === b.id);
    expect(seenByA.table()!.chairs.map((chair) => chair?.userId)).toEqual([a.id, b.id]);
  });

  test('le balayage du serveur tourne : une invitation sans réponse expire, l\'invitée n\'a plus à répondre et l\'invitante en est avertie', async () => {
    const clock = { t: 5_000 };
    const srv = await startTestServer({ ...OFFICE, now: () => clock.t, gamesSweepMs: 20 });
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(a, IN_ROOM);
    await command(a, { type: 'sit', game: 'connect4' });
    const invited = nextEvent(b.socket, 'game:invite');
    await command(a, { type: 'invite', game: 'connect4', userId: b.id });
    const invite = await invited;
    const gone = nextEvent(b.socket, 'game:invite:gone');
    const notified = nextEvent(a.socket, 'game:notice');
    clock.t += GAME_INVITE_TTL_MS + 1;
    expect(await gone).toEqual({ id: invite.id, reason: 'expired' });
    expect(await notified).toMatchObject({ kind: 'expired', game: 'connect4', user: { id: b.id } });
  });

  test('une invitation encore en attente est redite à l\'init suivant (retour pendant la grâce)', async () => {
    const srv = await startTestServer({ ...OFFICE, graceMs: 5000 });
    const a = await person(srv, 'a@x.fr');
    const cookieB = await srv.inviteAndLogin('b@x.fr');
    const b = await enter(srv, cookieB);
    await teleport(a, IN_ROOM);
    await command(a, { type: 'sit', game: 'connect4' });
    const invited = nextEvent(b.socket, 'game:invite');
    await command(a, { type: 'invite', game: 'connect4', userId: b.id });
    const invite = await invited;
    // Une nouvelle socket de Bastien (un onglet de plus) : son init redit l'invitation, avec ce qu'il lui reste à vivre.
    const second = srv.connect(cookieB);
    const init = await nextInit(second);
    expect(init.gameInvites).toEqual([{ ...invite, ttlMs: expect.any(Number) }]);
    expect(init.gameInvites![0]!.ttlMs).toBeLessThanOrEqual(60_000);
  });
});

describe('la présence', () => {
  test('un joueur assis qui perd sa connexion sans revenir : à la fin du délai de grâce du monde, sa chaise est libre', async () => {
    const srv = await startTestServer(OFFICE);
    const { a, seenByB } = await (async () => {
      const players = await twoInTheGameRoom(srv);
      return { a: players.a, seenByB: players.seenByB };
    })();
    await command(a, { type: 'sit', game: 'connect4' });
    await waitFor(() => seenByB.table()?.chairs[0]?.userId === a.id);
    cutNetwork(a.socket, { reconnect: false });
    await waitFor(() => seenByB.table()?.chairs[0] === null);
  });

  test('la connexion d\'un joueur tombe en pleine partie : la table le dit déconnecté, avec son compte à rebours ; revenu, il reprend, et son init lui redonne la table', async () => {
    const srv = await startTestServer({ ...OFFICE, graceMs: 5000 });
    const { a, b, seenByA } = await twoInTheGameRoom(srv);
    await command(a, { type: 'sit', game: 'connect4' });
    await command(b, { type: 'sit', game: 'connect4' });
    await command(a, { type: 'ready', game: 'connect4', ready: true });
    await command(b, { type: 'ready', game: 'connect4', ready: true });
    await waitFor(() => seenByA.table()?.match?.status === 'playing');

    const back = nextInit(b.socket);
    cutNetwork(b.socket);
    await waitFor(() => seenByA.table()?.match?.players.find((player) => player.userId === b.id)?.connected === false);
    expect(seenByA.table()!.match!.players.find((player) => player.userId === b.id)!.reconnectMs).toBeGreaterThan(80_000);
    const init = await back;
    expect(init.games?.find((view) => view.game === 'connect4')?.match).toMatchObject({ status: 'playing' });
    await waitFor(() => seenByA.table()?.match?.players.find((player) => player.userId === b.id)?.connected === true);
    expect(seenByA.table()!.match!.players.find((player) => player.userId === b.id)!.reconnectMs).toBeNull();
  });

  test('un membre retiré en pleine partie : défaite tout de suite, l\'autre le voit (P25)', async () => {
    const srv = await startTestServer(OFFICE);
    const { a, b, seenByA } = await twoInTheGameRoom(srv);
    await command(a, { type: 'sit', game: 'connect4' });
    await command(b, { type: 'sit', game: 'connect4' });
    await command(a, { type: 'ready', game: 'connect4', ready: true });
    await command(b, { type: 'ready', game: 'connect4', ready: true });
    await waitFor(() => seenByA.table()?.match?.status === 'playing');
    srv.events.emit('member:removed', b.id);
    await waitFor(() => seenByA.table()?.match?.status === 'ended');
    expect(seenByA.table()!.match!.result).toMatchObject({ reason: 'disconnect' });
    expect(seenByA.table()!.chairs.map((chair) => chair?.userId ?? null)).toEqual([a.id, null]);
  });

  test('un profil qui change : son nom change à la chaise, chez tout le monde', async () => {
    const srv = await startTestServer(OFFICE);
    const { a, seenByA } = await twoInTheGameRoom(srv);
    await command(a, { type: 'sit', game: 'connect4' });
    srv.events.emit('profile:changed', { id: a.id, name: 'Anaïs', avatarKey: null, timezone: 'Europe/Paris' });
    await waitFor(() => seenByA.table()?.chairs[0]?.name === 'Anaïs');
  });

  test('l\'arrêt du serveur arrête les jeux : plus de balayage ni de commande', async () => {
    const srv = await startTestServer({ ...OFFICE, gamesSweepMs: 20 });
    const a = await person(srv, 'a@x.fr');
    await teleport(a, IN_ROOM);
    const games = srv.realtime.games;
    await srv.realtime.stop();
    expect(await games.run(a.id, { type: 'sit', game: 'connect4' })).toEqual({ ok: false, error: 'unavailable' });
  });
});

describe('debug:game (E2E seulement)', () => {
  test('avec E2E=1, il remplace l\'état de la partie en cours : les deux reçoivent la table à la version suivante', async () => {
    const srv = await startTestServer(OFFICE);
    const { a, b, seenByA, seenByB } = await twoInTheGameRoom(srv);
    await command(a, { type: 'sit', game: 'connect4' });
    await command(b, { type: 'sit', game: 'connect4' });
    await command(a, { type: 'ready', game: 'connect4', ready: true });
    await command(b, { type: 'ready', game: 'connect4', ready: true });
    await waitFor(() => seenByA.table()?.match?.status === 'playing');
    const version = seenByA.table()!.version;
    a.socket.emit('debug:game', { game: 'connect4', state: { cells: [0, 0, null, 1, 1, null, null, null, null], next: 0, moves: 4, result: null } });
    await waitFor(() => (seenByB.table()?.version ?? 0) > version);
    expect(seenByB.table()!.match!.state).toMatchObject({ moves: 4, next: 0 });
  });

  test('sans E2E=1, l\'événement n\'existe pas : la partie en cours garde son état, à la même version', async () => {
    const srv = await startTestServer({ env: { MAP_KEY: 'office' }, gameDefinitions: TEST_GAMES });
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const seenByB = tracker(b.socket);
    // Sans E2E, pas de debug:teleport : c'est le monde qui pose les deux dans la salle.
    srv.realtime.world.teleport(a.id, IN_ROOM.x, IN_ROOM.y);
    srv.realtime.world.teleport(b.id, IN_ROOM.x + 96, IN_ROOM.y);
    await command(a, { type: 'sit', game: 'connect4' });
    await command(b, { type: 'sit', game: 'connect4' });
    await command(a, { type: 'ready', game: 'connect4', ready: true });
    await command(b, { type: 'ready', game: 'connect4', ready: true });
    await waitFor(() => seenByB.table()?.match?.status === 'playing');
    const before = seenByB.table()!;
    a.socket.emit('debug:game', { game: 'connect4', state: { cells: [0, 0, null, 1, 1, null, null, null, null], next: 0, moves: 4, result: null } });
    await sleep(150);
    expect(seenByB.table()!.version).toBe(before.version);
    expect(seenByB.table()!.match!.state).toEqual(before.match!.state);
  });
});
