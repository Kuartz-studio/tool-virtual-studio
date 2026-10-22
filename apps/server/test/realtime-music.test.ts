import { freeSpotIn, MUSIC_RATE_MS, placeByKey, type RoomMusic } from '@bureau/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { captureLogs } from './helpers/logs';
import { enter, nextEvent, record, sleep, startTestServer, type TestServer, type TestServerOptions } from './helpers/realtime';

// La musique de chaque pièce, partagée par tous ceux qui sont dedans : on la règle depuis la pièce (la touche E près de l'enceinte, ou le bouton de la
// puce du lieu), et dans un bureau seul son propriétaire la règle. Ces tests tournent sur la grande carte du bureau (office), la seule qui a des pièces
// à enceinte ; debug:teleport (E2E=1) pose les personnes où le test le veut.
const startMusic = (options: TestServerOptions = {}) => startTestServer({ env: { MAP_KEY: 'office', E2E: '1' }, ...options });

async function person(srv: TestServer, email: string) {
  const cookie = await srv.inviteAndLogin(email);
  const entered = await enter(srv, cookie);
  return { ...entered, email, cookie };
}
type Person = Awaited<ReturnType<typeof person>>;

// Un point libre au milieu de ce lieu (la salle de jeu, un bureau).
function spotIn(srv: TestServer, key: string): { x: number; y: number } {
  const spot = freeSpotIn(srv.map, placeByKey(srv.map, key)!, []);
  if (!spot) throw new Error(`Pas de place dans ${key}`);
  return spot;
}

// Pose la personne là, et attend que le monde l'y ait mise.
async function teleport(srv: TestServer, p: Person, at: { x: number; y: number }) {
  p.socket.emit('debug:teleport', at);
  await vi.waitFor(() => expect(srv.realtime.world.get(p.id)).toMatchObject(at));
}

// Un message quelconque (même mal formé) sur `music:set`.
const sendRaw = (p: Person, payload: unknown) => (p.socket as unknown as { emit(event: string, ...args: unknown[]): void }).emit('music:set', payload);

const changes = (events: ReturnType<typeof record>) => events.payloadsOf('music:changed');

