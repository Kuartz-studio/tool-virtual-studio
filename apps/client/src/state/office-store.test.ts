import { CHAT_HISTORY_LIMIT, type ChatMessage, type GameId, type GameInvite, type GameMatchView, type GameTableView, type InitPayload, type PublicPlayer, type RoomMusic } from '@bureau/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ZOOM_BUTTON_STEP, ZOOM_DEFAULT_PERCENT, ZOOM_MAX_PERCENT, ZOOM_MIN_PERCENT } from '../game/zoom';
import { createOfficeStore, selectChatUnread, selectDeskOf, useOfficeStore } from './office-store';

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

const init = (self: PublicPlayer, players: PublicPlayer[], mapKey = 'dev-office'): InitPayload => ({ self, players, mapKey, chatHistory: [], desks: [], closedDesks: [], deskBans: [] });

const SELF = player('moi');
const A = player('a');
const B = player('b');

let store: ReturnType<typeof createOfficeStore>;
beforeEach(() => {
  store = createOfficeStore();
});

test('deuxième init : joueurs remplacés', () => {
  store.getState().applyInit(init(SELF, [A, B]));
  store.getState().applyInit(init(SELF, [A]));
  expect(Object.keys(store.getState().players)).toEqual(['a']);
});

test('avant tout init : personne, pas de carte, pas remplacé', () => {
  expect(store.getState()).toMatchObject({ selfId: null, self: null, mapKey: null, players: {}, replaced: false });
});

test('init : soi-même à part (selfId, self), les autres dans players, la carte du serveur', () => {
  store.getState().applyInit(init(SELF, [A, B], 'bureau'));
  const state = store.getState();
  expect(state.selfId).toBe('moi');
  expect(state.self).toEqual(SELF);
  expect(state.mapKey).toBe('bureau');
  expect(state.players).toEqual({ a: A, b: B });
});

test('init : soi-même n\'est jamais dans players, même si le serveur le listait', () => {
  store.getState().applyInit(init(SELF, [A, SELF]));
  expect(Object.keys(store.getState().players)).toEqual(['a']);
});

test('init : on n\'est plus « remplacé » (l\'onglet a repris la main : « Utiliser ici »)', () => {
  store.getState().setReplaced(true);
  expect(store.getState().replaced).toBe(true);
  store.getState().applyInit(init(SELF, []));
  expect(store.getState().replaced).toBe(false);
});

test('upsertPlayer : ajoute, ou remplace le joueur du même identifiant ; soi-même met à jour self', () => {
  store.getState().applyInit(init(SELF, [A]));
  store.getState().upsertPlayer(B);
  store.getState().upsertPlayer({ ...A, name: 'Alice' });
  expect(store.getState().players).toEqual({ a: { ...A, name: 'Alice' }, b: B });
  store.getState().upsertPlayer({ ...SELF, x: 100 });
  expect(store.getState().self?.x).toBe(100);
  expect(store.getState().players.moi).toBeUndefined();
});

test('removePlayer : retire ; un inconnu, ou soi-même, ne change rien', () => {
  store.getState().applyInit(init(SELF, [A, B]));
  store.getState().removePlayer('a');
  expect(Object.keys(store.getState().players)).toEqual(['b']);
  const before = store.getState();
  store.getState().removePlayer('inconnu');
  store.getState().removePlayer('moi');
  expect(store.getState()).toBe(before);
});

test('setSpeaking : la parole d\'un autre, ou la sienne ; se taire retire la clé ; un inconnu est ignoré', () => {
  store.getState().applyInit(init(SELF, [A, B]));
  const { setSpeaking } = store.getState();
  setSpeaking('a', true);
  setSpeaking('moi', true);
  expect(store.getState().players.a?.speaking).toBe(true);
  expect(store.getState().self?.speaking).toBe(true);
  expect(store.getState().players.b).not.toHaveProperty('speaking');
  setSpeaking('a', false);
  expect(store.getState().players.a).not.toHaveProperty('speaking');
  const before = store.getState().players;
  setSpeaking('inconnu', true);
  expect(store.getState().players).toBe(before);
});

test('setStatus, setMedia, setProfile : pour un autre joueur, et pour soi-même', () => {
  store.getState().applyInit(init(SELF, [A]));
  const { setStatus, setMedia, setProfile } = store.getState();
  setStatus('a', 'dnd');
  setStatus('moi', 'busy');
  setMedia('a', { mic: true, cam: false, screen: true });
  setMedia('moi', { mic: false, cam: true, screen: false });
  setProfile({ id: 'a', name: 'Alice', avatarKey: 'dev-blue' });
  setProfile({ id: 'moi', name: 'Moi-même', avatarKey: 'dev-green' });
  const { players, self } = store.getState();
  expect(players.a).toMatchObject({ status: 'dnd', media: { mic: true, cam: false, screen: true }, name: 'Alice', avatarKey: 'dev-blue' });
  expect(self).toMatchObject({ status: 'busy', media: { mic: false, cam: true, screen: false }, name: 'Moi-même', avatarKey: 'dev-green' });
});

