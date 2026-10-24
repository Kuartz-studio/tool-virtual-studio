import { EMPTY_GROUPING, LIVEKIT_TOKEN_TTL_S, type GroupingState, type MediaJoinPayload } from '@bureau/shared';
import { TokenVerifier } from 'livekit-server-sdk';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { createLiveKitBackend, roomServiceUrl, type MediaBackend } from '../src/media/livekit';
import { MediaCoordinator, newBootId, type MediaEvent } from '../src/media/media-coordinator';
import { captureLogs } from './helpers/logs';

const BOOT = 'boot01';
const nameOf = (id: string) => `Nom de ${id}`;

// Les variables d'un projet LiveKit inventé : rien ne part sur le réseau, sauf vers un `fetch` remplacé par le test.
const LIVEKIT = {
  LIVEKIT_URL: 'wss://bureau-test.livekit.test',
  LIVEKIT_API_KEY: 'cle-de-test',
  LIVEKIT_API_SECRET: 'secret-de-test-0123456789-abcdefghij',
};

// Un faux backend qui enregistre ses appels. Ses jetons disent pour quelle room et pour qui ils ont été faits.
function fakeBackend() {
  const minted: Array<{ room: string; identity: string; name: string }> = [];
  // Le droit de parler de chaque jeton fabriqué, dans le même ordre que `minted`.
  const canSpeak: boolean[] = [];
  const removed: Array<[room: string, identity: string]> = [];
  const backend: MediaBackend = {
    url: 'wss://faux.livekit.test',
    async mintToken(i) {
      minted.push({ room: i.room, identity: i.identity, name: i.name });
      canSpeak.push(i.canSpeak ?? true);
      return `jeton(${i.room},${i.identity})`;
    },
    async removeParticipant(room, identity) {
      removed.push([room, identity]);
    },
  };
  return { backend, minted, canSpeak, removed };
}

// Ce que `send` a reçu, et ce que chacun a reçu dans l'ordre : « leave », ou « join <room> ».
function recorder() {
  const sent: Array<{ userId: string; e: MediaEvent }> = [];
  const send = (userId: string, e: MediaEvent) => {
    sent.push({ userId, e });
  };
  const of = (userId: string) => sent.filter((s) => s.userId === userId).map(({ e }) => (e.type === 'join' ? `join ${e.p.room}` : 'leave'));
  return { sent, send, of };
}

// Un état des groupes : ces groupes (id → membres), et ces personnes présentes hors groupe.
function grouping(groups: Record<string, string[]>, alone: string[] = []): GroupingState {
  const assignment: Record<string, string | null> = Object.fromEntries(alone.map((id) => [id, null]));
  const all: GroupingState['groups'] = {};
  for (const [id, members] of Object.entries(groups)) {
    all[id] = { id, members: [...members].sort(), zoneId: null };
    for (const m of members) assignment[m] = id;
  }
  return { assignment, groups: all, pending: {}, nextId: 10 };
}