describe('l\'état de la musique des pièces', () => {
  test('l\'init ne dit rien tant que personne n\'a touché à une pièce', async () => {
    const srv = await startMusic();
    const a = await person(srv, 'a@x.fr');
    expect(a.init.music).toBeUndefined();
    expect(srv.realtime.music.all()).toEqual({});
  });

  test('dans la salle de jeu, éteindre : tout le bureau l\'apprend, avec le nom de qui l\'a fait, et qui arrive ensuite la trouve éteinte', async () => {
    const srv = await startMusic();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(srv, a, spotIn(srv, 'game'));
    const seenByA = nextEvent(a.socket, 'music:changed');
    const seenByB = nextEvent(b.socket, 'music:changed');   // b est loin : il l'apprend aussi, pour quand il y entrera

    const before = Date.now();
    a.socket.emit('music:set', { place: 'game', on: false });
    const changed = await seenByA;
    expect(changed).toEqual({ place: 'game', state: { on: false, scene: null, by: { id: a.id, name: 'a' }, at: expect.any(Number) } });
    expect(changed.state.at).toBeGreaterThanOrEqual(before);
    expect(await seenByB).toEqual(changed);
    expect(srv.realtime.music.get('game')).toEqual(changed.state);

    const c = await person(srv, 'c@x.fr');
    expect(c.init.music).toEqual({ game: changed.state });
  });

  test('choisir une ambiance, puis revenir à celle par défaut (null)', async () => {
    let clock = 1000;
    const srv = await startMusic({ now: () => clock });
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, spotIn(srv, 'gym'));
    const seen = record(a.socket);

    a.socket.emit('music:set', { place: 'gym', scene: 'drift' });
    await vi.waitFor(() => expect(changes(seen)).toHaveLength(1));
    expect(changes(seen)[0]).toMatchObject({ place: 'gym', state: { on: true, scene: 'drift', by: { id: a.id } } });

    clock += MUSIC_RATE_MS;
    a.socket.emit('music:set', { place: 'gym', scene: null });
    await vi.waitFor(() => expect(changes(seen)).toHaveLength(2));
    expect(changes(seen)[1]).toMatchObject({ place: 'gym', state: { on: true, scene: null } });
  });

  test('de loin, rien : depuis l\'accueil, la musique de la salle de jeu ne se règle pas', async () => {
    const srv = await startMusic();
    const a = await person(srv, 'a@x.fr');   // à l'accueil, à l'autre bout de la carte
    const b = await person(srv, 'b@x.fr');
    const seen = record(b.socket);
    a.socket.emit('music:set', { place: 'game', on: false });
    await sleep(200);
    expect(changes(seen)).toEqual([]);
    expect(srv.realtime.music.get('game').on).toBe(true);

    // Dans sa pièce, l'accueil, c'est permis : il a une enceinte.
    const changed = nextEvent(b.socket, 'music:changed');
    a.socket.emit('music:set', { place: 'reception', on: false });
    expect(await changed).toMatchObject({ place: 'reception', state: { on: false } });
  });

  test('c\'est la pièce où le monde voit la personne qui compte, la plus petite : dans le café (au milieu de la place), le café se règle, la place non', async () => {
    const srv = await startMusic();
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, spotIn(srv, 'cafe'));
    const seen = record(a.socket);
    a.socket.emit('music:set', { place: 'plaza', on: false });
    await sleep(150);
    expect(changes(seen)).toEqual([]);
    a.socket.emit('music:set', { place: 'cafe', on: false });
    await vi.waitFor(() => expect(changes(seen)).toHaveLength(1));
    expect(changes(seen)[0]).toMatchObject({ place: 'cafe' });
  });

  test('une pièce sans enceinte (la rue, la salle client) n\'a pas de réglage : la demande est ignorée', async () => {
    const srv = await startMusic();
    const a = await person(srv, 'a@x.fr');
    const seen = record(a.socket);
    for (const key of ['street-n', 'client']) {
      await teleport(srv, a, spotIn(srv, key));
      a.socket.emit('music:set', { place: key, on: false });
    }
    await sleep(200);
    expect(changes(seen)).toEqual([]);
    expect(srv.realtime.music.all()).toEqual({});
  });

  test('une clé de lieu qui n\'existe pas, ou qui n\'est pas celle d\'où l\'on est : ignorée', async () => {
    const srv = await startMusic();
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, spotIn(srv, 'game'));
    const seen = record(a.socket);
    for (const place of ['nulle-part', 'gym', 'desk:A1', 'desk:ZZ', '../etc']) a.socket.emit('music:set', { place, on: false });
    await sleep(200);
    expect(changes(seen)).toEqual([]);
  });

  test('un bureau : son propriétaire règle sa musique, un autre qui y entre ne le peut pas', async () => {
    const srv = await startMusic();
    const alice = await person(srv, 'alice@x.fr');
    const bob = await person(srv, 'bob@x.fr');
    const aliceDesk = srv.realtime.desks.deskOf(alice.id)!;
    const room = `desk:${aliceDesk.key}`;
    await teleport(srv, bob, spotIn(srv, room));   // dans le bureau d'Alice, porte ouverte
    const seenByAlice = record(alice.socket);

    bob.socket.emit('music:set', { place: room, on: false });
    await sleep(200);
    expect(changes(seenByAlice)).toEqual([]);

    await teleport(srv, alice, spotIn(srv, room));
    alice.socket.emit('music:set', { place: room, scene: 'dusk' });
    await vi.waitFor(() => expect(changes(seenByAlice)).toHaveLength(1));
    expect(changes(seenByAlice)[0]).toMatchObject({ place: room, state: { on: true, scene: 'dusk', by: { id: alice.id } } });
  });

  test('chez soi seulement : le propriétaire, loin de son bureau, ne règle pas sa musique', async () => {
    const srv = await startMusic();
    const alice = await person(srv, 'alice@x.fr');
    const room = `desk:${srv.realtime.desks.deskOf(alice.id)!.key}`;
    await teleport(srv, alice, spotIn(srv, 'game'));
    const seen = record(alice.socket);
    alice.socket.emit('music:set', { place: room, on: false });
    await sleep(200);
    expect(changes(seen)).toEqual([]);
  });
});

