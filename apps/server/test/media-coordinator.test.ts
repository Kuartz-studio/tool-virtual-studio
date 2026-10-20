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
  const removed: Array<[room: string, identity: string]> = [];
  const backend: MediaBackend = {
    url: 'wss://faux.livekit.test',
    async mintToken(i) {
      minted.push(i);
      return `jeton(${i.room},${i.identity})`;
    },
    async removeParticipant(room, identity) {
      removed.push([room, identity]);
    },
  };
  return { backend, minted, removed };
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

  test('removeParticipant qui échoue : journalisé avec la room et la personne, sans jeton ; apply ne rejette pas', async () => {
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
    await vi.waitFor(() => expect(lines.filter((line) => line.level === 50)).toHaveLength(2));
    expect(lines.filter((line) => line.level === 50)).toEqual(
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
});
