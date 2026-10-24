import { SOCKET_CONNECT_RATE, type MovePayload } from '@bureau/shared';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, test, vi } from 'vitest';
import { removeMember } from '../src/admin/remove-member';
import { session, user } from '../src/db/schema';
import { createRateLimiter } from '../src/rate-limit';
import { loadOfficeMap } from '../src/realtime/io';
import { loadPosition, savePositions } from '../src/realtime/positions';
import { DEFAULT_SETUP } from './helpers/decor';
import { captureLogs } from './helpers/logs';
import {
  TEST_GRACE_MS,
  connectError,
  cutNetwork,
  disconnection,
  enter,
  nextEvent,
  nextInit,
  record,
  sleep,
  slowDatabase,
  startTestServer,
  type ClientSocket,
  type TestServer,
} from './helpers/realtime';
import { createTestApp, findUserByEmail } from './helpers/test-app';
import { testEnv } from './helpers/test-env';

const DAY_MS = 24 * 3600 * 1000;

// La carte de développement : l'apparition est en (80, 240), sur la ligne 7, du sol de bout en bout. (112, 240) et (48, 240) sont
// à une case de l'apparition, à droite et à gauche ; la salle de réunion (zone private) couvre x de 256 à 447 et y de 32 à 159.
const SPAWN = { x: 80, y: 240 };

// Les types de paquets Socket.io (socket.io-parser) que les tests lisent sur le fil.
const EVENT_PACKET = 2;
const CONNECT_ERROR_PACKET = 4;

// Un client muet : sa connexion reste ouverte et il reçoit encore tout, mais il ne répond plus aux pings du serveur (un ordinateur
// mis en veille, un réseau tombé sans fermer la connexion). engine.io-client répond à un ping par `_sendPacket('pong')`.
function silence(socket: ClientSocket): void {
  const engine = socket.io.engine as unknown as { _sendPacket(type: string, ...rest: unknown[]): void };
  const send = engine._sendPacket.bind(engine);
  engine._sendPacket = (type: string, ...rest: unknown[]) => {
    if (type !== 'pong') send(type, ...rest);
  };
}

// Place quelqu'un ailleurs, en mémoire seulement, sans que les autres reçoivent un tick pour ce mouvement : ces tests regardent ce que
// la présence envoie, et un test qui attend « rien d'autre » ne doit pas voir passer le mouvement de sa mise en place.
function placeSilently(srv: TestServer, id: string, move: MovePayload): void {
  expect(srv.realtime.world.applyMove(id, move)).toEqual({ ok: true });
  srv.realtime.world.drainMoves();
}

