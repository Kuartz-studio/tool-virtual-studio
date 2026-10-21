import {
  DEV_AVATAR_KEYS,
  DEV_OFFICE,
  MEDIA_STATE_RATE,
  MOVE_RATE,
  STATUS_RATE,
  OFFICE_ROOM,
  WORLD_TICK_MS,
  buildTiledMap,
  parseOfficeMap,
  type MovePayload,
  type WorldTick,
} from '@bureau/shared';
import request from 'supertest';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { startWorldTicks } from '../src/realtime/handlers';
import type { TypedServer } from '../src/realtime/io';
import { World } from '../src/realtime/world';
import { captureLogs } from './helpers/logs';
import {
  cutNetwork,
  enter,
  nextEvent,
  nextInit,
  record,
  sleep,
  slowDatabase,
  startTestServer,
  type ClientSocket,
} from './helpers/realtime';
import { findUserByEmail } from './helpers/test-app';

// La carte de développement : 24 × 16 cases de 32 px. L'apparition est en (80, 240), sur la ligne 7 (du sol de bout en bout) ; les
// bureaux sont sur la ligne 9 (x de 128 à 191 pour le premier) et les murs font le tour de la carte.
const SPAWN = { x: 80, y: 240 };
const map = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));

// Un pas vers la droite sur la ligne de l'apparition, tel que le client l'envoie en marchant.
const walk = (x: number): MovePayload => ({ x, y: SPAWN.y, dir: 'right', moving: true });

// Envoie ce qu'on veut au serveur, comme un client qui ne respecte pas le protocole : le typage de socket.io-client refuserait ces
// charges utiles.
function emitRaw(socket: ClientSocket, event: string, ...args: unknown[]): void {
  (socket as unknown as { emit(event: string, ...args: unknown[]): void }).emit(event, ...args);
}

