import { DESK_INVITE_TTL_MS, JOIN_RATE, buildOfficeTiledMap, parseOfficeMap, zoneAt, type DeskAck, type DeskCommand, type JoinAck } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { enter, nextEvent, record, sleep, startTestServer, type ClientSocket, type TestServer } from './helpers/realtime';

// Inviter quelqu'un dans son bureau, et rejoindre quelqu'un (le menu d'une personne, au clic droit), sur la grande carte (MAP_KEY=office) : le bureau A1 est la
// pièce des cases x 26 à 34, y 7 à 13, sa porte (x 29 et 30, y 14 et 15) perce la bande de mur du sud. (28, 11) est un point de la pièce, (29, 17) la rue,
// devant la porte. Centre d'une case, en pixels.
const px = (tile: number) => tile * 32 + 16;
const INSIDE = { x: px(28), y: px(11) };
const OUTSIDE = { x: px(29), y: px(17) };
const CORRIDOR = { x: px(41), y: px(17) };
// La carte des tests (celle du serveur) : pour savoir dans quelle zone quelqu'un se trouve.
const map = parseOfficeMap(buildOfficeTiledMap());

const startOffice = () => startTestServer({ env: { MAP_KEY: 'office', E2E: '1' } });

async function person(srv: TestServer, email: string) {
  const cookie = await srv.inviteAndLogin(email);
  const entered = await enter(srv, cookie);
  return { ...entered, email, cookie };
}
type Person = Awaited<ReturnType<typeof person>>;

async function teleport(srv: TestServer, p: Person, at: { x: number; y: number }) {
  p.socket.emit('debug:teleport', at);
  for (let tries = 0; tries < 20; tries++) {
    const now = srv.realtime.world.get(p.id);
    if (now?.x === at.x && now.y === at.y) return;
    await sleep(20);
  }
}

const run = (socket: ClientSocket, command: DeskCommand): Promise<DeskAck> => new Promise((resolve) => socket.emit('desk:do', command, resolve));
const join = (socket: ClientSocket, userId: string): Promise<JoinAck> => new Promise((resolve) => socket.emit('person:join', { userId }, resolve));
const posOf = (srv: TestServer, p: Person) => {
  const { x, y } = srv.realtime.world.get(p.id)!;
  return { x, y };
};
// Le bureau où est cette personne, d'après le serveur (null : hors de tout bureau).
const deskAt = (srv: TestServer, p: Person) => {
  const { x, y } = posOf(srv, p);
  return zoneAt(map, x, y, ['desk'])?.name ?? null;
};

describe('inviter dans son bureau', () => {
  test('dans son bureau seulement ; l\'invitée le voit, accepte, et arrive dans la pièce, porte fermée, par un voyage ; qui invite l\'apprend', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');   // A1
    const b = await person(srv, 'b@x.fr');   // A2
    await run(a.socket, { type: 'lock', locked: true });
    await teleport(srv, a, OUTSIDE);
    await teleport(srv, b, CORRIDOR);
    expect(await run(a.socket, { type: 'invite', userId: b.id })).toEqual({ ok: false, error: 'not_home' });

    await teleport(srv, a, INSIDE);
    const invited = nextEvent(b.socket, 'desk:invite');
    expect(await run(a.socket, { type: 'invite', userId: b.id })).toEqual({ ok: true });
    const invite = await invited;
    expect(invite).toEqual({ id: expect.any(String), key: 'A1', from: { id: a.id, name: 'a', avatarKey: null }, ttlMs: DESK_INVITE_TTL_MS });

    const corrected = nextEvent(b.socket, 'move:correct');
    const access = nextEvent(b.socket, 'desk:access');
    const notice = nextEvent(a.socket, 'desk:notice');
    expect(await run(b.socket, { type: 'answer', invite: invite.id, accept: true })).toEqual({ ok: true });
    expect(await access).toEqual({ closed: [] });
    expect((await corrected).reason).toBe('teleport');
    expect(deskAt(srv, b)).toBe('A1');
    // À une case de qui invite, pas sur lui.
    const [pa, pb] = [posOf(srv, a), posOf(srv, b)];
    expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeGreaterThanOrEqual(20);
    expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeLessThanOrEqual(48);
    expect(await notice).toEqual({ kind: 'accepted', user: { id: b.id, name: 'b' } });
    // Une réponse de plus à la même invitation : elle n'existe plus.
    expect(await run(b.socket, { type: 'answer', invite: invite.id, accept: true })).toEqual({ ok: false, error: 'expired' });
  });

  test('refuser : qui invite l\'apprend, et rien ne bouge ; réinviter tout de suite ne renvoie rien', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(srv, a, INSIDE);
    await teleport(srv, b, CORRIDOR);
    const invited = nextEvent(b.socket, 'desk:invite');
    await run(a.socket, { type: 'invite', userId: b.id });
    const invite = await invited;

    const seenByB = record(b.socket);
    expect(await run(a.socket, { type: 'invite', userId: b.id })).toEqual({ ok: true });
    await sleep(60);
    expect(seenByB.names()).not.toContain('desk:invite');

    const notice = nextEvent(a.socket, 'desk:notice');
    expect(await run(b.socket, { type: 'answer', invite: invite.id, accept: false })).toEqual({ ok: true });
    expect(await notice).toEqual({ kind: 'declined', user: { id: b.id, name: 'b' } });
    expect(posOf(srv, b)).toEqual(CORRIDOR);
    expect(seenByB.payloadsOf('desk:invite:gone')).toEqual([{ id: invite.id }]);
  });

  test('soi-même : self ; déjà dans la pièce : already_inside ; pas au bureau : offline ; sans bureau : no_desk ; une invitation inconnue : expired', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(srv, a, INSIDE);
    expect(await run(a.socket, { type: 'invite', userId: a.id })).toEqual({ ok: false, error: 'self' });
    expect(await run(a.socket, { type: 'invite', userId: 'personne' })).toEqual({ ok: false, error: 'offline' });
    await teleport(srv, b, { x: INSIDE.x + 64, y: INSIDE.y });
    expect(await run(a.socket, { type: 'invite', userId: b.id })).toEqual({ ok: false, error: 'already_inside' });
    expect(await run(b.socket, { type: 'answer', invite: 'inconnue', accept: true })).toEqual({ ok: false, error: 'expired' });
    await run(a.socket, { type: 'release' });
    expect(await run(a.socket, { type: 'invite', userId: b.id })).toEqual({ ok: false, error: 'no_desk' });
  });

  test('qui ne veut pas être dérangé n\'est pas invité : dnd', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(srv, a, INSIDE);
    b.socket.emit('status:set', 'dnd');
    await sleep(60);
    expect(await run(a.socket, { type: 'invite', userId: b.id })).toEqual({ ok: false, error: 'dnd' });
  });

  test('une invitation en attente est dans l\'init de qui revient (un rechargement ne la perd pas)', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(srv, a, INSIDE);
    const invited = nextEvent(b.socket, 'desk:invite');
    await run(a.socket, { type: 'invite', userId: b.id });
    const invite = await invited;
    const again = await enter(srv, b.cookie);
    expect(again.init.deskInvites).toEqual([{ ...invite, ttlMs: expect.any(Number) }]);
    expect(again.init.deskInvites![0]!.ttlMs).toBeLessThanOrEqual(DESK_INVITE_TTL_MS);
  });
});

