import { CHECKIN_XP, DECOR_ITEMS, kuartzonsBetween, missionXp, type MissionAck, type MissionGivePayload } from '@bureau/shared';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { enter, nextEvent, record, sleep, startTestServer, type TestServer } from './helpers/realtime';

// L'accueil de la grande carte (MAP_KEY=office) : les administratrices sont sur la rangée 17 (Margot en 39, Inès en 40, Lucie en 41), on se tient devant elles.
// Centre d'une case, en pixels.
const px = (tile: number) => tile * 32 + 16;
const AT_DESK = { x: px(40), y: px(18) };
const FAR = { x: px(40), y: px(30) };

async function person(srv: TestServer, email: string) {
  const cookie = await srv.inviteAndLogin(email);
  return { cookie, ...(await enter(srv, cookie)) };
}
type Person = Awaited<ReturnType<typeof person>>;

function teleport(p: Person, at: { x: number; y: number }) {
  p.socket.emit('debug:teleport', at);
  return sleep(60);
}

function give(p: Person, payload: unknown): Promise<MissionAck> {
  return new Promise((resolve) => p.socket.emit('mission:give', payload as MissionGivePayload, resolve));
}

// La grande carte (ses administratrices), les commandes des tests ; le pointage du jour seulement pour ceux qui l'éprouvent (le serveur des tests l'éteint).
const office = (checkIn = false) => startTestServer({ env: { MAP_KEY: 'office', E2E: '1' }, checkIn });

describe('mission:give', () => {
  test('loin des administratrices : `too_far` ; devant elles, la mission part, et celle qui la reçoit l\'apprend tout de suite', async () => {
    const srv = await office();
    const ana = await person(srv, 'ana@x.fr');
    const bob = await person(srv, 'bob@x.fr');
    await teleport(ana, FAR);
    expect(await give(ana, { to: bob.id, title: 'Refaire le logo', tier: 5 })).toEqual({ ok: false, error: 'too_far' });

    await teleport(ana, AT_DESK);
    const assigned = nextEvent(bob.socket, 'task:assigned');
    const ack = await give(ana, { to: bob.id, title: 'Refaire le logo', tier: 5 });
    expect(ack).toMatchObject({ ok: true, task: { kind: 'mission', title: 'Refaire le logo', tier: 5, xp: missionXp(5), owner: { id: bob.id }, giver: { id: ana.id } } });
    expect(await assigned).toMatchObject({ title: 'Refaire le logo', seen: false });
  });

  test('refusée : charge invalide, à soi-même, à un inconnu', async () => {
    const srv = await office();
    const ana = await person(srv, 'ana@x.fr');
    await teleport(ana, AT_DESK);
    expect(await give(ana, { to: 'x', title: 'x', tier: 11 })).toEqual({ ok: false, error: 'invalid' });
    expect(await give(ana, { to: ana.id, title: 'x', tier: 1 })).toEqual({ ok: false, error: 'self' });
    expect(await give(ana, { to: 'personne', title: 'x', tier: 1 })).toEqual({ ok: false, error: 'unknown_member' });
  });

  test('la faire : son XP lui revient (`progress:mine`, avec le gain), tout le bureau voit son niveau monter, et Ana apprend qu\'elle est faite', async () => {
    const srv = await office();
    const ana = await person(srv, 'ana@x.fr');
    const bob = await person(srv, 'bob@x.fr');
    await teleport(ana, AT_DESK);
    const ack = await give(ana, { to: bob.id, title: 'Le grand projet', tier: 10 });
    if (!ack.ok) throw new Error(ack.error);

    const mine = nextEvent(bob.socket, 'progress:mine');
    const levelSeenByAna = nextEvent(ana.socket, 'progress:level');
    const doneSeenByAna = nextEvent(ana.socket, 'task:changed');
    const res = await request(srv.app).post(`/api/me/tasks/${ack.task.id}/done`).set('Cookie', bob.cookie);
    expect(res.status).toBe(200);
    expect(await mine).toMatchObject({ gain: { amount: missionXp(10), source: 'mission', levelBefore: 0, levelAfter: 5, kuartzons: kuartzonsBetween(0, 5) } });
    expect(await levelSeenByAna).toEqual({ id: bob.id, level: 5 });
    expect(await doneSeenByAna).toMatchObject({ id: ack.task.id, status: 'done' });
    // Le monde le retient : qui arrive ensuite le voit au niveau 5.
    const cleo = await person(srv, 'cleo@x.fr');
    expect(cleo.init.players.find((player) => player.id === bob.id)?.level).toBe(5);
  });

  test('la retirer avant qu\'elle soit faite : celle qui l\'avait reçue la voit partir', async () => {
    const srv = await office();
    const ana = await person(srv, 'ana@x.fr');
    const bob = await person(srv, 'bob@x.fr');
    await teleport(ana, AT_DESK);
    const ack = await give(ana, { to: bob.id, title: 'Plus besoin', tier: 2 });
    if (!ack.ok) throw new Error(ack.error);
    const cancelled = nextEvent(bob.socket, 'task:changed');
    expect((await request(srv.app).post(`/api/me/missions/${ack.task.id}/cancel`).set('Cookie', ana.cookie)).status).toBe(200);
    expect(await cancelled).toMatchObject({ id: ack.task.id, status: 'cancelled' });
  });
});

