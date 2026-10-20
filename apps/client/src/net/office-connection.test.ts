import type { InitPayload, PublicPlayer } from '@bureau/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createOfficeStore } from '../state/office-store';
import { FakeBus, FakeSocket } from '../test/fake-socket';
import { connectOffice, retryDelay, superviseConnection } from './office-connection';

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
const init = (players: PublicPlayer[] = [A]): InitPayload => ({ self: SELF, players, mapKey: 'dev-office', chatHistory: [] });
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
    socket.receive('profile:changed', { id: 'b', name: 'Bea', avatarKey: 'dev-blue' });
    socket.receive('media:changed', { id: 'b', media: { mic: true, cam: false, screen: false } });
    expect(store.getState().players.b).toMatchObject({ status: 'dnd', name: 'Bea', avatarKey: 'dev-blue', media: { mic: true } });
    socket.receive('player:left', { id: 'a' });
    expect(Object.keys(store.getState().players)).toEqual(['b']);

    expect(bus.emittedOf('net:joined')).toEqual([B]);
    expect(bus.emittedOf('net:status')).toEqual([{ id: 'b', status: 'dnd' }]);
    expect(bus.emittedOf('net:profile')).toEqual([{ id: 'b', name: 'Bea', avatarKey: 'dev-blue' }]);
    expect(bus.emittedOf('net:left')).toEqual([{ id: 'a' }]);
  });

  test('move:correct : au jeu (net:correct), qui recale l\'avatar local', () => {
    connectOffice(socket.asSocket(), store, bus);
    socket.receive('move:correct', { x: 80, y: 240 });
    expect(bus.emittedOf('net:correct')).toEqual([{ x: 80, y: 240 }]);
  });

  test('session:replaced : le magasin le sait (un autre onglet a pris la place)', () => {
    connectOffice(socket.asSocket(), store, bus);
    socket.receive('session:replaced');
    expect(store.getState().replaced).toBe(true);
  });

  // L'audio et la vidéo (useMedia) ne suivent les consignes qu'après « Entrer » : la connexion, ouverte dès l'écran d'entrée, retient
  // la dernière, que le serveur ne redira pas.
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
    // Ce n'est pas pour le jeu.
    expect(bus.emitted.map(([event]) => event)).toEqual(['net:init']);
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
