import {
  CLOSE_RANGE_GROUPING,
  DEV_OFFICE,
  GROUP_DEBOUNCE_MS,
  buildTiledMap,
  busyZoneIds,
  parseOfficeMap,
  type ConversationLockNotice,
} from '@bureau/shared';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import type { MediaBackend } from '../src/media/livekit';
import { MediaCoordinator, type MediaEvent } from '../src/media/media-coordinator';
import { startGroupTicks } from '../src/realtime/handlers';
import { World } from '../src/realtime/world';
import { captureLogs } from './helpers/logs';

// Les conversations verrouillées dans la boucle des groupes (startGroupTicks) : un monde et une horloge qu'on avance à la main, un
// coordinateur sur un faux LiveKit qui sait parquer, et ce que chacun reçoit (consignes média, annonces du verrou). La carte de développement,
// avec le cercle serré des tests (3 cases, à l'arrêt).
const map = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
const ROOM = map.zones.find((z) => z.type === 'private')!.id;
const at = (tx: number, ty: number) => ({ x: tx * 32 + 16, y: ty * 32 + 16 });
const TICK = 100;

function setup() {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const clock = { t: 10_000 };
  const world = new World(map, () => clock.t);
  const backend: MediaBackend = {
    url: 'wss://faux.livekit.test',
    mintToken: async ({ room, identity }) => `jeton(${room},${identity})`,
    removeParticipant: async () => {},
    park: async () => {},
    resume: async () => {},
  };
  const coordinator = new MediaCoordinator(backend, 'boot01', undefined, { canPark: (id) => world.canConverse(id) });
  // Ce que chacun reçoit : « join <room> », « leave », « park » (media:leave avec park), et les annonces du verrou.
  const media: Record<string, string[]> = {};
  const notices: Record<string, ConversationLockNotice[]> = {};
  const send = (userId: string, e: MediaEvent) => {
    (media[userId] ??= []).push(e.type === 'join' ? `join ${e.p.room}` : e.park ? 'park' : 'leave');
  };
  const { logger } = captureLogs();
  const loop = startGroupTicks({
    world,
    map,
    coordinator,
    send,
    nameOf: (id) => `Nom de ${id}`,
    groupsMs: TICK,
    grouping: CLOSE_RANGE_GROUPING,
    notifyLock: (userId, notice) => (notices[userId] ??= []).push(notice),
    now: () => clock.t,
    clock: () => 1_700_000_000_000,
    logger,
  });
  onTestFinished(loop.stop);
  const place = (id: string, spot: { x: number; y: number }) => {
    if (world.get(id)) world.teleport(id, spot.x, spot.y);
    else world.join({ id, name: `Nom de ${id}`, avatarKey: null, ...spot, dir: 'down', status: 'available' });
  };
  // Avance l'horloge du monde et les minuteurs de `ms`, un tour de calcul à la fois.
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += TICK) {
      clock.t += TICK;
      await vi.advanceTimersByTimeAsync(TICK);
    }
  };
  const groupOf = (id: string) => loop.state().assignment[id] ?? null;
  return { world, loop, media, notices, place, advance, groupOf, coordinator };
}

// A et B côte à côte et arrêtés, ensemble dans g1.
async function together() {
  const s = setup();
  s.place('a', at(4, 7));
  s.place('b', at(6, 7));
  await s.advance(GROUP_DEBOUNCE_MS + 2 * TICK);
  expect(s.groupOf('a')).toBe('g1');
  expect(s.groupOf('b')).toBe('g1');
  return s;
}

