import {
  CLOSE_RANGE_GROUPING,
  DEV_OFFICE,
  EMPTY_GROUPING,
  GROUP_DEBOUNCE_MS,
  GROUPS_TICK_MS,
  buildTiledMap,
  parseOfficeMap,
  type MediaJoinPayload,
} from '@bureau/shared';
import { TokenVerifier } from 'livekit-server-sdk';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { createLiveKitBackend, type MediaBackend } from '../src/media/livekit';
import { MediaCoordinator, type MediaEvent } from '../src/media/media-coordinator';
import { startGroupTicks } from '../src/realtime/handlers';
import { savePositions } from '../src/realtime/positions';
import { World } from '../src/realtime/world';
import { captureLogs } from './helpers/logs';
import {
  cutNetwork,
  nextEvent,
  nextInit,
  record,
  sleep,
  slowDatabase,
  startTestServer,
  type ClientSocket,
  type TestServer,
  type TestServerOptions,
} from './helpers/realtime';
import { findUserByEmail } from './helpers/test-app';

// La carte de développement (24 × 16 cases de 32 px) : l'apparition en (80, 240), sur la ligne 7, du sol de bout en bout, dans l'open
// space ; la salle de réunion (zone privée) va des cases 8 à 13 sur les lignes 1 à 4, soit x de 256 à 447 et y de 32 à 159.
const SPAWN = { x: 80, y: 240 };
const FAR = { x: 688, y: 240 };   // l'autre bout de la ligne 7, à 19 cases de l'apparition
const SIDE_A = { x: 400, y: 240 };
const SIDE_B = { x: 432, y: 240 };   // une case à droite de SIDE_A
const IN_ROOM_A = { x: 304, y: 80 };
const IN_ROOM_B = { x: 400, y: 112 };
const map = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));

// Un projet LiveKit inventé. Les tests passent un faux backend : de vrais jetons (createLiveKitBackend, avec ces clés), mais des
// retraits de participant seulement enregistrés, sans réseau.
const LIVEKIT = {
  LIVEKIT_URL: 'wss://bureau-test.livekit.test',
  LIVEKIT_API_KEY: 'cle-de-test',
  LIVEKIT_API_SECRET: 'secret-de-test-0123456789-abcdefghij',
};
const verifier = new TokenVerifier(LIVEKIT.LIVEKIT_API_KEY, LIVEKIT.LIVEKIT_API_SECRET);

const isMedia = (event: string) => event.startsWith('media:');
const initAndMedia = (event: string) => event === 'init' || isMedia(event);

function fakeLiveKit() {
  const real = createLiveKitBackend(LIVEKIT)!;
  const removed: string[] = [];
  const backend: MediaBackend = {
    url: real.url,
    mintToken: (i) => real.mintToken(i),
    removeParticipant: async (room, identity) => {
      removed.push(`${room} ${identity}`);
    },
  };
  return { backend, removed };
}

// Le serveur des tests, avec E2E=1 (debug:teleport), les variables LiveKit de test et le faux backend.
async function startMediaServer(o: TestServerOptions = {}) {
  const live = fakeLiveKit();
  const srv = await startTestServer({ ...o, env: { E2E: '1', ...LIVEKIT, ...o.env }, media: live.backend });
  return { srv, removed: live.removed };
}

type Player = { socket: ClientSocket; id: string; events: ReturnType<typeof record> };

// Entre au bureau en enregistrant tout ce que la socket reçoit, init compris.
async function enterRecorded(srv: TestServer, email: string): Promise<Player> {
  const socket = srv.connect(await srv.inviteAndLogin(email));
  const events = record(socket);
  const init = await nextInit(socket);
  return { socket, id: init.self.id, events };
}

async function teleport(srv: TestServer, p: Player, to: { x: number; y: number }): Promise<void> {
  p.socket.emit('debug:teleport', to);
  await vi.waitFor(() => expect(srv.realtime.world.get(p.id)).toMatchObject(to));
}

