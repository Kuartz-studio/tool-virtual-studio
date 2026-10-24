import type { ChatMessage, GameInvite, GameNotice, GameTableView, InitPayload, PublicPlayer } from '@bureau/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import { getSimRoom, resetSimRoom, subscribeSimConnectionLost } from '../sim/sim-room';
import { createOfficeStore } from '../state/office-store';
import { FakeBus, FakeSocket } from '../test/fake-socket';
import { connectOffice, retryDelay, superviseConnection } from './office-connection';

// Le réglage de la pièce d'un bureau qui n'a rien de particulier.
const DEFAULT_ROOM = { floor: 'parquet-clair', wall: 'creme', items: [] };

const player = (id: string, over: Partial<PublicPlayer> = {}): PublicPlayer => ({
  id,
  name: id.toUpperCase(),
  avatarKey: null,
  x: 80,
  y: 240,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
  ...over,
});
const SELF = player('moi');
const A = player('a');
const init = (players: PublicPlayer[] = [A]): InitPayload => ({ self: SELF, players, mapKey: 'dev-office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] });
const move = { x: 81, y: 240, dir: 'right', moving: true } as const;

let socket: FakeSocket;
let bus: FakeBus;
let store: ReturnType<typeof createOfficeStore>;
beforeEach(() => {
  socket = new FakeSocket();
  bus = new FakeBus();
  store = createOfficeStore();
});

describe('connectOffice', () => {
  test('connexion coupée : le faux live en est prévenu (ses sons s\'arrêtent), et plus après l\'arrêt de la connexion au jeu', () => {
    const lost = vi.fn();
    const off = subscribeSimConnectionLost(lost);
    const disconnect = connectOffice(socket.asSocket(), store, bus);
    socket.serverAccepts();
    socket.receive('init', init([A]));
    socket.connectionDrops();
    expect(lost).toHaveBeenCalledTimes(1);
    disconnect();
    off();
  });

  test('sim:room (le faux live) : retenu pour le faux transport, rien d\'autre ne bouge', () => {
    connectOffice(socket.asSocket(), store, bus);
    resetSimRoom();
    const payload = { room: 'r-g1', members: [{ id: 'a', name: 'A', audio: '/api/sim/audio/voix.mp3' }] };
    socket.receive('sim:room', payload);
    expect(getSimRoom()).toEqual(payload);
    expect(bus.emitted).toEqual([]);
  });

  test('init : tout l\'état va au magasin, puis au jeu (net:init), qui y lit déjà le nouvel état', () => {
    connectOffice(socket.asSocket(), store, bus);
    let seenByGame: string[] = [];
    bus.on('net:init', () => {
      seenByGame = Object.keys(store.getState().players);
    });
    socket.serverAccepts();
    socket.receive('init', init([A]));
    expect(store.getState().selfId).toBe('moi');
    expect(bus.emittedOf('net:init')).toEqual([init([A])]);
    expect(seenByGame).toEqual(['a']);
  });

  test('world:tick : au jeu (net:tick), et aux dernières positions du magasin, sans toucher à son état réactif', () => {
    connectOffice(socket.asSocket(), store, bus);
    socket.receive('init', init([A]));
    let seenByGame: unknown = null;
    bus.on('net:tick', () => {
      seenByGame = store.getState().positions.get('a');
    });
    const tick = { t: 1234, moves: [{ id: 'a', x: 120, y: 240, dir: 'right' as const, moving: true }] };
    socket.receive('world:tick', tick);
    expect(bus.emittedOf('net:tick')).toEqual([tick]);
    // Un jeu qui démarre après ce tick (il chargeait encore) y lit la position : elle n'est pas perdue.
    expect(store.getState().positions.get('a')).toEqual({ x: 120, y: 240, dir: 'right', moving: true });
    expect(seenByGame).toEqual({ x: 120, y: 240, dir: 'right', moving: true });
    // L'état réactif (players) ne suit pas les positions : React ne se redessine pas 10 fois par seconde.
    expect(store.getState().players.a!.x).toBe(80);
  });

  test('arrivées, départs, statuts, profils et médias : au magasin, et au jeu sauf les médias', () => {
    connectOffice(socket.asSocket(), store, bus);
    socket.receive('init', init([A]));
    const B = player('b');
    socket.receive('player:joined', B);
    socket.receive('status:changed', { id: 'b', status: 'dnd' });
    socket.receive('profile:changed', { id: 'b', name: 'Bea', avatarKey: 'dev-blue', timezone: 'Asia/Tokyo' });
    socket.receive('media:changed', { id: 'b', media: { mic: true, cam: false, screen: false } });
    expect(store.getState().players.b).toMatchObject({ status: 'dnd', name: 'Bea', avatarKey: 'dev-blue', timezone: 'Asia/Tokyo', media: { mic: true } });
    socket.receive('player:left', { id: 'a' });
    expect(Object.keys(store.getState().players)).toEqual(['b']);

    expect(bus.emittedOf('net:joined')).toEqual([B]);
    expect(bus.emittedOf('net:status')).toEqual([{ id: 'b', status: 'dnd' }]);
    expect(bus.emittedOf('net:profile')).toEqual([{ id: 'b', name: 'Bea', avatarKey: 'dev-blue', timezone: 'Asia/Tokyo' }]);
    expect(bus.emittedOf('net:left')).toEqual([{ id: 'a' }]);
  });

  test('speaking:changed : au magasin, puis au jeu (net:speaking) ; l\'init dit déjà qui parle', () => {
    connectOffice(socket.asSocket(), store, bus);
    socket.receive('init', init([player('a', { speaking: true }), player('c')]));
    expect(store.getState().players.a?.speaking).toBe(true);
    expect(store.getState().players.c).not.toHaveProperty('speaking');

    socket.receive('speaking:changed', { id: 'c', speaking: true });
    expect(store.getState().players.c?.speaking).toBe(true);
    socket.receive('speaking:changed', { id: 'a', speaking: false });
    expect(store.getState().players.a).not.toHaveProperty('speaking');
    // Quelqu'un que le magasin ne connaît pas : il ne change rien, mais le jeu en est prévenu (il le dessine peut-être déjà).
    socket.receive('speaking:changed', { id: 'inconnu', speaking: true });
    expect(Object.keys(store.getState().players)).toEqual(['a', 'c']);

    expect(bus.emittedOf('net:speaking')).toEqual([
      { id: 'c', speaking: true },
      { id: 'a', speaking: false },
      { id: 'inconnu', speaking: true },
    ]);
  });

  test('move:correct : au jeu (net:correct), qui recale l\'avatar local', () => {
    connectOffice(socket.asSocket(), store, bus);
    socket.receive('move:correct', { x: 80, y: 240 });
    expect(bus.emittedOf('net:correct')).toEqual([{ x: 80, y: 240 }]);
    // Un voyage voulu (un mode) porte sa raison : le jeu en fait un anneau de lumière, le son un bruit de saut.
    socket.receive('move:correct', { x: 300, y: 400, reason: 'teleport' });
    expect(bus.emittedOf('net:correct').at(-1)).toEqual({ x: 300, y: 400, reason: 'teleport' });
  });

  test('session:replaced : le magasin le sait (un autre onglet a pris la place)', () => {
    connectOffice(socket.asSocket(), store, bus);
    socket.receive('session:replaced');
    expect(store.getState().replaced).toBe(true);
  });

  // L'audio et la vidéo (useMedia) rejouent la dernière consigne en se branchant, par sûreté : la connexion la retient, le serveur ne la
  // redira pas.
  test('media:join et media:leave : la dernière consigne est retenue au magasin', () => {
    connectOffice(socket.asSocket(), store, bus);
    socket.serverAccepts();
    socket.receive('init', init());
    expect(store.getState().mediaInstruction).toBeNull();
    const p = { url: 'wss://livekit.test', room: 'r1', token: 'jeton' };
    socket.receive('media:join', p);
    expect(store.getState().mediaInstruction).toEqual({ type: 'join', p });
    socket.receive('media:leave');
    expect(store.getState().mediaInstruction).toEqual({ type: 'leave' });
    // Une sortie qui garde la connexion parquée le dit aussi.
    socket.receive('media:leave', { park: true });
    expect(store.getState().mediaInstruction).toEqual({ type: 'leave', park: true });
    // Ce n'est pas pour le jeu.
    expect(bus.emitted.map(([event]) => event)).toEqual(['net:init']);
  });

  test('conversation:lock : sa conversation verrouillée au magasin, puis au bus (toast et son) ; l\'init dit celle du moment', () => {
    connectOffice(socket.asSocket(), store, bus);
    socket.serverAccepts();
    socket.receive('init', init());
    expect(store.getState().conversationLock).toBeNull();
    const lock = { id: 'g1', members: ['bob', 'moi'], by: { id: 'bob', name: 'Bob' }, at: 1 };
    const notice = { lock, cause: 'locked' as const, by: { id: 'bob', name: 'Bob' } };
    socket.receive('conversation:lock', notice);
    expect(store.getState().conversationLock).toEqual(lock);
    expect(bus.emitted.at(-1)).toEqual(['conversation:lock', notice]);
    socket.receive('conversation:lock', { lock: null, cause: 'unlocked', by: { id: 'bob', name: 'Bob' } });
    expect(store.getState().conversationLock).toBeNull();
    socket.receive('init', { ...init(), conversationLock: lock });
    expect(store.getState().conversationLock).toEqual(lock);
    socket.receive('init', init());
    expect(store.getState().conversationLock).toBeNull();
  });

  // Une consigne ne vaut que pour la connexion qui l'a reçue : pendant une coupure, le serveur peut sortir la personne de son groupe
  // (au-delà du délai de grace) sans qu'elle l'apprenne, et la room retenue ne serait plus la sienne. À la connexion suivante, le
  // serveur redit la consigne du moment, après son init.
  test('la connexion coupée : la consigne retenue est oubliée ; la suivante redit la sienne', () => {
    connectOffice(socket.asSocket(), store, bus);
    socket.serverAccepts();
    socket.receive('init', init());
    socket.receive('media:join', { url: 'wss://livekit.test', room: 'r1', token: 'jeton' });
    socket.connectionDrops();
    expect(store.getState().mediaInstruction).toBeNull();
    socket.serverAccepts();
    socket.receive('init', init());
    expect(store.getState().mediaInstruction).toBeNull();
    socket.receive('media:leave');
    expect(store.getState().mediaInstruction).toEqual({ type: 'leave' });
  });

  // Un autre onglet a pris la place : le serveur ne dira plus rien à celui-ci, et la room retenue est maintenant celle de l'autre (un
  // client qui la rejoindrait avec la même identité l'en chasserait).
  test('session:replaced : la consigne retenue n\'a plus cours (leave)', () => {
    connectOffice(socket.asSocket(), store, bus);
    socket.serverAccepts();
    socket.receive('init', init());
    socket.receive('media:join', { url: 'wss://livekit.test', room: 'r1', token: 'jeton' });
    socket.receive('session:replaced');
    expect(store.getState().mediaInstruction).toEqual({ type: 'leave' });
  });

  test('ready : vrai une fois l\'init de la connexion reçu, faux dès qu\'elle est coupée (le magasin le dit à l\'interface)', () => {
    connectOffice(socket.asSocket(), store, bus);
    socket.connect();
    socket.serverAccepts();
    expect(store.getState().ready).toBe(false);
    socket.receive('init', init());
    expect(store.getState().ready).toBe(true);
    socket.connectionDrops();
    expect(store.getState().ready).toBe(false);
    // Reconnectée, mais pas encore placée par le serveur : toujours pas prête.
    socket.serverAccepts();
    expect(store.getState().ready).toBe(false);
    socket.receive('init', init());
    expect(store.getState().ready).toBe(true);
  });

  test('local:move part au serveur une fois l\'init de la connexion reçu ; après une coupure, plus rien jusqu\'au prochain init', () => {
    connectOffice(socket.asSocket(), store, bus);
    socket.connect();
    bus.emit('local:move', move);
    socket.serverAccepts();
    // Connecté, mais le serveur ne nous a pas encore placés : un mouvement ne voudrait rien dire pour lui.
    bus.emit('local:move', move);
    expect(socket.sentOf('move')).toEqual([]);

    socket.receive('init', init());
    bus.emit('local:move', move);
    expect(socket.sentOf('move')).toEqual([move]);

    // Pendant une coupure, Socket.io garderait les messages pour les envoyer au retour, tous d'un coup et périmés : on n'envoie rien.
    socket.connectionDrops();
    bus.emit('local:move', { ...move, x: 90 });
    socket.serverAccepts();
    bus.emit('local:move', { ...move, x: 91 });
    expect(socket.sentOf('move')).toEqual([move]);
    socket.receive('init', init());
    bus.emit('local:move', { ...move, x: 92 });
    expect(socket.sentOf('move')).toEqual([move, { ...move, x: 92 }]);
  });

  test('local:teleport part au serveur (debug:teleport), aux mêmes conditions', () => {
    connectOffice(socket.asSocket(), store, bus);
    bus.emit('local:teleport', { x: 300, y: 400 });
    socket.serverAccepts();
    socket.receive('init', init());
    bus.emit('local:teleport', { x: 300, y: 400 });
    expect(socket.sentOf('debug:teleport')).toEqual([{ x: 300, y: 400 }]);
  });

  describe('la lumière', () => {
    const OFF = { level: 'off' as const, by: { id: 'a', name: 'A' }, at: 1_700_000_000_000 };

    test('init : l\'état de la lumière va au magasin ; sans lumière dans l\'init, elle est allumée', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', { ...init(), lights: OFF });
      expect(store.getState().lights).toEqual(OFF);
      socket.receive('init', init());
      expect(store.getState().lights).toEqual({ level: 'on' as const, by: null, at: 0 });
    });

    test('lights:changed : au magasin, puis au jeu et au son (lights:changed sur le bus), qui y lisent déjà le nouvel état', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', init());
      let seenByGame: string | null = null;
      bus.on('lights:changed', () => {
        seenByGame = store.getState().lights.level;
      });
      socket.receive('lights:changed', OFF);
      expect(store.getState().lights).toEqual(OFF);
      expect(bus.emittedOf('lights:changed')).toEqual([OFF]);
      expect(seenByGame).toBe('off');
      // Rallumée : de même.
      const lit = { level: 'on' as const, by: { id: 'moi', name: 'MOI' }, at: OFF.at + 5000 };
      socket.receive('lights:changed', lit);
      expect(store.getState().lights).toEqual(lit);
      expect(bus.emittedOf('lights:changed')).toEqual([OFF, lit]);
    });

    test('local:lights part au serveur (lights:set) une fois l\'init reçu ; avant, et pendant une coupure, rien', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.connect();
      bus.emit('local:lights', { level: 'off' });
      socket.serverAccepts();
      bus.emit('local:lights', { level: 'off' });
      expect(socket.sentOf('lights:set')).toEqual([]);

      socket.receive('init', init());
      bus.emit('local:lights', { level: 'off' });
      expect(socket.sentOf('lights:set')).toEqual([{ level: 'off' }]);
      bus.emit('local:lights', { level: 'on' });
      expect(socket.sentOf('lights:set')).toEqual([{ level: 'off' }, { level: 'on' }]);

      // Pendant une coupure, Socket.io garderait le message pour le rendre au retour, périmé.
      socket.connectionDrops();
      bus.emit('local:lights', { level: 'off' });
      socket.serverAccepts();
      bus.emit('local:lights', { level: 'off' });
      expect(socket.sentOf('lights:set')).toEqual([{ level: 'off' }, { level: 'on' }]);
    });

    test('local:lights n\'est qu\'une demande : le magasin ne change qu\'à la réponse du serveur (lights:changed)', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', init());
      bus.emit('local:lights', { level: 'off' });
      expect(store.getState().lights.level).toBe('on');
      socket.receive('lights:changed', OFF);
      expect(store.getState().lights.level).toBe('off');
    });
  });

  describe('la musique des pièces', () => {
    const OFF = { on: false, scene: null, by: { id: 'a', name: 'A' }, at: 1_700_000_000_000 } as const;

    test('init : la musique des pièces réglées va au magasin ; sans musique dans l\'init, aucune pièce n\'a d\'état', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', { ...init(), music: { game: OFF } });
      expect(store.getState().music).toEqual({ game: OFF });
      socket.receive('init', init());
      expect(store.getState().music).toEqual({});
    });

    test('music:changed : au magasin, pièce par pièce', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', init());
      socket.receive('music:changed', { place: 'game', state: OFF });
      expect(store.getState().music).toEqual({ game: OFF });
      const quest = { on: true, scene: 'quest', by: { id: 'moi', name: 'MOI' }, at: OFF.at + 5000 } as const;
      socket.receive('music:changed', { place: 'gym', state: quest });
      expect(store.getState().music).toEqual({ game: OFF, gym: quest });
    });

    test('local:music part au serveur (music:set) une fois l\'init reçu ; avant, et pendant une coupure, rien', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.connect();
      bus.emit('local:music', { place: 'game', on: false });
      socket.serverAccepts();
      bus.emit('local:music', { place: 'game', on: false });
      expect(socket.sentOf('music:set')).toEqual([]);

      socket.receive('init', init());
      bus.emit('local:music', { place: 'game', on: false });
      bus.emit('local:music', { place: 'game', scene: 'dusk' });
      expect(socket.sentOf('music:set')).toEqual([{ place: 'game', on: false }, { place: 'game', scene: 'dusk' }]);

      // Pendant une coupure, Socket.io garderait le message pour le rendre au retour, périmé.
      socket.connectionDrops();
      bus.emit('local:music', { place: 'game', on: true });
      socket.serverAccepts();
      bus.emit('local:music', { place: 'game', on: true });
      expect(socket.sentOf('music:set')).toHaveLength(2);
    });

    test('local:music n\'est qu\'une demande : le magasin ne change qu\'à la réponse du serveur (music:changed)', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', init());
      bus.emit('local:music', { place: 'game', on: false });
      expect(store.getState().music).toEqual({});
      socket.receive('music:changed', { place: 'game', state: OFF });
      expect(store.getState().music).toEqual({ game: OFF });
    });
  });

  describe('le café', () => {
    beforeEach(() => {
      vi.spyOn(performance, 'now').mockReturnValue(10_000);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    test('init : le café en cours de chacun (boost) devient une échéance au magasin', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', { ...init([player('a', { boost: 20_000 })]), self: player('moi', { boost: 8_000 }) });
      expect(store.getState().coffee).toEqual({ moi: 18_000, a: 30_000 });
    });

    test('coffee:changed : au magasin, puis au jeu, au son et à la pastille (coffee:changed sur le bus), qui y lisent déjà la nouvelle échéance', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', init([A]));
      let seenByGame: number | undefined;
      bus.on('coffee:changed', () => {
        seenByGame = store.getState().coffee.a;
      });
      socket.receive('coffee:changed', { id: 'a', ms: 30_000 });
      expect(store.getState().coffee).toEqual({ a: 40_000 });
      expect(bus.emittedOf('coffee:changed')).toEqual([{ id: 'a', ms: 30_000 }]);
      expect(seenByGame).toBe(40_000);
      // Fini (ms: 0) : l'échéance disparaît, et le bus le dit aussi.
      socket.receive('coffee:changed', { id: 'a', ms: 0 });
      expect(store.getState().coffee).toEqual({});
      expect(bus.emittedOf('coffee:changed')).toEqual([{ id: 'a', ms: 30_000 }, { id: 'a', ms: 0 }]);
    });

    test('local:coffee part au serveur (coffee:take) une fois l\'init reçu ; avant, et pendant une coupure, rien', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.connect();
      bus.emit('local:coffee');
      socket.serverAccepts();
      bus.emit('local:coffee');
      expect(socket.sentOf('coffee:take')).toEqual([]);

      socket.receive('init', init());
      bus.emit('local:coffee');
      expect(socket.sentOf('coffee:take')).toEqual([undefined]);

      // Pendant une coupure, Socket.io garderait le message pour le rendre au retour, périmé.
      socket.connectionDrops();
      bus.emit('local:coffee');
      socket.serverAccepts();
      bus.emit('local:coffee');
      expect(socket.sentOf('coffee:take')).toEqual([undefined]);
    });

    test('local:coffee n\'est qu\'une demande : le magasin ne change qu\'à la réponse du serveur (coffee:changed)', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', init());
      bus.emit('local:coffee');
      expect(store.getState().coffee).toEqual({});
      socket.receive('coffee:changed', { id: 'moi', ms: 30_000 });
      expect(store.getState().coffee).toEqual({ moi: 40_000 });
    });
  });

  describe('les invitations dans un bureau', () => {
    const invite = { id: 'd1', key: 'A1', from: { id: 'a', name: 'A', avatarKey: null }, ttlMs: 60_000 };

    test('init, desk:invite : au magasin ; desk:invite:gone la retire ; desk:notice va au bus', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', { ...init(), deskInvites: [invite] });
      expect(store.getState().deskInvites).toEqual([{ ...invite, until: expect.any(Number) }]);
      socket.receive('desk:invite:gone', { id: 'd1' });
      expect(store.getState().deskInvites).toEqual([]);
      socket.receive('desk:invite', invite);
      expect(store.getState().deskInvites).toEqual([{ ...invite, until: expect.any(Number) }]);
      socket.receive('init', init());
      expect(store.getState().deskInvites).toEqual([]);
      const notice = { kind: 'declined' as const, user: { id: 'b', name: 'B' } };
      socket.receive('desk:notice', notice);
      expect(bus.emittedOf('desk:notice')).toEqual([notice]);
    });
  });

  describe('les jeux', () => {
    const view = (version: number, over: Partial<GameTableView> = {}): GameTableView => ({ game: 'connect4', version, chairs: [null, null], spectators: [], match: null, ...over });
    const invite: GameInvite = { id: 'i1', game: 'chess', from: { id: 'a', name: 'A', avatarKey: null }, ttlMs: 60_000 };

    test('init : les tables et les invitations en attente vont au magasin', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', { ...init(), games: [view(2)], gameInvites: [invite] });
      expect(store.getState().games.connect4?.version).toBe(2);
      expect(store.getState().gameInvites).toEqual([{ ...invite, until: expect.any(Number) }]);
      socket.receive('init', init());
      expect(store.getState().games).toEqual({});
      expect(store.getState().gameInvites).toEqual([]);
    });

    test('game:table : au magasin, par jeu ; une version plus ancienne ne remplace rien', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', init());
      socket.receive('game:table', view(1));
      socket.receive('game:table', view(2, { spectators: [{ id: 'a', name: 'A' }] }));
      socket.receive('game:table', view(1));
      expect(store.getState().games.connect4?.version).toBe(2);
      expect(store.getState().games.connect4?.spectators).toHaveLength(1);
    });

    test('game:invite : au magasin ; game:invite:gone la retire', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', init());
      socket.receive('game:invite', invite);
      expect(store.getState().gameInvites).toEqual([{ ...invite, until: expect.any(Number) }]);
      socket.receive('game:invite:gone', { id: 'i1', reason: 'expired' });
      expect(store.getState().gameInvites).toEqual([]);
    });

    test('local:debug-game part au serveur (debug:game) une fois l\'init reçu ; avant, rien', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.connect();
      bus.emit('local:debug-game', { game: 'connect4', state: {} });
      socket.serverAccepts();
      bus.emit('local:debug-game', { game: 'connect4', state: {} });
      expect(socket.sentOf('debug:game')).toEqual([]);
      socket.receive('init', init());
      bus.emit('local:debug-game', { game: 'connect4', state: { a: 1 }, rolls: [6, 1] });
      expect(socket.sentOf('debug:game')).toEqual([{ game: 'connect4', state: { a: 1 }, rolls: [6, 1] }]);
    });

    test('game:notice : sur le bus, pour les messages passagers ; le magasin n\'en garde rien', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', init());
      const notice: GameNotice = { kind: 'accepted', game: 'chess', user: { id: 'a', name: 'A' } };
      socket.receive('game:notice', notice);
      expect(bus.emittedOf('game:notice')).toEqual([notice]);
    });
  });

  describe('le chat', () => {
    const msg = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
      id,
      channel: 'all',
      userId: 'a',
      name: 'A',
      text: `texte ${id}`,
      sentAt: '2026-10-20T10:00:00.000Z',
      ...over,
    });
    const initWith = (chatHistory: ChatMessage[]): InitPayload => ({ ...init(), chatHistory });
    const ids = (list: ChatMessage[]) => list.map((m) => m.id);

    test('init : l\'historique « Tout le monde » va au magasin', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', initWith([msg('m1'), msg('m2')]));
      expect(ids(store.getState().chatAll)).toEqual(['m1', 'm2']);
    });

    test('activity:changed : au magasin (pour soi comme pour les autres), puis au jeu (net:activity) ; le choix de l\'onglet suit le sien', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.serverAccepts();
      socket.receive('init', init([A]));
      const state = { id: 's1', label: 'En focus', color: '#6d28d9', allowEntry: false, hear: true, heard: false };

      socket.receive('activity:changed', { id: 'a', activity: state });
      expect(store.getState().players.a?.activity).toEqual(state);
      expect(store.getState().chosenActivityId).toBeNull();   // celui d'un autre n'est pas le choix de cet onglet
      expect(bus.emittedOf('net:activity')).toEqual([{ id: 'a', activity: state }]);

      socket.receive('activity:changed', { id: 'moi', activity: state });
      expect(store.getState().self?.activity).toEqual(state);
      expect(store.getState().chosenActivityId).toBe('s1');
      socket.receive('activity:changed', { id: 'moi', activity: null });
      expect(store.getState().self?.activity).toBeNull();
      expect(store.getState().chosenActivityId).toBeNull();
    });

    test('init : l\'état d\'activité que le serveur a gardé devient le choix de l\'onglet ; pris ici et oublié par un serveur redémarré, il est redit', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.serverAccepts();
      const state = { id: 's1', label: 'En focus', color: '#6d28d9', allowEntry: false, hear: true, heard: false };
      socket.receive('init', { ...init([A]), self: { ...SELF, activity: state } });
      expect(store.getState().chosenActivityId).toBe('s1');
      expect(socket.sentOf('state:set')).toEqual([]);

      // Le serveur redémarre et a tout oublié : l'onglet redit son état.
      socket.receive('init', init([A]));
      expect(socket.sentOf('state:set')).toEqual(['s1']);
      expect(socket.sentOf('status:set')).toEqual([]);
    });

    test('un état d\'activité pris : il passe avant le statut choisi, qui n\'est pas redit', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.serverAccepts();
      store.getState().setChosenStatus('busy');
      store.getState().setChosenActivity('s9');
      socket.receive('init', init([A]));
      expect(socket.sentOf('state:set')).toEqual(['s9']);
      expect(socket.sentOf('status:set')).toEqual([]);
    });

    test('session:replaced : le choix d\'état de cet onglet est oublié aussi', () => {
      connectOffice(socket.asSocket(), store, bus);
      store.getState().setChosenActivity('s1');
      socket.receive('session:replaced');
      expect(store.getState().chosenActivityId).toBeNull();
    });

    test('desk:changed, desk:access, desk:bans, desk:knock : au magasin, pas au jeu', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.serverAccepts();
      socket.receive('init', { ...init([A]), desks: [{ key: 'A1', ownerId: null, ownerName: null, name: null, locked: false, closedByState: false, ...DEFAULT_ROOM }] });
      bus.emitted.length = 0;
      socket.receive('desk:changed', { key: 'A1', ownerId: 'a', ownerName: 'A', name: 'Labo', locked: true, closedByState: false, ...DEFAULT_ROOM });
      socket.receive('desk:access', { closed: ['A1'] });
      socket.receive('desk:bans', [{ id: 'z', name: 'Zoé' }]);
      socket.receive('desk:knock', { key: 'A1', userId: 'z', name: 'Zoé' });
      expect(store.getState().desks[0]).toMatchObject({ key: 'A1', ownerId: 'a', name: 'Labo', locked: true });
      expect(store.getState().closedDesks).toEqual(['A1']);
      expect(store.getState().deskBans).toEqual([{ id: 'z', name: 'Zoé' }]);
      expect(store.getState().deskKnocks).toEqual([{ key: 'A1', userId: 'z', name: 'Zoé' }]);
      expect(bus.emitted).toEqual([]);
    });

    test('local:knock : part au serveur (knock), la réponse devient un message passager ; rien tant que la connexion n\'est pas prête', async () => {
      connectOffice(socket.asSocket(), store, bus);
      bus.emit('local:knock', { key: 'A1' });
      expect(socket.sentOf('desk:do')).toEqual([]);

      socket.serverAccepts();
      socket.receive('init', { ...init([A]), desks: [{ key: 'A1', ownerId: 'a', ownerName: 'Ana', name: null, locked: true, closedByState: false, ...DEFAULT_ROOM }] });
      bus.emit('local:knock', { key: 'A1' });
      expect(socket.sentOf('desk:do')).toEqual([{ type: 'knock', key: 'A1' }]);
      socket.serverAcks('desk:do', { ok: true });
      await Promise.resolve();
      expect(store.getState().deskNotice).toBe(t(fr.desk.knockSent, { name: 'Bureau de Ana' }));

      bus.emit('local:knock', { key: 'A1' });
      socket.serverAcks('desk:do', { ok: false, error: 'not_locked' });
      await Promise.resolve();
      expect(store.getState().deskNotice).toBe(fr.desk.errors.not_locked);
    });

    test('chat:message : au magasin, dans la liste de son canal ; pas au jeu', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', initWith([msg('m1')]));
      socket.receive('chat:message', msg('m2'));
      socket.receive('chat:message', msg('n1', { channel: 'nearby' }));
      expect(ids(store.getState().chatAll)).toEqual(['m1', 'm2']);
      expect(ids(store.getState().chatNearby)).toEqual(['n1']);
      expect(bus.emitted.map(([event]) => event)).toEqual(['net:init']);
    });

    test('un message reçu deux fois (une fois dans l\'init, une fois en direct) n\'est dans la liste qu\'une fois', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.receive('init', initWith([msg('m1')]));
      socket.receive('chat:message', msg('m1'));
      socket.receive('chat:message', msg('m2'));
      socket.receive('chat:message', msg('m2'));
      expect(ids(store.getState().chatAll)).toEqual(['m1', 'm2']);
    });

    test('après une coupure, l\'init du retour redonne « Tout le monde » ; « À proximité », que le serveur ne redit pas, reste', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.serverAccepts();
      socket.receive('init', initWith([msg('m1')]));
      socket.receive('chat:message', msg('n1', { channel: 'nearby' }));
      socket.connectionDrops();
      socket.serverAccepts();
      socket.receive('init', initWith([msg('m1'), msg('m2')]));
      expect(ids(store.getState().chatAll)).toEqual(['m1', 'm2']);
      expect(ids(store.getState().chatNearby)).toEqual(['n1']);
    });
  });

  // Le serveur ne garde les statuts qu'en mémoire : après un redémarrage (un déploiement), son init dit « Disponible ». Le statut choisi
  // dans le menu (chosenStatus, au magasin) lui est redit aussitôt, avant que les groupes (500 ms d'attente) ne prennent la personne.
  describe('le statut choisi', () => {
    const SELF_ID = SELF.id;

    test('un init qui ne dit pas le statut choisi (le serveur l\'a oublié) : status:set le lui redit, une fois', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.serverAccepts();
      socket.receive('init', init());
      // Choisi dans le menu, qui envoie lui-même status:set ; le serveur le confirme.
      store.getState().setChosenStatus('dnd');
      socket.receive('status:changed', { id: SELF_ID, status: 'dnd' });
      expect(socket.sentOf('status:set')).toEqual([]);

      socket.connectionDrops();
      socket.serverAccepts();
      socket.receive('init', init());   // self : available
      expect(socket.sentOf('status:set')).toEqual(['dnd']);
    });

    test('un init qui dit le statut choisi : rien à redire', () => {
      connectOffice(socket.asSocket(), store, bus);
      store.getState().setChosenStatus('dnd');
      socket.serverAccepts();
      socket.receive('init', { ...init(), self: { ...SELF, status: 'dnd' } });
      expect(socket.sentOf('status:set')).toEqual([]);
    });

    test('sans choix dans cet onglet, un init « Disponible » : rien, et le choix reste vide', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.serverAccepts();
      socket.receive('init', init());
      expect(store.getState().chosenStatus).toBeNull();
      socket.connectionDrops();
      socket.serverAccepts();
      socket.receive('init', init());
      expect(socket.sentOf('status:set')).toEqual([]);
    });

    // Après un rechargement de la page (ou « Utiliser ici »), cet onglet n'a rien choisi, mais le serveur, lui, a gardé le statut de la
    // personne. Ce statut est le choix : sans cela, le redémarrage suivant du serveur le ferait tomber.
    test('sans choix dans cet onglet (rechargement), un init qui dit « Ne pas déranger » : il devient le choix, sans rien renvoyer', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.serverAccepts();
      socket.receive('init', { ...init(), self: { ...SELF, status: 'dnd' } });
      expect(store.getState().chosenStatus).toBe('dnd');
      expect(socket.sentOf('status:set')).toEqual([]);

      socket.connectionDrops();
      socket.serverAccepts();
      socket.receive('init', init());   // le serveur redémarré : « Disponible »
      expect(socket.sentOf('status:set')).toEqual(['dnd']);
    });

    // Un autre onglet a pris la place : c'est lui qui parle pour la personne, et il a pu choisir un autre statut depuis. « Utiliser ici »
    // ne doit pas lui imposer un choix plus ancien.
    test('session:replaced : le choix de cet onglet est oublié ; le retour (« Utiliser ici ») suit le serveur', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.serverAccepts();
      socket.receive('init', init());
      store.getState().setChosenStatus('dnd');
      socket.receive('session:replaced');
      expect(store.getState().chosenStatus).toBeNull();
      socket.serverDisconnects();
      socket.serverAccepts();
      socket.receive('init', init());   // l'autre onglet a choisi « available »
      expect(socket.sentOf('status:set')).toEqual([]);
    });
  });

  describe('la progression', () => {
    const mission = { id: 'm1', kind: 'mission' as const, title: 'Refaire le logo', notes: null, tier: 5 as const, xp: 500, status: 'open' as const, createdAt: '2026-10-24T08:00:00.000Z', doneAt: null, owner: { id: 'moi', name: 'MOI' }, giver: { id: 'a', name: 'A' }, seen: false };

    test('progress:mine : au magasin sans le gain, et le gain au bus (progress:gain) ; un état sans gain ne dit rien au bus', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.serverAccepts();
      socket.receive('init', init());
      const gain = { amount: 500, source: 'mission' as const, label: 'Refaire le logo', levelBefore: 0, levelAfter: 0, kuartzons: 0 };
      socket.receive('progress:mine', { xp: 520, kuartzons: 0, streak: 1, todoXpLeft: 100, owned: [], gain });
      expect(store.getState().progress).toEqual({ xp: 520, kuartzons: 0, streak: 1, todoXpLeft: 100, owned: [] });
      expect(bus.emittedOf('progress:gain')).toEqual([gain]);
      socket.receive('progress:mine', { xp: 520, kuartzons: 0, streak: 1, todoXpLeft: 100, owned: ['statue'] });
      expect(store.getState().progress?.owned).toEqual(['statue']);
      expect(bus.emittedOf('progress:gain')).toHaveLength(1);
    });

    test('progress:level : le niveau au magasin, et au bus avec celui d\'avant', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.serverAccepts();
      socket.receive('init', init([player('a', { level: 3 })]));
      socket.receive('progress:level', { id: 'a', level: 4 });
      expect(store.getState().players.a?.level).toBe(4);
      expect(bus.emittedOf('net:level')).toEqual([{ id: 'a', level: 4, before: 3 }]);
    });

    test('task:assigned : dans sa liste, puis au bus ; task:changed : dans la liste qui la concerne', () => {
      connectOffice(socket.asSocket(), store, bus);
      socket.serverAccepts();
      socket.receive('init', init());
      // Sa liste a été lue (vide) : la mission s'y ajoute.
      store.getState().setTasks([]);
      socket.receive('task:assigned', mission);
      expect(store.getState().tasks).toEqual([mission]);
      expect(bus.emittedOf('task:assigned')).toEqual([mission]);
      socket.receive('task:changed', { ...mission, status: 'cancelled' });
      expect(store.getState().tasks?.[0]?.status).toBe('cancelled');
      // Une mission qu'on a confiée, faite : dans les missions confiées.
      const mine = { ...mission, id: 'm2', owner: { id: 'a', name: 'A' }, giver: { id: 'moi', name: 'MOI' }, status: 'done' as const };
      socket.receive('task:changed', mine);
      expect(store.getState().given).toEqual([mine]);
    });

    test('local:xp part au serveur (debug:xp) une fois la connexion prête', () => {
      connectOffice(socket.asSocket(), store, bus);
      bus.emit('local:xp', { xp: 1000 });
      expect(socket.sentOf('debug:xp')).toEqual([]);
      socket.serverAccepts();
      socket.receive('init', init());
      bus.emit('local:xp', { xp: 1000, kuartzons: 50 });
      expect(socket.sentOf('debug:xp')).toEqual([{ xp: 1000, kuartzons: 50 }]);
    });
  });

  test('la fonction rendue retire tous ses écouteurs, de la socket comme du bus : plus rien ne passe', () => {
    const disconnect = connectOffice(socket.asSocket(), store, bus);
    expect(socket.listenerCount()).toBeGreaterThan(0);
    expect(bus.listenerCount()).toBeGreaterThan(0);
    disconnect();
    expect(socket.listenerCount()).toBe(0);
    expect(bus.listenerCount()).toBe(0);
    socket.receive('init', init());
    expect(store.getState().selfId).toBeNull();
    expect(bus.emitted).toEqual([]);
  });
});

