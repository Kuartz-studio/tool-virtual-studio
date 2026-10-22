import { SPEAKING_RATE, SPEAKING_TTL_MS, type ActivityInput, type ActivityState } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { createActivityService } from '../src/activity/activity-service';
import { enter, nextEvent, record, sleep, startTestServer, TEST_GRACE_MS, type ClientSocket, type TestServer, type TestServerOptions } from './helpers/realtime';

const sport: ActivityInput = { label: 'Sport', color: '#22c55e', allowEntry: false, hear: false, heard: false };
const quiet: ActivityInput = { label: 'Au calme', color: '#6d28d9', allowEntry: true, hear: true, heard: false };

async function person(srv: TestServer, email: string, withMic = true) {
  const p = await enter(srv, await srv.inviteAndLogin(email));
  if (withMic) await setMedia(p.socket, srv, p.id, { mic: true, cam: false, screen: false });
  return p;
}

// Le micro (ou son absence) est dit au serveur, qui le retient ; on attend que le monde l'ait.
async function setMedia(socket: ClientSocket, srv: TestServer, id: string, media: { mic: boolean; cam: boolean; screen: boolean }): Promise<void> {
  const seen = nextEvent(socket, 'media:changed');
  socket.emit('media:state', media);
  await seen;
  expect(srv.realtime.world.get(id)?.media).toEqual(media);
}

async function stateOf(srv: TestServer, userId: string, input: ActivityInput): Promise<ActivityState> {
  const created = await createActivityService(srv.db).create(userId, input);
  if (!created.ok) throw new Error('création refusée');
  return created.state;
}

// Ce qu'un serveur à horloge à la main laisse faire : le temps du monde (TTL, limites de débit) est celui du test.
function withClock(): { clock: { t: number }; options: TestServerOptions } {
  const clock = { t: 5_000 };
  return { clock, options: { now: () => clock.t } };
}

const changes = (events: ReturnType<typeof record>) => events.payloadsOf('speaking:changed');

describe('speaking:set', () => {
  test('« je parle » avec le micro allumé : à tout le bureau, émetteur compris ; le monde le retient, et un arrivant le voit', async () => {
    const srv = await startTestServer();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');

    const seenByA = nextEvent(a.socket, 'speaking:changed');
    const seenByB = nextEvent(b.socket, 'speaking:changed');
    a.socket.emit('speaking:set', true);
    expect(await seenByA).toEqual({ id: a.id, speaking: true });
    expect(await seenByB).toEqual({ id: a.id, speaking: true });
    expect(srv.realtime.world.get(a.id)?.speaking).toBe(true);

    const c = await person(srv, 'c@x.fr', false);
    expect(c.init.players.find((p) => p.id === a.id)?.speaking).toBe(true);
    expect(c.init.players.find((p) => p.id === b.id)).not.toHaveProperty('speaking');

    const quietNow = nextEvent(b.socket, 'speaking:changed');
    a.socket.emit('speaking:set', false);
    expect(await quietNow).toEqual({ id: a.id, speaking: false });
    expect(srv.realtime.world.get(a.id)).not.toHaveProperty('speaking');
  });

  test('le micro coupé : « je parle » est ignoré, sans rien dire à personne', async () => {
    const srv = await startTestServer();
    const a = await person(srv, 'a@x.fr', false);
    const b = await person(srv, 'b@x.fr');
    const seen = record(b.socket);
    a.socket.emit('speaking:set', true);
    await sleep(150);
    expect(changes(seen)).toEqual([]);
    expect(srv.realtime.world.get(a.id)).not.toHaveProperty('speaking');
  });

  test.each([
    ['sans entendre ni être entendu', sport],
    ['où l\'on entend mais n\'est pas entendu', quiet],
  ])('un état d\'activité %s : « je parle » est ignoré', async (_name, input) => {
    const srv = await startTestServer({ env: { MAP_KEY: 'office' } });
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const state = await stateOf(srv, a.id, input);
    const taken = nextEvent(b.socket, 'activity:changed');
    a.socket.emit('state:set', state.id);
    await taken;
    const seen = record(b.socket);
    a.socket.emit('speaking:set', true);
    await sleep(150);
    expect(changes(seen)).toEqual([]);
    expect(srv.realtime.world.get(a.id)).not.toHaveProperty('speaking');
  });

  test('prendre un état où l\'on n\'est pas entendu éteint la bulle de qui parlait, à tout le bureau', async () => {
    const srv = await startTestServer({ env: { MAP_KEY: 'office' } });
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const state = await stateOf(srv, a.id, sport);
    a.socket.emit('speaking:set', true);
    await nextEvent(b.socket, 'speaking:changed');

    const off = nextEvent(b.socket, 'speaking:changed');
    a.socket.emit('state:set', state.id);
    expect(await off).toEqual({ id: a.id, speaking: false });
    expect(srv.realtime.world.get(a.id)).not.toHaveProperty('speaking');
  });

  test('couper son micro éteint la bulle de qui parlait, à tout le bureau', async () => {
    const srv = await startTestServer();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    a.socket.emit('speaking:set', true);
    await nextEvent(b.socket, 'speaking:changed');

    const off = nextEvent(b.socket, 'speaking:changed');
    a.socket.emit('media:state', { mic: false, cam: false, screen: false });
    expect(await off).toEqual({ id: a.id, speaking: false });
  });

  test('couper son micro puis redire « je me tais » : une seule extinction part', async () => {
    const srv = await startTestServer();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    a.socket.emit('speaking:set', true);
    await nextEvent(b.socket, 'speaking:changed');
    const seen = record(b.socket);
    a.socket.emit('media:state', { mic: false, cam: false, screen: false });
    a.socket.emit('speaking:set', false);
    await sleep(200);
    expect(changes(seen)).toEqual([{ id: a.id, speaking: false }]);
    expect(srv.realtime.world.get(a.id)).not.toHaveProperty('speaking');
  });

  test('une charge utile invalide est ignorée', async () => {
    const srv = await startTestServer();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const seen = record(b.socket);
    for (const bad of ['true', 1, null, undefined, { speaking: true }]) (a.socket as unknown as { emit(event: string, ...args: unknown[]): void }).emit('speaking:set', bad);
    await sleep(150);
    expect(changes(seen)).toEqual([]);
  });

  test('le même « je parle » redit (le battement du client) ne rediffuse rien', async () => {
    const srv = await startTestServer();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const seen = record(b.socket);
    for (let i = 0; i < 4; i++) a.socket.emit('speaking:set', true);
    await sleep(150);
    expect(changes(seen)).toEqual([{ id: a.id, speaking: true }]);
  });

  test('le débit est limité par socket (SPEAKING_RATE) : au-delà, les messages sont ignorés', async () => {
    const { clock, options } = withClock();
    const srv = await startTestServer(options);
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const seen = record(b.socket);
    // Une alternance : chaque message change l'état, donc chacun diffuserait s'il passait.
    for (let i = 0; i < 2 * SPEAKING_RATE.max + 4; i++) a.socket.emit('speaking:set', i % 2 === 0);
    await sleep(250);
    // L'horloge du monde n'a pas bougé : la fenêtre est la même pour tous. media:state du test compte pour sa propre limite.
    expect(changes(seen)).toHaveLength(SPEAKING_RATE.max);
    // La fenêtre passée, ça repart.
    clock.t += SPEAKING_RATE.windowMs + 1;
    const last = nextEvent(b.socket, 'speaking:changed');
    const speaking = srv.realtime.world.get(a.id)?.speaking === true;
    a.socket.emit('speaking:set', !speaking);
    expect(await last).toEqual({ id: a.id, speaking: !speaking });
  });
});

