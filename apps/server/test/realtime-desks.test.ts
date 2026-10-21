import { DESK_KNOCK_COOLDOWN_MS, DESK_RATE, type DeskAck, type DeskCommand, type MovePayload } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { enter, nextEvent, record, sleep, startTestServer, type ClientSocket, type TestServer } from './helpers/realtime';
import { findUserByEmail } from './helpers/test-app';

// La grande carte (MAP_KEY=office) : le bureau A1 est la pièce des cases x 1 à 7, y 1 à 5 ; sa porte, les cases (3, 6) et (4, 6), au sud.
// La case (3, 6) est la porte, (3, 7) l'allée juste devant, (2, 4) et (3, 5) l'intérieur de la pièce. Centre d'une case, en pixels.
const px = (tile: number) => tile * 32 + 16;
const DOORWAY = { x: px(3), y: px(6) };
const INSIDE = { x: px(2), y: px(4) };
const OUTSIDE = { x: px(3), y: px(8) };   // dans l'allée, 2 cases devant la porte

const step = (to: { x: number; y: number }): MovePayload => ({ ...to, dir: 'up', moving: true });

async function startOffice() {
  return startTestServer({ env: { MAP_KEY: 'office', E2E: '1' } });
}

// Une personne au bureau : arrivée par la vraie route, posée là où le test le veut (debug:teleport, E2E=1).
async function person(srv: TestServer, email: string) {
  const cookie = await srv.inviteAndLogin(email);
  const entered = await enter(srv, cookie);
  return { ...entered, email, cookie };
}
type Person = Awaited<ReturnType<typeof person>>;

function teleport(p: Person, at: { x: number; y: number }) {
  p.socket.emit('debug:teleport', at);
  return sleep(60);
}

function run(socket: ClientSocket, command: DeskCommand): Promise<DeskAck> {
  return new Promise((resolve) => socket.emit('desk:do', command, resolve));
}

const posOf = (srv: TestServer, p: Person) => {
  const { x, y } = srv.realtime.world.get(p.id)!;
  return { x, y };
};

describe('les places', () => {
  test('à l\'arrivée : A1 au premier, A2 au deuxième ; l\'init dit les 20 places, et chacun apprend le bureau pris par l\'autre', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    expect(a.init.mapKey).toBe('office');
    expect(a.init.desks).toHaveLength(20);
    expect(a.init.desks[0]).toEqual({ key: 'A1', ownerId: a.id, ownerName: 'a', name: null, locked: false, closedByState: false });
    expect(a.init.closedDesks).toEqual([]);

    const changed = nextEvent(a.socket, 'desk:changed');
    const b = await person(srv, 'b@x.fr');
    expect(await changed).toEqual({ key: 'A2', ownerId: b.id, ownerName: 'b', name: null, locked: false, closedByState: false });
    expect(b.init.desks.filter((d) => d.ownerId !== null).map((d) => d.key)).toEqual(['A1', 'A2']);
  });

  test('revenir (reconnexion) ne change pas de place', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    a.socket.disconnect();
    await sleep(500);   // au-delà du délai de grâce : elle quitte le monde, et son retour est une vraie arrivée
    expect(srv.realtime.world.get(a.id)).toBeUndefined();
    const again = await enter(srv, a.cookie);
    expect(again.init.desks.filter((d) => d.ownerId === a.id).map((d) => d.key)).toEqual(['A1']);
  });

  test('desk:do claim : déménager dans une place libre, la leur reste fermée aux autres places prises ; tout le monde le voit', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const seenByB = record(b.socket);

    expect(await run(a.socket, { type: 'claim', key: 'B4' })).toEqual({ ok: true });
    await sleep(60);
    expect(seenByB.payloadsOf('desk:changed')).toEqual([
      { key: 'A1', ownerId: null, ownerName: null, name: null, locked: false, closedByState: false },
      { key: 'B4', ownerId: a.id, ownerName: 'a', name: null, locked: false, closedByState: false },
    ]);
    expect(await run(b.socket, { type: 'claim', key: 'B4' })).toEqual({ ok: false, error: 'taken' });
    expect(await run(b.socket, { type: 'claim', key: 'nulle-part' })).toEqual({ ok: false, error: 'unknown_desk' });
  });

  test('rename, lock, release : diffusés, bornés, et sans bureau no_desk', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const seen = record(b.socket);

    expect(await run(a.socket, { type: 'rename', name: '  Le labo  ' })).toEqual({ ok: true });
    expect(await run(a.socket, { type: 'lock', locked: true })).toEqual({ ok: true });
    await sleep(60);
    expect(seen.payloadsOf('desk:changed').at(-1)).toMatchObject({ key: 'A1', name: 'Le labo', locked: true });
    expect(seen.payloadsOf('desk:access').at(-1)).toEqual({ closed: ['A1'] });   // B : A1 lui est fermé

    expect(await run(a.socket, { type: 'release' })).toEqual({ ok: true });
    expect(await run(a.socket, { type: 'rename', name: 'x' })).toEqual({ ok: false, error: 'no_desk' });
    expect(await run(a.socket, { type: 'goto' })).toEqual({ ok: false, error: 'no_desk' });
    await sleep(60);
    expect(seen.payloadsOf('desk:access').at(-1)).toEqual({ closed: [] });
  });

  test('commande invalide : invalid ; trop de commandes : rate_limited', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const raw = (payload: unknown) => new Promise<DeskAck>((resolve) => (a.socket as unknown as { emit(e: string, ...a: unknown[]): void }).emit('desk:do', payload, resolve));
    expect(await raw({ type: 'inconnue' })).toEqual({ ok: false, error: 'invalid' });
    expect(await raw({ type: 'rename', name: 'x'.repeat(41) })).toEqual({ ok: false, error: 'invalid' });
    expect(await raw('bonjour')).toEqual({ ok: false, error: 'invalid' });
    const acks = await Promise.all(Array.from({ length: DESK_RATE.max + 5 }, () => run(a.socket, { type: 'lock', locked: false })));
    expect(acks.filter((ack) => !ack.ok && ack.error === 'rate_limited').length).toBeGreaterThan(0);
  });
});