// Une promesse que le test résout quand il veut.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('MediaCoordinator.apply', () => {
  test('nouveau groupe {A,B} : chacun reçoit join avec la room du groupe', async () => {
    const { backend, minted, removed } = fakeBackend();
    const media = new MediaCoordinator(backend, BOOT);
    const { sent, send } = recorder();

    await media.apply(EMPTY_GROUPING, grouping({ g1: ['a', 'b'] }), send, nameOf);

    const room = `${BOOT}-g1`;
    expect(media.roomFor('g1')).toBe(room);
    expect(sent).toHaveLength(2);
    for (const id of ['a', 'b']) {
      expect(sent.filter((s) => s.userId === id).map((s) => s.e)).toEqual([
        { type: 'join', p: { url: backend.url, room, token: `jeton(${room},${id})` } },
      ]);
    }
    // Le jeton est fait pour la room du groupe, au nom de la personne : identité = son id, nom = son nom affiché.
    expect(minted).toEqual(
      expect.arrayContaining([
        { room, identity: 'a', name: 'Nom de a' },
        { room, identity: 'b', name: 'Nom de b' },
      ]),
    );
    expect(minted).toHaveLength(2);
    expect(removed).toEqual([]);
  });

  test('C rejoint un groupe existant : seul C reçoit join', async () => {
    const { backend, removed } = fakeBackend();
    const media = new MediaCoordinator(backend, BOOT);
    const { sent, send, of } = recorder();

    await media.apply(grouping({ g1: ['a', 'b'] }, ['c']), grouping({ g1: ['a', 'b', 'c'] }), send, nameOf);

    expect(of('c')).toEqual([`join ${BOOT}-g1`]);
    expect(sent).toHaveLength(1);   // A et B ne reçoivent rien : leur room n'a pas changé
    expect(removed).toEqual([]);
  });

  test('A quitte : leave pour A et removeParticipant(room, A)', async () => {
    const { backend, minted, removed } = fakeBackend();
    const media = new MediaCoordinator(backend, BOOT);
    const { sent, send, of } = recorder();

    await media.apply(grouping({ g1: ['a', 'b', 'c'] }), grouping({ g1: ['b', 'c'] }, ['a']), send, nameOf);

    expect(of('a')).toEqual(['leave']);
    expect(sent).toHaveLength(1);
    expect(removed).toEqual([[`${BOOT}-g1`, 'a']]);
    expect(minted).toEqual([]);

    // Parti du bureau (absent du nouvel état, après la fin du délai de grâce ou un retrait) : pareil.
    const again = recorder();
    await media.apply(grouping({ g1: ['b', 'c', 'd'] }), grouping({ g1: ['b', 'c'] }), again.send, nameOf);
    expect(again.of('d')).toEqual(['leave']);
    expect(again.sent).toHaveLength(1);
    expect(removed).toEqual([
      [`${BOOT}-g1`, 'a'],
      [`${BOOT}-g1`, 'd'],
    ]);
  });

  test('fusion : seuls ceux qui changent de room reçoivent leave puis join', async () => {
    const { backend, removed } = fakeBackend();
    const media = new MediaCoordinator(backend, BOOT);
    const { send, of } = recorder();

    // {A,B,C} et {D,E} se rejoignent ; la plus grande partie garde sa room (computeGroups lui donne l'id g1).
    await media.apply(grouping({ g1: ['a', 'b', 'c'], g2: ['d', 'e'] }), grouping({ g1: ['a', 'b', 'c', 'd', 'e'] }), send, nameOf);

    for (const id of ['a', 'b', 'c']) expect(of(id), id).toEqual([]);
    for (const id of ['d', 'e']) expect(of(id), id).toEqual(['leave', `join ${BOOT}-g1`]);
    expect(removed).toEqual(
      expect.arrayContaining([
        [`${BOOT}-g2`, 'd'],
        [`${BOOT}-g2`, 'e'],
      ]),
    );
    expect(removed).toHaveLength(2);
  });

  test('séparation : seuls ceux qui partent dans un nouveau groupe changent de room', async () => {
    const { backend, removed } = fakeBackend();
    const media = new MediaCoordinator(backend, BOOT);
    const { send, of } = recorder();

    await media.apply(grouping({ g1: ['a', 'b', 'c', 'd'] }), grouping({ g1: ['a', 'b'], g3: ['c', 'd'] }), send, nameOf);

    for (const id of ['a', 'b']) expect(of(id), id).toEqual([]);
    for (const id of ['c', 'd']) expect(of(id), id).toEqual(['leave', `join ${BOOT}-g3`]);
    expect(removed).toHaveLength(2);
  });

  test('LiveKit non configuré (backend null) : aucun événement, aucun appel, mais les groupes restent connus', async () => {
    const media = new MediaCoordinator(null, BOOT);
    const { sent, send } = recorder();

    await media.apply(EMPTY_GROUPING, grouping({ g1: ['a', 'b'] }), send, nameOf);
    await media.apply(grouping({ g1: ['a', 'b'] }), grouping({}, ['a', 'b']), send, nameOf);
    await media.apply(grouping({}, ['a', 'b']), grouping({ g2: ['a', 'b'] }), send, nameOf);

    expect(sent).toEqual([]);
    expect(media.groupMembersOf('a')).toEqual(['a', 'b']);   // le chat « À proximité » (tâche 21) en a besoin
    expect(await media.currentJoin('a')).toBeNull();
  });

  // Un avertissement, pas une erreur : le client quitte la room de lui-même en recevant media:leave, le retrait n'est qu'une sûreté.
  // (« Introuvable », la personne déjà partie, est ignoré par le backend : createLiveKitBackend.)
  test('removeParticipant qui échoue : un avertissement (warn) avec la room et la personne, sans jeton ; apply ne rejette pas', async () => {
    const { backend } = fakeBackend();
    const failure = deferred<void>();
    backend.removeParticipant = vi.fn(async () => {
      failure.resolve();
      throw new Error('LiveKit injoignable');
    });
    const { logger, lines } = captureLogs();
    const media = new MediaCoordinator(backend, BOOT, logger);
    const { send, of } = recorder();

    await expect(media.apply(grouping({ g1: ['a', 'b'] }), grouping({ g2: ['a', 'c'] }, ['b']), send, nameOf)).resolves.toBeUndefined();
    expect(of('a')).toEqual(['leave', `join ${BOOT}-g2`]);   // le reste n'en souffre pas
    expect(of('b')).toEqual(['leave']);
    expect(of('c')).toEqual([`join ${BOOT}-g2`]);

    await failure.promise;
    await vi.waitFor(() => expect(lines.filter((line) => line.level === 40)).toHaveLength(2));
    expect(lines.filter((line) => (line.level as number) >= 50)).toEqual([]);
    expect(lines.filter((line) => line.level === 40)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ room: `${BOOT}-g1`, userId: 'a', err: expect.objectContaining({ message: 'LiveKit injoignable' }) }),
        expect.objectContaining({ room: `${BOOT}-g1`, userId: 'b' }),
      ]),
    );
    expect(JSON.stringify(lines)).not.toContain('jeton(');
  });

  test('removeParticipant n\'est pas attendu : un LiveKit lent ne retarde pas les join', async () => {
    const { backend } = fakeBackend();
    backend.removeParticipant = () => new Promise<void>(() => {});   // ne répond jamais
    const media = new MediaCoordinator(backend, BOOT);
    const { send, of } = recorder();

    await media.apply(grouping({ g1: ['a', 'b'], g2: ['c', 'd'] }), grouping({ g1: ['a', 'b', 'c', 'd'] }), send, nameOf);
    expect(of('c')).toEqual(['leave', `join ${BOOT}-g1`]);
  });

  test('un jeton impossible à fabriquer pour une personne : journalisé, les autres reçoivent leur join', async () => {
    const { backend } = fakeBackend();
    const mint = backend.mintToken.bind(backend);
    backend.mintToken = async (i) => {
      if (i.identity === 'b') throw new Error('signature impossible');
      return mint(i);
    };
    const { logger, lines } = captureLogs();
    const media = new MediaCoordinator(backend, BOOT, logger);
    const { send, of } = recorder();

    await expect(media.apply(EMPTY_GROUPING, grouping({ g1: ['a', 'b', 'c'] }), send, nameOf)).resolves.toBeUndefined();
    expect(of('a')).toEqual([`join ${BOOT}-g1`]);
    expect(of('b')).toEqual([]);
    expect(of('c')).toEqual([`join ${BOOT}-g1`]);
    expect(lines.filter((line) => line.level === 50)).toEqual([
      expect.objectContaining({ userId: 'b', room: `${BOOT}-g1`, err: expect.objectContaining({ message: 'signature impossible' }) }),
    ]);
  });

  test('deux apply qui se chevauchent : pas de join pour une room que la personne a déjà quittée', async () => {
    const { backend } = fakeBackend();
    const mints: Array<ReturnType<typeof deferred<string>>> = [];
    backend.mintToken = () => {
      const d = deferred<string>();
      mints.push(d);
      return d.promise;
    };
    const media = new MediaCoordinator(backend, BOOT);
    const { send, of } = recorder();

    const first = media.apply(grouping({}, ['a', 'b']), grouping({ g1: ['a', 'b'] }), send, nameOf);   // jetons en cours…
    await media.apply(grouping({ g1: ['a', 'b'] }), grouping({}, ['a', 'b']), send, nameOf);   // … et le groupe se défait déjà
    for (const d of mints) d.resolve('jeton');
    await first;

    expect(of('a')).toEqual(['leave']);   // jamais de join vers g1, qu'elle a quitté
    expect(of('b')).toEqual(['leave']);
  });
});