test('un identifiant inconnu (parti, ou pas encore arrivé) ne change rien, et ne crée personne', () => {
  store.getState().applyInit(init(SELF, [A]));
  const before = store.getState();
  store.getState().setStatus('x', 'away');
  store.getState().setMedia('x', { mic: true, cam: true, screen: true });
  store.getState().setProfile({ id: 'x', name: 'X', avatarKey: null });
  expect(store.getState()).toBe(before);
});

test('chaque changement donne de nouveaux objets (React ne voit que ce qui change), sans toucher aux autres joueurs', () => {
  store.getState().applyInit(init(SELF, [A, B]));
  const before = store.getState();
  store.getState().setStatus('a', 'away');
  const after = store.getState();
  expect(after.players).not.toBe(before.players);
  expect(after.players.a).not.toBe(before.players.a);
  expect(after.players.b).toBe(before.players.b);
  expect(before.players.a!.status).toBe('available');
});

test('reset : l\'état de départ (une autre session, un autre compte)', () => {
  store.getState().applyInit(init(SELF, [A]));
  store.getState().setReplaced(true);
  store.getState().setMediaInstruction({ type: 'leave' });
  store.getState().addChatMessage(msg('m1'));
  store.getState().addChatMessage(msg('n1', { channel: 'nearby' }));
  store.getState().setChosenStatus('dnd');
  store.getState().reset();
  expect(store.getState()).toMatchObject({
    selfId: null,
    self: null,
    mapKey: null,
    players: {},
    replaced: false,
    ready: false,
    mediaInstruction: null,
    chatAll: [],
    chatNearby: [],
    chatReadId: null,
    chosenStatus: null,
  });
});

test('chosenStatus : aucun au départ ; le dernier choisi ; un init ne le change pas (self dit ce que dit le serveur)', () => {
  expect(store.getState().chosenStatus).toBeNull();
  store.getState().applyInit(init({ ...SELF, status: 'busy' }, [A]));
  // Le statut de l'init est celui du serveur, pas un choix de la personne.
  expect(store.getState().chosenStatus).toBeNull();
  store.getState().setChosenStatus('dnd');
  store.getState().setChosenStatus('away');
  expect(store.getState().chosenStatus).toBe('away');
  // Le serveur a redémarré, et l'a oublié : son init dit « available », le choix reste.
  store.getState().applyInit(init({ ...SELF, status: 'available' }, [A]));
  expect(store.getState().chosenStatus).toBe('away');
  expect(store.getState().self!.status).toBe('available');
  store.getState().setChosenStatus(null);
  expect(store.getState().chosenStatus).toBeNull();
});

test('ready : faux au départ ; vrai à l\'init (le serveur nous a placés) ; faux quand la connexion est coupée', () => {
  expect(store.getState().ready).toBe(false);
  store.getState().applyInit(init(SELF, [A]));
  expect(store.getState().ready).toBe(true);
  store.getState().setReady(false);
  expect(store.getState().ready).toBe(false);
  // Le reste de l'état reste là pendant la coupure : on sait qui on est, et la carte.
  expect(store.getState()).toMatchObject({ selfId: 'moi', mapKey: 'dev-office' });
  store.getState().applyInit(init(SELF, [A]));
  expect(store.getState().ready).toBe(true);
});

test('mediaInstruction : aucune au départ, puis la dernière reçue, et plus aucune une fois oubliée', () => {
  expect(store.getState().mediaInstruction).toBeNull();
  const p = { url: 'wss://livekit.test', room: 'r1', token: 'jeton' };
  store.getState().setMediaInstruction({ type: 'join', p });
  expect(store.getState().mediaInstruction).toEqual({ type: 'join', p });
  store.getState().setMediaInstruction({ type: 'leave' });
  expect(store.getState().mediaInstruction).toEqual({ type: 'leave' });
  // La connexion qui l'a reçue est coupée : oubliée.
  store.getState().setMediaInstruction(null);
  expect(store.getState().mediaInstruction).toBeNull();
});

// ---- Les dernières positions (pour un jeu qui démarre après des ticks) ----------------------------------------------------------

const move = (id: string, x: number, moving = true) => ({ id, x, y: 240, dir: 'right' as const, moving });

test('positions : celles de l\'init pour les autres joueurs (pas soi-même), avec direction et marche', () => {
  store.getState().applyInit(init({ ...SELF, x: 1 }, [{ ...A, x: 100, dir: 'left', moving: true }, B]));
  expect(Object.fromEntries(store.getState().positions)).toEqual({
    a: { x: 100, y: 240, dir: 'left', moving: true },
    b: { x: 80, y: 240, dir: 'down', moving: false },
  });
});

test('recordMoves : la dernière position de chaque joueur connu ; soi-même et les inconnus sont ignorés', () => {
  store.getState().applyInit(init(SELF, [A, B]));
  store.getState().recordMoves([move('a', 120), move('moi', 300), move('inconnu', 50)]);
  store.getState().recordMoves([move('a', 136, false)]);
  const { positions } = store.getState();
  expect(positions.get('a')).toEqual({ x: 136, y: 240, dir: 'right', moving: false });
  expect(positions.get('b')).toEqual({ x: 80, y: 240, dir: 'down', moving: false });
  expect(positions.has('moi')).toBe(false);
  expect(positions.has('inconnu')).toBe(false);
});