describe('rejoindre quelqu\'un', () => {
  test('posé à une case de la personne, par un voyage (l\'anneau de lumière) ; soi-même : self ; pas au bureau : offline', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    await teleport(srv, b, CORRIDOR);
    const corrected = nextEvent(a.socket, 'move:correct');
    expect(await join(a.socket, b.id)).toEqual({ ok: true });
    expect((await corrected).reason).toBe('teleport');
    const at = posOf(srv, a);
    expect(Math.hypot(at.x - CORRIDOR.x, at.y - CORRIDOR.y)).toBe(32);
    expect(await join(a.socket, a.id)).toEqual({ ok: false, error: 'self' });
    expect(await join(a.socket, 'personne')).toEqual({ ok: false, error: 'offline' });
  });

  test('la personne est dans un bureau fermé : on arrive devant sa porte, dans le couloir', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');   // A1
    const c = await person(srv, 'c@x.fr');
    await run(a.socket, { type: 'lock', locked: true });
    await teleport(srv, a, INSIDE);
    await teleport(srv, c, CORRIDOR);
    expect(await join(c.socket, a.id)).toEqual({ ok: true });
    expect(deskAt(srv, c)).toBeNull();
    const at = posOf(srv, c);
    expect(zoneAt(map, at.x, at.y, ['door'])).toBeNull();
    expect(Math.hypot(at.x - OUTSIDE.x, at.y - OUTSIDE.y)).toBeLessThanOrEqual(2 * 32);
  });

  test('la personne est dans la rue, juste sous la fontaine du dehors de A1 (son dehors par défaut) : on n\'est jamais posé dans la fontaine', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');   // A1, rien de réglé : son dehors par défaut, la fontaine en (27, 16)
    const b = await person(srv, 'b@x.fr');
    await teleport(srv, b, { x: px(27), y: px(17) });
    expect(await join(a.socket, b.id)).toEqual({ ok: true });
    // Des quatre cases voisines, la plus haute (la fontaine) est fermée : la suivante, à l'ouest.
    expect(posOf(srv, a)).toEqual({ x: px(26), y: px(17) });
  });

  test('une demande mal formée : invalid ; trop de demandes : rate_limited', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const raw = (payload: unknown) => new Promise<JoinAck>((resolve) => (a.socket as unknown as { emit(e: string, p: unknown, ack: (r: JoinAck) => void): void }).emit('person:join', payload, resolve));
    expect(await raw({ userId: 42 })).toEqual({ ok: false, error: 'invalid' });
    expect(await raw(null)).toEqual({ ok: false, error: 'invalid' });
    for (let i = 0; i < JOIN_RATE.max; i++) expect((await join(a.socket, b.id)).ok).toBe(true);
    expect(await join(a.socket, b.id)).toEqual({ ok: false, error: 'rate_limited' });
  });
});