describe('verrouiller une conversation', () => {
  test('les deux l\'apprennent (qui, quand) ; rien n\'est coupé : la même room, aucune consigne média', async () => {
    const s = await together();
    const before = structuredClone(s.media);
    expect(s.loop.command('a', { type: 'lock' })).toEqual({ ok: true });
    const lock = { id: 'g1', members: ['a', 'b'], by: { id: 'a', name: 'Nom de a' }, at: 1_700_000_000_000 };
    for (const id of ['a', 'b']) expect(s.notices[id]).toEqual([{ lock, cause: 'locked', by: { id: 'a', name: 'Nom de a' } }]);
    expect(s.loop.lockOf('b')).toEqual(lock);
    await s.advance(1000);
    expect(s.media).toEqual(before);
    expect(s.groupOf('a')).toBe('g1');
    // Déjà verrouillée : rien ne change, et personne n'est prévenu une seconde fois.
    expect(s.loop.command('b', { type: 'lock' })).toEqual({ ok: true });
    expect(s.notices.a).toHaveLength(1);
  });

  test('ses membres restent ensemble où qu\'ils aillent, même dans une salle ; elle n\'occupe aucune zone', async () => {
    const s = await together();
    s.loop.command('a', { type: 'lock' });
    s.place('b', at(20, 13));   // loin dans l'open space
    await s.advance(2000);
    expect([s.groupOf('a'), s.groupOf('b')]).toEqual(['g1', 'g1']);
    s.place('a', at(9, 2));   // dans la salle de réunion
    await s.advance(2000);
    expect([s.groupOf('a'), s.groupOf('b')]).toEqual(['g1', 'g1']);
    expect(s.loop.state().groups.g1?.zoneId).toBeNull();
    expect(busyZoneIds(s.loop.state())).toEqual(new Set());
    expect(s.media.b).toEqual(['join boot01-g1']);
  });

  test('personne ne la rejoint par proximité, et ses membres ne rejoignent aucun autre groupe', async () => {
    const s = await together();
    s.loop.command('a', { type: 'lock' });
    s.place('c', at(5, 8));   // collé à eux
    await s.advance(2000);
    expect(s.groupOf('c')).toBeNull();
    expect(s.loop.state().groups.g1?.members).toEqual(['a', 'b']);
    // A s'approche de D et E, qui se parlent : ils restent entre eux, A reste avec B.
    s.place('d', at(14, 13));
    s.place('e', at(16, 13));
    await s.advance(1000);
    s.place('a', at(15, 14));
    await s.advance(2000);
    expect(s.groupOf('a')).toBe('g1');
    expect(s.loop.state().groups[s.groupOf('d')!]?.members).toEqual(['d', 'e']);
  });

  test('dans une salle, ceux qui ne sont pas verrouillés forment leur groupe sans eux', async () => {
    const s = await together();
    s.loop.command('a', { type: 'lock' });
    s.place('a', at(9, 2));
    s.place('c', at(11, 2));
    s.place('d', at(12, 3));
    await s.advance(1000);
    const room = s.groupOf('c');
    expect(room).not.toBeNull();
    expect(s.loop.state().groups[room!]).toMatchObject({ members: ['c', 'd'], zoneId: ROOM });
    expect(s.groupOf('a')).toBe('g1');
  });

  test('refusée hors d\'une conversation à deux : no_group ; déverrouiller ou quitter sans verrou : not_locked', async () => {
    const s = setup();
    s.place('a', at(4, 7));
    await s.advance(1000);
    expect(s.loop.command('a', { type: 'lock' })).toEqual({ ok: false, error: 'no_group' });
    expect(s.loop.command('a', { type: 'unlock' })).toEqual({ ok: false, error: 'not_locked' });
    expect(s.loop.command('a', { type: 'leave' })).toEqual({ ok: false, error: 'not_locked' });
    // En attente de rejoindre un groupe (pas encore dedans) : pas encore de conversation à verrouiller.
    s.place('b', at(6, 7));
    await s.advance(TICK);
    expect(s.loop.command('a', { type: 'lock' })).toEqual({ ok: false, error: 'no_group' });
    expect(s.notices).toEqual({});
  });
});