// Le jeton vaut pour cette room seulement, au nom de cette personne, et il est signé avec le secret du projet.
async function expectToken(join: MediaJoinPayload, userId: string, name: string): Promise<void> {
  const claims = await verifier.verify(join.token);
  expect(claims).toMatchObject({ sub: userId, name, video: { roomJoin: true, room: join.room } });
}

// A et B, côte à côte et arrêtés, dans le même groupe : la room de leur conversation.
async function grouped(srv: TestServer): Promise<{ a: Player; b: Player; room: string }> {
  const a = await enterRecorded(srv, 'a@x.fr');
  await teleport(srv, a, FAR);   // loin de l'apparition, où B arrive
  const b = await enterRecorded(srv, 'b@x.fr');
  const joins = Promise.all([nextEvent(a.socket, 'media:join'), nextEvent(b.socket, 'media:join')]);
  a.socket.emit('debug:teleport', SIDE_A);
  b.socket.emit('debug:teleport', SIDE_B);
  const [joinA, joinB] = await joins;
  expect(joinA.room).toBe(joinB.room);
  return { a, b, room: joinA.room };
}

describe('rooms LiveKit des groupes', () => {
  test('deux personnes téléportées côte à côte et arrêtées : media:join pour les deux en moins d\'1 s', async () => {
    const { srv, removed } = await startMediaServer();
    const a = await enterRecorded(srv, 'a@x.fr');
    await teleport(srv, a, FAR);
    const b = await enterRecorded(srv, 'b@x.fr');

    const joins = Promise.all([nextEvent(a.socket, 'media:join'), nextEvent(b.socket, 'media:join')]);
    const sentAt = performance.now();
    a.socket.emit('debug:teleport', SIDE_A);
    b.socket.emit('debug:teleport', SIDE_B);
    const [joinA, joinB] = await joins;

    expect(performance.now() - sentAt).toBeLessThan(1000);
    expect(joinA.room).toBe(joinB.room);
    expect(joinA.room).toMatch(/^[a-z0-9]{6}-g\d+$/);   // `${bootId}-${groupId}`
    expect(joinA.url).toBe(LIVEKIT.LIVEKIT_URL);
    expect(joinB.url).toBe(LIVEKIT.LIVEKIT_URL);
    await expectToken(joinA, a.id, 'a');
    await expectToken(joinB, b.id, 'b');
    // À l'arrivée, hors groupe : media:leave juste après init. Puis le join, une seule fois.
    expect(a.events.names().filter(initAndMedia)).toEqual(['init', 'media:leave', 'media:join']);
    expect(b.events.names().filter(initAndMedia)).toEqual(['init', 'media:leave', 'media:join']);
    expect(removed).toEqual([]);
    expect(srv.realtime.coordinator.groupMembersOf(a.id)).toEqual([a.id, b.id].sort());
  });

  test('reconnexion pendant le délai de grâce : media:join renvoyé avec la même room', async () => {
    // Un délai de grâce de 2 s : même sur une machine chargée, la reconnexion tombe dedans.
    const { srv, removed } = await startMediaServer({ graceMs: 2_000 });
    const { a, b, room } = await grouped(srv);
    const aEvents = record(a.socket);
    const bEvents = record(b.socket);

    const reinit = nextInit(a.socket);
    const rejoin = nextEvent(a.socket, 'media:join');
    cutNetwork(a.socket);   // le Wi-Fi saute : le client se reconnecte de lui-même, avant la fin du délai de grâce
    expect((await reinit).self).toMatchObject(SIDE_A);   // l'avatar n'a pas bougé
    const join = await rejoin;

    expect(join.room).toBe(room);
    await expectToken(join, a.id, 'a');   // un jeton neuf, pour la même room
    expect(aEvents.names().filter(initAndMedia)).toEqual(['init', 'media:join']);   // init d'abord ; pas de leave : toujours dans le groupe
    // Un changement de groupe dû à la coupure se verrait en 500 ms et deux tours de calcul : il n'y en a pas.
    await sleep(GROUP_DEBOUNCE_MS + 2 * GROUPS_TICK_MS);
    expect(bEvents.names().filter(isMedia)).toEqual([]);   // la conversation n'a pas bougé pour B
    expect(aEvents.names().filter(isMedia)).toEqual(['media:join']);
    expect(removed).toEqual([]);
    expect(srv.realtime.coordinator.groupMembersOf(a.id)).toEqual([a.id, b.id].sort());
  });

  test('A s\'éloigne : le groupe se défait, media:leave et removeParticipant pour les deux', async () => {
    const { srv, removed } = await startMediaServer();
    const { a, b, room } = await grouped(srv);

    const leaves = Promise.all([nextEvent(a.socket, 'media:leave'), nextEvent(b.socket, 'media:leave')]);
    a.socket.emit('debug:teleport', FAR);
    await leaves;

    expect(removed.sort()).toEqual([`${room} ${a.id}`, `${room} ${b.id}`].sort());
    expect(srv.realtime.coordinator.groupMembersOf(a.id)).toEqual([]);
    expect(srv.realtime.coordinator.groupMembersOf(b.id)).toEqual([]);
  });

  test('fin du délai de grâce : A quitte le bureau, B reçoit media:leave, et les deux sont retirés de la room', async () => {
    const { srv, removed } = await startMediaServer();
    const { a, b, room } = await grouped(srv);

    const left = nextEvent(b.socket, 'player:left');
    const leave = nextEvent(b.socket, 'media:leave');
    cutNetwork(a.socket, { reconnect: false });
    expect(await left).toEqual({ id: a.id });
    await leave;

    expect(removed.sort()).toEqual([`${room} ${a.id}`, `${room} ${b.id}`].sort());
    expect(srv.realtime.coordinator.groupMembersOf(b.id)).toEqual([]);
  });

  test('redémarrage du serveur : la conversation se reforme dans une room neuve, d\'un autre démarrage', async () => {
    const { srv } = await startMediaServer();
    const { a, b, room } = await grouped(srv);
    const aEvents = record(a.socket);

    const joins = Promise.all([nextEvent(a.socket, 'media:join', 5000), nextEvent(b.socket, 'media:join', 5000)]);
    await srv.restart();   // positions enregistrées ; les clients se reconnectent seuls à la nouvelle instance
    const [joinA, joinB] = await joins;

    expect(joinA.room).toBe(joinB.room);
    expect(joinA.room.split('-')[0]).not.toBe(room.split('-')[0]);   // un autre bootId : jamais la room d'avant le redémarrage
    // Au retour, la nouvelle instance n'a pas encore de groupe : media:leave d'abord (le client quitte la room d'avant), puis le join.
    expect(aEvents.names().filter(initAndMedia)).toEqual(['init', 'media:leave', 'media:join']);
    await expectToken(joinA, a.id, 'a');
  });

  // Le serveur ne garde les statuts qu'en mémoire : redémarré, il voit A « Disponible », et le client lui redit son choix à l'init
  // (apps/client/src/net/office-connection.ts). Les groupes attendent GROUP_DEBOUNCE_MS avant de prendre quelqu'un : le statut redit
  // arrive avant, et A, en Ne pas déranger, ne rejoint jamais la conversation de B.
  test('redémarrage du serveur : A en Ne pas déranger le redit à son init, et n\'est pas pris dans un groupe', async () => {
    const { srv } = await startMediaServer();
    const a = await enterRecorded(srv, 'a@x.fr');
    a.socket.emit('status:set', 'dnd');
    await vi.waitFor(() => expect(srv.realtime.world.get(a.id)?.status).toBe('dnd'));
    await teleport(srv, a, SIDE_A);
    const b = await enterRecorded(srv, 'b@x.fr');
    await teleport(srv, b, SIDE_B);
    // Ce que fait le client : le statut choisi, redit à chaque init qui en dit un autre.
    a.socket.on('init', (p) => {
      if (p.self.status !== 'dnd') a.socket.emit('status:set', 'dnd');
    });
    const aEvents = record(a.socket);
    const bEvents = record(b.socket);

    const reinits = Promise.all([nextInit(a.socket), nextInit(b.socket)]);
    await srv.restart();
    const [aInit] = await reinits;
    expect(aInit.self.status).toBe('available');   // le monde neuf l'a oublié
    await vi.waitFor(() => expect(srv.realtime.world.get(a.id)?.status).toBe('dnd'));
    // Côte à côte et arrêtés : sans le statut redit, la conversation se serait reformée en 500 ms et deux tours de calcul.
    await sleep(GROUP_DEBOUNCE_MS + 4 * GROUPS_TICK_MS);
    expect(aEvents.names().filter(isMedia)).not.toContain('media:join');
    expect(bEvents.names().filter(isMedia)).not.toContain('media:join');
    expect(srv.realtime.coordinator.groupMembersOf(a.id)).toEqual([]);
  });

  test('une conversation dans la salle de réunion : qui y avait sa dernière position réapparaît au point d\'apparition', async () => {
    const { srv } = await startMediaServer();
    const cookieC = await srv.inviteAndLogin('c@x.fr');
    const { id: cId } = (await findUserByEmail(srv.db, 'c@x.fr'))!;
    await savePositions(srv.db, [{ id: cId, x: 336, y: 80, dir: 'left' }]);   // C était parti de la salle de réunion

    // A entre dans la salle avant l'arrivée de B à l'apparition : ils ne sont ensemble que dans la salle, en groupe de zone.
    const a = await enterRecorded(srv, 'a@x.fr');
    await teleport(srv, a, IN_ROOM_A);
    const b = await enterRecorded(srv, 'b@x.fr');
    await teleport(srv, b, IN_ROOM_B);
    await vi.waitFor(() => expect(srv.realtime.coordinator.groupMembersOf(a.id)).toEqual([a.id, b.id].sort()), { timeout: 2000 });

    const c = srv.connect(cookieC);
    expect((await nextInit(c)).self).toMatchObject({ ...SPAWN, dir: 'down' });   // busyZones vient des groupes du dernier calcul
  });
});