describe('connexion', () => {
  test('sans cookie → connect_error unauthorized', async () => {
    const srv = await startTestServer();
    const anonymous = srv.connect();
    expect(await connectError(anonymous)).toBe('unauthorized');
    // Un refus du serveur est définitif pour le client : il ne réessaie pas tout seul.
    expect(anonymous.active).toBe(false);
  });

  test('cookie d\'une session qui n\'existe plus → unauthorized', async () => {
    const srv = await startTestServer();
    const cookie = await srv.inviteAndLogin('a@x.fr');
    await srv.db.delete(session);
    expect(await connectError(srv.connect(cookie))).toBe('unauthorized');
  });

  test('compte désactivé dont la session a survécu → connect_error disabled', async () => {
    const srv = await startTestServer();
    const cookie = await srv.inviteAndLogin('a@x.fr');
    const { id } = (await findUserByEmail(srv.db, 'a@x.fr'))!;
    await srv.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, id));
    expect(await connectError(srv.connect(cookie))).toBe('disabled');
  });

  test('Origin d\'une autre page que l\'appli → connect_error forbidden_origin, sans même lire la session', async () => {
    const srv = await startTestServer();
    const cookie = await srv.inviteAndLogin('a@x.fr');
    const getSession = vi.spyOn(srv.auth.api, 'getSession');
    // Un autre site, un autre port du même hôte (un sous-domaine voisin partage le cookie SameSite=Lax), une page sans origine.
    for (const origin of ['https://pirate.example', 'http://localhost:4001', 'http://bureau.localhost:4000', 'null']) {
      expect(await connectError(srv.connect(cookie, { extraHeaders: { cookie, origin } })), origin).toBe('forbidden_origin');
    }
    expect(getSession).not.toHaveBeenCalled();
  });

  test('Origin de l\'appli, ou pas d\'Origin du tout (client hors navigateur) : la connexion passe', async () => {
    const srv = await startTestServer();
    const cookie = await srv.inviteAndLogin('a@x.fr');
    // testEnv : APP_URL vaut http://localhost:4000.
    const fromApp = await enter(srv, cookie, { extraHeaders: { cookie, origin: 'http://localhost:4000' } });
    fromApp.socket.disconnect();
    await enter(srv, cookie);   // les autres tests aussi : aucun en-tête Origin
  });

  test('Better Auth lève une 401 → unauthorized ; une autre erreur → unavailable, journalisée, et le serveur continue', async () => {
    const { logger, lines } = captureLogs();
    const srv = await startTestServer({ logger });
    const cookie = await srv.inviteAndLogin('a@x.fr');
    vi.spyOn(srv.auth.api, 'getSession')
      // La session a disparu entre sa lecture et sa prolongation : Better Auth lève une 401 au lieu de répondre « aucune session ».
      .mockRejectedValueOnce(new APIError('UNAUTHORIZED', { message: 'Failed to get session' }))
      // La base est tombée : ce n'est pas une session absente.
      .mockRejectedValueOnce(new APIError('INTERNAL_SERVER_ERROR', { message: 'Failed to get session' }));

    expect(await connectError(srv.connect(cookie))).toBe('unauthorized');
    expect(await connectError(srv.connect(cookie))).toBe('unavailable');
    expect(lines.filter((line) => line.level === 50)).toHaveLength(1);

    await enter(srv, cookie);   // la panne passée, on entre
  });

  test('la connexion ne prolonge pas la session : la prolongation reste aux routes HTTP, qui renvoient le cookie', async () => {
    const srv = await startTestServer();
    const cookie = await srv.inviteAndLogin('a@x.fr');
    const { id } = (await findUserByEmail(srv.db, 'a@x.fr'))!;
    // Il reste 29 jours sur 30 : Better Auth prolongerait la session en base, mais la poignée de main ne peut pas poser de cookie.
    const due = new Date(Date.now() + 29 * DAY_MS);
    await srv.db.update(session).set({ expiresAt: due }).where(eq(session.userId, id));

    await enter(srv, cookie);
    const [row] = await srv.db.select({ expiresAt: session.expiresAt }).from(session).where(eq(session.userId, id));
    expect(row!.expiresAt.getTime()).toBe(due.getTime());
  });

  test('arrivée : init puis player:joined chez les autres', async () => {
    const srv = await startTestServer();
    const a = srv.connect(await srv.inviteAndLogin('a@x.fr'));
    const aInit = await nextInit(a);
    expect(aInit.self).toEqual({
      id: aInit.self.id,
      name: 'a',
      avatarKey: null,
      ...SPAWN,
      dir: 'down',
      moving: false,
      status: 'available',
      media: { mic: false, cam: false, screen: false },
      activity: null,
      level: 0,
      timezone: 'Europe/Paris',   // le fuseau du compte : l'heure de Paris tant qu'il n'en a pas choisi d'autre
    });
    // Sa progression : rien encore.
    expect(aInit.progress).toEqual({ xp: 0, kuartzons: 0, streak: 0, owned: [] });
    expect(aInit.players).toEqual([]);
    expect(aInit.mapKey).toBe('dev-office');
    expect(aInit.chatHistory).toEqual([]);
    // Les trois bureaux de la carte de développement (clés : les numéros de leurs zones) : le premier est à A, qui n'a pas à y accéder. Aucun
    // n'a été décoré : tous montrent le poste de travail par défaut.
    expect(aInit.desks).toEqual([
      { key: '2', ownerId: aInit.self.id, ownerName: 'a', ownerTimezone: 'Europe/Paris', name: null, locked: false, closedByState: false, ...DEFAULT_SETUP },
      { key: '3', ownerId: null, ownerName: null, name: null, locked: false, closedByState: false, ...DEFAULT_SETUP },
      { key: '4', ownerId: null, ownerName: null, name: null, locked: false, closedByState: false, ...DEFAULT_SETUP },
    ]);
    expect(aInit.closedDesks).toEqual([]);
    expect(aInit.deskBans).toEqual([]);

    const aEvents = record(a);
    const b = srv.connect(await srv.inviteAndLogin('b@x.fr'));
    const bEvents = record(b);
    const [bInit, joined] = await Promise.all([nextInit(b), nextEvent(a, 'player:joined')]);
    expect(bInit.self).toMatchObject({ name: 'b', ...SPAWN });
    expect(bInit.players).toEqual([aInit.self]);
    expect(joined).toEqual(bInit.self);

    // B n'apprend pas sa propre arrivée. Une diffusion n'a qu'un argument, sa charge utile : pas d'identifiant de reprise de
    // connexion à la fin (la récupération de connexion de Socket.io est désactivée).
    await sleep(50);
    expect(bEvents.names()).toEqual(['init']);
    // A apprend aussi que B a pris la place suivante : avant son arrivée (le bureau d'abord).
    expect(aEvents.received).toEqual([
      { event: 'desk:changed', args: [{ key: '3', ownerId: bInit.self.id, ownerName: 'b', ownerTimezone: 'Europe/Paris', name: null, locked: false, closedByState: false, ...DEFAULT_SETUP }] },
      { event: 'player:joined', args: [bInit.self] },
    ]);
    expect(srv.realtime.socketsOf(aInit.self.id)).toEqual([a.id]);
  });

  test('11e connexion dans la minute → rate_limited', async () => {
    const srv = await startTestServer();
    const cookieA = await srv.inviteAndLogin('a@x.fr');
    for (let n = 1; n <= SOCKET_CONNECT_RATE.max; n++) {
      const { socket } = await enter(srv, cookieA);
      socket.disconnect();
    }
    expect(await connectError(srv.connect(cookieA))).toBe('rate_limited');
    // La limite est propre à chaque compte.
    await enter(srv, await srv.inviteAndLogin('b@x.fr'));
  });
});