describe('MediaCoordinator : room, groupe, join du moment', () => {
  test('roomFor : `${bootId}-${groupId}` ; newBootId : 6 caractères aléatoires', () => {
    expect(new MediaCoordinator(null, 'k3x9qa').roomFor('g12')).toBe('k3x9qa-g12');
    const ids = Array.from({ length: 20 }, () => newBootId());
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{6}$/);
    expect(new Set(ids).size).toBe(20);
  });

  test('groupMembersOf : les membres du groupe, la personne comprise ; [] hors groupe ou inconnue', async () => {
    const media = new MediaCoordinator(fakeBackend().backend, BOOT);
    expect(media.groupMembersOf('a')).toEqual([]);   // avant tout calcul

    await media.apply(EMPTY_GROUPING, grouping({ g1: ['c', 'a', 'b'] }, ['d']), recorder().send, nameOf);
    expect(media.groupMembersOf('b')).toEqual(['a', 'b', 'c']);
    expect(media.groupMembersOf('d')).toEqual([]);
    expect(media.groupMembersOf('inconnu')).toEqual([]);
    expect(media.groupMembersOf('constructor')).toEqual([]);   // pas une propriété héritée

    const members = media.groupMembersOf('a');
    members.push('intrus');   // une copie : la liste rendue ne touche pas l'état
    expect(media.groupMembersOf('a')).toEqual(['a', 'b', 'c']);
  });

  test('currentJoin : la room du groupe du moment, avec un jeton neuf au nom de la personne ; null hors groupe', async () => {
    const { backend, minted } = fakeBackend();
    const media = new MediaCoordinator(backend, BOOT);
    await media.apply(EMPTY_GROUPING, grouping({ g1: ['a', 'b'] }, ['c']), recorder().send, nameOf);
    minted.length = 0;

    expect(await media.currentJoin('a')).toEqual({ url: backend.url, room: `${BOOT}-g1`, token: `jeton(${BOOT}-g1,a)` });
    expect(minted).toEqual([{ room: `${BOOT}-g1`, identity: 'a', name: 'Nom de a' }]);   // un jeton neuf, à l'appel
    expect(await media.currentJoin('c')).toBeNull();
    expect(await media.currentJoin('inconnu')).toBeNull();
    expect(minted).toHaveLength(1);
  });

  test('currentJoin : le groupe change pendant la fabrication du jeton → null (apply a envoyé ce qu\'il fallait)', async () => {
    const { backend } = fakeBackend();
    const media = new MediaCoordinator(backend, BOOT);
    await media.apply(EMPTY_GROUPING, grouping({ g1: ['a', 'b'] }), recorder().send, nameOf);

    const slow = deferred<string>();
    backend.mintToken = () => slow.promise;
    const join = media.currentJoin('a');
    backend.mintToken = async (i) => `jeton(${i.room},${i.identity})`;
    await media.apply(grouping({ g1: ['a', 'b'] }), grouping({ g2: ['a', 'c'] }, ['b']), recorder().send, nameOf);
    slow.resolve('jeton périmé');

    expect(await join).toBeNull();   // jamais un jeton pour g1, qu'elle vient de quitter
    expect(await media.currentJoin('a')).toMatchObject({ room: `${BOOT}-g2` });
  });
});