describe('superviseConnection', () => {
  const handlers = () => ({ signedOut: vi.fn(), forbidden: vi.fn() });

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('retryDelay : 1 s, 2 s, 4 s… au plus 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
  });

  test.each(['unauthorized', 'disabled'])('%s : retour à la connexion, sans nouvel essai', (refusal) => {
    const on = handlers();
    superviseConnection(socket.asSocket(), store, on);
    socket.connect();
    socket.serverRefuses(refusal);
    expect(on.signedOut).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(120_000);
    expect(socket.connectCalls).toBe(1);
    expect(on.forbidden).not.toHaveBeenCalled();
  });

  test('forbidden_origin : le message d\'erreur, sans nouvel essai', () => {
    const on = handlers();
    superviseConnection(socket.asSocket(), store, on);
    socket.connect();
    socket.serverRefuses('forbidden_origin');
    expect(on.forbidden).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(120_000);
    expect(socket.connectCalls).toBe(1);
    expect(on.signedOut).not.toHaveBeenCalled();
  });

  test.each(['unavailable', 'rate_limited', 'refus inconnu'])('%s : nouvel essai après 1 s, puis 2 s, 4 s…, remis à zéro par une connexion réussie', (refusal) => {
    const on = handlers();
    superviseConnection(socket.asSocket(), store, on);
    socket.connect();
    const attemptsAfter = (ms: number) => {
      vi.advanceTimersByTime(ms);
      return socket.connectCalls;
    };
    socket.serverRefuses(refusal);
    expect(attemptsAfter(999)).toBe(1);
    expect(attemptsAfter(1)).toBe(2);
    socket.serverRefuses(refusal);
    expect(attemptsAfter(1999)).toBe(2);
    expect(attemptsAfter(1)).toBe(3);
    socket.serverRefuses(refusal);
    expect(attemptsAfter(3999)).toBe(3);
    expect(attemptsAfter(1)).toBe(4);

    socket.serverAccepts();
    socket.serverDisconnects();
    socket.serverRefuses(refusal);
    // La connexion réussie a remis le compte à zéro : 1 s de nouveau (un seul essai prévu à la fois).
    expect(attemptsAfter(1000)).toBe(5);
    expect(on.signedOut).not.toHaveBeenCalled();
    expect(on.forbidden).not.toHaveBeenCalled();
  });

  test('les essais plafonnent à 30 s', () => {
    superviseConnection(socket.asSocket(), store, handlers());
    socket.connect();
    for (let i = 0; i < 8; i++) {
      socket.serverRefuses('unavailable');
      vi.advanceTimersByTime(retryDelay(i));
    }
    const before = socket.connectCalls;
    socket.serverRefuses('unavailable');
    vi.advanceTimersByTime(29_999);
    expect(socket.connectCalls).toBe(before);
    vi.advanceTimersByTime(1);
    expect(socket.connectCalls).toBe(before + 1);
  });

  test('une panne du réseau : rien à faire, Socket.io réessaie seul', () => {
    const on = handlers();
    superviseConnection(socket.asSocket(), store, on);
    socket.connect();
    socket.networkFails();
    socket.connectionDrops();
    vi.advanceTimersByTime(120_000);
    expect(socket.connectCalls).toBe(1);
    expect(on.signedOut).not.toHaveBeenCalled();
    expect(on.forbidden).not.toHaveBeenCalled();
  });

  test('session:replaced, puis le serveur ferme la connexion : jamais de reconnexion', () => {
    connectOffice(socket.asSocket(), store, bus);
    superviseConnection(socket.asSocket(), store, handlers());
    socket.connect();
    socket.serverAccepts();
    socket.receive('init', init());
    socket.receive('session:replaced');
    socket.serverDisconnects();
    vi.advanceTimersByTime(600_000);
    expect(socket.connectCalls).toBe(1);
  });

  test('le serveur ferme la connexion sans session:replaced (compte retiré) : un nouvel essai, dont le refus dira pourquoi', () => {
    const on = handlers();
    connectOffice(socket.asSocket(), store, bus);
    superviseConnection(socket.asSocket(), store, on);
    socket.connect();
    socket.serverAccepts();
    socket.receive('init', init());
    socket.serverDisconnects();
    vi.advanceTimersByTime(1000);
    expect(socket.connectCalls).toBe(2);
    socket.serverRefuses('disabled');
    expect(on.signedOut).toHaveBeenCalledOnce();
  });

  test('notre propre déconnexion (io client disconnect) : rien', () => {
    superviseConnection(socket.asSocket(), store, handlers());
    socket.connect();
    socket.serverAccepts();
    socket.disconnect();
    vi.advanceTimersByTime(120_000);
    expect(socket.connectCalls).toBe(1);
  });

  test('stop() annule l\'essai prévu et retire les écouteurs', () => {
    const supervisor = superviseConnection(socket.asSocket(), store, handlers());
    socket.connect();
    socket.serverRefuses('unavailable');
    supervisor.stop();
    expect(socket.listenerCount()).toBe(0);
    vi.advanceTimersByTime(120_000);
    expect(socket.connectCalls).toBe(1);
  });

  // « Utiliser ici » : la personne reprend la main depuis cet onglet, après que le serveur l'a remplacé par un autre.
  describe('restart()', () => {
    test('après session:replaced : la connexion repart tout de suite, et le prochain init rend la main à l\'onglet', () => {
      connectOffice(socket.asSocket(), store, bus);
      const supervisor = superviseConnection(socket.asSocket(), store, handlers());
      socket.connect();
      socket.serverAccepts();
      socket.receive('init', init());
      socket.receive('session:replaced');
      socket.serverDisconnects();
      vi.advanceTimersByTime(600_000);
      expect(socket.connectCalls).toBe(1);
      expect(store.getState().replaced).toBe(true);

      supervisor.restart();
      expect(socket.connectCalls).toBe(2);
      expect(socket.active).toBe(true);
      // Tant que le serveur n'a pas répondu, l'onglet reste « remplacé ».
      expect(store.getState().replaced).toBe(true);
      socket.serverAccepts();
      socket.receive('init', init());
      expect(store.getState().replaced).toBe(false);
    });

    test('un essai déjà prévu est annulé, et les délais repartent de 1 s', () => {
      const supervisor = superviseConnection(socket.asSocket(), store, handlers());
      socket.connect();
      socket.serverRefuses('unavailable');
      vi.advanceTimersByTime(1000);
      socket.serverRefuses('unavailable');
      vi.advanceTimersByTime(2000);
      socket.serverRefuses('unavailable');   // le prochain essai serait dans 4 s
      expect(socket.connectCalls).toBe(3);

      supervisor.restart();
      expect(socket.connectCalls).toBe(4);
      // Le nouvel essai est refusé tout de suite : le prochain est dans 1 s, comme au premier. (L'essai de 4 s a été annulé : s'il
      // restait, aucun autre ne serait prévu, et la reprise n'aurait lieu qu'à ses 4 s.)
      socket.serverRefuses('unavailable');
      vi.advanceTimersByTime(999);
      expect(socket.connectCalls).toBe(4);
      vi.advanceTimersByTime(1);
      expect(socket.connectCalls).toBe(5);
      // Et rien d'autre ne s'y ajoute.
      socket.serverAccepts();
      vi.advanceTimersByTime(60_000);
      expect(socket.connectCalls).toBe(5);
    });

    test('une connexion en cours : rien à relancer', () => {
      const supervisor = superviseConnection(socket.asSocket(), store, handlers());
      socket.connect();
      supervisor.restart();
      expect(socket.connectCalls).toBe(1);
      expect(socket.disconnectCalls).toBe(0);
    });

    // « Reconnecter », après un échec de la connexion audio/vidéo : la socket va bien, mais le serveur ne redit la consigne média (avec un
    // jeton neuf) qu'après un init, donc à une nouvelle connexion.
    test('une connexion ouverte : fermée puis rouverte tout de suite, et le serveur redit tout (init, puis la consigne média)', () => {
      connectOffice(socket.asSocket(), store, bus);
      const supervisor = superviseConnection(socket.asSocket(), store, handlers());
      socket.connect();
      socket.serverAccepts();
      socket.receive('init', init());
      supervisor.restart();
      expect(socket.disconnectCalls).toBe(1);
      expect(socket.connectCalls).toBe(2);
      expect(socket.active).toBe(true);
      expect(store.getState().ready).toBe(false);
      socket.serverAccepts();
      socket.receive('init', init());
      const p = { url: 'wss://livekit.test', room: 'r1', token: 'jeton-neuf' };
      socket.receive('media:join', p);
      expect(store.getState()).toMatchObject({ ready: true, mediaInstruction: { type: 'join', p } });
      // Rien d'autre n'est prévu : pas de second essai.
      vi.advanceTimersByTime(60_000);
      expect(socket.connectCalls).toBe(2);
    });

    test('une panne du réseau (Socket.io réessaie seul) : rien à relancer non plus', () => {
      const supervisor = superviseConnection(socket.asSocket(), store, handlers());
      socket.connect();
      socket.serverAccepts();
      socket.connectionDrops();
      supervisor.restart();
      expect(socket.connectCalls).toBe(1);
    });

    test('après stop(), il ne fait rien : la page se ferme', () => {
      const supervisor = superviseConnection(socket.asSocket(), store, handlers());
      socket.connect();
      socket.disconnect();
      supervisor.stop();
      supervisor.restart();
      expect(socket.connectCalls).toBe(1);
    });

    test('la connexion relancée est surveillée comme la première : un refus du serveur est suivi', () => {
      const on = handlers();
      const supervisor = superviseConnection(socket.asSocket(), store, on);
      socket.connect();
      socket.serverAccepts();
      socket.serverDisconnects();
      supervisor.restart();
      socket.serverRefuses('unauthorized');
      expect(on.signedOut).toHaveBeenCalledOnce();
    });
  });
});