describe('la bulle s\'éteint d\'elle-même', () => {
  test('à la déconnexion : tout le bureau l\'apprend tout de suite, sans attendre la fin du délai de grâce', async () => {
    const srv = await startTestServer();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    a.socket.emit('speaking:set', true);
    await nextEvent(b.socket, 'speaking:changed');

    const off = nextEvent(b.socket, 'speaking:changed', Math.max(500, TEST_GRACE_MS / 2));
    a.socket.disconnect();
    expect(await off).toEqual({ id: a.id, speaking: false });
    // Elle est encore au monde (délai de grâce), et ne parle plus.
    expect(srv.realtime.world.get(a.id)).toBeDefined();
    expect(srv.realtime.world.get(a.id)).not.toHaveProperty('speaking');
  });

  test('après SPEAKING_TTL_MS sans nouvelle : le serveur l\'éteint pour tout le bureau', async () => {
    const { clock, options } = withClock();
    const srv = await startTestServer(options);
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    a.socket.emit('speaking:set', true);
    await nextEvent(b.socket, 'speaking:changed');

    clock.t += SPEAKING_TTL_MS - 1;
    const seen = record(b.socket);
    await sleep(250);
    expect(changes(seen)).toEqual([]);

    clock.t += 1;
    expect(await nextEvent(b.socket, 'speaking:changed')).toEqual({ id: a.id, speaking: false });
    expect(srv.realtime.world.get(a.id)).not.toHaveProperty('speaking');
  });

  test('un battement du client tient la bulle au-delà du délai', async () => {
    const { clock, options } = withClock();
    const srv = await startTestServer(options);
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    a.socket.emit('speaking:set', true);
    await nextEvent(b.socket, 'speaking:changed');
    const seen = record(b.socket);
    for (let i = 0; i < 4; i++) {
      clock.t += 3_000;
      a.socket.emit('speaking:set', true);
      await sleep(130);
    }
    expect(changes(seen)).toEqual([]);
    expect(srv.realtime.world.get(a.id)?.speaking).toBe(true);
  });
});