describe('mouvements', () => {
  test('A bouge → B reçoit world:tick avec le mouvement de A en moins de 250 ms', async () => {
    const srv = await startTestServer();
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));

    const tick = nextEvent(b.socket, 'world:tick');
    const sentAt = performance.now();
    a.socket.emit('move', walk(112));
    const { t, moves } = await tick;

    expect(performance.now() - sentAt).toBeLessThan(250);
    expect(moves).toEqual([{ id: a.id, ...walk(112) }]);
    expect(Number.isInteger(t)).toBe(true);   // l'heure du tick, en ms entières
    expect(srv.realtime.world.get(a.id)).toMatchObject({ x: 112, y: 240, dir: 'right', moving: true });
  });

  test('mouvement trop rapide → move:correct à A, absent des ticks de B', async () => {
    // Une horloge arrêtée : A n'a pas une milliseconde pour aller plus loin que les 60 px que la marge de gigue permet.
    const clock = { t: 5_000 };
    const srv = await startTestServer({ now: () => clock.t });
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const aEvents = record(a.socket);
    const bEvents = record(b.socket);

    a.socket.emit('move', walk(400));   // 320 px d'un coup
    expect(await nextEvent(a.socket, 'move:correct')).toEqual(SPAWN);   // il se recale à sa dernière position acceptée
    await sleep(WORLD_TICK_MS * 3);

    expect(aEvents.payloadsOf('move:correct')).toEqual([SPAWN]);   // une seule correction, et aucun tick pour personne
    expect(aEvents.payloadsOf('world:tick')).toEqual([]);
    expect(bEvents.names()).toEqual([]);
    expect(srv.realtime.world.get(a.id)).toMatchObject({ ...SPAWN, moving: false });

    // Rien n'est cassé : depuis sa position, un pas permis passe, et B le voit.
    const tick = nextEvent(b.socket, 'world:tick');
    a.socket.emit('move', walk(112));
    expect((await tick).moves).toEqual([{ id: a.id, ...walk(112) }]);
    expect(aEvents.payloadsOf('move:correct')).toEqual([SPAWN]);
  });

  test('charge utile invalide (x: 1.5) → ignorée, aucun tick, pas de plantage', async () => {
    const srv = await startTestServer();
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const applyMove = vi.spyOn(srv.realtime.world, 'applyMove');
    const aEvents = record(a.socket);
    const bEvents = record(b.socket);

    const invalid: unknown[] = [
      { x: 1.5, y: 240, dir: 'right', moving: true },   // x n'est pas un entier
      { x: 96, y: 240.5, dir: 'right', moving: true },
      { x: 1e21, y: 240, dir: 'right', moving: true },   // hors des entiers sûrs
      { x: NaN, y: 240, dir: 'right', moving: true },   // devient null sur le fil
      { x: '96', y: 240, dir: 'right', moving: true },
      { x: 96, y: 240, dir: 'diagonale', moving: true },
      { x: 96, y: 240, dir: 'right', moving: 'oui' },
      { x: 96, y: 240, dir: 'right' },
      { x: 96, y: 240 },
      {},
      [],
      'move',
      42,
      null,
    ];
    for (const payload of invalid) emitRaw(a.socket, 'move', payload);
    emitRaw(a.socket, 'move');   // pas de charge utile du tout
    await sleep(WORLD_TICK_MS * 3);

    expect(applyMove).not.toHaveBeenCalled();
    expect(aEvents.payloadsOf('move:correct')).toEqual([]);   // ignorée : pas même une correction
    expect(bEvents.names()).toEqual([]);   // et aucun tick
    expect(srv.realtime.world.get(a.id)).toMatchObject({ ...SPAWN, moving: false });

    // Le serveur est toujours là, et la socket n'a pas été coupée pour si peu.
    const tick = nextEvent(b.socket, 'world:tick');
    a.socket.emit('move', walk(96));
    expect((await tick).moves).toEqual([{ id: a.id, ...walk(96) }]);
    expect(a.socket.connected).toBe(true);
  });

  test('rafale de 50 move en 100 ms → au plus 20 traités, le serveur répond toujours', async () => {
    // Une horloge arrêtée : les 50 mouvements tombent dans la même fenêtre de MOVE_RATE.windowMs, quel que soit le temps que le test
    // met à les envoyer, et aucun n'est refusé pour sa vitesse (1 px d'écart à chaque fois, 60 px permis à l'instant même).
    const clock = { t: 5_000 };
    const srv = await startTestServer({ now: () => clock.t });
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const applyMove = vi.spyOn(srv.realtime.world, 'applyMove');
    const aEvents = record(a.socket);
    const bEvents = record(b.socket);

    for (let n = 1; n <= 50; n++) {
      a.socket.emit('move', walk(SPAWN.x + n));
      await sleep(2);
    }
    await sleep(WORLD_TICK_MS * 2);   // les derniers ont eu le temps d'arriver, et d'être diffusés s'ils devaient l'être

    expect(applyMove).toHaveBeenCalledTimes(MOVE_RATE.max);
    const last = SPAWN.x + MOVE_RATE.max;
    expect(srv.realtime.world.get(a.id)).toMatchObject({ x: last });
    const seenByB = (bEvents.payloadsOf('world:tick') as WorldTick[]).flatMap((tick) => tick.moves.map((move) => move.x));
    expect(seenByB.length).toBeGreaterThan(0);
    expect(Math.max(...seenByB)).toBe(last);   // les 30 suivants n'ont jamais été diffusés
    expect(aEvents.payloadsOf('move:correct')).toEqual([]);   // ignorés, pas corrigés
    expect(a.socket.connected).toBe(true);

    // La limite est propre à chaque socket : B, dans la même fenêtre, bouge sans problème...
    b.socket.emit('move', walk(SPAWN.x + 32));
    await vi.waitFor(() => expect(srv.realtime.world.get(b.id)).toMatchObject({ x: SPAWN.x + 32 }));
    // ... et A est de nouveau écouté dès la fenêtre suivante.
    clock.t += MOVE_RATE.windowMs;
    a.socket.emit('move', walk(last + 40));
    await vi.waitFor(() => expect(srv.realtime.world.get(a.id)).toMatchObject({ x: last + 40 }));
    expect(applyMove).toHaveBeenCalledTimes(MOVE_RATE.max + 2);
  });

  test('3 mouvements dans la même fenêtre → B ne reçoit que le dernier', async () => {
    const srv = await startTestServer({ tickMs: 400 });
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));

    // Un premier mouvement donne le tick auquel se caler : les trois suivants partent juste après lui, à 400 ms du tick d'après.
    const first = nextEvent(b.socket, 'world:tick');
    a.socket.emit('move', walk(90));
    const { t: firstAt } = await first;
    const bEvents = record(b.socket);
    a.socket.emit('move', walk(100));
    a.socket.emit('move', walk(110));
    a.socket.emit('move', walk(120));

    await vi.waitFor(() => expect(bEvents.names()).toEqual(['world:tick']), { timeout: 2000 });
    await sleep(500);   // un tick de plus, s'il y en avait un
    const ticks = bEvents.payloadsOf('world:tick') as WorldTick[];
    expect(ticks).toEqual([{ t: expect.any(Number), moves: [{ id: a.id, ...walk(120) }] }]);
    expect(ticks[0]!.t).toBeGreaterThan(firstAt);   // t avance d'un tick à l'autre
  });
});