describe('une porte fermée', () => {
  test('on n\'y entre pas (move:correct), le propriétaire si ; porte rouverte, on y entre', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');   // A1
    const b = await person(srv, 'b@x.fr');
    await run(a.socket, { type: 'lock', locked: true });
    await teleport(b, DOORWAY);

    const corrected = nextEvent(b.socket, 'move:correct');
    b.socket.emit('move', step({ x: DOORWAY.x, y: px(5) }));
    expect(await corrected).toEqual(DOORWAY);
    expect(posOf(srv, b)).toEqual(DOORWAY);

    await teleport(a, DOORWAY);
    const ownerCorrections = record(a.socket);
    a.socket.emit('move', step({ x: DOORWAY.x, y: px(5) }));
    await sleep(100);
    expect(ownerCorrections.names()).not.toContain('move:correct');
    expect(posOf(srv, a)).toEqual({ x: DOORWAY.x, y: px(5) });

    await run(a.socket, { type: 'lock', locked: false });
    b.socket.emit('move', step({ x: DOORWAY.x, y: px(5) }));
    await sleep(100);
    expect(posOf(srv, b)).toEqual({ x: DOORWAY.x, y: px(5) });
  });

  test('on peut rester dans une pièce dont la porte se ferme, et en sortir ; y revenir est refusé', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(b, INSIDE);
    await run(a.socket, { type: 'lock', locked: true });
    b.socket.emit('move', step({ x: px(2), y: px(5) }));
    await sleep(100);
    expect(posOf(srv, b)).toEqual({ x: px(2), y: px(5) });   // il y circule encore

    await teleport(b, DOORWAY);
    const corrected = nextEvent(b.socket, 'move:correct');
    b.socket.emit('move', step({ x: DOORWAY.x, y: px(5) }));
    expect(await corrected).toEqual(DOORWAY);
  });

  test('toquer : le propriétaire voit qui toque ; une seule fois par DESK_KNOCK_COOLDOWN_MS ; admis, on entre', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    expect(await run(b.socket, { type: 'knock', key: 'A1' })).toEqual({ ok: false, error: 'not_locked' });   // porte ouverte
    await run(a.socket, { type: 'lock', locked: true });

    const knock = nextEvent(a.socket, 'desk:knock');
    expect(await run(b.socket, { type: 'knock', key: 'A1' })).toEqual({ ok: true });
    expect(await knock).toEqual({ key: 'A1', userId: b.id, name: 'b' });

    const again = record(a.socket);
    expect(await run(b.socket, { type: 'knock', key: 'A1' })).toEqual({ ok: true });
    await sleep(60);
    expect(again.names()).not.toContain('desk:knock');
    expect(DESK_KNOCK_COOLDOWN_MS).toBeGreaterThan(1000);

    expect(await run(b.socket, { type: 'knock', key: 'A2' })).toEqual({ ok: false, error: 'self' });
    expect(await run(a.socket, { type: 'knock', key: 'A1' })).toEqual({ ok: false, error: 'self' });

    const access = nextEvent(b.socket, 'desk:access');
    expect(await run(a.socket, { type: 'admit', userId: b.id })).toEqual({ ok: true });
    expect(await access).toEqual({ closed: [] });
    await teleport(b, DOORWAY);
    b.socket.emit('move', step({ x: DOORWAY.x, y: px(5) }));
    await sleep(100);
    expect(posOf(srv, b)).toEqual({ x: DOORWAY.x, y: px(5) });
  });
});

