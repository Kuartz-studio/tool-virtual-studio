import { COFFEE_DURATION_MS, COFFEE_RATE_MS, MAX_SPEED_PX_PER_S, MOVE_JITTER_MS, NORMAL_MAX_SPEED_PX_PER_S } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { enter, nextEvent, record, sleep, startTestServer, type TestServer, type TestServerOptions } from './helpers/realtime';

// La machine à café de la grande carte (MAP_KEY=office) : sa case de service est (40, 5), devant le comptoir du café. Centre d'une case, en pixels.
const px = (tile: number) => tile * 32 + 16;
const AT_MACHINE = { x: px(40), y: px(5) };
const TWO_TILES_AWAY = { x: px(40), y: px(7) };
const THREE_TILES_AWAY = { x: px(40), y: px(8) };

// Ce qu'un serveur à horloge à la main laisse faire : le temps du monde (café, limites de débit) est celui du test.
function withClock(): { clock: { t: number }; options: TestServerOptions } {
  const clock = { t: 5_000 };
  return { clock, options: { now: () => clock.t, env: { MAP_KEY: 'office', E2E: '1' } } };
}

async function person(srv: TestServer, email: string) {
  return enter(srv, await srv.inviteAndLogin(email));
}
type Person = Awaited<ReturnType<typeof person>>;

function teleport(p: Person, at: { x: number; y: number }) {
  p.socket.emit('debug:teleport', at);
  return sleep(60);
}

const changes = (events: ReturnType<typeof record>) => events.payloadsOf('coffee:changed');

describe('coffee:take', () => {
  test('à la machine : tout le bureau apprend le café (30 s), le monde le retient et relève la vitesse permise', async () => {
    const { clock, options } = withClock();
    const srv = await startTestServer(options);
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(a, AT_MACHINE);
    expect(srv.realtime.world.maxSpeedOf(a.id)).toBe(NORMAL_MAX_SPEED_PX_PER_S);

    const seenByA = nextEvent(a.socket, 'coffee:changed');
    const seenByB = nextEvent(b.socket, 'coffee:changed');
    a.socket.emit('coffee:take');
    expect(await seenByA).toEqual({ id: a.id, ms: COFFEE_DURATION_MS });
    expect(await seenByB).toEqual({ id: a.id, ms: COFFEE_DURATION_MS });
    expect(srv.realtime.world.maxSpeedOf(a.id)).toBe(MAX_SPEED_PX_PER_S);
    expect(srv.realtime.world.maxSpeedOf(b.id)).toBe(NORMAL_MAX_SPEED_PX_PER_S);
    expect(srv.realtime.world.boostRemaining(a.id)).toBe(COFFEE_DURATION_MS);
    clock.t += 10_000;
    expect(srv.realtime.world.boostRemaining(a.id)).toBe(COFFEE_DURATION_MS - 10_000);
  });

  test('à deux cases : encore bon ; à trois cases, ou loin (à l\'accueil) : ignoré, sans rien dire à personne', async () => {
    const srv = await startTestServer(withClock().options);
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const seen = record(b.socket);
    a.socket.emit('coffee:take');   // à l'apparition : loin de la machine
    await sleep(150);
    await teleport(a, THREE_TILES_AWAY);
    a.socket.emit('coffee:take');
    await sleep(150);
    expect(changes(seen)).toEqual([]);
    expect(srv.realtime.world.boostRemaining(a.id)).toBe(0);

    await teleport(a, TWO_TILES_AWAY);
    const near = nextEvent(b.socket, 'coffee:changed');
    a.socket.emit('coffee:take');
    expect(await near).toEqual({ id: a.id, ms: COFFEE_DURATION_MS });
  });

  test('un second café en moins de COFFEE_RATE_MS est ignoré : rien n\'est rediffusé et le compte ne repart pas', async () => {
    const { clock, options } = withClock();
    const srv = await startTestServer(options);
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(a, AT_MACHINE);
    const seen = record(b.socket);
    a.socket.emit('coffee:take');
    await nextEvent(b.socket, 'coffee:changed');

    const early = COFFEE_RATE_MS - 500;
    clock.t += early;
    a.socket.emit('coffee:take');   // trop tôt : la fenêtre de COFFEE_RATE_MS ouverte par la première prise n'est pas finie
    a.socket.emit('coffee:take');
    await sleep(200);
    expect(changes(seen)).toHaveLength(1);
    expect(srv.realtime.world.boostRemaining(a.id)).toBe(COFFEE_DURATION_MS - early);
  });

  test('passé COFFEE_RATE_MS, un café remet le compte à 30 s', async () => {
    const { clock, options } = withClock();
    const srv = await startTestServer(options);
    const a = await person(srv, 'a@x.fr');
    await teleport(a, AT_MACHINE);
    a.socket.emit('coffee:take');
    await nextEvent(a.socket, 'coffee:changed');
    clock.t += COFFEE_RATE_MS + 100;
    expect(srv.realtime.world.boostRemaining(a.id)).toBe(COFFEE_DURATION_MS - COFFEE_RATE_MS - 100);
    const again = nextEvent(a.socket, 'coffee:changed');
    a.socket.emit('coffee:take');   // la fenêtre de la première prise est finie : celle-ci passe
    expect(await again).toEqual({ id: a.id, ms: COFFEE_DURATION_MS });
    expect(srv.realtime.world.boostRemaining(a.id)).toBe(COFFEE_DURATION_MS);
  });

  test('« Ne pas déranger » n\'y change rien : le café se prend quel que soit le statut', async () => {
    const srv = await startTestServer(withClock().options);
    const a = await person(srv, 'a@x.fr');
    a.socket.emit('status:set', 'dnd');
    await sleep(100);
    await teleport(a, AT_MACHINE);
    const seen = nextEvent(a.socket, 'coffee:changed');
    a.socket.emit('coffee:take');
    expect(await seen).toEqual({ id: a.id, ms: COFFEE_DURATION_MS });
  });
});