describe('configuration de LiveKit', () => {
  test('LiveKit non configuré : un avertissement au démarrage ; les groupes sont calculés, mais aucun événement média', async () => {
    const { logger, lines } = captureLogs();
    const srv = await startTestServer({ env: { E2E: '1' }, logger });
    const warnings = lines.filter((line) => line.level === 40 && String(line.msg).includes('LiveKit'));
    expect(warnings).toEqual([expect.objectContaining({ missing: ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] })]);

    const a = await enterRecorded(srv, 'a@x.fr');
    await teleport(srv, a, FAR);
    const b = await enterRecorded(srv, 'b@x.fr');
    a.socket.emit('debug:teleport', SIDE_A);
    b.socket.emit('debug:teleport', SIDE_B);
    await vi.waitFor(() => expect(srv.realtime.coordinator.groupMembersOf(a.id)).toEqual([a.id, b.id].sort()), { timeout: 2000 });
    await sleep(GROUPS_TICK_MS * 2);

    expect([...a.events.names(), ...b.events.names()].filter(isMedia)).toEqual([]);
  });

  test('avec un backend, pas d\'avertissement', async () => {
    const { logger, lines } = captureLogs();
    await startMediaServer({ logger });
    expect(lines.filter((line) => String(line.msg).includes('LiveKit'))).toEqual([]);
  });

  test('LIVEKIT_URL inutilisable : le temps réel refuse de démarrer, avec un message qui la nomme', async () => {
    await expect(startTestServer({ env: { ...LIVEKIT, LIVEKIT_URL: 'bureau-test.livekit.test' } })).rejects.toThrow(/LIVEKIT_URL invalide/);
  });
});