describe('statuts et médias', () => {
  test('statut dnd → status:changed chez B ; conservé après reconnexion', async () => {
    const srv = await startTestServer();
    const cookieA = await srv.inviteAndLogin('a@x.fr');
    const a = await enter(srv, cookieA);
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));

    const forB = nextEvent(b.socket, 'status:changed');
    const forA = nextEvent(a.socket, 'status:changed');   // l'émetteur reçoit aussi l'annonce : c'est sa confirmation
    a.socket.emit('status:set', 'dnd');
    expect(await forB).toEqual({ id: a.id, status: 'dnd' });
    expect(await forA).toEqual({ id: a.id, status: 'dnd' });
    expect(srv.realtime.world.get(a.id)?.status).toBe('dnd');

    // Une brève coupure : sa place est gardée, avec son statut.
    const reinit = nextInit(a.socket);
    cutNetwork(a.socket);
    expect((await reinit).self.status).toBe('dnd');

    // Parti pour de bon, puis de retour : le monde se souvient de son statut.
    a.socket.disconnect();
    await vi.waitFor(() => expect(srv.realtime.world.get(a.id)).toBeUndefined());
    const back = await enter(srv, cookieA);
    expect(back.init.self.status).toBe('dnd');

    // La nouvelle socket est écoutée comme la première.
    const available = nextEvent(b.socket, 'status:changed');
    back.socket.emit('status:set', 'available');
    expect(await available).toEqual({ id: a.id, status: 'available' });
  });

  // Chacun est diffusé à tout le bureau : une socket qui en envoie à la chaîne ne doit pas inonder les autres. Comme pour `move`, ce
  // qui dépasse est ignoré sans réponse, et la limite est propre à chaque socket.
  test('rafale de status:set et de media:state → au plus 10 de chaque par seconde diffusés, le reste ignoré', async () => {
    expect(STATUS_RATE).toEqual({ max: 10, windowMs: 1_000 });
    expect(MEDIA_STATE_RATE).toEqual({ max: 10, windowMs: 1_000 });
    // Une horloge arrêtée : toute la rafale tombe dans la même fenêtre, quel que soit le temps que le test met à l'envoyer.
    const clock = { t: 5_000 };
    const srv = await startTestServer({ now: () => clock.t });
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const bEvents = record(b.socket);

    const statuses = ['busy', 'away'] as const;
    for (let n = 0; n < 15; n++) a.socket.emit('status:set', statuses[n % 2]!);
    for (let n = 0; n < 15; n++) a.socket.emit('media:state', { mic: n % 2 === 0, cam: n >= 9, screen: false });
    await vi.waitFor(() => expect(bEvents.payloadsOf('media:changed')).toHaveLength(MEDIA_STATE_RATE.max));
    await sleep(100);   // les suivants ont eu le temps d'arriver, et d'être diffusés s'ils devaient l'être
    expect(bEvents.payloadsOf('status:changed')).toHaveLength(STATUS_RATE.max);
    expect(bEvents.payloadsOf('media:changed')).toHaveLength(MEDIA_STATE_RATE.max);
    // Le 10e est le dernier pris : le 11e (busy) n'a rien changé.
    expect(srv.realtime.world.get(a.id)).toMatchObject({ status: 'away', media: { mic: false, cam: true } });
    expect(a.socket.connected).toBe(true);

    // B, dans la même fenêtre, n'est pas touché par la limite de A...
    const seen = Promise.all([nextEvent(a.socket, 'status:changed'), nextEvent(b.socket, 'status:changed')]);
    b.socket.emit('status:set', 'dnd');
    expect(await seen).toEqual([
      { id: b.id, status: 'dnd' },
      { id: b.id, status: 'dnd' },
    ]);
    // ... et A est de nouveau écouté dès la fenêtre suivante.
    clock.t += STATUS_RATE.windowMs;
    const again = nextEvent(b.socket, 'status:changed');
    a.socket.emit('status:set', 'dnd');
    expect(await again).toEqual({ id: a.id, status: 'dnd' });
  });

  test('statut inconnu ou charge utile invalide → ignoré, sans diffusion', async () => {
    const srv = await startTestServer();
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const aEvents = record(a.socket);
    const bEvents = record(b.socket);

    for (const payload of ['sleeping', '', 'DND', 42, null, { status: 'dnd' }, ['dnd']]) emitRaw(a.socket, 'status:set', payload);
    emitRaw(a.socket, 'status:set');
    await sleep(100);
    expect(aEvents.payloadsOf('status:changed')).toEqual([]);
    expect(bEvents.names()).toEqual([]);
    expect(srv.realtime.world.get(a.id)?.status).toBe('available');

    const changed = nextEvent(b.socket, 'status:changed');
    a.socket.emit('status:set', 'busy');
    expect(await changed).toEqual({ id: a.id, status: 'busy' });
  });

  test('media:state → media:changed chez tout le monde, émetteur compris ; un nouvel arrivant voit cet état', async () => {
    const srv = await startTestServer();
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const media = { mic: true, cam: false, screen: true };

    const forB = nextEvent(b.socket, 'media:changed');
    const forA = nextEvent(a.socket, 'media:changed');
    emitRaw(a.socket, 'media:state', { ...media, intrus: 'oui' });   // un champ en trop n'est pas diffusé
    expect(await forB).toEqual({ id: a.id, media });
    expect(await forA).toEqual({ id: a.id, media });
    expect(srv.realtime.world.get(a.id)?.media).toEqual(media);

    // Des charges invalides : ignorées.
    const bEvents = record(b.socket);
    for (const payload of [{ mic: 'oui', cam: false, screen: false }, { mic: true }, {}, 'micro', null]) emitRaw(a.socket, 'media:state', payload);
    emitRaw(a.socket, 'media:state');
    await sleep(100);
    expect(bEvents.names()).toEqual([]);
    expect(srv.realtime.world.get(a.id)?.media).toEqual(media);

    const c = await enter(srv, await srv.inviteAndLogin('c@x.fr'));
    expect(c.init.players.find((p) => p.id === a.id)?.media).toEqual(media);
  });
});