test('recordMoves ne prévient personne : aucun abonné (React) n\'est appelé, l\'état reste le même objet', () => {
  store.getState().applyInit(init(SELF, [A]));
  const before = store.getState();
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);
  store.getState().recordMoves([move('a', 120)]);
  unsubscribe();
  expect(calls).toBe(0);
  expect(store.getState()).toBe(before);
  expect(store.getState().positions.get('a')!.x).toBe(120);
});

test('arrivée, départ, nouvel init et reset tiennent les positions à jour (rien ne s\'y accumule)', () => {
  store.getState().applyInit(init(SELF, [A]));
  store.getState().upsertPlayer({ ...B, x: 200 });
  expect(store.getState().positions.get('b')!.x).toBe(200);
  store.getState().upsertPlayer({ ...SELF, x: 999 });
  expect(store.getState().positions.has('moi')).toBe(false);
  store.getState().removePlayer('a');
  expect(store.getState().positions.has('a')).toBe(false);

  store.getState().recordMoves([move('b', 250)]);
  store.getState().applyInit(init(SELF, [{ ...A, x: 90 }]));
  expect(Object.fromEntries(store.getState().positions)).toEqual({ a: { x: 90, y: 240, dir: 'down', moving: false } });
  store.getState().reset();
  expect(store.getState().positions.size).toBe(0);
});

test('useOfficeStore est le magasin de l\'appli', () => {
  useOfficeStore.getState().reset();
  useOfficeStore.getState().applyInit(init(SELF, [A]));
  expect(useOfficeStore.getState().selfId).toBe('moi');
  useOfficeStore.getState().reset();
});

// ---- Le chat ---------------------------------------------------------------------------------------------------------------------

const msg = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  channel: 'all',
  userId: 'a',
  name: 'A',
  text: `texte ${id}`,
  sentAt: '2026-10-20T10:00:00.000Z',
  ...over,
});
const initWith = (chatHistory: ChatMessage[], players: PublicPlayer[] = [A]): InitPayload => ({ self: SELF, players, mapKey: 'dev-office', chatHistory, desks: [], closedDesks: [], deskBans: [] });
const ids = (list: ChatMessage[]) => list.map((m) => m.id);
const many = (count: number, prefix = 'm', over: Partial<ChatMessage> = {}) => Array.from({ length: count }, (_, i) => msg(`${prefix}${i + 1}`, over));