describe('les limites', () => {
  test('« éteindre » est un état demandé, non une bascule : le redemander ne change rien, ne dit rien, et ne compte pas dans la limite', async () => {
    let clock = 1000;
    const srv = await startMusic({ now: () => clock });
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, spotIn(srv, 'game'));
    const seen = record(a.socket);

    a.socket.emit('music:set', { place: 'game', on: true });   // déjà allumée
    await sleep(150);
    expect(changes(seen)).toEqual([]);

    a.socket.emit('music:set', { place: 'game', on: false });
    await vi.waitFor(() => expect(changes(seen)).toHaveLength(1));
    a.socket.emit('music:set', { place: 'game', on: false });   // déjà éteinte : sans effet, et sans compter dans la limite
    await sleep(150);
    expect(changes(seen)).toHaveLength(1);
    clock += 100;
    a.socket.emit('music:set', { place: 'game', on: true });   // trop tôt après le vrai changement : ignoré
    await sleep(150);
    expect(changes(seen)).toHaveLength(1);
  });

  test('un changement par personne et par MUSIC_RATE_MS : le suivant, trop tôt, est ignoré ; passé le délai, il est pris', async () => {
    let clock = 1000;
    const srv = await startMusic({ now: () => clock });
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, spotIn(srv, 'game'));
    const seen = record(a.socket);

    a.socket.emit('music:set', { place: 'game', on: false });
    await vi.waitFor(() => expect(changes(seen)).toHaveLength(1));
    clock += MUSIC_RATE_MS - 1;
    a.socket.emit('music:set', { place: 'game', on: true });
    await sleep(150);
    expect(changes(seen)).toHaveLength(1);
    expect(srv.realtime.music.get('game').on).toBe(false);

    clock += 1;
    a.socket.emit('music:set', { place: 'game', on: true });
    await vi.waitFor(() => expect(changes(seen)).toHaveLength(2));
    expect(srv.realtime.music.get('game').on).toBe(true);
  });

  test('la limite est celle de la personne : deux personnes n\'attendent pas l\'une l\'autre', async () => {
    let clock = 1000;
    const srv = await startMusic({ now: () => clock });
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(srv, a, spotIn(srv, 'game'));
    await teleport(srv, b, spotIn(srv, 'gym'));
    const seen = record(a.socket);

    a.socket.emit('music:set', { place: 'game', on: false });
    await vi.waitFor(() => expect(changes(seen)).toHaveLength(1));
    clock += 50;
    b.socket.emit('music:set', { place: 'gym', on: false });
    await vi.waitFor(() => expect(changes(seen)).toHaveLength(2));
  });

  test('deux personnes éteignent la même pièce en même temps : une seule diffusion, et la pièce finit éteinte', async () => {
    const srv = await startMusic();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(srv, a, spotIn(srv, 'game'));
    await teleport(srv, b, { x: spotIn(srv, 'game').x + 64, y: spotIn(srv, 'game').y });
    const seenByA = record(a.socket);
    const seenByB = record(b.socket);

    a.socket.emit('music:set', { place: 'game', on: false });
    b.socket.emit('music:set', { place: 'game', on: false });
    await sleep(300);
    expect(changes(seenByA)).toHaveLength(1);
    expect(changes(seenByB)).toEqual(changes(seenByA));
    expect(srv.realtime.music.get('game').on).toBe(false);
  });

  test('une charge utile qui n\'est pas une demande valable est ignorée, sans rien dire à personne ni consommer la limite', async () => {
    const srv = await startMusic();
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, spotIn(srv, 'game'));
    const seen = record(a.socket);

    for (const payload of [{ place: 'game' }, { place: 'game', on: 'non' }, { place: 'game', scene: 'disco' }, { on: false }, { place: 5, on: false }, null, 'éteindre', 42, [false]]) sendRaw(a, payload);
    await sleep(200);
    expect(changes(seen)).toEqual([]);

    const changed = nextEvent(a.socket, 'music:changed');
    sendRaw(a, { place: 'game', on: false, by: 'quelqu\'un d\'autre' });
    expect(await changed).toMatchObject({ place: 'game', state: { on: false, by: { id: a.id, name: 'a' } } });
  });
});

describe('la mémoire du serveur', () => {
  test('un redémarrage garde la musique éteinte, avec son auteur et sa date', async () => {
    const srv = await startMusic();
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, spotIn(srv, 'game'));
    const changed = nextEvent(a.socket, 'music:changed');
    a.socket.emit('music:set', { place: 'game', on: false });
    const off = await changed;

    const reinit = nextEvent(a.socket, 'init', 5000);
    await srv.restart();   // nouvelle instance, même base : les clients se reconnectent seuls
    expect((await reinit).music).toEqual({ game: off.state });
    expect(srv.realtime.music.get('game')).toEqual(off.state);
  });

  test('la base n\'enregistre pas le changement : rien n\'est diffusé, la pièce reste allumée, l\'erreur est journalisée', async () => {
    const { logger, lines } = captureLogs();
    const srv = await startMusic({ logger });
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, spotIn(srv, 'game'));
    const seen = record(a.socket);
    await srv.db.execute(sql`drop table "room_music"`);

    a.socket.emit('music:set', { place: 'game', on: false });
    await vi.waitFor(() => expect(lines.some((line) => line.msg === 'Changement de la musique impossible')).toBe(true));
    expect(changes(seen)).toEqual([]);
    expect(srv.realtime.music.get('game').on).toBe(true);
  });

  test('un état de chaque pièce dans l\'init : celles qu\'on a touchées, et seulement elles', async () => {
    let clock = 1000;
    const srv = await startMusic({ now: () => clock });
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, spotIn(srv, 'game'));
    a.socket.emit('music:set', { place: 'game', on: false });
    await vi.waitFor(() => expect(srv.realtime.music.get('game').on).toBe(false));
    clock += MUSIC_RATE_MS;
    await teleport(srv, a, spotIn(srv, 'gym'));
    a.socket.emit('music:set', { place: 'gym', scene: 'sunny' });
    await vi.waitFor(() => expect(srv.realtime.music.get('gym').scene).toBe('sunny'));

    const b = await person(srv, 'b@x.fr');
    const music = b.init.music as Record<string, RoomMusic>;
    expect(Object.keys(music).sort()).toEqual(['game', 'gym']);
    expect(music.game).toMatchObject({ on: false, scene: null });
    expect(music.gym).toMatchObject({ on: true, scene: 'sunny' });
  });
});