test('createRateLimiter : max par fenêtre, puis nouvelle fenêtre', () => {
  const clock = { t: 0 };
  const limiter = createRateLimiter({ max: 3, windowMs: 1000, now: () => clock.t });
  expect([limiter.take('a'), limiter.take('a'), limiter.take('a'), limiter.take('a')]).toEqual([true, true, true, false]);
  expect(limiter.take('b')).toBe(true);   // chaque clé a sa fenêtre
  clock.t = 999;
  expect(limiter.take('a')).toBe(false);
  clock.t = 1000;   // la fenêtre de « a » ouverte à 0 est finie
  expect([limiter.take('a'), limiter.take('a'), limiter.take('a'), limiter.take('a')]).toEqual([true, true, true, false]);
  expect([limiter.take('b'), limiter.take('b'), limiter.take('b')]).toEqual([true, true, true]);   // ouverte à 0 aussi : neuve
  expect(limiter.take('b')).toBe(false);
});

describe('plusieurs onglets', () => {
  test('2e onglet : le premier reçoit session:replaced, B ne voit aucun départ', async () => {
    const srv = await startTestServer();
    const cookieA = await srv.inviteAndLogin('a@x.fr');
    const a1 = await enter(srv, cookieA);
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const bEvents = record(b.socket);
    const a1Events: string[] = [];
    a1.socket.on('session:replaced', () => a1Events.push('session:replaced'));
    a1.socket.on('disconnect', (reason) => a1Events.push(`disconnect: ${reason}`));

    const a2 = srv.connect(cookieA);
    const a2Init = await nextInit(a2);
    // Le même joueur, à la même place : un onglet de plus n'est pas une arrivée.
    expect(a2Init.self).toEqual(a1.init.self);
    expect(a2Init.players).toEqual([b.init.self]);
    await vi.waitFor(() => expect(a1Events).toEqual(['session:replaced', 'disconnect: io server disconnect']));

    await sleep(TEST_GRACE_MS * 2);   // un départ à tort tomberait à la fin du délai de grâce
    expect(bEvents.names()).toEqual([]);
    expect(a1.socket.active).toBe(false);   // l'ancien onglet ne se reconnecte pas pour reprendre la place
    expect(srv.realtime.socketsOf(a1.id)).toEqual([a2.id]);
    expect(srv.realtime.world.list().map((p) => p.id)).toEqual([a1.id, b.id]);
  });

  test('deux connexions simultanées du même compte : une seule reste, une seule arrivée annoncée', async () => {
    const srv = await startTestServer();
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const bEvents = record(b.socket);
    const cookieA = await srv.inviteAndLogin('a@x.fr');
    const { id: aId } = (await findUserByEmail(srv.db, 'a@x.fr'))!;

    const sockets = [srv.connect(cookieA), srv.connect(cookieA)];
    const events = sockets.map(record);
    await vi.waitFor(() => {
      expect(events.filter((e) => e.names().includes('session:replaced'))).toHaveLength(1);
      expect(srv.realtime.socketsOf(aId)).toHaveLength(1);
    });
    const survivor = sockets.find((s) => s.id === srv.realtime.socketsOf(aId)[0])!;
    await vi.waitFor(() => expect(events[sockets.indexOf(survivor)]!.names()).toContain('init'));

    await sleep(TEST_GRACE_MS * 2);
    expect(bEvents.payloadsOf('player:joined')).toEqual([expect.objectContaining({ id: aId })]);
    expect(bEvents.names()).not.toContain('player:left');
    expect(survivor.connected).toBe(true);
    expect(srv.realtime.world.list().map((p) => p.id)).toEqual([b.id, aId]);
  });
});