describe('chat', () => {
  test('avant tout init : aucun message, rien de lu', () => {
    expect(store.getState()).toMatchObject({ chatAll: [], chatNearby: [], chatReadId: null });
    expect(selectChatUnread(store.getState())).toBe(0);
  });

  test('init : l\'historique « Tout le monde » est la liste, dans l\'ordre du serveur (du plus ancien au plus récent)', () => {
    store.getState().applyInit(initWith([msg('m1'), msg('m2'), msg('m3')]));
    expect(ids(store.getState().chatAll)).toEqual(['m1', 'm2', 'm3']);
    expect(store.getState().chatNearby).toEqual([]);
  });

  test('un nouvel init (retour après une coupure, nouvel onglet) remplace « Tout le monde » par l\'historique, et garde « À proximité »', () => {
    store.getState().applyInit(initWith([msg('m1'), msg('m2')]));
    store.getState().addChatMessage(msg('m3'));
    store.getState().addChatMessage(msg('n1', { channel: 'nearby' }));
    // Le serveur ne redit jamais « À proximité », qu'il ne garde pas ; l'historique, lui, fait foi pour « Tout le monde ».
    store.getState().applyInit(initWith([msg('m2'), msg('m3'), msg('m4')]));
    expect(ids(store.getState().chatAll)).toEqual(['m2', 'm3', 'm4']);
    expect(ids(store.getState().chatNearby)).toEqual(['n1']);
    store.getState().applyInit(initWith([]));
    expect(store.getState().chatAll).toEqual([]);
    expect(ids(store.getState().chatNearby)).toEqual(['n1']);
  });

  test('addChatMessage : chaque canal à sa liste, à la suite de ce qu\'il y a', () => {
    store.getState().applyInit(initWith([msg('m1')]));
    store.getState().addChatMessage(msg('m2'));
    store.getState().addChatMessage(msg('n1', { channel: 'nearby' }));
    store.getState().addChatMessage(msg('m3'));
    store.getState().addChatMessage(msg('n2', { channel: 'nearby' }));
    expect(ids(store.getState().chatAll)).toEqual(['m1', 'm2', 'm3']);
    expect(ids(store.getState().chatNearby)).toEqual(['n1', 'n2']);
  });

  test('un message déjà là (même id) n\'est pas ajouté deux fois, et l\'état reste le même objet', () => {
    store.getState().applyInit(initWith([msg('m1')]));
    store.getState().addChatMessage(msg('m2'));
    store.getState().addChatMessage(msg('n1', { channel: 'nearby' }));
    const before = store.getState();
    // Celui de l'historique, un message du direct reçu deux fois : un seul.
    store.getState().addChatMessage(msg('m1'));
    store.getState().addChatMessage(msg('m2'));
    store.getState().addChatMessage(msg('n1', { channel: 'nearby' }));
    expect(store.getState()).toBe(before);
    expect(ids(store.getState().chatAll)).toEqual(['m1', 'm2']);
  });

  test('l\'historique est dédoublonné aussi (le premier exemplaire reste)', () => {
    store.getState().applyInit(initWith([msg('m1'), msg('m2', { text: 'premier' }), msg('m2', { text: 'second' }), msg('m3')]));
    expect(store.getState().chatAll.map((m) => [m.id, m.text])).toEqual([
      ['m1', 'texte m1'],
      ['m2', 'premier'],
      ['m3', 'texte m3'],
    ]);
  });

  test('les 200 derniers messages seulement (CHAT_HISTORY_LIMIT) : à l\'init, en direct, et pour « À proximité »', () => {
    expect(CHAT_HISTORY_LIMIT).toBe(200);
    store.getState().applyInit(initWith(many(205)));
    expect(store.getState().chatAll).toHaveLength(200);
    expect(store.getState().chatAll[0]!.id).toBe('m6');
    expect(store.getState().chatAll.at(-1)!.id).toBe('m205');

    store.getState().addChatMessage(msg('m206'));
    expect(store.getState().chatAll).toHaveLength(200);
    expect(store.getState().chatAll[0]!.id).toBe('m7');
    expect(store.getState().chatAll.at(-1)!.id).toBe('m206');

    for (const m of many(230, 'n', { channel: 'nearby' })) store.getState().addChatMessage(m);
    expect(store.getState().chatNearby).toHaveLength(200);
    expect(store.getState().chatNearby[0]!.id).toBe('n31');
    expect(store.getState().chatNearby.at(-1)!.id).toBe('n230');
  });

  describe('non lus', () => {
    test('au premier init, l\'historique est lu : rien de non lu', () => {
      store.getState().applyInit(initWith([msg('m1'), msg('m2')]));
      expect(store.getState().chatReadId).toBe('m2');
      expect(selectChatUnread(store.getState())).toBe(0);
    });

    test('un historique vide au premier init : tout ce qui arrive ensuite, des autres, est non lu', () => {
      store.getState().applyInit(initWith([]));
      expect(store.getState().chatReadId).toBeNull();
      store.getState().addChatMessage(msg('m1'));
      store.getState().addChatMessage(msg('m2'));
      expect(selectChatUnread(store.getState())).toBe(2);
    });

    test('les messages des autres reçus depuis le dernier lu ; les siens ne comptent pas', () => {
      store.getState().applyInit(initWith([msg('m1')]));
      store.getState().addChatMessage(msg('m2'));
      store.getState().addChatMessage(msg('m3', { userId: 'moi', name: 'MOI' }));
      store.getState().addChatMessage(msg('m4', { userId: 'b', name: 'B' }));
      expect(selectChatUnread(store.getState())).toBe(2);
    });

    test('« À proximité » ne compte pas', () => {
      store.getState().applyInit(initWith([msg('m1')]));
      store.getState().addChatMessage(msg('n1', { channel: 'nearby' }));
      expect(selectChatUnread(store.getState())).toBe(0);
    });

    test('markChatRead : tout ce qui est là est lu ; la suite compte de nouveau', () => {
      store.getState().applyInit(initWith([msg('m1')]));
      store.getState().addChatMessage(msg('m2'));
      store.getState().addChatMessage(msg('m3'));
      expect(selectChatUnread(store.getState())).toBe(2);
      store.getState().markChatRead();
      expect(store.getState().chatReadId).toBe('m3');
      expect(selectChatUnread(store.getState())).toBe(0);
      store.getState().addChatMessage(msg('m4'));
      expect(selectChatUnread(store.getState())).toBe(1);
    });

    test('markChatRead sans rien de nouveau ne change rien (l\'état reste le même objet)', () => {
      store.getState().applyInit(initWith([msg('m1')]));
      const before = store.getState();
      store.getState().markChatRead();
      expect(store.getState()).toBe(before);
    });

    test('un init de retour : ce qui est arrivé pendant la coupure est non lu, ce qui était lu le reste', () => {
      store.getState().applyInit(initWith([msg('m1'), msg('m2')]));
      store.getState().setReady(false);
      store.getState().applyInit(initWith([msg('m1'), msg('m2'), msg('m3'), msg('m4', { userId: 'moi', name: 'MOI' }), msg('m5')]));
      expect(store.getState().chatReadId).toBe('m2');
      expect(selectChatUnread(store.getState())).toBe(2);
    });

    test('le dernier message lu n\'est plus dans la liste (200 de plus depuis) : tous ceux des autres sont non lus', () => {
      store.getState().applyInit(initWith([msg('m1')]));
      for (const m of many(210, 'x')) store.getState().addChatMessage(m);
      expect(store.getState().chatAll.some((m) => m.id === 'm1')).toBe(false);
      expect(selectChatUnread(store.getState())).toBe(200);
    });
  });
});