describe('profils', () => {
  test('PATCH /api/me { name } → profile:changed chez B', async () => {
    const srv = await startTestServer();
    const cookieA = await srv.inviteAndLogin('a@x.fr');
    const a = await enter(srv, cookieA);
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));

    const forB = nextEvent(b.socket, 'profile:changed');
    const forA = nextEvent(a.socket, 'profile:changed');
    const res = await request(srv.app).patch('/api/me').set('Cookie', cookieA).send({ name: 'Léa' });

    expect(res.status).toBe(200);
    expect(await forB).toEqual({ id: a.id, name: 'Léa', avatarKey: null });
    expect(await forA).toEqual({ id: a.id, name: 'Léa', avatarKey: null });
    expect(srv.realtime.world.get(a.id)).toMatchObject({ name: 'Léa', avatarKey: null });
  });

  test('PATCH /api/me { avatarKey } → le profil complet est diffusé, et un nouvel arrivant voit le nouveau', async () => {
    const srv = await startTestServer();
    const cookieA = await srv.inviteAndLogin('a@x.fr');
    const a = await enter(srv, cookieA);
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));

    const forB = nextEvent(b.socket, 'profile:changed');
    const res = await request(srv.app).patch('/api/me').set('Cookie', cookieA).send({ avatarKey: DEV_AVATAR_KEYS[1] });

    expect(res.status).toBe(200);
    expect(await forB).toEqual({ id: a.id, name: 'a', avatarKey: 'dev-blue' });   // avec le nom : le client remplace les deux ensemble
    const c = await enter(srv, await srv.inviteAndLogin('c@x.fr'));
    expect(c.init.players.find((p) => p.id === a.id)).toMatchObject({ name: 'a', avatarKey: 'dev-blue' });
  });

  test('un membre qui n\'est pas au bureau change de profil → annoncé quand même, et le monde n\'y gagne personne', async () => {
    const srv = await startTestServer();
    const cookieA = await srv.inviteAndLogin('a@x.fr');   // A n'est pas connecté
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const { id } = (await findUserByEmail(srv.db, 'a@x.fr'))!;

    const forB = nextEvent(b.socket, 'profile:changed');
    const res = await request(srv.app).patch('/api/me').set('Cookie', cookieA).send({ name: 'Zoé' });

    expect(res.status).toBe(200);
    expect(await forB).toEqual({ id, name: 'Zoé', avatarKey: null });   // la liste des membres d'un autre onglet peut la suivre
    expect(srv.realtime.world.get(id)).toBeUndefined();
  });

  test('stop() désabonne profile:changed', async () => {
    const srv = await startTestServer();
    const setProfile = vi.spyOn(srv.realtime.world, 'setProfile');
    await srv.realtime.stop();
    srv.events.emit('profile:changed', { id: 'quelqu-un', name: 'Zoé', avatarKey: null });
    expect(setProfile).not.toHaveBeenCalled();
  });
});

