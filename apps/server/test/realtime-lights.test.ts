import { LIGHTS_RATE_MS } from '@bureau/shared';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { user } from '../src/db/schema';
import { captureLogs } from './helpers/logs';
import { enter, nextEvent, record, sleep, startTestServer, type TestServer, type TestServerOptions } from './helpers/realtime';
import { NEAR_SWITCH, SWITCH_AT, withSwitchMap } from './helpers/switch-map';

// La lumière du bureau, partagée par tout le monde : un interrupteur dans le couloir, que l'on actionne de près (3 cases au plus). Ces
// tests tournent sur la carte de développement avec un interrupteur ajouté (helpers/switch-map.ts) : seule la grande carte du bureau
// (office) a le sien. Les personnes y arrivent à son point d'apparition, à plus de 11 cases de l'interrupteur ; debug:teleport (E2E=1)
// les pose où le test le veut.
const startLights = (options: TestServerOptions = {}) => startTestServer({ env: { ...withSwitchMap(), E2E: '1' }, ...options });

async function person(srv: TestServer, email: string) {
  const cookie = await srv.inviteAndLogin(email);
  const entered = await enter(srv, cookie);
  return { ...entered, email, cookie };
}
type Person = Awaited<ReturnType<typeof person>>;

// Pose la personne là, et attend que le monde l'y ait mise.
async function teleport(srv: TestServer, p: Person, at: { x: number; y: number }) {
  p.socket.emit('debug:teleport', at);
  await vi.waitFor(() => expect(srv.realtime.world.get(p.id)).toMatchObject(at));
}

// Un message quelconque (même mal formé) sur `lights:set`.
const sendRaw = (p: Person, payload: unknown) => (p.socket as unknown as { emit(event: string, ...args: unknown[]): void }).emit('lights:set', payload);