describe('déverrouiller, quitter, sortir', () => {
  test('déverrouiller : pour tous ; encore ensemble, ils gardent la room, sans coupure', async () => {
    const s = await together();
    s.loop.command('a', { type: 'lock' });
    expect(s.loop.command('b', { type: 'unlock' })).toEqual({ ok: true });
    for (const id of ['a', 'b']) expect(s.notices[id]!.at(-1)).toEqual({ lock: null, cause: 'unlocked', by: { id: 'b', name: 'Nom de b' } });
    expect(s.loop.lockOf('a')).toBeNull();
    await s.advance(2000);
    expect([s.groupOf('a'), s.groupOf('b')]).toEqual(['g1', 'g1']);
    expect(s.media.a).toEqual(['join boot01-g1']);
  });

  test('déverrouiller loin l\'un de l\'autre : ils quittent la room comme on quitte un groupe (500 ms), en la parquant', async () => {
    const s = await together();
    s.loop.command('a', { type: 'lock' });
    s.place('b', at(20, 13));
    await s.advance(1000);
    s.loop.command('a', { type: 'unlock' });
    await s.advance(TICK * 2);
    expect(s.groupOf('a')).toBe('g1');   // l'attente de 500 ms
    await s.advance(GROUP_DEBOUNCE_MS);
    expect([s.groupOf('a'), s.groupOf('b')]).toEqual([null, null]);
    expect(s.media.a).toEqual(['join boot01-g1', 'park']);
    expect(s.media.b).toEqual(['join boot01-g1', 'park']);
  });

  test('« Quitter » à trois : lui seul en sort (sa connexion parquée) ; les deux autres continuent, verrouillés', async () => {
    const s = await together();
    s.place('c', at(8, 7));
    await s.advance(GROUP_DEBOUNCE_MS + 2 * TICK);
    s.loop.command('a', { type: 'lock' });
    expect(s.loop.command('c', { type: 'leave' })).toEqual({ ok: true });
    const rest = { id: 'g1', members: ['a', 'b'], by: { id: 'a', name: 'Nom de a' }, at: 1_700_000_000_000 };
    expect(s.notices.c!.at(-1)).toEqual({ lock: null, cause: 'quit', by: { id: 'c', name: 'Nom de c' } });
    for (const id of ['a', 'b']) expect(s.notices[id]!.at(-1)).toEqual({ lock: rest, cause: 'left', by: { id: 'c', name: 'Nom de c' } });
    await s.advance(TICK * 2);
    expect(s.groupOf('c')).toBeNull();
    expect(s.media.c).toEqual(['join boot01-g1', 'park']);
    // Toujours à côté d'eux, C ne les rejoint pas : la conversation reste verrouillée.
    await s.advance(2000);
    expect(s.groupOf('c')).toBeNull();
    expect(s.groupOf('a')).toBe('g1');
  });

  test('« Quitter » à deux : la conversation n\'est plus verrouillée ; celui qui reste, seul, quitte la room aussi', async () => {
    const s = await together();
    s.loop.command('a', { type: 'lock' });
    s.place('b', at(20, 13));
    await s.advance(1000);
    s.loop.command('b', { type: 'leave' });
    expect(s.notices.b!.at(-1)).toMatchObject({ lock: null, cause: 'quit' });
    expect(s.notices.a!.at(-1)).toEqual({ lock: null, cause: 'ended', by: { id: 'b', name: 'Nom de b' } });
    await s.advance(TICK * 2);
    expect([s.groupOf('a'), s.groupOf('b')]).toEqual([null, null]);
  });

  test('Ne pas déranger fait sortir du verrou (et de la room, pour de bon) ; une coupure plus courte que le délai de grâce, non', async () => {
    const s = await together();
    s.place('c', at(8, 7));
    await s.advance(GROUP_DEBOUNCE_MS + 2 * TICK);
    s.loop.command('a', { type: 'lock' });
    s.world.setStatus('c', 'dnd');
    await s.advance(TICK * 2);
    expect(s.notices.c!.at(-1)).toMatchObject({ lock: null, cause: 'quit' });
    expect(s.notices.a!.at(-1)).toMatchObject({ lock: { members: ['a', 'b'] }, cause: 'left', by: { id: 'c' } });
    expect(s.media.c).toEqual(['join boot01-g1', 'leave']);   // hors de toute conversation : pas de connexion parquée
    // Parti du bureau (la fin du délai de grâce : le monde l'a retiré) : il en sort aussi, et le verrou s'arrête.
    s.world.leave('b');
    await s.advance(TICK * 2);
    expect(s.notices.a!.at(-1)).toEqual({ lock: null, cause: 'ended', by: { id: 'b', name: 'Nom de b' } });
  });

  test('l\'id d\'une conversation verrouillée n\'est jamais repris par un autre groupe', async () => {
    const s = await together();
    s.loop.command('a', { type: 'lock' });
    s.place('a', at(2, 13));
    s.place('b', at(3, 13));
    // D'autres se groupent, se séparent, se regroupent : jamais sous g1.
    for (const spot of [at(14, 7), at(20, 7), at(15, 7)]) {
      s.place('c', at(13, 7));
      s.place('d', spot);
      await s.advance(1000);
      expect(s.groupOf('c')).not.toBe('g1');
    }
    expect(s.loop.state().groups.g1?.members).toEqual(['a', 'b']);
  });
});