describe('createLiveKitBackend', () => {
  test('null sans l\'une des trois variables LIVEKIT_*', () => {
    expect(createLiveKitBackend({})).toBeNull();
    for (const name of ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const) {
      expect(createLiveKitBackend({ ...LIVEKIT, [name]: undefined }), name).toBeNull();
    }
    expect(createLiveKitBackend(LIVEKIT)).toMatchObject({ url: LIVEKIT.LIVEKIT_URL });
  });

  test('vrai jeton livekit-server-sdk : room et durée', async () => {
    const backend = createLiveKitBackend(LIVEKIT)!;
    const media = new MediaCoordinator(backend, BOOT);
    const { sent, send } = recorder();

    const before = Math.floor(Date.now() / 1000);
    await media.apply(EMPTY_GROUPING, grouping({ g1: ['a', 'b'] }), send, nameOf);
    const after = Math.ceil(Date.now() / 1000);

    const join = sent.find((s) => s.userId === 'a')!.e as { type: 'join'; p: MediaJoinPayload };
    expect(join.p).toMatchObject({ url: LIVEKIT.LIVEKIT_URL, room: `${BOOT}-g1` });
    const claims = await new TokenVerifier(LIVEKIT.LIVEKIT_API_KEY, LIVEKIT.LIVEKIT_API_SECRET).verify(join.p.token);
    // Une seule room, et rien de plus que rejoindre, publier et recevoir (pas de données).
    expect(claims.video).toEqual({ roomJoin: true, room: `${BOOT}-g1`, canPublish: true, canSubscribe: true, canPublishData: false });
    expect(claims).toMatchObject({ sub: 'a', name: 'Nom de a', iss: LIVEKIT.LIVEKIT_API_KEY });
    // livekit-server-sdk ne pose pas `iat` : son `nbf` est l'heure de fabrication.
    const issuedAt = claims.iat ?? claims.nbf!;
    expect(claims.exp! - issuedAt).toBeLessThanOrEqual(LIVEKIT_TOKEN_TTL_S);
    expect(claims.exp! - issuedAt).toBeGreaterThan(LIVEKIT_TOKEN_TTL_S - 2);
    expect(issuedAt).toBeGreaterThanOrEqual(before);
    expect(claims.exp).toBeLessThanOrEqual(after + LIVEKIT_TOKEN_TTL_S);

    // Signé avec le secret : une autre clé ne le vérifie pas.
    await expect(new TokenVerifier(LIVEKIT.LIVEKIT_API_KEY, 'un-autre-secret-0123456789-abcdefghij').verify(join.p.token)).rejects.toThrow();
  });

  test('roomServiceUrl : l\'API HTTP du projet d\'après LIVEKIT_URL ; une adresse inutilisable arrête le démarrage', () => {
    expect(roomServiceUrl('wss://bureau.livekit.cloud')).toBe('https://bureau.livekit.cloud');
    expect(roomServiceUrl('ws://localhost:7880')).toBe('http://localhost:7880');
    expect(roomServiceUrl('https://bureau.livekit.cloud/')).toBe('https://bureau.livekit.cloud');
    expect(roomServiceUrl('http://127.0.0.1:7880')).toBe('http://127.0.0.1:7880');
    for (const url of ['bureau.livekit.cloud', 'ftp://bureau.livekit.cloud', 'wss//bureau']) {
      expect(() => roomServiceUrl(url), url).toThrow(/LIVEKIT_URL/);
      expect(() => createLiveKitBackend({ ...LIVEKIT, LIVEKIT_URL: url }), url).toThrow(/LIVEKIT_URL/);
    }
  });

  test('removeParticipant : RemoveParticipant sur l\'API HTTP ; « introuvable » ignoré, toute autre erreur rejetée', async () => {
    const backend = createLiveKitBackend({ ...LIVEKIT, LIVEKIT_URL: 'ws://livekit.test:7880' })!;
    const twirp = (status: number, body: object) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    onTestFinished(() => {
      fetchSpy.mockRestore();
    });

    fetchSpy.mockResolvedValueOnce(twirp(200, {}));
    await backend.removeParticipant(`${BOOT}-g1`, 'a');
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('http://livekit.test:7880/twirp/livekit.RoomService/RemoveParticipant');
    expect(JSON.parse(String(init!.body))).toMatchObject({ room: `${BOOT}-g1`, identity: 'a' });

    // La personne a déjà quitté la room (ou ne l'avait pas encore rejointe) : rien à faire.
    fetchSpy.mockResolvedValueOnce(twirp(404, { code: 'not_found', msg: 'participant not found' }));
    await expect(backend.removeParticipant(`${BOOT}-g1`, 'a')).resolves.toBeUndefined();

    fetchSpy.mockResolvedValueOnce(twirp(401, { code: 'unauthenticated', msg: 'invalid token' }));
    await expect(backend.removeParticipant(`${BOOT}-g1`, 'a')).rejects.toThrow('invalid token');
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(backend.removeParticipant(`${BOOT}-g1`, 'a')).rejects.toThrow('fetch failed');
  });

  // Un retrait qui traîne peut arriver après le retour de la personne dans la même room, et l'en chasser : il a peu de temps. Par
  // défaut, livekit-server-sdk attend 10 s, et sur LiveKit Cloud réessaie dans deux autres régions (près de 30 s en tout). Avec un
  // délai de moins de 5 s, il ne fait qu'un essai.
  test('removeParticipant : un seul essai, de 3 s au plus, même sur LiveKit Cloud', async () => {
    const backend = createLiveKitBackend({ ...LIVEKIT, LIVEKIT_URL: 'wss://bureau.livekit.cloud' })!;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    onTestFinished(() => {
      fetchSpy.mockRestore();
      timeoutSpy.mockRestore();
    });

    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
    await expect(backend.removeParticipant(`${BOOT}-g1`, 'a')).rejects.toThrow('fetch failed');
    expect(fetchSpy).toHaveBeenCalledOnce();   // ni découverte des régions, ni autre essai
    expect(String(fetchSpy.mock.calls[0]![0])).toBe('https://bureau.livekit.cloud/twirp/livekit.RoomService/RemoveParticipant');
    expect(timeoutSpy).toHaveBeenCalledWith(3000);
    expect(fetchSpy.mock.calls[0]![1]!.signal).toBe(timeoutSpy.mock.results[0]!.value);
  });
});