describe('avant l\'entrée dans le monde', () => {
  test('move, statut, média et téléportation d\'une socket pas encore entrée : ignorés, sans move:correct', async () => {
    const srv = await startTestServer({ env: { E2E: '1' } });
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const bEvents = record(b.socket);
    const cookieA = await srv.inviteAndLogin('a@x.fr');

    // La base devient lente à la connexion de A : son arrivée (lecture de sa position) attend qu'on la libère, et A n'est pas
    // encore dans le monde.
    const slow = slowDatabase(srv);
    srv.realtime.io.once('connection', () => slow.hold());
    const a = srv.connect(cookieA);
    const aEvents = record(a);
    await new Promise<void>((resolve) => {
      a.once('connect', () => {
        a.emit('move', walk(400));   // il pourrait croire qu'il est déjà arrivé : ce n'est pas le cas
        a.emit('status:set', 'dnd');
        a.emit('media:state', { mic: true, cam: true, screen: false });
        a.emit('debug:teleport', { x: 400, y: 400 });
        resolve();
      });
    });
    await sleep(WORLD_TICK_MS * 3);   // le serveur a lu les quatre messages
    const init = nextInit(a);
    slow.release();

    // Il arrive comme n'importe qui, rien de ce qu'il a envoyé n'a laissé de trace.
    expect((await init).self).toMatchObject({
      ...SPAWN,
      moving: false,
      status: 'available',
      media: { mic: false, cam: false, screen: false },
    });
    await sleep(WORLD_TICK_MS * 3);
    expect(aEvents.names()).toEqual(['init']);   // pas de move:correct
    expect(bEvents.names()).toEqual(['desk:changed', 'player:joined']);   // ni statut, ni média, ni tick : seulement son arrivée, et le bureau qu'elle prend
  });
});