describe('exclure', () => {
  test('quelqu\'un qui est dans le bureau : sorti devant la porte, sans y revenir, même porte ouverte ; réadmis, il revient', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(b, INSIDE);

    const corrected = nextEvent(b.socket, 'move:correct');
    const bans = nextEvent(a.socket, 'desk:bans');
    const bAccess = nextEvent(b.socket, 'desk:access');
    expect(await run(a.socket, { type: 'kick', userId: b.id })).toEqual({ ok: true });
    // Devant la porte, un pas hors de la pièce : le centre de la porte (x 128, y 208), plus une case vers le sud.
    expect(await corrected).toEqual({ x: 128, y: 240 });
    expect(await bans).toEqual([{ id: b.id, name: 'b' }]);
    expect(await bAccess).toEqual({ closed: ['A1'] });
    expect(posOf(srv, b)).toEqual({ x: 128, y: 240 });

    await teleport(b, DOORWAY);
    const refused = nextEvent(b.socket, 'move:correct');
    b.socket.emit('move', step({ x: DOORWAY.x, y: px(5) }));
    await refused;

    expect(await run(a.socket, { type: 'unban', userId: b.id })).toEqual({ ok: true });
    b.socket.emit('move', step({ x: DOORWAY.x, y: px(5) }));
    await sleep(100);
    expect(posOf(srv, b)).toEqual({ x: DOORWAY.x, y: px(5) });
  });

  test('quelqu\'un qui n\'y est pas : not_inside ; soi-même : self ; sans bureau : no_desk', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(b, OUTSIDE);
    expect(await run(a.socket, { type: 'kick', userId: b.id })).toEqual({ ok: false, error: 'not_inside' });
    expect(await run(a.socket, { type: 'kick', userId: a.id })).toEqual({ ok: false, error: 'self' });
    expect(await run(a.socket, { type: 'kick', userId: 'inconnu' })).toEqual({ ok: false, error: 'not_inside' });
    await run(a.socket, { type: 'release' });
    expect(await run(a.socket, { type: 'kick', userId: b.id })).toEqual({ ok: false, error: 'no_desk' });
  });
});

describe('aller à son bureau', () => {
  test('goto : posé dans la pièce, et son navigateur se replace', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    await teleport(a, OUTSIDE);
    const corrected = nextEvent(a.socket, 'move:correct');
    expect(await run(a.socket, { type: 'goto' })).toEqual({ ok: true });
    const at = await corrected;
    expect(at.x).toBe(144);   // le milieu de la pièce A1 : x 32 à 255
    expect(at.y).toBe(112);   // y 32 à 191
    expect(posOf(srv, a)).toEqual(at);
  });
});

describe('la vie des bureaux', () => {
  test('un membre retiré rend sa place', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const seen = nextEvent(b.socket, 'desk:changed');
    srv.events.emit('member:removed', a.id);
    expect(await seen).toEqual({ key: 'A1', ownerId: null, ownerName: null, name: null, locked: false, closedByState: false });
    const c = await person(srv, 'c@x.fr');
    expect(c.init.desks.find((d) => d.ownerId === c.id)?.key).toBe('A1');
  });

  test('un profil renommé change le nom affiché sur le bureau', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const seen = nextEvent(b.socket, 'desk:changed');
    srv.events.emit('profile:changed', { id: a.id, name: 'Anaïs', avatarKey: null });
    expect(await seen).toMatchObject({ key: 'A1', ownerName: 'Anaïs' });
  });

  test('un redémarrage du serveur garde les bureaux, leur nom et leur verrou', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    await run(a.socket, { type: 'claim', key: 'C2' });
    await run(a.socket, { type: 'rename', name: 'Chez A' });
    await run(a.socket, { type: 'lock', locked: true });
    await srv.restart();
    const user = await findUserByEmail(srv.db, 'a@x.fr');
    expect(user).toBeTruthy();
    await sleep(300);
    expect(srv.realtime.desks.get('C2')).toEqual({ key: 'C2', ownerId: a.id, ownerName: 'a', name: 'Chez A', locked: true, closedByState: false });
    expect(srv.realtime.desks.get('A1')?.ownerId).toBeNull();
  });
});