describe('la fin du café', () => {
  test('à l\'échéance, le serveur l\'éteint pour tout le bureau (ms: 0), et la vitesse retombe après la tolérance des derniers paquets', async () => {
    const { clock, options } = withClock();
    const srv = await startTestServer(options);
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(a, AT_MACHINE);
    a.socket.emit('coffee:take');
    await nextEvent(b.socket, 'coffee:changed');

    clock.t += COFFEE_DURATION_MS - 1;
    const seen = record(b.socket);
    await sleep(250);
    expect(changes(seen)).toEqual([]);

    clock.t += 1;
    expect(await nextEvent(b.socket, 'coffee:changed')).toEqual({ id: a.id, ms: 0 });
    expect(srv.realtime.world.boostRemaining(a.id)).toBe(0);
    // Les derniers paquets arrivent en retard : la limite du café tient encore MOVE_JITTER_MS.
    expect(srv.realtime.world.maxSpeedOf(a.id)).toBe(MAX_SPEED_PX_PER_S);
    clock.t += MOVE_JITTER_MS + 1;
    expect(srv.realtime.world.maxSpeedOf(a.id)).toBe(NORMAL_MAX_SPEED_PX_PER_S);
    // Et on ne l'éteint pas deux fois.
    await sleep(250);
    expect(changes(seen)).toEqual([{ id: a.id, ms: 0 }]);
  });

  test('l\'init d\'un arrivant dit le café en cours, avec ce qu\'il en reste, et seulement celui-là', async () => {
    const { clock, options } = withClock();
    const srv = await startTestServer(options);
    const a = await person(srv, 'a@x.fr');
    await person(srv, 'b@x.fr');
    await teleport(a, AT_MACHINE);
    a.socket.emit('coffee:take');
    await nextEvent(a.socket, 'coffee:changed');
    clock.t += 12_000;

    const c = await person(srv, 'c@x.fr');
    const seenA = c.init.players.find((p) => p.id === a.id)!;
    expect(seenA.boost).toBe(COFFEE_DURATION_MS - 12_000);
    expect(c.init.players.filter((p) => p.id !== a.id).every((p) => p.boost === undefined)).toBe(true);
    expect(c.init.self.boost).toBeUndefined();
  });

  test('le café ne survit pas au départ de la personne, ni ne s\'éteint pour elle après', async () => {
    const { clock, options } = withClock();
    const srv = await startTestServer(options);
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(a, AT_MACHINE);
    a.socket.emit('coffee:take');
    await nextEvent(b.socket, 'coffee:changed');
    a.socket.disconnect();
    await sleep(500);
    const seen = record(b.socket);
    clock.t += COFFEE_DURATION_MS + 1_000;
    await sleep(300);
    expect(changes(seen)).toEqual([]);
  });
});

describe('debug:boost (tests de bout en bout, E2E=1) : comme la machine', () => {
  test('il donne le café à tout le bureau, avec sa durée, et le retire avec ms 0', async () => {
    const srv = await startTestServer(withClock().options);
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const started = nextEvent(b.socket, 'coffee:changed');
    a.socket.emit('debug:boost', { ms: 5_000 });
    expect(await started).toEqual({ id: a.id, ms: 5_000 });
    expect(srv.realtime.world.maxSpeedOf(a.id)).toBe(MAX_SPEED_PX_PER_S);
    const stopped = nextEvent(b.socket, 'coffee:changed');
    a.socket.emit('debug:boost', { ms: 0 });
    expect(await stopped).toEqual({ id: a.id, ms: 0 });
    expect(srv.realtime.world.boostRemaining(a.id)).toBe(0);
  });
});