describe('envoi des événements média aux sockets', () => {
  // L'envoi que la boucle des groupes passe au coordinateur (apply), pour lui faire envoyer ce qu'on veut.
  async function sendOf(srv: TestServer): Promise<(userId: string, e: MediaEvent) => void> {
    const apply = vi.spyOn(srv.realtime.coordinator, 'apply');
    await vi.waitFor(() => expect(apply).toHaveBeenCalled());
    return apply.mock.calls[0]![2];
  }
  const join = (room: string): MediaEvent => ({ type: 'join', p: { url: LIVEKIT.LIVEKIT_URL, room, token: 'jeton' } });

  test('une socket qui attend son init ne reçoit aucun événement média : init d\'abord, puis son état', async () => {
    const { srv } = await startMediaServer();
    const send = await sendOf(srv);
    const cookieA = await srv.inviteAndLogin('a@x.fr');
    const { id: aId } = (await findUserByEmail(srv.db, 'a@x.fr'))!;

    // L'arrivée de A lit la base : lente, elle laisse A connecté (sa socket est enregistrée) mais sans init.
    const slow = slowDatabase(srv);
    srv.realtime.io.once('connection', () => slow.hold());
    const a = srv.connect(cookieA);
    const events = record(a);
    await vi.waitFor(() => expect(srv.realtime.socketsOf(aId)).toHaveLength(1));
    send(aId, join('boot01-g1'));
    send(aId, { type: 'leave' });
    await sleep(50);
    expect(events.names()).toEqual([]);

    const init = nextInit(a);
    slow.release();
    await init;
    await vi.waitFor(() => expect(events.names()).toEqual(['init', 'media:leave']));   // hors groupe : media:leave, après init
  });

  test('une même consigne n\'est pas envoyée deux fois de suite à une socket', async () => {
    const { srv } = await startMediaServer();
    const send = await sendOf(srv);
    const a = await enterRecorded(srv, 'a@x.fr');
    await vi.waitFor(() => expect(a.events.names()).toEqual(['init', 'media:leave']));

    send(a.id, { type: 'leave' });   // déjà dit
    send(a.id, join('boot01-g1'));
    send(a.id, join('boot01-g1'));   // le retour d'une socket et un changement de groupe peuvent se croiser
    send(a.id, join('boot01-g2'));
    send(a.id, { type: 'leave' });
    send(a.id, { type: 'leave' });
    await vi.waitFor(() => expect(a.events.names().filter(isMedia)).toHaveLength(4));
    await sleep(50);
    expect(a.events.names().filter(isMedia)).toEqual(['media:leave', 'media:join', 'media:join', 'media:leave']);
    expect(a.events.payloadsOf('media:join').map((p) => (p as MediaJoinPayload).room)).toEqual(['boot01-g1', 'boot01-g2']);
  });
});