describe('les bureaux', () => {
  const free = (key: string) => ({ key, ownerId: null, ownerName: null, name: null, locked: false, closedByState: false, ...DEFAULT_ROOM });
  const initWithDesks = (desks: ReturnType<typeof free>[], closedDesks: string[] = [], deskBans: Array<{ id: string; name: string }> = []): InitPayload => ({
    ...init(SELF, []),
    desks,
    closedDesks,
    deskBans,
  });

  test('l\'init donne les places, les portes fermées pour soi et les exclus ; un init de retour les remplace et efface les toc toc', () => {
    const store = createOfficeStore();
    store.getState().applyInit(initWithDesks([free('A1'), free('A2')], ['A2'], [{ id: 'bob', name: 'Bob' }]));
    expect(store.getState().desks.map((d) => d.key)).toEqual(['A1', 'A2']);
    expect(store.getState().closedDesks).toEqual(['A2']);
    expect(store.getState().deskBans).toEqual([{ id: 'bob', name: 'Bob' }]);

    store.getState().addDeskKnock({ key: 'A1', userId: 'zoe', name: 'Zoé' });
    store.getState().applyInit(initWithDesks([free('B1')]));
    expect(store.getState().desks.map((d) => d.key)).toEqual(['B1']);
    expect(store.getState().closedDesks).toEqual([]);
    expect(store.getState().deskKnocks).toEqual([]);
  });

  test('setDesk remplace la place de même clé, sans changer l\'ordre ; une place inconnue s\'ajoute', () => {
    const store = createOfficeStore();
    store.getState().applyInit(initWithDesks([free('A1'), free('A2'), free('A3')]));
    store.getState().setDesk({ ...free('A2'), ownerId: 'bob', ownerName: 'Bob', locked: true });
    expect(store.getState().desks.map((d) => [d.key, d.ownerId, d.locked])).toEqual([['A1', null, false], ['A2', 'bob', true], ['A3', null, false]]);
    store.getState().setDesk(free('Z9'));
    expect(store.getState().desks.map((d) => d.key)).toEqual(['A1', 'A2', 'A3', 'Z9']);
  });

  test('selectDeskOf : la place d\'une personne, ou rien', () => {
    const desks = [free('A1'), { ...free('A2'), ownerId: 'bob' }];
    expect(selectDeskOf({ desks }, 'bob')?.key).toBe('A2');
    expect(selectDeskOf({ desks }, 'zoe')).toBeUndefined();
    expect(selectDeskOf({ desks }, null)).toBeUndefined();
  });

  test('toc toc : un par personne (le dernier remplace l\'ancien), ignorable', () => {
    const store = createOfficeStore();
    store.getState().addDeskKnock({ key: 'A1', userId: 'bob', name: 'Bob' });
    store.getState().addDeskKnock({ key: 'A1', userId: 'zoe', name: 'Zoé' });
    store.getState().addDeskKnock({ key: 'A1', userId: 'bob', name: 'Bob' });
    expect(store.getState().deskKnocks.map((k) => k.userId)).toEqual(['zoe', 'bob']);
    store.getState().dismissDeskKnock('zoe');
    expect(store.getState().deskKnocks.map((k) => k.userId)).toEqual(['bob']);
  });

  test('reset efface tout cela', () => {
    const store = createOfficeStore();
    store.getState().applyInit(initWithDesks([free('A1')], ['A1']));
    store.getState().setDeskNotice('x');
    store.getState().reset();
    expect(store.getState()).toMatchObject({ desks: [], closedDesks: [], deskBans: [], deskKnocks: [], deskNotice: null, officeMap: null });
  });
});

describe('zoom', () => {
  beforeEach(() => {
    useOfficeStore.getState().reset();
  });
  const store = () => useOfficeStore.getState();

  test('au départ, 100 % ; chaque cran fait 5 %, arrêté à 25 % et à 200 %', () => {
    expect(store().zoomPercent).toBe(ZOOM_DEFAULT_PERCENT);
    store().stepZoom(1);
    expect(store().zoomPercent).toBe(105);
    store().stepZoom(-3);
    expect(store().zoomPercent).toBe(90);
    store().stepZoom(1000);
    expect(store().zoomPercent).toBe(ZOOM_MAX_PERCENT);
    store().stepZoom(-1000);
    expect(store().zoomPercent).toBe(ZOOM_MIN_PERCENT);
  });

  test('un cran de 10 % (les boutons) va au cran voisin de la grille de 10, y compris depuis le minimum', () => {
    store().stepZoom(1, ZOOM_BUTTON_STEP);
    expect(store().zoomPercent).toBe(110);
    store().stepZoom(-2, ZOOM_BUTTON_STEP);
    expect(store().zoomPercent).toBe(90);
    store().setZoomPercent(ZOOM_MIN_PERCENT);
    store().stepZoom(1, ZOOM_BUTTON_STEP);
    expect(store().zoomPercent).toBe(30);
  });

  test('setZoomPercent ramène un pourcentage hors bornes aux bornes, et un pourcentage entre deux crans au cran de 5 % le plus proche', () => {
    store().setZoomPercent(999);
    expect(store().zoomPercent).toBe(ZOOM_MAX_PERCENT);
    store().setZoomPercent(103);
    expect(store().zoomPercent).toBe(105);
    store().setZoomPercent(Number.NaN);
    expect(store().zoomPercent).toBe(ZOOM_DEFAULT_PERCENT);
  });

  test('resetZoom et reset() rétablissent 100 %', () => {
    store().setZoomPercent(30);
    store().resetZoom();
    expect(store().zoomPercent).toBe(ZOOM_DEFAULT_PERCENT);
    store().setZoomPercent(30);
    store().reset();
    expect(store().zoomPercent).toBe(ZOOM_DEFAULT_PERCENT);
  });
});