describe('le pointage et l\'init', () => {
  test('l\'init dit sa progression ; la première arrivée du jour rapporte le pointage, une seule fois', async () => {
    const srv = await office(true);
    const cookie = await srv.inviteAndLogin('ana@x.fr');
    const socket = srv.connect(cookie);
    const seen = record(socket);
    const init = await nextEvent(socket, 'init');
    expect(init.progress).toMatchObject({ xp: 0, kuartzons: 0, owned: [] });
    // Le pointage part juste après l'init : il est peut-être déjà là.
    for (let waited = 0; seen.payloadsOf('progress:mine').length === 0 && waited < 2000; waited += 50) await sleep(50);
    expect(seen.payloadsOf('progress:mine')).toMatchObject([{ xp: CHECKIN_XP, gain: { source: 'checkin', amount: CHECKIN_XP } }]);
    // Un second onglet le même jour : rien de plus.
    const again = srv.connect(cookie);
    await nextEvent(again, 'init');
    await sleep(200);
    expect(seen.payloadsOf('progress:mine')).toHaveLength(1);
  });
});

describe('debug:xp (E2E)', () => {
  test('de l\'XP d\'un coup : le niveau monte chez tout le monde', async () => {
    const srv = await office();
    const ana = await person(srv, 'ana@x.fr');
    const bob = await person(srv, 'bob@x.fr');
    const level = nextEvent(bob.socket, 'progress:level');
    ana.socket.emit('debug:xp', { xp: 12_000, kuartzons: 500 });
    expect(await level).toEqual({ id: ana.id, level: 12 });
  });
});

// Un élément de la boutique (s'il y en a dans la banque) : sans l'avoir acheté, on ne le pose pas.
const forSale = DECOR_ITEMS.find((item) => item.price !== undefined && item.kind === 'wall');
describe.skipIf(!forSale)('la déco et la boutique', () => {
  test('poser un élément de la boutique sans l\'avoir acheté : `not_owned` ; acheté, il se pose', async () => {
    const srv = await office();
    const ana = await person(srv, 'ana@x.fr');
    const decor = { type: 'decor' as const, floor: 'f1', wall: 'w1', items: [{ id: forSale!.id, x: 1, y: 0 }] };
    // Le bureau de la personne et ses thèmes du moment, pour ne changer que les éléments.
    const desk = ana.init.desks.find((d) => d.ownerId === ana.id)!;
    const save = () => new Promise((resolve) => ana.socket.emit('desk:do', { ...decor, floor: desk.floor, wall: desk.wall }, resolve));
    expect(await save()).toEqual({ ok: false, error: 'bad_decor', reason: 'not_owned' });
    ana.socket.emit('debug:xp', { xp: 0, kuartzons: forSale!.price! });
    await nextEvent(ana.socket, 'progress:mine');
    expect((await request(srv.app).post('/api/shop/buy').set('Cookie', ana.cookie).send({ itemId: forSale!.id })).status).toBe(200);
    expect(await save()).toEqual({ ok: true });
  });
});