describe('debug:teleport', () => {
  test('avec E2E=1 : A est posé là où il le demande, à l\'arrêt, et B le voit au tick suivant', async () => {
    const srv = await startTestServer({ env: { E2E: '1' } });
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));

    // A marche d'abord : sa dernière direction est « right », et il est en marche.
    const walking = nextEvent(b.socket, 'world:tick');
    a.socket.emit('move', walk(96));
    await walking;
    expect(srv.realtime.world.get(a.id)).toMatchObject({ moving: true });

    const tick = nextEvent(b.socket, 'world:tick');
    a.socket.emit('debug:teleport', { x: 400, y: 400 });
    expect((await tick).moves).toEqual([{ id: a.id, x: 400, y: 400, dir: 'right', moving: false }]);
    expect(srv.realtime.world.get(a.id)).toMatchObject({ x: 400, y: 400, dir: 'right', moving: false });
  });

  test('avec E2E=1 : une case bloquante, hors de la carte ou une charge invalide → ignoré', async () => {
    const srv = await startTestServer({ env: { E2E: '1' } });
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const aEvents = record(a.socket);
    const bEvents = record(b.socket);

    const refused: unknown[] = [
      { x: 144, y: 304 },   // sur un bureau
      { x: 16, y: 16 },   // dans un mur
      { x: -5, y: 240 },   // hors de la carte
      { x: 5000, y: 240 },
      { x: 1.5, y: 240 },
      { x: '400', y: 400 },
      { x: 400 },
      null,
      'ici',
    ];
    for (const payload of refused) emitRaw(a.socket, 'debug:teleport', payload);
    emitRaw(a.socket, 'debug:teleport');
    await sleep(WORLD_TICK_MS * 3);

    expect(srv.realtime.world.get(a.id)).toMatchObject(SPAWN);
    expect(bEvents.names()).toEqual([]);
    expect(aEvents.payloadsOf('move:correct')).toEqual([]);
  });

  test('sans E2E=1 : l\'événement n\'est pas enregistré, et n\'a aucun effet', async () => {
    const srv = await startTestServer();
    const a = await enter(srv, await srv.inviteAndLogin('a@x.fr'));
    const b = await enter(srv, await srv.inviteAndLogin('b@x.fr'));
    const bEvents = record(b.socket);
    const serverSideA = srv.realtime.io.sockets.sockets.get(srv.realtime.socketsOf(a.id)[0]!)!;
    expect(serverSideA.listeners('debug:teleport')).toHaveLength(0);
    expect(serverSideA.listeners('move')).toHaveLength(1);   // les autres, eux, le sont

    a.socket.emit('debug:teleport', { x: 400, y: 400 });
    await sleep(WORLD_TICK_MS * 3);
    expect(srv.realtime.world.get(a.id)).toMatchObject(SPAWN);
    expect(bEvents.names()).toEqual([]);
  });
});