describe('la lumière', () => {
  const OFF = { on: false, by: { id: 'a', name: 'A' }, at: 1_700_000_000_000 };
  const ON = { on: true, by: { id: 'b', name: 'B' }, at: 1_700_000_050_000 };
  const LIT = { on: true, by: null, at: 0 };

  test('allumée au départ, tant que le serveur n\'a rien dit', () => {
    expect(store.getState().lights).toEqual(LIT);
  });

  test('l\'init donne son état ; un init sans lumière (un serveur qui n\'en dit rien) la dit allumée', () => {
    store.getState().applyInit({ ...init(SELF, [A]), lights: OFF });
    expect(store.getState().lights).toEqual(OFF);
    store.getState().applyInit(init(SELF, [A]));
    expect(store.getState().lights).toEqual(LIT);
  });

  test('un init de retour (reconnexion) remplace ce que l\'on croyait : le serveur fait foi', () => {
    store.getState().applyInit({ ...init(SELF, [A]), lights: OFF });
    store.getState().applyInit({ ...init(SELF, [A]), lights: ON });
    expect(store.getState().lights).toEqual(ON);
  });

  test('setLights : l\'état que le serveur annonce, avec son auteur', () => {
    store.getState().setLights(OFF);
    expect(store.getState().lights).toEqual(OFF);
    store.getState().setLights(ON);
    expect(store.getState().lights).toEqual(ON);
  });

  test('setLights ne change que la lumière : les joueurs restent les mêmes objets', () => {
    store.getState().applyInit(init(SELF, [A]));
    const before = store.getState();
    store.getState().setLights(OFF);
    expect(store.getState().players).toBe(before.players);
    expect(store.getState().self).toBe(before.self);
  });

  test('reset rallume (un autre compte, une autre session)', () => {
    store.getState().applyInit({ ...init(SELF, [A]), lights: OFF });
    store.getState().reset();
    expect(store.getState().lights).toEqual(LIT);
  });
});

// La musique des pièces : le serveur dit l'état de celles qu'on a réglées (init, puis `music:changed`) ; les autres sont allumées, leur ambiance par défaut.
describe('la musique des pièces', () => {
  const OFF: RoomMusic = { on: false, scene: null, by: { id: 'a', name: 'A' }, at: 1_700_000_000_000 };
  const QUEST: RoomMusic = { on: true, scene: 'quest', by: { id: 'b', name: 'B' }, at: 1_700_000_005_000 };

  test('avant tout réglage : aucune pièce n\'a d\'état', () => {
    expect(store.getState().music).toEqual({});
  });

  test('init : les pièces réglées vont au magasin ; un init sans `music` dit que personne n\'a rien réglé', () => {
    store.getState().applyInit({ ...init(SELF, [A]), music: { game: OFF } });
    expect(store.getState().music).toEqual({ game: OFF });
    store.getState().applyInit(init(SELF, [A]));
    expect(store.getState().music).toEqual({});
  });

  test('setRoomMusic : l\'état de cette pièce, tel que le serveur l\'annonce ; les autres pièces ne changent pas', () => {
    store.getState().setRoomMusic('game', OFF);
    store.getState().setRoomMusic('gym', QUEST);
    expect(store.getState().music).toEqual({ game: OFF, gym: QUEST });
    store.getState().setRoomMusic('game', { ...OFF, on: true, at: OFF.at + 1 });
    expect(store.getState().music.game).toMatchObject({ on: true, at: OFF.at + 1 });
    expect(store.getState().music.gym).toBe(QUEST);
  });

  test('un nouvel init remplace tout : ce qu\'on croyait avant une coupure n\'a plus cours', () => {
    store.getState().applyInit({ ...init(SELF, [A]), music: { game: OFF } });
    store.getState().setRoomMusic('gym', QUEST);
    store.getState().applyInit({ ...init(SELF, [A]), music: { cafe: QUEST } });
    expect(store.getState().music).toEqual({ cafe: QUEST });
  });

  test('setRoomMusic ne change que la musique : les joueurs restent les mêmes objets ; reset efface tout', () => {
    store.getState().applyInit(init(SELF, [A]));
    const before = store.getState();
    store.getState().setRoomMusic('game', OFF);
    expect(store.getState().players).toBe(before.players);
    expect(store.getState().self).toBe(before.self);
    store.getState().reset();
    expect(store.getState().music).toEqual({});
  });
});