describe('le droit de parler (canSpeak)', () => {
  test('le jeton le dit : fabriqué avec canSpeak, ou sans le droit de parler', async () => {
    const { backend, canSpeak } = fakeBackend();
    const media = new MediaCoordinator(backend, BOOT, undefined, { canSpeak: (id) => id !== 'b' });
    const { send } = recorder();
    await media.apply(grouping({}, ['a', 'b']), grouping({ g1: ['a', 'b'] }), send, nameOf);
    expect(canSpeak.sort()).toEqual([false, true]);
    await media.currentJoin('b');
    expect(canSpeak.at(-1)).toBe(false);
  });

  test('le droit change dans la room : la personne la quitte et la rejoint avec un jeton neuf ; les autres ne bougent pas', async () => {
    const { backend, canSpeak, removed } = fakeBackend();
    let allowed = true;
    const media = new MediaCoordinator(backend, BOOT, undefined, { canSpeak: (id) => id !== 'b' || allowed });
    const { send, of } = recorder();
    const together = grouping({ g1: ['a', 'b'] });
    await media.apply(grouping({}, ['a', 'b']), together, send, nameOf);
    expect(of('b')).toEqual(['join boot01-g1']);

    // Rien ne change : rien n'est renvoyé.
    await media.apply(together, together, send, nameOf);
    expect(of('b')).toEqual(['join boot01-g1']);

    // B n'est plus entendu : un jeton sans micro, dans la même room.
    allowed = false;
    await media.apply(together, together, send, nameOf);
    expect(of('b')).toEqual(['join boot01-g1', 'leave', 'join boot01-g1']);
    expect(of('a')).toEqual(['join boot01-g1']);
    expect(canSpeak.at(-1)).toBe(false);
    expect(removed).toEqual([['boot01-g1', 'b']]);

    // Et une seule fois : le droit n'a plus changé depuis.
    await media.apply(together, together, send, nameOf);
    expect(of('b')).toHaveLength(3);

    allowed = true;
    await media.apply(together, together, send, nameOf);
    expect(of('b')).toEqual(['join boot01-g1', 'leave', 'join boot01-g1', 'leave', 'join boot01-g1']);
    expect(canSpeak.at(-1)).toBe(true);
  });

  test('hors groupe, le droit ne sert à rien : rien n\'est envoyé quand il change', async () => {
    const { backend } = fakeBackend();
    let allowed = true;
    const media = new MediaCoordinator(backend, BOOT, undefined, { canSpeak: () => allowed });
    const { send, sent } = recorder();
    const alone = grouping({}, ['a']);
    await media.apply(alone, alone, send, nameOf);
    allowed = false;
    await media.apply(alone, alone, send, nameOf);
    expect(sent).toEqual([]);
  });
});