describe('déconnexion et délai de grâce', () => {
  test('coupure brève (< grâce) : pas de player:left, même position au retour', async () => {
    const srv = await startTestServer();
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    placeSilently(srv, a.id, { x: 112, y: 240, dir: 'right', moving: false });
    const before = srv.realtime.world.get(a.id);
    const bEvents = record(b.socket);

    const again = nextInit(a.socket);
    cutNetwork(a.socket);   // le Wi-Fi saute : le client se reconnecte de lui-même, avant la fin du délai de grâce
    expect((await again).self).toEqual(before);
    // Une nouvelle session Socket.io (pas de récupération de connexion) : c'est le délai de grâce qui a gardé l'avatar, et le nouvel
    // init qui redonne tout l'état.
    expect(a.socket.recovered).toBeFalsy();

    await sleep(TEST_GRACE_MS * 2);
    expect(bEvents.names()).toEqual([]);   // ni départ ni nouvelle arrivée : l'avatar n'a pas bougé chez B
    expect(srv.realtime.world.get(a.id)).toEqual(before);
  });

  test('client muet (ordinateur en veille) : coupé faute de réponse aux pings, puis player:left à la fin du délai de grâce', async () => {
    // Pings toutes les 100 ms, 200 ms pour répondre : un client muet est coupé en 300 ms au plus.
    const srv = await startTestServer({ pingIntervalMs: 100, pingTimeoutMs: 200 });
    const cookieA = await srv.inviteAndLogin('a@x.fr');
    const cookieB = await srv.inviteAndLogin('b@x.fr');
    const a = await enter(srv, cookieA, { reconnection: false });   // un ordinateur en veille ne se reconnecte pas
    const b = await enter(srv, cookieB);
    const dropped = new Promise<{ reason: string; at: number }>((resolve) => {
      srv.realtime.io.sockets.sockets.get(a.socket.id!)!.once('disconnect', (reason) => resolve({ reason, at: performance.now() }));
    });

    silence(a.socket);
    const { reason, at: droppedAt } = await dropped;
    expect(reason).toBe('ping timeout');   // vu par le serveur seul : le client n'a rien fermé
    expect(srv.realtime.world.get(a.id)).toBeDefined();   // l'avatar reste, le temps du délai de grâce
    const { payload, at } = await nextEvent(b.socket, 'player:left').then((payload) => ({ payload, at: performance.now() }));
    expect(payload).toEqual({ id: a.id });
    expect(at - droppedAt).toBeGreaterThanOrEqual(TEST_GRACE_MS - 10);
    expect(b.socket.connected).toBe(true);   // B, qui répond aux pings, est toujours là
  });

  test('coupure longue (> grâce) : player:left et position enregistrée', async () => {
    const srv = await startTestServer();
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    expect(srv.realtime.world.applyMove(a.id, { x: 112, y: 240, dir: 'right', moving: false })).toEqual({ ok: true });

    const left = nextEvent(b.socket, 'player:left').then((payload) => ({ payload, at: performance.now() }));
    const cutAt = performance.now();
    const cutClock = Date.now();
    cutNetwork(a.socket, { reconnect: false });
    const { payload, at } = await left;
    expect(payload).toEqual({ id: a.id });
    expect(at - cutAt).toBeGreaterThanOrEqual(TEST_GRACE_MS - 10);   // pas avant la fin du délai de grâce (à 10 ms près)

    // Enregistrée avant l'annonce du départ : elle est en base quand B l'apprend, avec l'heure de la coupure, pas celle de la fin du
    // délai de grâce (au moins TEST_GRACE_MS avant l'annonce, à 10 ms près).
    const [row] = await srv.db.select({ lastX: user.lastX, lastY: user.lastY, lastDir: user.lastDir, lastSeenAt: user.lastSeenAt }).from(user).where(eq(user.id, a.id));
    expect(row).toMatchObject({ lastX: 112, lastY: 240, lastDir: 'right' });
    expect(row!.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(cutClock);
    expect(row!.lastSeenAt!.getTime()).toBeLessThan(cutClock + (at - cutAt) - (TEST_GRACE_MS - 10));
    expect(srv.realtime.world.get(a.id)).toBeUndefined();
  });

  test('départ : la position est enregistrée au départ, sans attendre la sauvegarde périodique', async () => {
    const srv = await startTestServer({ saveMs: 60_000 });
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    expect(srv.realtime.world.applyMove(a.id, { x: 48, y: 240, dir: 'left', moving: false })).toEqual({ ok: true });

    const left = nextEvent(b.socket, 'player:left');
    a.socket.disconnect();   // l'onglet est fermé
    expect(await left).toEqual({ id: a.id });
    expect(await loadPosition(srv.db, a.id)).toEqual({ x: 48, y: 240, dir: 'left' });
    expect(await loadPosition(srv.db, b.id)).toBeNull();   // la sauvegarde périodique n'est pas passée
  });

  test('on revient à sa position enregistrée, ou au point d\'apparition si sa zone est occupée', async () => {
    const busy = new Set<string>();
    const srv = await startTestServer({ busyZones: () => busy });
    const cookie = await srv.inviteAndLogin('a@x.fr');
    const { id } = (await findUserByEmail(srv.db, 'a@x.fr'))!;
    await savePositions(srv.db, [{ id, x: 336, y: 80, dir: 'left' }]);   // dans la salle de réunion

    const first = await enter(srv, cookie);
    expect(first.init.self).toMatchObject({ x: 336, y: 80, dir: 'left' });

    first.socket.disconnect();
    await vi.waitFor(() => expect(srv.realtime.world.get(id)).toBeUndefined());   // parti, au bout du délai de grâce
    busy.add(srv.map.zones.find((zone) => zone.type === 'private')!.id);   // une réunion a commencé dans la salle
    expect((await enter(srv, cookie)).init.self).toMatchObject({ ...SPAWN, dir: 'down' });
  });

  test('connexion fermée pendant la lecture de sa position : personne n\'entre, aucun avatar fantôme', async () => {
    const srv = await startTestServer();
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const bEvents = record(b.socket);
    const cookieA = await srv.inviteAndLogin('a@x.fr');
    const { id: aId } = (await findUserByEmail(srv.db, 'a@x.fr'))!;

    // La base devient lente à la connexion de A, après l'écouteur de la présence : les lectures de son arrivée (position, compte),
    // pas encore lancées, attendent qu'on les libère.
    const slow = slowDatabase(srv);
    srv.realtime.io.once('connection', () => slow.hold());

    const a = srv.connect(cookieA, { reconnection: false });
    const aEvents = record(a);
    // L'onglet est fermé aussitôt ouvert. Quand le client voit `connect`, le serveur a déjà enregistré la socket.
    await new Promise<void>((resolve) => {
      a.once('connect', () => {
        a.disconnect();
        resolve();
      });
    });
    await vi.waitFor(() => expect(srv.realtime.socketsOf(aId)).toEqual([]));   // le serveur a vu la socket partir
    slow.release();

    await sleep(TEST_GRACE_MS * 2);
    expect(aEvents.names()).toEqual([]);
    expect(srv.realtime.world.get(aId)).toBeUndefined();   // un joueur sans socket ni délai de grâce ne partirait jamais
    expect(bEvents.names()).toEqual([]);
  });

  test('retour pendant l\'enregistrement de son départ : on revient là où on était parti, départ puis retour annoncés', async () => {
    const srv = await startTestServer({ saveMs: 60_000 });
    const cookieA = await srv.inviteAndLogin('a@x.fr');
    const a = await enter(srv, cookieA);
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    placeSilently(srv, a.id, { x: 112, y: 240, dir: 'right', moving: false });
    const bEvents = record(b.socket);

    // La base est lente à écrire : l'enregistrement des positions attend qu'on le libère ; les lectures passent.
    const slow = slowDatabase(srv, (sql) => /^update "user"/i.test(sql));
    slow.hold();

    a.socket.disconnect();
    await vi.waitFor(() => expect(srv.realtime.world.get(a.id)).toBeUndefined());   // délai écoulé : parti, position en cours d'écriture
    const back = srv.connect(cookieA);
    const backEvents = record(back);
    await sleep(100);
    expect(backEvents.names()).toEqual([]);   // l'arrivée attend l'écriture avant de lire la position
    slow.release();

    await vi.waitFor(() => expect(backEvents.names()).toEqual(['init']));
    expect(backEvents.payloadsOf('init')[0]).toMatchObject({ self: { id: a.id, x: 112, y: 240, dir: 'right' } });
    await vi.waitFor(() => expect(bEvents.names()).toEqual(['player:left', 'player:joined']));
  });

  test('statut retenu : on revient avec le statut qu\'on avait en partant', async () => {
    const srv = await startTestServer();
    const cookie = await srv.inviteAndLogin('a@x.fr');
    const a = await enter(srv, cookie);
    srv.realtime.world.setStatus(a.id, 'dnd');
    a.socket.disconnect();
    await vi.waitFor(() => expect(srv.realtime.world.get(a.id)).toBeUndefined());
    expect((await enter(srv, cookie)).init.self.status).toBe('dnd');
  });
});

describe('positions', () => {
  test('positions enregistrées toutes les saveMs, sans attendre un départ', async () => {
    const srv = await startTestServer({ saveMs: 100 });
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    expect(srv.realtime.world.applyMove(a.id, { x: 112, y: 240, dir: 'right', moving: false })).toEqual({ ok: true });
    await vi.waitFor(async () => expect(await loadPosition(srv.db, a.id)).toEqual({ x: 112, y: 240, dir: 'right' }));
    expect(srv.realtime.world.get(a.id)).toBeDefined();
  });

  test('redémarrage du serveur : reconnexion automatique, position enregistrée restaurée', async () => {
    const srv = await startTestServer();
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    // Les positions du moment, en mémoire seulement : aucune n'est encore en base.
    expect(srv.realtime.world.applyMove(a.id, { x: 112, y: 240, dir: 'right', moving: false })).toEqual({ ok: true });
    expect(srv.realtime.world.applyMove(b.id, { x: 48, y: 240, dir: 'left', moving: false })).toEqual({ ok: true });

    const reinit = Promise.all([nextEvent(a.socket, 'init', 5000), nextEvent(b.socket, 'init', 5000)]);
    // Un déploiement : nouvelle instance, monde vide, même base. Les clients se reconnectent seuls.
    const [, [aInit, bInit]] = await Promise.all([srv.restart(), reinit]);

    expect(aInit.self).toMatchObject({ id: a.id, x: 112, y: 240, dir: 'right' });
    expect(bInit.self).toMatchObject({ id: b.id, x: 48, y: 240, dir: 'left' });
    expect(srv.realtime.world.list().map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
  });

  test('stop() enregistre toutes les positions, y compris pendant le délai de grâce, et peut être appelé deux fois', async () => {
    const srv = await startTestServer({ saveMs: 60_000, graceMs: 60_000 });
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    expect(srv.realtime.world.applyMove(a.id, { x: 112, y: 240, dir: 'right', moving: false })).toEqual({ ok: true });
    expect(srv.realtime.world.applyMove(b.id, { x: 48, y: 240, dir: 'left', moving: false })).toEqual({ ok: true });
    b.socket.disconnect();
    await vi.waitFor(() => expect(srv.realtime.socketsOf(b.id)).toEqual([]));   // B est en délai de grâce

    const first = srv.realtime.stop();
    expect(srv.realtime.stop()).toBe(first);
    await first;
    expect(await loadPosition(srv.db, a.id)).toEqual({ x: 112, y: 240, dir: 'right' });
    expect(await loadPosition(srv.db, b.id)).toEqual({ x: 48, y: 240, dir: 'left' });
  });

  test('stop() enregistre les positions avant de fermer les sockets : quand un client voit sa connexion tomber, sa dernière position est déjà en base', async () => {
    const srv = await startTestServer({ saveMs: 60_000 });
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    a.socket.emit('move', { x: 112, y: 240, dir: 'right', moving: false });
    await vi.waitFor(() => expect(srv.realtime.world.get(a.id)).toMatchObject({ x: 112, dir: 'right' }));
    expect(await loadPosition(srv.db, a.id)).toBeNull();   // en mémoire seulement

    // Un déploiement avec une base lente : les écritures attendent qu'on les libère (les lectures passent). Ce que la base contient
    // quand le client voit sa connexion tomber, c'est ce que sa reconnexion à la nouvelle instance peut lire.
    const slow = slowDatabase(srv, (sql) => /^update "user"/i.test(sql));
    slow.hold();
    const savedWhenCut = new Promise<Awaited<ReturnType<typeof loadPosition>>>((resolve) => {
      a.socket.once('disconnect', () => resolve(loadPosition(srv.db, a.id)));
    });

    const stopping = srv.realtime.stop();
    await sleep(TEST_GRACE_MS * 2);
    expect(a.socket.connected).toBe(true);   // l'enregistrement n'est pas fini : les sockets restent ouvertes
    slow.release();
    await stopping;
    expect(await savedWhenCut).toEqual({ x: 112, y: 240, dir: 'right' });
    expect(a.socket.connected).toBe(false);

    // La nouvelle instance, sur la même base : le client s'y reconnecte et retrouve cette position.
    const reinit = nextEvent(a.socket, 'init', 5000);
    await srv.restart();
    expect((await reinit).self).toMatchObject({ x: 112, y: 240, dir: 'right' });
  });

  test('une écriture de position qui échoue est journalisée et ne retient pas stop() : les sockets sont fermées quand même', async () => {
    const { logger, lines } = captureLogs();
    const srv = await startTestServer({ logger, saveMs: 60_000 });
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    vi.spyOn(srv.db, 'update').mockImplementation(() => {
      throw new Error('base indisponible');
    });
    const cut = disconnection(a.socket);

    await srv.realtime.stop();
    await cut;
    expect(lines.map((line) => line.msg)).toContain('Enregistrement des positions impossible');
  });

  test('savePositions et loadPosition', async () => {
    const t = await createTestApp();
    const a = await t.inviteAndAccept('a@x.fr');
    const b = await t.inviteAndAccept('b@x.fr');
    expect(await loadPosition(t.db, a.userId)).toBeNull();   // jamais venu
    expect(await loadPosition(t.db, 'inconnu')).toBeNull();

    await savePositions(t.db, []);
    await savePositions(t.db, [
      { id: a.userId, x: 112, y: 240, dir: 'right' },
      { id: b.userId, x: 400, y: 400, dir: 'up' },
    ]);
    expect(await loadPosition(t.db, a.userId)).toEqual({ x: 112, y: 240, dir: 'right' });
    expect(await loadPosition(t.db, b.userId)).toEqual({ x: 400, y: 400, dir: 'up' });

    // Une direction illisible en base ne fait pas échouer l'arrivée : l'avatar regarde vers le bas.
    await t.db.update(user).set({ lastDir: 'nulle-part' }).where(eq(user.id, a.userId));
    expect(await loadPosition(t.db, a.userId)).toEqual({ x: 112, y: 240, dir: 'down' });
  });

  test('loadOfficeMap lit MAPS_DIR/<MAP_KEY>.json ; une carte absente arrête tout avec son chemin', () => {
    expect(loadOfficeMap(testEnv()).spawn).toEqual(SPAWN);
    expect(() => loadOfficeMap({ MAPS_DIR: '/nulle-part', MAP_KEY: 'absente' })).toThrow('/nulle-part/absente.json');
  });
});

// Réinitialiser son mot de passe ferme toutes les sessions du compte (revokeSessionsOnPasswordReset) : une session volée ne survit pas
// au changement. Les connexions au bureau ouvertes avec elles sont coupées aussi, sans désactiver le compte : la reconnexion, avec
// une session qui n'existe plus, est refusée (`unauthorized`), et le client renvoie à la page de connexion.
describe('mot de passe réinitialisé', () => {
  // Le parcours de l'e-mail : la demande, le lien reçu (qui renvoie vers la page de l'appli avec le jeton), le nouveau mot de passe.
  async function resetPassword(srv: TestServer, email: string, newPassword: string): Promise<void> {
    const asked = await request(srv.app).post('/api/auth/request-password-reset').send({ email, redirectTo: `${srv.env.APP_URL}/reinitialiser` });
    expect(asked.status).toBe(200);
    const mail = await vi.waitFor(
      () => {
        const last = srv.mailer.last(email);
        expect(last).toBeDefined();
        return last!;
      },
      { timeout: 4000 },
    );
    const { pathname, search } = new URL(mail.link);
    const clicked = await request(srv.app).get(pathname + search);
    const token = new URL(clicked.get('Location') ?? '').searchParams.get('token');
    expect((await request(srv.app).post('/api/auth/reset-password').send({ token, newPassword })).status).toBe(200);
  }

  test('ses sockets sont coupées par le serveur, le compte reste actif, et l\'ancienne session ne rouvre pas le bureau', async () => {
    const srv = await startTestServer();
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const bEvents = record(b.socket);

    const cut = disconnection(a.socket);
    await resetPassword(srv, 'a@x.fr', 'nouveaumdp1');
    expect(await cut).toBe('io server disconnect');   // coupée par le serveur : Socket.io ne se reconnecte pas seul
    expect(srv.realtime.socketsOf(a.id)).toEqual([]);
    // Le compte n'est pas retiré : seulement ses sessions.
    expect((await findUserByEmail(srv.db, 'a@x.fr'))?.disabledAt).toBeNull();
    // Les autres ne sont pas touchés.
    expect(b.socket.connected).toBe(true);
    expect(srv.realtime.socketsOf(b.id)).toHaveLength(1);

    // Le client essaie de revenir (superviseConnection), avec le cookie d'avant : plus de session.
    const refused = connectError(a.socket);
    a.socket.connect();
    expect(await refused).toBe('unauthorized');

    // Avec le nouveau mot de passe, une session neuve, et le bureau de nouveau.
    const signIn = await request(srv.app).post('/api/auth/sign-in/email').send({ email: 'a@x.fr', password: 'nouveaumdp1' });
    expect(signIn.status).toBe(200);
    const cookie = (signIn.get('Set-Cookie') ?? []).map((setCookie) => setCookie.split(';')[0]).join('; ');
    expect((await enter(srv, cookie)).id).toBe(a.id);
    expect(bEvents.payloadsOf('player:left')).toEqual([]);   // revenue pendant le délai de grâce
  });
});

describe('membre retiré', () => {
  test('membre retiré : socket coupée, player:left immédiat', async () => {
    const srv = await startTestServer();
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));

    const cut = disconnection(a.socket);
    const left = nextEvent(b.socket, 'player:left').then((payload) => ({ payload, at: performance.now() }));
    const removedAt = performance.now();
    srv.events.emit('member:removed', a.id);
    const [reason, { payload, at }] = await Promise.all([cut, left]);
    expect(reason).toBe('io server disconnect');   // coupée par le serveur : le client ne se reconnecte pas
    expect(payload).toEqual({ id: a.id });
    expect(at - removedAt).toBeLessThan(TEST_GRACE_MS);   // sans délai de grâce
    expect(a.socket.active).toBe(false);
    expect(srv.realtime.world.get(a.id)).toBeUndefined();
    expect(srv.realtime.socketsOf(a.id)).toEqual([]);
  });

  test('retiré pendant le délai de grâce : player:left tout de suite, et une seule fois', async () => {
    const srv = await startTestServer();
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const bEvents = record(b.socket);
    cutNetwork(a.socket, { reconnect: false });
    await vi.waitFor(() => expect(srv.realtime.socketsOf(a.id)).toEqual([]));   // A est en délai de grâce

    srv.events.emit('member:removed', a.id);
    await vi.waitFor(() => expect(bEvents.payloadsOf('player:left')).toEqual([{ id: a.id }]));
    await sleep(TEST_GRACE_MS * 2);
    expect(bEvents.payloadsOf('player:left')).toEqual([{ id: a.id }]);
  });

  test('retiré pendant sa coupure : en revenant, il ne reçoit aucune des diffusions qu\'il a manquées', async () => {
    // Un long délai de grâce : A est encore dans le monde quand il revient (une reprise de connexion serait encore possible).
    const srv = await startTestServer({ graceMs: 5_000 });
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));   // A reçoit player:joined(B)
    const cookieC = await srv.inviteAndLogin('c@x.fr');
    // Les paquets Socket.io que reçoit le client de A, décodés, avant même qu'un événement n'en sorte.
    const wire: Array<{ type: number }> = [];
    a.socket.io.on('packet', (packet) => wire.push(packet));

    cutNetwork(a.socket, { reconnect: false });
    await vi.waitFor(() => expect(srv.realtime.socketsOf(a.id)).toEqual([]));
    wire.length = 0;
    // Diffusé au bureau pendant la coupure de A : l'arrivée de C, puis le départ de A, retiré par un admin.
    await enter(srv, cookieC);
    expect(await removeMember({ db: srv.db, events: srv.events }, { actorId: b.id, targetId: a.id })).toBe('removed');

    const refused = connectError(a.socket);
    a.socket.connect();   // le même client revient, sur la même socket
    expect(['unauthorized', 'disabled']).toContain(await refused);
    expect(wire.map((packet) => packet.type)).toEqual([CONNECT_ERROR_PACKET]);   // le refus, et rien d'autre
    expect(wire.map((packet) => packet.type)).not.toContain(EVENT_PACKET);
  });

  test('retiré pendant que sa connexion s\'établit : il n\'entre pas', async () => {
    const srv = await startTestServer();
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const bEvents = record(b.socket);
    const cookieA = await srv.inviteAndLogin('a@x.fr');
    const { id: aId } = (await findUserByEmail(srv.db, 'a@x.fr'))!;

    // La session de A est lue, valide ; un admin le retire juste après, avant que sa connexion n'arrive au bureau.
    const getSession = srv.auth.api.getSession;
    vi.spyOn(srv.auth.api, 'getSession').mockImplementationOnce((async (...args: Parameters<typeof getSession>) => {
      const found = await getSession(...args);
      expect(await removeMember({ db: srv.db, events: srv.events }, { actorId: b.id, targetId: aId })).toBe('removed');
      return found;
    }) as typeof getSession);

    const a = srv.connect(cookieA);
    const aEvents = record(a);
    expect(await disconnection(a)).toBe('io server disconnect');
    expect(aEvents.names()).toEqual([]);   // aucun init
    expect(srv.realtime.world.get(aId)).toBeUndefined();
    await sleep(50);
    expect(bEvents.names()).toEqual([]);
  });
});