// Le café : le serveur dit ce qu'il reste (`coffee:changed`, ou `boost` dans l'init) ; le magasin en garde l'échéance, sur l'horloge de la page.
describe('le café', () => {
  const NOW = 5_000;
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('avant tout café : personne n\'en a', () => {
    expect(store.getState().coffee).toEqual({});
  });

  test('setCoffee : l\'échéance est l\'heure de la page plus ce que dit le serveur ; un nouveau café la remplace ; 0 la retire', () => {
    store.getState().setCoffee('a', 30_000);
    expect(store.getState().coffee).toEqual({ a: NOW + 30_000 });
    vi.mocked(performance.now).mockReturnValue(NOW + 10_000);
    store.getState().setCoffee('a', 30_000);
    store.getState().setCoffee('moi', 5_000);
    expect(store.getState().coffee).toEqual({ a: NOW + 40_000, moi: NOW + 15_000 });
    store.getState().setCoffee('a', 0);
    expect(store.getState().coffee).toEqual({ moi: NOW + 15_000 });
  });

  test('retirer un café qu\'on ne connaît pas ne change rien (l\'état reste le même objet)', () => {
    store.getState().setCoffee('a', 1_000);
    const before = store.getState().coffee;
    store.getState().setCoffee('inconnu', 0);
    expect(store.getState().coffee).toBe(before);
  });

  test('init : le café de soi-même et des autres (boost, ce qu\'il en reste) devient une échéance ; le magasin n\'en garde pas la durée', () => {
    store.getState().applyInit(init(player('moi', { boost: 12_000 }), [player('a', { boost: 30_000 }), player('b')]));
    expect(store.getState().coffee).toEqual({ moi: NOW + 12_000, a: NOW + 30_000 });
    expect(store.getState().self).not.toHaveProperty('boost');
    expect(store.getState().players.a).not.toHaveProperty('boost');
  });

  test('un nouvel init remplace tous les cafés : celui d\'avant la coupure, fini ou non, n\'a plus cours', () => {
    store.getState().applyInit(init(SELF, [A], 'dev-office'));
    store.getState().setCoffee('a', 30_000);
    store.getState().setCoffee('moi', 30_000);
    store.getState().applyInit(init(player('moi', { boost: 4_000 }), [A]));
    expect(store.getState().coffee).toEqual({ moi: NOW + 4_000 });
  });

  test('quelqu\'un qui part n\'a plus de café ; reset (le bureau quitté) les efface tous', () => {
    store.getState().applyInit(init(SELF, [A, B]));
    store.getState().setCoffee('a', 30_000);
    store.getState().setCoffee('b', 30_000);
    store.getState().removePlayer('a');
    expect(store.getState().coffee).toEqual({ b: NOW + 30_000 });
    store.getState().reset();
    expect(store.getState().coffee).toEqual({});
  });
});

const GAME_NOW = 10_000;