describe('parquer et reprendre', () => {
  // Un faux backend qui sait parquer : il enregistre, dans l'ordre, chaque appel (« park room id », « resume room id resume canSpeak », « remove
  // room id »), et un test peut retenir les appels jusqu'à ce qu'il les libère.
  function parkingBackend() {
    const calls: string[] = [];
    let hold: Promise<void> | null = null;
    const wait = async () => {
      if (hold) await hold;
    };
    const backend: MediaBackend = {
      url: 'wss://faux.livekit.test',
      mintToken: async (i) => `jeton(${i.room},${i.identity})`,
      removeParticipant: async (room, identity) => {
        await wait();
        calls.push(`remove ${room} ${identity}`);
      },
      park: async (room, identity) => {
        await wait();
        calls.push(`park ${room} ${identity}`);
      },
      resume: async (room, identity, { resume, canSpeak }) => {
        calls.push(`resume ${room} ${identity} ${resume} ${canSpeak}`);
      },
    };
    const holdCalls = () => {
      const d = deferred<void>();
      hold = d.promise;
      return () => {
        hold = null;
        d.resolve();
      };
    };
    return { backend, calls, holdCalls };
  }

  function fakeTimers() {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
  }

  test('quitter un groupe, encore au bureau : media:leave avec park, le backend la parque, et la retire parkRemoveMs plus tard', async () => {
    fakeTimers();
    const { backend, calls } = parkingBackend();
    const media = new MediaCoordinator(backend, BOOT, undefined, { parkRemoveMs: 65_000 });
    const { sent, send } = recorder();
    await media.apply(grouping({}, ['a', 'b']), grouping({ g1: ['a', 'b'] }), send, nameOf);
    sent.length = 0;

    await media.apply(grouping({ g1: ['a', 'b'] }), grouping({}, ['a', 'b']), send, nameOf);
    expect(sent).toEqual([
      { userId: 'a', e: { type: 'leave', park: true } },
      { userId: 'b', e: { type: 'leave', park: true } },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([`park ${BOOT}-g1 a`, `park ${BOOT}-g1 b`]);
    expect(media.parkedRoomOf('a')).toBe(`${BOOT}-g1`);

    await vi.advanceTimersByTimeAsync(64_999);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.slice(2).sort()).toEqual([`remove ${BOOT}-g1 a`, `remove ${BOOT}-g1 b`]);
    expect(media.parkedRoomOf('a')).toBeNull();
  });

  test('revenir dans la room où l\'on est parqué : media:join avec resume ; le backend la reprend, et ne la retire plus', async () => {
    fakeTimers();
    const { backend, calls } = parkingBackend();
    const media = new MediaCoordinator(backend, BOOT, undefined, { parkRemoveMs: 65_000 });
    const { send, of, sent } = recorder();
    const together = grouping({ g1: ['a', 'b'] });
    await media.apply(grouping({}, ['a', 'b']), together, send, nameOf);
    await media.apply(together, grouping({}, ['a', 'b']), send, nameOf);
    sent.length = 0;

    await media.apply(grouping({}, ['a', 'b']), together, send, nameOf);
    const joins = sent.map(({ userId, e }) => ({ userId, p: (e as { type: 'join'; p: MediaJoinPayload }).p }));
    expect(joins.map(({ userId, p }) => [userId, p.room, p.token])).toEqual([
      ['a', `${BOOT}-g1`, `jeton(${BOOT}-g1,a)`],
      ['b', `${BOOT}-g1`, `jeton(${BOOT}-g1,b)`],
    ]);
    // Chaque reprise a son numéro, neuf : le client n'attend jamais l'attribut d'une reprise d'avant.
    const [ra, rb] = joins.map(({ p }) => p.resume);
    expect(ra).toBeDefined();
    expect(new Set([ra, rb]).size).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([`park ${BOOT}-g1 a`, `park ${BOOT}-g1 b`, `resume ${BOOT}-g1 a ${ra} true`, `resume ${BOOT}-g1 b ${rb} true`]);
    expect(media.parkedRoomOf('a')).toBeNull();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls.filter((c) => c.startsWith('remove'))).toEqual([]);
    expect(of('a')).toEqual([`join ${BOOT}-g1`]);
  });

  test('rejoindre une autre room : un join sans resume ; la connexion parquée est retirée à son heure', async () => {
    fakeTimers();
    const { backend, calls } = parkingBackend();
    const media = new MediaCoordinator(backend, BOOT, undefined, { parkRemoveMs: 65_000 });
    const { send, sent } = recorder();
    await media.apply(grouping({}, ['a', 'b', 'c']), grouping({ g1: ['a', 'b'] }, ['c']), send, nameOf);
    await media.apply(grouping({ g1: ['a', 'b'] }, ['c']), grouping({ g2: ['a', 'c'] }, ['b']), send, nameOf);
    const joinOfA = sent.filter(({ userId, e }) => userId === 'a' && e.type === 'join').at(-1)!.e as { type: 'join'; p: MediaJoinPayload };
    expect(joinOfA.p).toEqual({ url: backend.url, room: `${BOOT}-g2`, token: `jeton(${BOOT}-g2,a)` });
    await vi.advanceTimersByTimeAsync(65_000);
    expect(calls).toEqual(expect.arrayContaining([`park ${BOOT}-g1 a`, `remove ${BOOT}-g1 a`]));
  });

  test('qui sort de toute conversation (canPark faux) ou du bureau : media:leave sans park, et retrait tout de suite', async () => {
    const { backend, calls } = parkingBackend();
    const media = new MediaCoordinator(backend, BOOT, undefined, { canPark: (id) => id !== 'b' });
    const { sent, send } = recorder();
    await media.apply(grouping({}, ['a', 'b', 'c']), grouping({ g1: ['a', 'b', 'c'] }), send, nameOf);
    sent.length = 0;
    // B passe en Ne pas déranger ; C quitte le bureau (absent du nouvel état) ; A reste seul.
    await media.apply(grouping({ g1: ['a', 'b', 'c'] }), grouping({}, ['a', 'b']), send, nameOf);
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(sent).toEqual([
      { userId: 'a', e: { type: 'leave', park: true } },
      { userId: 'b', e: { type: 'leave' } },
      { userId: 'c', e: { type: 'leave' } },
    ]);
    expect(calls.sort()).toEqual([`park ${BOOT}-g1 a`, `remove ${BOOT}-g1 b`, `remove ${BOOT}-g1 c`]);
  });

  test('les appels d\'une personne dans une room se suivent : la reprise attend un parcage lent', async () => {
    const { backend, calls, holdCalls } = parkingBackend();
    const media = new MediaCoordinator(backend, BOOT);
    const { send, of } = recorder();
    const together = grouping({ g1: ['a', 'b'] });
    await media.apply(grouping({}, ['a', 'b']), together, send, nameOf);
    const release = holdCalls();
    await media.apply(together, grouping({}, ['a', 'b']), send, nameOf);   // les parcages attendent LiveKit…
    await media.apply(grouping({}, ['a', 'b']), together, send, nameOf);   // … et ils reviennent déjà
    // Le join part sans attendre LiveKit (le client attend l'attribut de la reprise) ; mais la reprise attend le parcage.
    expect(of('a')).toEqual([`join ${BOOT}-g1`, 'leave', `join ${BOOT}-g1`]);
    expect(calls).toEqual([]);
    release();
    await vi.waitFor(() => expect(calls).toHaveLength(4));
    expect(calls.map((c) => c.split(' ').slice(0, 3).join(' '))).toEqual([`park ${BOOT}-g1 a`, `park ${BOOT}-g1 b`, `resume ${BOOT}-g1 a`, `resume ${BOOT}-g1 b`]);
  });

  test('un retrait encore en cours (une sortie pour de bon) : le join vers la même room l\'attend, il ne tombe jamais sur la connexion d\'après', async () => {
    const { backend, calls, holdCalls } = parkingBackend();
    let out = true;
    const media = new MediaCoordinator(backend, BOOT, undefined, { canPark: () => !out });
    const { send, of } = recorder();
    const together = grouping({ g1: ['a', 'b'] });
    out = false;
    await media.apply(grouping({}, ['a', 'b']), together, send, nameOf);
    out = true;
    const release = holdCalls();
    await media.apply(together, grouping({}, ['a', 'b']), send, nameOf);   // Ne pas déranger : retirés, et LiveKit est lent…
    out = false;
    const back = media.apply(grouping({}, ['a', 'b']), together, send, nameOf);   // … et ils reviennent aussitôt
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(of('a')).toEqual([`join ${BOOT}-g1`, 'leave']);   // pas encore de join : le retrait n'a pas fini
    release();
    await back;
    expect(of('a')).toEqual([`join ${BOOT}-g1`, 'leave', `join ${BOOT}-g1`]);
    expect(calls).toEqual([`remove ${BOOT}-g1 a`, `remove ${BOOT}-g1 b`]);
  });

  test('le droit de parler change dans la room : elle est parquée puis reprise, avec ses nouveaux droits ; rien n\'est retiré', async () => {
    const { backend, calls } = parkingBackend();
    let allowed = true;
    const media = new MediaCoordinator(backend, BOOT, undefined, { canSpeak: (id) => id !== 'b' || allowed });
    const { send, of } = recorder();
    const together = grouping({ g1: ['a', 'b'] });
    await media.apply(grouping({}, ['a', 'b']), together, send, nameOf);
    allowed = false;
    await media.apply(together, together, send, nameOf);
    expect(of('b')).toEqual([`join ${BOOT}-g1`, 'leave', `join ${BOOT}-g1`]);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]).toBe(`park ${BOOT}-g1 b`);
    expect(calls[1]).toMatch(new RegExp(`^resume ${BOOT}-g1 b \\d+ false$`));
  });
});