describe('startWorldTicks', () => {
  // Un io réduit à ce que la boucle appelle (io.to(salle).volatile.emit), et un monde où A est à l'apparition.
  function setup() {
    const clock = { t: 1_000 };
    const world = new World(map, () => clock.t);
    world.join({ id: 'a', name: 'A', avatarKey: null, ...SPAWN, dir: 'down', status: 'available' });
    const emit = vi.fn();
    const to = vi.fn(() => ({ volatile: { emit } }));
    const { logger, lines } = captureLogs();
    return { clock, world, emit, to, io: { to } as unknown as TypedServer, logger, lines };
  }

  test('toutes les tickMs, un world:tick volatile vers la salle du bureau s\'il y a des mouvements, rien sinon', () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { clock, world, emit, to, io, logger } = setup();
    const stop = startWorldTicks(io, world, 100, () => clock.t, logger);

    vi.advanceTimersByTime(300);
    expect(to).not.toHaveBeenCalled();   // personne n'a bougé : pas de tick

    clock.t = 1_150;
    expect(world.applyMove('a', walk(96))).toEqual({ ok: true });
    vi.advanceTimersByTime(99);
    expect(emit).not.toHaveBeenCalled();   // le tick d'après n'est pas encore là
    vi.advanceTimersByTime(1);
    expect(to).toHaveBeenCalledExactlyOnceWith(OFFICE_ROOM);
    expect(emit).toHaveBeenCalledExactlyOnceWith('world:tick', { t: 1_150, moves: [{ id: 'a', ...walk(96) }] });

    vi.advanceTimersByTime(500);
    expect(emit).toHaveBeenCalledTimes(1);   // le mouvement est parti une fois, la liste est vidée

    // Deux mouvements dans la même fenêtre : le dernier seulement. Puis l'arrêt.
    world.applyMove('a', walk(100));
    world.applyMove('a', walk(104));
    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith('world:tick', { t: 1_150, moves: [{ id: 'a', ...walk(104) }] });
    stop();
    world.applyMove('a', walk(108));
    vi.advanceTimersByTime(1_000);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(world.drainMoves()).toEqual([{ id: 'a', ...walk(108) }]);   // rien n'a été vidé depuis l'arrêt
  });

  test('une exception dans la boucle est journalisée, et la boucle continue sans rien perdre', () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { clock, world, emit, io, logger, lines } = setup();
    vi.spyOn(world, 'drainMoves').mockImplementationOnce(() => {
      throw new Error('monde illisible');
    });
    const stop = startWorldTicks(io, world, 100, () => clock.t, logger);
    onTestFinished(stop);

    clock.t = 1_150;
    world.applyMove('a', walk(96));
    vi.advanceTimersByTime(100);   // levée dans le rappel d'un minuteur, l'exception ferait tomber le processus
    expect(emit).not.toHaveBeenCalled();
    expect(lines).toEqual([
      expect.objectContaining({ level: 50, msg: 'Envoi du world:tick impossible', err: expect.objectContaining({ message: 'monde illisible' }) }),
    ]);

    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledExactlyOnceWith('world:tick', { t: 1_150, moves: [{ id: 'a', ...walk(96) }] });
  });

  test('le minuteur ne retient pas le processus', () => {
    // Un minuteur « unref » n'est pas compté parmi les ressources actives de Node.
    const timeouts = () => process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
    const { world, io, logger } = setup();
    const before = timeouts();
    const stop = startWorldTicks(io, world, 100, () => performance.now(), logger);
    onTestFinished(stop);
    expect(timeouts()).toBe(before);
  });

  test('la boucle du serveur tourne à tickMs, et stop() l\'arrête', async () => {
    const srv = await startTestServer({ tickMs: 20 });
    const drain = vi.spyOn(srv.realtime.world, 'drainMoves');
    await sleep(300);
    expect(drain.mock.calls.length).toBeGreaterThanOrEqual(6);   // une quinzaine à 20 ms, trois seulement aux 100 ms par défaut

    await srv.realtime.stop();
    const calls = drain.mock.calls.length;
    await sleep(150);
    expect(drain).toHaveBeenCalledTimes(calls);
  });
});