describe('l\'état de la lumière', () => {
  test('l\'init dit la lumière : allumée tant que personne n\'y a touché', async () => {
    const srv = await startLights();
    const a = await person(srv, 'a@x.fr');
    expect(a.init.lights).toEqual({ on: true, by: null, at: 0 });
    expect(srv.realtime.lights.get()).toEqual({ on: true, by: null, at: 0 });
  });

  test('quelqu\'un à 2 cases éteint : tout le bureau l\'apprend, avec son nom, et qui arrive ensuite la trouve éteinte', async () => {
    const srv = await startLights();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(srv, a, NEAR_SWITCH);
    const seenByA = nextEvent(a.socket, 'lights:changed');
    const seenByB = nextEvent(b.socket, 'lights:changed');

    const before = Date.now();
    a.socket.emit('lights:set', { on: false });
    const changed = await seenByA;
    expect(changed).toEqual({ on: false, by: { id: a.id, name: 'a' }, at: expect.any(Number) });
    expect(changed.at).toBeGreaterThanOrEqual(before);
    expect(changed.at).toBeLessThanOrEqual(Date.now());
    expect(await seenByB).toEqual(changed);
    expect(srv.realtime.lights.get()).toEqual(changed);

    const c = await person(srv, 'c@x.fr');
    expect(c.init.lights).toEqual(changed);
  });

  test('rallumer : le même chemin dans l\'autre sens, avec le nom de qui rallume', async () => {
    const srv = await startLights();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(srv, a, NEAR_SWITCH);
    await teleport(srv, b, { x: SWITCH_AT.x + 32, y: SWITCH_AT.y + 64 });

    a.socket.emit('lights:set', { on: false });
    await nextEvent(b.socket, 'lights:changed');
    const lit = nextEvent(a.socket, 'lights:changed');
    b.socket.emit('lights:set', { on: true });
    expect(await lit).toEqual({ on: true, by: { id: b.id, name: 'b' }, at: expect.any(Number) });
    expect(srv.realtime.lights.get().on).toBe(true);
  });

  test('quelqu\'un à plus de 3 cases : rien ne change, rien n\'est diffusé', async () => {
    const srv = await startLights();
    const a = await person(srv, 'a@x.fr');   // à l'apparition : à plus de 11 cases de l'interrupteur
    const b = await person(srv, 'b@x.fr');
    const seenByA = record(a.socket);
    const seenByB = record(b.socket);

    a.socket.emit('lights:set', { on: false });
    await sleep(200);
    expect(seenByA.names()).not.toContain('lights:changed');
    expect(seenByB.names()).not.toContain('lights:changed');
    expect(srv.realtime.lights.get().on).toBe(true);

    // À 4 cases, c'est encore trop loin ; à 3, c'est bon (la limite elle-même est dans les tests de withinSwitchReach).
    await teleport(srv, a, { x: SWITCH_AT.x, y: SWITCH_AT.y + 4 * 32 });
    a.socket.emit('lights:set', { on: false });
    await sleep(200);
    expect(srv.realtime.lights.get().on).toBe(true);
    await teleport(srv, a, { x: SWITCH_AT.x, y: SWITCH_AT.y + 3 * 32 });
    const changed = nextEvent(b.socket, 'lights:changed');
    a.socket.emit('lights:set', { on: false });
    expect(await changed).toMatchObject({ on: false });
  });

  test('une carte sans interrupteur (la carte de développement) : la lumière ne se change pas', async () => {
    const srv = await startTestServer({ env: { E2E: '1' } });
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, NEAR_SWITCH);
    const seen = record(a.socket);
    a.socket.emit('lights:set', { on: false });
    await sleep(200);
    expect(seen.names()).not.toContain('lights:changed');
    expect(srv.realtime.lights.get().on).toBe(true);
  });

  test('un changement par personne et par 800 ms : le suivant, trop tôt, est ignoré ; passé le délai, il est pris', async () => {
    let clock = 1000;
    const srv = await startLights({ now: () => clock });
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, NEAR_SWITCH);
    const seen = record(a.socket);

    a.socket.emit('lights:set', { on: false });
    await vi.waitFor(() => expect(seen.payloadsOf('lights:changed')).toHaveLength(1));
    clock += 100;
    a.socket.emit('lights:set', { on: true });
    await sleep(200);
    expect(seen.payloadsOf('lights:changed')).toHaveLength(1);
    expect(srv.realtime.lights.get().on).toBe(false);

    clock += LIGHTS_RATE_MS - 100;   // 800 ms après le premier changement
    a.socket.emit('lights:set', { on: true });
    await vi.waitFor(() => expect(seen.payloadsOf('lights:changed')).toHaveLength(2));
    expect(srv.realtime.lights.get().on).toBe(true);
  });

  test('la limite est celle de la personne : deux personnes n\'attendent pas l\'une l\'autre', async () => {
    let clock = 1000;
    const srv = await startLights({ now: () => clock });
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(srv, a, NEAR_SWITCH);
    await teleport(srv, b, NEAR_SWITCH);
    const seen = record(b.socket);

    a.socket.emit('lights:set', { on: false });
    await vi.waitFor(() => expect(seen.payloadsOf('lights:changed')).toHaveLength(1));
    clock += 50;
    b.socket.emit('lights:set', { on: true });
    await vi.waitFor(() => expect(seen.payloadsOf('lights:changed')).toHaveLength(2));
    expect(seen.payloadsOf('lights:changed').at(-1)).toMatchObject({ on: true, by: { id: b.id } });
  });

  test('deux personnes éteignent en même temps : une seule diffusion, et tout le monde finit éteint', async () => {
    const srv = await startLights();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(srv, a, NEAR_SWITCH);
    await teleport(srv, b, NEAR_SWITCH);
    const seenByA = record(a.socket);
    const seenByB = record(b.socket);

    a.socket.emit('lights:set', { on: false });
    b.socket.emit('lights:set', { on: false });
    await sleep(300);
    expect(seenByA.payloadsOf('lights:changed')).toHaveLength(1);
    expect(seenByB.payloadsOf('lights:changed')).toHaveLength(1);
    expect(seenByA.payloadsOf('lights:changed')).toEqual(seenByB.payloadsOf('lights:changed'));
    expect(srv.realtime.lights.get().on).toBe(false);
  });

  test('« éteindre » est un état demandé, non une bascule : le redemander ne change rien et ne dit rien à personne', async () => {
    let clock = 1000;
    const srv = await startLights({ now: () => clock });
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, NEAR_SWITCH);
    const seen = record(a.socket);

    a.socket.emit('lights:set', { on: true });   // déjà allumée
    await sleep(150);
    expect(seen.names()).not.toContain('lights:changed');

    a.socket.emit('lights:set', { on: false });
    await vi.waitFor(() => expect(seen.payloadsOf('lights:changed')).toHaveLength(1));
    clock += LIGHTS_RATE_MS;
    a.socket.emit('lights:set', { on: false });   // déjà éteinte
    await sleep(150);
    expect(seen.payloadsOf('lights:changed')).toHaveLength(1);
  });

  test('une demande qui ne change rien ne compte pas dans la limite : celle qui suit, juste après, est prise', async () => {
    let clock = 1000;
    const srv = await startLights({ now: () => clock });
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(srv, a, NEAR_SWITCH);
    await teleport(srv, b, NEAR_SWITCH);
    const seen = record(b.socket);

    a.socket.emit('lights:set', { on: false });
    await vi.waitFor(() => expect(seen.payloadsOf('lights:changed')).toHaveLength(1));
    // B appuie sur un écran qui n'a pas encore appris l'extinction : il demande « éteindre », déjà fait. Puis, tout de suite, il rallume.
    b.socket.emit('lights:set', { on: false });
    await sleep(100);
    clock += 100;
    b.socket.emit('lights:set', { on: true });
    await vi.waitFor(() => expect(seen.payloadsOf('lights:changed')).toHaveLength(2));
    expect(srv.realtime.lights.get().on).toBe(true);
  });

  test('une charge utile qui n\'est pas { on: booléen } est ignorée, sans rien dire à personne', async () => {
    const srv = await startLights();
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, NEAR_SWITCH);
    const seen = record(a.socket);

    for (const payload of [{ on: 'non' }, { on: 0 }, {}, null, 'éteindre', 42, [false]]) sendRaw(a, payload);
    await sleep(200);
    expect(seen.names()).not.toContain('lights:changed');
    expect(srv.realtime.lights.get().on).toBe(true);

    // Les messages refusés n'ont rien consommé : un bon message passe tout de suite.
    const changed = nextEvent(a.socket, 'lights:changed');
    sendRaw(a, { on: false, by: 'quelqu\'un d\'autre' });
    expect(await changed).toMatchObject({ on: false, by: { id: a.id, name: 'a' } });
  });

  test('un redémarrage du serveur garde la lumière éteinte, et dit qui l\'a éteinte et quand', async () => {
    const srv = await startLights();
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, NEAR_SWITCH);
    const changed = nextEvent(a.socket, 'lights:changed');
    a.socket.emit('lights:set', { on: false });
    const off = await changed;

    const reinit = nextEvent(a.socket, 'init', 5000);
    await srv.restart();   // nouvelle instance, même base : les clients se reconnectent seuls
    expect((await reinit).lights).toEqual(off);
    expect(srv.realtime.lights.get()).toEqual(off);

    const b = await person(srv, 'b@x.fr');
    expect(b.init.lights).toEqual(off);
  });

  test('de nouveau allumée avant le redémarrage : elle l\'est après', async () => {
    let clock = 1000;
    const srv = await startLights({ now: () => clock });
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, NEAR_SWITCH);
    const seen = record(a.socket);
    a.socket.emit('lights:set', { on: false });
    await vi.waitFor(() => expect(seen.payloadsOf('lights:changed')).toHaveLength(1));
    clock += LIGHTS_RATE_MS;
    a.socket.emit('lights:set', { on: true });
    await vi.waitFor(() => expect(seen.payloadsOf('lights:changed')).toHaveLength(2));

    const reinit = nextEvent(a.socket, 'init', 5000);
    await srv.restart();
    expect((await reinit).lights).toMatchObject({ on: true, by: { id: a.id, name: 'a' } });
  });

  test('l\'auteur n\'a plus de compte : la lumière reste éteinte, sans nom', async () => {
    const srv = await startLights();
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, NEAR_SWITCH);
    const changed = nextEvent(a.socket, 'lights:changed');
    a.socket.emit('lights:set', { on: false });
    const off = await changed;
    a.socket.disconnect();
    await srv.db.delete(user).where(eq(user.id, a.id));

    await srv.restart();
    const b = await person(srv, 'b@x.fr');
    expect(b.init.lights).toEqual({ on: false, by: null, at: off.at });
  });

  test('la base n\'enregistre pas le changement : rien n\'est diffusé, la lumière reste allumée, l\'erreur est journalisée', async () => {
    const { logger, lines } = captureLogs();
    const srv = await startLights({ logger });
    const a = await person(srv, 'a@x.fr');
    await teleport(srv, a, NEAR_SWITCH);
    const seen = record(a.socket);
    await srv.db.execute(sql`drop table "office_lights"`);

    a.socket.emit('lights:set', { on: false });
    await vi.waitFor(() => expect(lines.some((line) => line.msg === 'Changement de la lumière impossible')).toBe(true));
    expect(seen.names()).not.toContain('lights:changed');
    expect(srv.realtime.lights.get().on).toBe(true);
  });
});