describe('le parcage chez LiveKit (UpdateParticipant)', () => {
  test('parquer retire tous les droits et pose l\'attribut ; reprendre rend ceux du jeton et l\'attribut de la reprise ; « introuvable » ignoré', async () => {
    const backend = createLiveKitBackend({ ...LIVEKIT, LIVEKIT_URL: 'ws://livekit.test:7880' })!;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    onTestFinished(() => {
      fetchSpy.mockRestore();
    });
    const twirp = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    fetchSpy.mockImplementation(async () => twirp(200, {}));

    await backend.park!(`${BOOT}-g1`, 'a');
    await backend.resume!(`${BOOT}-g1`, 'a', { canSpeak: true, resume: '7' });
    await backend.resume!(`${BOOT}-g1`, 'b', { canSpeak: false, resume: '8' });
    const bodies = fetchSpy.mock.calls.map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init!.body)) as Record<string, unknown> }));
    expect(bodies.every(({ url }) => url === 'http://livekit.test:7880/twirp/livekit.RoomService/UpdateParticipant')).toBe(true);
    expect(bodies[0]!.body).toMatchObject({ room: `${BOOT}-g1`, identity: 'a', attributes: { 'bureau.parked': '1' } });
    expect(bodies[0]!.body.permission ?? {}).not.toHaveProperty('canSubscribe', true);
    expect(bodies[0]!.body.permission ?? {}).not.toHaveProperty('canPublish', true);
    expect(bodies[1]!.body).toMatchObject({
      identity: 'a',
      permission: { canSubscribe: true, canPublish: true },
      attributes: { 'bureau.parked': '', 'bureau.resume': '7' },
    });
    expect((bodies[1]!.body.permission as Record<string, unknown>).canPublishSources ?? []).toEqual([]);
    // Sans droit de parler : les mêmes sources que son jeton (tout, sauf le micro).
    expect((bodies[2]!.body.permission as { canPublishSources: string[] }).canPublishSources).toEqual(expect.arrayContaining(['CAMERA', 'SCREEN_SHARE']));
    expect((bodies[2]!.body.permission as { canPublishSources: string[] }).canPublishSources).not.toContain('MICROPHONE');

    fetchSpy.mockResolvedValueOnce(twirp(404, { code: 'not_found', msg: 'participant not found' }));
    await expect(backend.park!(`${BOOT}-g1`, 'a')).resolves.toBeUndefined();
    fetchSpy.mockResolvedValueOnce(twirp(401, { code: 'unauthenticated', msg: 'invalid token' }));
    await expect(backend.resume!(`${BOOT}-g1`, 'a', { canSpeak: true, resume: '9' })).rejects.toThrow('invalid token');
  });
});

describe('le jeton LiveKit sans droit de parler', () => {
  test('il permet la caméra et le partage d\'écran, pas le micro ; avec le droit de parler : tout (aucune restriction de source)', async () => {
    const backend = createLiveKitBackend(LIVEKIT)!;
    const verifier = new TokenVerifier(LIVEKIT.LIVEKIT_API_KEY, LIVEKIT.LIVEKIT_API_SECRET);
    const mute = await verifier.verify(await backend.mintToken({ room: 'r', identity: 'b', name: 'B', canSpeak: false }));
    expect(mute.video?.canPublish).toBe(true);
    expect(mute.video?.canPublishSources).toEqual(expect.arrayContaining(['camera', 'screen_share']));
    expect(mute.video?.canPublishSources).not.toContain('microphone');
    const free = await verifier.verify(await backend.mintToken({ room: 'r', identity: 'a', name: 'A' }));
    expect(free.video?.canPublishSources ?? []).toEqual([]);
  });
});