describe('les jeux', () => {
  const table = (game: GameId, version: number, over: Partial<GameTableView> = {}): GameTableView => ({ game, version, chairs: [null, null], spectators: [], match: null, ...over });
  const match = (id: string, userIds: string[], status: 'playing' | 'ended' = 'playing'): GameMatchView => ({
    id,
    status,
    players: userIds.map((userId) => ({ userId, name: userId, avatarKey: null, connected: true, reconnectMs: null, out: false })),
    first: 0,
    state: {},
    events: [],
    turnMs: status === 'playing' ? 1000 : null,
    drawOffer: null,
    startedAt: 0,
    result: null,
    ranked: null,
    ratings: null,
  });
  const invite = (id: string, game: GameId = 'chess'): GameInvite => ({ id, game, from: { id: 'a', name: 'A', avatarKey: null }, ttlMs: 60_000 });
  const withGames = (games?: GameTableView[], gameInvites?: GameInvite[]): InitPayload => ({ ...init(SELF, [A]), ...(games ? { games } : {}), ...(gameInvites ? { gameInvites } : {}) });
  // Une invitation au magasin : ce que le serveur dit, avec son échéance (maintenant + ce qu'il lui reste à vivre).
  const entry = (given: GameInvite) => ({ ...given, until: GAME_NOW + given.ttlMs });
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(GAME_NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('avant tout init : aucune table, aucune invitation, aucun panneau de jeu ouvert, rien d\'interrompu', () => {
    expect(store.getState()).toMatchObject({ games: {}, gameInvites: [], gameOpen: null, gameInterrupted: null });
  });

  test('init : les tables, par jeu, et les invitations en attente ; un init qui n\'en dit rien les vide', () => {
    store.getState().applyInit(withGames([table('chess', 3), table('ludo', 0)], [invite('i1')]));
    expect(Object.keys(store.getState().games).sort()).toEqual(['chess', 'ludo']);
    expect(store.getState().games.chess?.version).toBe(3);
    expect(store.getState().gameInvites).toEqual([entry(invite('i1'))]);
    store.getState().applyInit(withGames());
    expect(store.getState().games).toEqual({});
    expect(store.getState().gameInvites).toEqual([]);
  });

  test('setGameTable : la table de ce jeu est remplacée par une version plus récente ; une version égale ou plus ancienne est ignorée (l\'état reste le même objet)', () => {
    store.getState().applyInit(withGames([table('chess', 3)]));
    store.getState().setGameTable(table('chess', 4, { spectators: [{ id: 'a', name: 'A' }] }));
    expect(store.getState().games.chess?.spectators).toHaveLength(1);
    const before = store.getState().games;
    store.getState().setGameTable(table('chess', 4));
    store.getState().setGameTable(table('chess', 2));
    expect(store.getState().games).toBe(before);
  });

  test('setGameTable : une table que l\'init ne connaissait pas s\'ajoute', () => {
    store.getState().applyInit(withGames([table('chess', 3)]));
    store.getState().setGameTable(table('connect4', 1));
    expect(Object.keys(store.getState().games).sort()).toEqual(['chess', 'connect4']);
  });

  test('addGameInvite : une invitation de même identifiant remplace l\'ancienne, sans changer de rang ; removeGameInvite la retire, un inconnu ne change rien', () => {
    store.getState().addGameInvite(invite('i1'));
    store.getState().addGameInvite(invite('i2', 'ludo'));
    store.getState().addGameInvite({ ...invite('i1'), ttlMs: 10_000 });
    expect(store.getState().gameInvites.map((known) => [known.id, known.ttlMs, known.until])).toEqual([['i1', 10_000, GAME_NOW + 10_000], ['i2', 60_000, GAME_NOW + 60_000]]);
    store.getState().removeGameInvite('i1');
    expect(store.getState().gameInvites.map((known) => known.id)).toEqual(['i2']);
    const before = store.getState().gameInvites;
    store.getState().removeGameInvite('inconnue');
    expect(store.getState().gameInvites).toBe(before);
  });

  test('openGame : le panneau d\'une table s\'ouvre, et null le ferme', () => {
    store.getState().openGame('connect4');
    expect(store.getState().gameOpen).toBe('connect4');
    store.getState().openGame(null);
    expect(store.getState().gameOpen).toBeNull();
  });

  test('init : une partie qu\'on jouait et que le serveur ne connaît plus (il a redémarré) est « interrompue »', () => {
    store.getState().applyInit(withGames([table('chess', 5, { match: match('m1', ['moi', 'a']) })]));
    store.getState().applyInit(withGames([table('chess', 0)]));
    expect(store.getState().gameInterrupted).toBe('chess');
    store.getState().dismissGameInterrupted();
    expect(store.getState().gameInterrupted).toBeNull();
  });

  test('une interruption signalée le reste aux init suivants, jusqu\'à ce qu\'on l\'ait lue', () => {
    store.getState().applyInit(withGames([table('chess', 5, { match: match('m1', ['moi', 'a']) })]));
    store.getState().applyInit(withGames([table('chess', 0)]));
    store.getState().applyInit(withGames([table('chess', 1)]));
    expect(store.getState().gameInterrupted).toBe('chess');
  });

  test('init : une autre partie à la même table (un autre identifiant) vaut aussi interruption', () => {
    store.getState().applyInit(withGames([table('chess', 5, { match: match('m1', ['moi', 'a']) })]));
    store.getState().applyInit(withGames([table('chess', 1, { match: match('m2', ['moi', 'a']) })]));
    expect(store.getState().gameInterrupted).toBe('chess');
  });

  test('init : la partie qui continue, ou qui a fini pendant la coupure (même identifiant), ou celle des autres, n\'est pas interrompue', () => {
    store.getState().applyInit(withGames([table('chess', 5, { match: match('m1', ['moi', 'a']) }), table('ludo', 2, { match: match('m9', ['a', 'b']) })]));
    store.getState().applyInit(withGames([table('chess', 6, { match: match('m1', ['moi', 'a'], 'ended') })]));
    expect(store.getState().gameInterrupted).toBeNull();
    store.getState().applyInit(withGames([table('ludo', 0)]));
    expect(store.getState().gameInterrupted).toBeNull();
  });

  test('init : une partie finie qu\'on avait vue et que le serveur n\'a plus n\'est pas une interruption (elle était finie)', () => {
    store.getState().applyInit(withGames([table('chess', 5, { match: match('m1', ['moi', 'a'], 'ended') })]));
    store.getState().applyInit(withGames([table('chess', 0)]));
    expect(store.getState().gameInterrupted).toBeNull();
  });

  test('reset (le bureau quitté) : tout redevient comme au départ', () => {
    store.getState().applyInit(withGames([table('chess', 3)], [invite('i1')]));
    store.getState().openGame('chess');
    store.getState().reset();
    expect(store.getState()).toMatchObject({ games: {}, gameInvites: [], gameOpen: null, gameInterrupted: null });
  });
});