describe('boucle des groupes', () => {
  // Un monde où A et B sont côte à côte et arrêtés, sur une horloge qu'on avance à la main ; un coordinateur sans LiveKit.
  function setup() {
    const clock = { t: 10_000 };
    const world = new World(map, () => clock.t);
    world.join({ id: 'a', name: 'A', avatarKey: null, ...SIDE_A, dir: 'down', status: 'available' });
    world.join({ id: 'b', name: 'B', avatarKey: null, ...SIDE_B, dir: 'down', status: 'available' });
    const coordinator = new MediaCoordinator(null, 'boot01');
    const apply = vi.spyOn(coordinator, 'apply');
    const { logger, lines } = captureLogs();
    const send = vi.fn();
    const nameOf = (id: string) => id;
    const start = (groupsMs = 250) => {
      const loop = startGroupTicks({ world, map, coordinator, send, nameOf, groupsMs, grouping: CLOSE_RANGE_GROUPING, now: () => clock.t, logger });
      onTestFinished(loop.stop);
      return loop;
    };
    return { clock, world, coordinator, apply, lines, send, nameOf, start };
  }

  function fakeTimers() {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
  }

  test('toutes les groupsMs : computeGroups à l\'heure de l\'horloge du monde, puis apply(état précédent, nouvel état)', async () => {
    fakeTimers();
    const { clock, apply, send, nameOf, start } = setup();
    const loop = start();

    await vi.advanceTimersByTimeAsync(249);
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(apply).toHaveBeenCalledTimes(1);
    const [prev1, next1, send1, nameOf1] = apply.mock.calls[0]!;
    expect(prev1).toBe(EMPTY_GROUPING);
    expect(send1).toBe(send);
    expect(nameOf1).toBe(nameOf);
    // Le délai de 500 ms part de l'heure de l'horloge injectée, pas de Date.now.
    expect(next1.pending).toEqual({ a: { target: 'g1', since: 10_000 }, b: { target: 'g1', since: 10_000 } });
    expect(loop.state()).toBe(next1);

    clock.t = 10_500;
    await vi.advanceTimersByTimeAsync(250);
    const [prev2, next2] = apply.mock.calls[1]!;
    expect(prev2).toBe(next1);   // chaque calcul part de l'état du précédent
    expect(next2.assignment).toEqual({ a: 'g1', b: 'g1' });
    expect(loop.state()).toBe(next2);
  });

  test('un calcul ne commence pas tant que le précédent n\'a pas fini d\'envoyer ses rooms', async () => {
    fakeTimers();
    const { apply, start } = setup();
    let finish!: () => void;
    apply.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    start();

    await vi.advanceTimersByTimeAsync(250 * 4);
    expect(apply).toHaveBeenCalledTimes(1);   // les trois tours suivants sont sautés
    finish();
    await vi.advanceTimersByTimeAsync(250);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[1]![0]).toBe(apply.mock.calls[0]![1]);
  });

  test('une exception est journalisée et la boucle continue ; un apply qui échoue n\'empêche pas l\'état d\'avancer', async () => {
    fakeTimers();
    const { world, apply, lines, start } = setup();
    vi.spyOn(world, 'proximityPlayers').mockImplementationOnce(() => {
      throw new Error('monde illisible');
    });
    apply.mockRejectedValueOnce(new Error('envoi impossible'));
    const loop = start();

    await vi.advanceTimersByTimeAsync(250);   // computeGroups ne peut pas lire le monde
    expect(apply).not.toHaveBeenCalled();
    expect(lines.filter((line) => line.level === 50)).toEqual([
      expect.objectContaining({ msg: 'Calcul des groupes impossible', err: expect.objectContaining({ message: 'monde illisible' }) }),
    ]);

    await vi.advanceTimersByTimeAsync(250);   // apply rejette
    expect(apply).toHaveBeenCalledTimes(1);
    expect(loop.state()).toBe(apply.mock.calls[0]![1]);   // le coordinateur a déjà cet état : la boucle le garde aussi
    expect(lines.filter((line) => line.level === 50)).toHaveLength(2);
    expect(lines.at(-1)).toMatchObject({ err: expect.objectContaining({ message: 'envoi impossible' }) });

    await vi.advanceTimersByTimeAsync(250);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[1]![0]).toBe(apply.mock.calls[0]![1]);
  });

  test('le minuteur ne retient pas le processus', () => {
    // Un minuteur « unref » n'est pas compté parmi les ressources actives de Node.
    const timeouts = () => process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
    const { start } = setup();
    const before = timeouts();
    start();
    expect(timeouts()).toBe(before);
  });

  test('la boucle du serveur tourne à groupsMs ; stop() l\'arrête avant d\'enregistrer les positions', async () => {
    const srv = await startTestServer({ groupsMs: 20 });
    await enterRecorded(srv, 'a@x.fr');   // une position à enregistrer
    const computed = vi.spyOn(srv.realtime.world, 'proximityPlayers');
    await sleep(300);
    expect(computed.mock.calls.length).toBeGreaterThanOrEqual(6);   // une quinzaine à 20 ms, une seule aux 250 ms par défaut

    // L'écriture des positions de stop() attend : la boucle est déjà arrêtée.
    const slow = slowDatabase(srv);
    slow.hold();
    const stopping = srv.realtime.stop();
    const calls = computed.mock.calls.length;
    await sleep(150);
    expect(computed).toHaveBeenCalledTimes(calls);
    slow.release();
    await stopping;
  });
});
