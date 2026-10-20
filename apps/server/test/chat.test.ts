import { CHAT_HISTORY_LIMIT, CHAT_MAX_LENGTH, CHAT_RATE, OFFICE_ROOM, type ChatAck, type ChatMessage, type ChatSendPayload } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { removeMember } from '../src/admin/remove-member';
import { createChatService } from '../src/chat/chat-service';
import { chatMessage, user } from '../src/db/schema';
import type { MediaBackend } from '../src/media/livekit';
import { captureLogs } from './helpers/logs';
import {
  cutNetwork,
  nextEvent,
  nextInit,
  record,
  sleep,
  slowDatabase,
  startTestServer,
  type ClientSocket,
  type TestServer,
} from './helpers/realtime';
import { createTestApp, findUserByEmail } from './helpers/test-app';

// La carte de développement (24 × 16 cases de 32 px) : l'apparition en (80, 240), sur la ligne 7, du sol de bout en bout. Deux
// personnes à une case l'une de l'autre, arrêtées, forment un groupe en 500 ms ; à plus de 4 cases, non.
const SIDE_A = { x: 400, y: 240 };
const SIDE_B = { x: 432, y: 240 };   // une case à droite de SIDE_A
const FAR_C = { x: 656, y: 240 };    // à 7 cases de SIDE_B
const FAR_D = { x: 688, y: 240 };    // une case à droite de FAR_C

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const everyone = (text: string) => ({ channel: 'all' as const, text });
const nearby = (text: string) => ({ channel: 'nearby' as const, text });

// Les requêtes de l'historique (lecture) et de l'enregistrement (écriture) des messages, pour la base lente ou en panne.
const isChatRead = (sql: string) => /^select\b[\s\S]*\bfrom "chat_message"/i.test(sql);
const isChatWrite = (sql: string) => /^insert into "chat_message"/i.test(sql);

type Player = { socket: ClientSocket; id: string; init: Awaited<ReturnType<typeof nextInit>>; events: ReturnType<typeof record> };

// Entre au bureau en enregistrant tout ce que la socket reçoit, init compris.
async function enterRecorded(srv: TestServer, email: string): Promise<Player> {
  const socket = srv.connect(await srv.inviteAndLogin(email));
  const events = record(socket);
  const init = await nextInit(socket);
  return { socket, id: init.self.id, init, events };
}

async function teleport(srv: TestServer, p: Player, to: { x: number; y: number }): Promise<void> {
  p.socket.emit('debug:teleport', to);
  await vi.waitFor(() => expect(srv.realtime.world.get(p.id)).toMatchObject(to));
}

const received = (p: Player): ChatMessage[] => p.events.payloadsOf('chat:message') as ChatMessage[];
const textsOf = (p: Player): string[] => received(p).map((m) => m.text);
const sortedIds = (...players: Player[]): string[] => players.map((p) => p.id).sort();

// L'accusé de réception d'un chat:send. La charge utile n'est pas typée : on envoie aussi ce qu'un client ne devrait pas envoyer.
function send(socket: ClientSocket, payload: unknown): Promise<ChatAck> {
  return new Promise<ChatAck>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('chat:send : pas d\'accusé en 2 s')), 2000);
    socket.emit('chat:send', payload as ChatSendPayload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

// Un émetteur sans le typage du protocole : un client modifié envoie ce qu'il veut, avec ou sans rappel.
const raw = (socket: ClientSocket) => socket as unknown as { emit(event: string, ...args: unknown[]): void };

// Les sockets dans la salle du bureau, côté serveur : celles qui ont reçu leur init, et aucune autre.
const officeSockets = (srv: TestServer): string[] => [...(srv.realtime.io.sockets.adapter.rooms.get(OFFICE_ROOM) ?? [])];

// La lecture de l'historique du chat échoue (la base est tombée), le reste de la base répond.
function failChatReads(srv: TestServer) {
  const client = (srv.db as unknown as { $client: { query(sql: string, ...rest: unknown[]): Promise<unknown> } }).$client;
  const query = client.query.bind(client);
  return vi.spyOn(client, 'query').mockImplementation(async (sql: string, ...rest: unknown[]) => {
    if (isChatRead(sql)) throw new Error('base illisible');
    return query(sql, ...rest);
  });
}

describe('service du chat', () => {
  test('recent : les 200 derniers, du plus ancien au plus récent', async () => {
    const t = await createTestApp();
    const alice = await t.inviteAndAccept('alice@x.fr', { name: 'Alice' });
    const bob = await t.inviteAndAccept('bob@x.fr', { name: 'Bob' });
    const start = Date.UTC(2026, 2, 4, 9, 0, 0);
    const authorOf = (n: number) => (n % 2 === 0 ? alice : bob);
    // 205 messages, à la seconde, insérés dans l'ordre inverse : seule la date fait l'ordre.
    const rows = Array.from({ length: 205 }, (_, i) => ({
      userId: authorOf(i + 1).userId,
      body: `message ${i + 1}`,
      createdAt: new Date(start + (i + 1) * 1000),
    }));
    await t.db.insert(chatMessage).values(rows.reverse());
    const chat = createChatService(t.db);

    const recent = await chat.recent();
    expect(recent).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(recent.map((m) => m.text)).toEqual(Array.from({ length: 200 }, (_, i) => `message ${i + 6}`));   // du 6e au 205e
    expect(recent[0]).toEqual({
      id: expect.stringMatching(UUID),
      channel: 'all',
      userId: alice.userId,
      name: 'Alice',
      text: 'message 6',
      sentAt: new Date(start + 6000).toISOString(),
    });
    expect(recent.at(-1)).toMatchObject({ text: 'message 205', userId: bob.userId, name: 'Bob' });

    // Une limite plus petite : les derniers, toujours du plus ancien au plus récent.
    expect((await chat.recent(3)).map((m) => m.text)).toEqual(['message 203', 'message 204', 'message 205']);
  });

  test('recent : des messages de la même milliseconde gardent le même ordre d\'un appel à l\'autre', async () => {
    const t = await createTestApp();
    const alice = await t.inviteAndAccept('alice@x.fr');
    const same = new Date('2026-03-04T09:00:00.000Z');
    await t.db.insert(chatMessage).values(['un', 'deux', 'trois', 'quatre'].map((body) => ({ userId: alice.userId, body, createdAt: same })));
    const chat = createChatService(t.db);

    const first = await chat.recent();
    expect(first).toHaveLength(4);
    expect(await chat.recent()).toEqual(first);
    // Une limite ne coupe pas au hasard : les deux derniers de cet ordre.
    expect(await chat.recent(2)).toEqual(first.slice(2));
  });

  test('post : le texte tel quel, le message rendu avec le nom de l\'auteur et l\'heure de l\'horloge ; le nom n\'est pas enregistré', async () => {
    const t = await createTestApp();
    const alice = await t.inviteAndAccept('alice@x.fr', { name: 'Alice' });
    const chat = createChatService(t.db, () => new Date('2026-03-04T05:06:07.089Z'));
    expect(await chat.recent()).toEqual([]);

    const text = 'Voir <b>ça</b> : https://exemple.fr/?a=1&b=2';
    const message = await chat.post(alice.userId, text);
    expect(message).toEqual({
      id: expect.stringMatching(UUID),
      channel: 'all',
      userId: alice.userId,
      name: 'Alice',
      text,
      sentAt: '2026-03-04T05:06:07.089Z',
    });
    // En base : l'auteur, le texte et l'heure. Pas son nom.
    expect(await t.db.select().from(chatMessage)).toEqual([
      { id: message.id, userId: alice.userId, body: text, createdAt: new Date('2026-03-04T05:06:07.089Z') },
    ]);
    expect(await chat.recent()).toEqual([message]);

    // L'historique donne son nom du moment : il n'y a rien à réécrire quand elle en change.
    await t.db.update(user).set({ name: 'Alice Martin' }).where(eq(user.id, alice.userId));
    expect(await chat.recent()).toEqual([{ ...message, name: 'Alice Martin' }]);
    expect((await chat.post(alice.userId, 'suite')).name).toBe('Alice Martin');
  });

  test('post : sans horloge, l\'heure de la machine ; un compte inconnu est refusé et rien n\'est enregistré', async () => {
    const t = await createTestApp();
    const alice = await t.inviteAndAccept('alice@x.fr');
    const chat = createChatService(t.db);

    const before = Date.now();
    const message = await chat.post(alice.userId, 'salut');
    expect(Date.parse(message.sentAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(message.sentAt)).toBeLessThanOrEqual(Date.now());

    // Le refus (clé étrangère) est l'erreur de la base, sans le texte du message ni les paramètres de la requête.
    const refused = await chat.post('compte-inconnu', 'un secret à ne pas écrire dans les journaux').catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(Error);
    expect(refused).toMatchObject({ message: expect.stringContaining('foreign key'), code: '23503' });
    const error = refused as Error;
    expect(JSON.stringify({ ...error, message: error.message, stack: error.stack, cause: error.cause })).not.toContain('secret');
    expect(await t.db.$count(chatMessage)).toBe(1);
  });
});

describe('chat:send, canal Tout le monde', () => {
  test('all : B reçoit, accusé ok, présent dans le init suivant', async () => {
    const srv = await startTestServer();
    const a = await enterRecorded(srv, 'a@x.fr');
    const b = await enterRecorded(srv, 'b@x.fr');

    // Les espaces autour sont coupés, le HTML n'est pas touché (le client le rend comme du texte). L'auteur, le nom, l'identifiant
    // et l'heure sont ceux du serveur, quoi que dise le client.
    const ack = await send(a.socket, {
      ...everyone('  Bonjour <b>tout le monde</b>  '),
      userId: 'quelqu-un-d-autre',
      name: 'Mallory',
      id: 'faux-id',
      sentAt: '2000-01-01T00:00:00.000Z',
    });
    expect(ack).toEqual({ ok: true });
    await vi.waitFor(() => expect(received(b)).toHaveLength(1));
    const message = received(b)[0]!;
    expect(message).toEqual({
      id: expect.stringMatching(UUID),
      channel: 'all',
      userId: a.id,
      name: 'a',
      text: 'Bonjour <b>tout le monde</b>',
      sentAt: expect.stringMatching(ISO_DATE),
    });
    expect(message.id).not.toBe('faux-id');
    expect(Math.abs(Date.parse(message.sentAt) - Date.now())).toBeLessThan(5000);
    // En base : l'auteur, le texte, l'heure d'envoi.
    expect(await srv.db.select().from(chatMessage)).toEqual([
      { id: message.id, userId: a.id, body: 'Bonjour <b>tout le monde</b>', createdAt: new Date(message.sentAt) },
    ]);

    await sleep(5);   // deux messages ne partagent pas la même milliseconde : ils gardent leur ordre dans l'historique
    expect(await send(b.socket, everyone('Salut A'))).toEqual({ ok: true });
    await vi.waitFor(() => expect(received(a)).toHaveLength(2));
    const reply = received(a)[1]!;
    // Chacun, l'émetteur compris (c'est sa confirmation), reçoit chaque message une seule fois.
    expect(received(a)).toEqual([message, reply]);
    expect(received(b)).toEqual([message, reply]);
    expect(reply).toMatchObject({ userId: b.id, name: 'b', text: 'Salut A', channel: 'all' });

    // Une nouvelle arrivée reçoit les deux, du plus ancien au plus récent.
    const c = await enterRecorded(srv, 'c@x.fr');
    expect(c.init.chatHistory).toEqual([message, reply]);
    // B recharge : sa socket revient pendant le délai de grâce, et son init redonne l'historique.
    const reinit = nextInit(b.socket);
    cutNetwork(b.socket);
    expect((await reinit).chatHistory).toEqual([message, reply]);
  });

  test('6 messages en 5 s → le 6e est refusé (rate_limited)', async () => {
    const clock = { t: 1_000 };
    const srv = await startTestServer({ now: () => clock.t });
    const a = await enterRecorded(srv, 'a@x.fr');
    const b = await enterRecorded(srv, 'b@x.fr');

    for (let n = 1; n <= CHAT_RATE.max; n++) {
      expect(await send(a.socket, everyone(`message ${n}`))).toEqual({ ok: true });
      clock.t += 500;   // 2,5 s en tout, dans la fenêtre ouverte au premier
    }
    expect(await send(a.socket, everyone('message 6'))).toEqual({ ok: false, error: 'rate_limited' });
    expect(await srv.db.$count(chatMessage)).toBe(CHAT_RATE.max);

    // Un message invalide est refusé comme tel, même au-delà de la limite : la validation passe avant le débit.
    expect(await send(a.socket, everyone('   '))).toEqual({ ok: false, error: 'invalid' });
    // La limite est celle du compte, pas de la socket : se reconnecter ne la remet pas à zéro.
    const again = nextInit(a.socket);
    cutNetwork(a.socket);
    await again;
    expect(await send(a.socket, everyone('message 7'))).toEqual({ ok: false, error: 'rate_limited' });
    // Chacun a la sienne.
    expect(await send(b.socket, everyone('message de B'))).toEqual({ ok: true });

    // La fenêtre, ouverte à la première prise, finit 5 s plus tard.
    clock.t = 1_000 + CHAT_RATE.windowMs - 1;
    expect(await send(a.socket, everyone('message 8'))).toEqual({ ok: false, error: 'rate_limited' });
    clock.t = 1_000 + CHAT_RATE.windowMs;
    expect(await send(a.socket, everyone('message 9'))).toEqual({ ok: true });

    // Les refusés n'ont ni été enregistrés ni été envoyés.
    await vi.waitFor(() => expect(textsOf(b)).toContain('message 9'));
    expect(textsOf(b)).toEqual(['message 1', 'message 2', 'message 3', 'message 4', 'message 5', 'message de B', 'message 9']);
    expect(await srv.db.$count(chatMessage)).toBe(CHAT_RATE.max + 2);
  });

  test('un texte que PostgreSQL refuse (un caractère NUL) : unavailable, journalisé sans le texte, rien n\'est envoyé, et le chat continue', async () => {
    const { logger, lines } = captureLogs();
    const srv = await startTestServer({ logger });
    const a = await enterRecorded(srv, 'a@x.fr');
    const b = await enterRecorded(srv, 'b@x.fr');

    // Le message n'a pas pu être enregistré, et le client n'y peut rien : `unavailable` (la cause est dans le journal).
    expect(await send(a.socket, everyone('un secret\u0000à ne pas écrire dans les journaux'))).toEqual({ ok: false, error: 'unavailable' });
    expect(lines.filter((line) => line.level === 50)).toEqual([
      expect.objectContaining({
        msg: 'Enregistrement du message impossible',
        userId: a.id,
        err: expect.objectContaining({ message: expect.stringContaining('invalid byte sequence') }),
      }),
    ]);
    // L'erreur de Drizzle cite les paramètres de la requête, donc le texte : le service rend l'erreur de la base, qui n'en dit rien.
    expect(JSON.stringify(lines)).not.toContain('secret');
    expect(await srv.db.$count(chatMessage)).toBe(0);

    // Rien n'est resté de la panne : le message suivant passe, et lui seul est reçu.
    expect(await send(a.socket, everyone('Ça repart'))).toEqual({ ok: true });
    await vi.waitFor(() => expect(textsOf(b)).toEqual(['Ça repart']));
  });

  test('le débit est commun aux deux canaux : un refus no_group compte aussi', async () => {
    const clock = { t: 1_000 };
    const srv = await startTestServer({ now: () => clock.t });
    const a = await enterRecorded(srv, 'a@x.fr');

    for (let n = 1; n <= CHAT_RATE.max; n++) {
      expect(await send(a.socket, nearby('Quelqu\'un ?'))).toEqual({ ok: false, error: 'no_group' });
    }
    // Le débit passe avant les règles du canal.
    expect(await send(a.socket, nearby('Quelqu\'un ?'))).toEqual({ ok: false, error: 'rate_limited' });
    expect(await send(a.socket, everyone('Quelqu\'un ?'))).toEqual({ ok: false, error: 'rate_limited' });
    expect(await srv.db.$count(chatMessage)).toBe(0);
  });
});

describe('chat:send, canal À proximité', () => {
  test('nearby sans groupe → no_group', async () => {
    const srv = await startTestServer();
    const a = await enterRecorded(srv, 'a@x.fr');

    expect(await send(a.socket, nearby('Il y a quelqu\'un ?'))).toEqual({ ok: false, error: 'no_group' });
    // Rien n'est parti, pas même vers l'émetteur : un message à tout le monde, ensuite, est le seul qu'il voit.
    expect(await send(a.socket, everyone('Tout le monde ?'))).toEqual({ ok: true });
    await vi.waitFor(() => expect(textsOf(a)).toEqual(['Tout le monde ?']));
    expect(await srv.db.$count(chatMessage)).toBe(1);
  });

  test('nearby dans {A,B} : B reçoit, C non, rien en base', { timeout: 20_000 }, async () => {
    const srv = await startTestServer({ env: { E2E: '1' } });
    const a = await enterRecorded(srv, 'a@x.fr');
    await teleport(srv, a, FAR_D);   // loin de l'apparition, où B arrive
    const b = await enterRecorded(srv, 'b@x.fr');
    await teleport(srv, b, SIDE_B);
    await teleport(srv, a, SIDE_A);
    const c = await enterRecorded(srv, 'c@x.fr');   // reste au point d'apparition, à 11 cases de B
    await vi.waitFor(() => expect(srv.realtime.coordinator.groupMembersOf(a.id)).toEqual(sortedIds(a, b)), { timeout: 4000 });
    expect(srv.realtime.coordinator.groupMembersOf(c.id)).toEqual([]);

    const before = Date.now();
    const ack = await send(a.socket, { ...nearby('  Un café ? <i>vite</i>  '), userId: c.id, name: 'Mallory', id: 'faux-id' });
    const after = Date.now();
    expect(ack).toEqual({ ok: true });
    await vi.waitFor(() => expect(received(b)).toHaveLength(1));
    const message = received(b)[0]!;
    expect(message).toEqual({
      id: expect.stringMatching(UUID),
      channel: 'nearby',
      userId: a.id,
      name: 'a',
      text: 'Un café ? <i>vite</i>',
      sentAt: expect.stringMatching(ISO_DATE),
    });
    expect(message.id).not.toBe('faux-id');
    expect(Date.parse(message.sentAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(message.sentAt)).toBeLessThanOrEqual(after);
    // L'émetteur est du groupe : il reçoit le sien, une seule fois.
    expect(received(a)).toEqual([message]);
    // Rien en base : « À proximité » n'est pas conservé.
    expect(await srv.db.$count(chatMessage)).toBe(0);

    // C est hors du groupe : il ne reçoit rien. Un message pour tous, ensuite, est le seul qu'il voit (les envois vers une socket
    // arrivent dans l'ordre où ils sont partis).
    expect(await send(c.socket, everyone('Bonjour de C'))).toEqual({ ok: true });
    await vi.waitFor(() => expect(textsOf(c)).toEqual(['Bonjour de C']));
    await vi.waitFor(() => expect(textsOf(a)).toEqual(['Un café ? <i>vite</i>', 'Bonjour de C']));
    expect(textsOf(b)).toEqual(['Un café ? <i>vite</i>', 'Bonjour de C']);
    // Et C, sans groupe, ne peut pas écrire à proximité.
    expect(await send(c.socket, nearby('Quelqu\'un ?'))).toEqual({ ok: false, error: 'no_group' });

    // A s'éloigne : le groupe se défait, et plus personne ne peut écrire à proximité.
    await teleport(srv, a, FAR_D);
    await vi.waitFor(
      () => {
        expect(srv.realtime.coordinator.groupMembersOf(a.id)).toEqual([]);
        expect(srv.realtime.coordinator.groupMembersOf(b.id)).toEqual([]);
      },
      { timeout: 4000 },
    );
    expect(await send(a.socket, nearby('Plus personne'))).toEqual({ ok: false, error: 'no_group' });
    expect(await send(b.socket, nearby('Plus personne'))).toEqual({ ok: false, error: 'no_group' });
    expect(await srv.db.$count(chatMessage)).toBe(1);   // le seul message pour tous
  });

  test('deux conversations à la fois : un message ne sort pas de son groupe', { timeout: 30_000 }, async () => {
    const srv = await startTestServer({ env: { E2E: '1' } });
    const a = await enterRecorded(srv, 'a@x.fr');
    await teleport(srv, a, SIDE_A);
    const b = await enterRecorded(srv, 'b@x.fr');
    await teleport(srv, b, SIDE_B);
    const c = await enterRecorded(srv, 'c@x.fr');
    await teleport(srv, c, FAR_C);
    const d = await enterRecorded(srv, 'd@x.fr');
    await teleport(srv, d, FAR_D);
    const e = await enterRecorded(srv, 'e@x.fr');   // seule, au point d'apparition
    await vi.waitFor(
      () => {
        expect(srv.realtime.coordinator.groupMembersOf(a.id)).toEqual(sortedIds(a, b));
        expect(srv.realtime.coordinator.groupMembersOf(c.id)).toEqual(sortedIds(c, d));
      },
      { timeout: 5000 },
    );
    expect(srv.realtime.coordinator.groupMembersOf(e.id)).toEqual([]);

    expect(await send(a.socket, nearby('de A pour B'))).toEqual({ ok: true });
    expect(await send(d.socket, nearby('de D pour C'))).toEqual({ ok: true });
    // Un message pour tous ferme la marche : tout ce qui devait arriver avant lui est arrivé.
    expect(await send(e.socket, everyone('de E pour tous'))).toEqual({ ok: true });
    await vi.waitFor(() => {
      for (const p of [a, b, c, d, e]) expect(textsOf(p)).toContain('de E pour tous');
    });
    expect(textsOf(a)).toEqual(['de A pour B', 'de E pour tous']);
    expect(textsOf(b)).toEqual(['de A pour B', 'de E pour tous']);
    expect(textsOf(c)).toEqual(['de D pour C', 'de E pour tous']);
    expect(textsOf(d)).toEqual(['de D pour C', 'de E pour tous']);
    expect(textsOf(e)).toEqual(['de E pour tous']);
    expect(received(c)[0]).toMatchObject({ channel: 'nearby', userId: d.id, name: 'd' });
  });

  test('une socket revenue qui attend son init ne reçoit rien du groupe et ne peut rien écrire ; son init arrive d\'abord', { timeout: 20_000 }, async () => {
    // Un long délai de grâce : B reste au monde, et dans son groupe, pendant que sa nouvelle socket attend la base.
    const srv = await startTestServer({ env: { E2E: '1' }, graceMs: 5_000 });
    const a = await enterRecorded(srv, 'a@x.fr');
    await teleport(srv, a, FAR_D);
    const b = await enterRecorded(srv, 'b@x.fr');
    await teleport(srv, b, SIDE_B);
    await teleport(srv, a, SIDE_A);
    await vi.waitFor(() => expect(srv.realtime.coordinator.groupMembersOf(a.id)).toEqual(sortedIds(a, b)), { timeout: 4000 });

    // Le retour de B lit l'historique du chat : la base le retient. Sa socket est enregistrée, mais n'a pas son init.
    const slow = slowDatabase(srv, isChatRead);
    slow.hold();
    const oldSocketId = b.socket.id;
    const back = record(b.socket);
    cutNetwork(b.socket);
    await vi.waitFor(() => {
      expect(b.socket.id).not.toBe(oldSocketId);
      expect(srv.realtime.socketsOf(b.id)).toEqual([b.socket.id]);
    });
    await slow.reached;

    // Dans le groupe, A écrit : la socket de B, pas encore entrée au bureau, ne reçoit rien (comme pour les événements média).
    expect(await send(a.socket, nearby('Tu es là, B ?'))).toEqual({ ok: true });
    expect(textsOf(a)).toEqual(['Tu es là, B ?']);
    // B, de son côté, n'écrit pas encore : son message est ignoré, sans accusé, ni enregistré ni envoyé.
    const ack = vi.fn();
    b.socket.emit('chat:send', everyone('Trop tôt'), ack);
    raw(b.socket).emit('chat:send', nearby('Trop tôt aussi'), ack);
    await sleep(150);
    expect(back.names()).toEqual([]);   // pas même l'init
    expect(ack).not.toHaveBeenCalled();
    expect(textsOf(a)).toEqual(['Tu es là, B ?']);

    slow.release();
    await vi.waitFor(() => expect(back.names()).toEqual(['init']));   // l'init d'abord ; le message à proximité est perdu pour B
    expect(back.payloadsOf('init')[0]).toMatchObject({ chatHistory: [] });   // ses messages ignorés n'ont rien enregistré
    expect(await srv.db.$count(chatMessage)).toBe(0);
    // Une fois entrée, la socket écrit et reçoit.
    expect(await send(b.socket, nearby('Me voilà'))).toEqual({ ok: true });
    await vi.waitFor(() => expect(textsOf(a)).toEqual(['Tu es là, B ?', 'Me voilà']));
    expect(back.names()).toEqual(['init', 'chat:message']);
    expect(ack).not.toHaveBeenCalled();
  });
});

describe('chat:send, charge utile et accusé', () => {
  test('501 caractères → invalid', async () => {
    const srv = await startTestServer();
    const a = await enterRecorded(srv, 'a@x.fr');
    const b = await enterRecorded(srv, 'b@x.fr');

    expect(await send(a.socket, everyone('a'.repeat(CHAT_MAX_LENGTH + 1)))).toEqual({ ok: false, error: 'invalid' });
    expect(await send(a.socket, nearby('a'.repeat(CHAT_MAX_LENGTH + 1)))).toEqual({ ok: false, error: 'invalid' });

    // Plus d'autres charges que le client ne devrait pas envoyer : aucune n'est enregistrée ni envoyée, et aucune ne compte dans le
    // débit (il y en a plus que CHAT_RATE.max, et les messages valides passent ensuite).
    const invalid: unknown[] = [
      undefined,
      null,
      'texte',
      42,
      true,
      [],
      {},
      { channel: 'all' },
      { text: 'sans canal' },
      { channel: 'privé', text: 'x' },
      { channel: ['all'], text: 'x' },
      { channel: 'all', text: 12 },
      { channel: 'all', text: null },
      { channel: 'all', text: '' },
      { channel: 'all', text: '   ' },
      { channel: 'nearby', text: '\n\t' },
      { channel: 'all', text: ` ${'a'.repeat(CHAT_MAX_LENGTH + 1)} ` },
    ];
    for (const payload of invalid) {
      expect(await send(a.socket, payload), JSON.stringify(payload)).toEqual({ ok: false, error: 'invalid' });
    }
    expect(await srv.db.$count(chatMessage)).toBe(0);

    // 500 caractères passent, après avoir coupé les espaces autour (501 en tout, 500 une fois coupés).
    expect(await send(a.socket, everyone('a'.repeat(CHAT_MAX_LENGTH)))).toEqual({ ok: true });
    expect(await send(a.socket, everyone(`  ${'b'.repeat(CHAT_MAX_LENGTH)} `))).toEqual({ ok: true });
    for (let n = 1; n <= CHAT_RATE.max - 2; n++) expect(await send(a.socket, everyone(`court ${n}`))).toEqual({ ok: true });
    expect(await send(a.socket, everyone('un de trop'))).toEqual({ ok: false, error: 'rate_limited' });

    await vi.waitFor(() => expect(received(b)).toHaveLength(CHAT_RATE.max));
    expect(textsOf(b)).toEqual(['a'.repeat(CHAT_MAX_LENGTH), 'b'.repeat(CHAT_MAX_LENGTH), 'court 1', 'court 2', 'court 3']);
    expect((await srv.db.select().from(chatMessage)).map((row) => row.body.length).sort((x, y) => x - y)).toEqual([7, 7, 7, 500, 500]);
  });

  test('sans rappel d\'accusé, ou avec autre chose à sa place : le serveur ne tombe pas, ne journalise rien, et répond ensuite', async () => {
    const { logger, lines } = captureLogs();
    const srv = await startTestServer({ logger });
    const a = await enterRecorded(srv, 'a@x.fr');
    const b = await enterRecorded(srv, 'b@x.fr');

    // Trois prises du débit (5 en tout) : les deux premiers messages et le refus no_group. L'invalide n'en prend aucune.
    raw(a.socket).emit('chat:send', everyone('sans accusé'));
    raw(a.socket).emit('chat:send', everyone('pas une fonction'), 'pas un rappel');
    raw(a.socket).emit('chat:send', everyone(''));   // invalide, et personne à qui répondre
    raw(a.socket).emit('chat:send');                 // rien du tout
    raw(a.socket).emit('chat:send', nearby('sans groupe'));   // no_group, sans rappel
    // Les deux prises qui restent, puis le débit dépassé, sans rappel non plus.
    for (let n = 1; n <= CHAT_RATE.max; n++) raw(a.socket).emit('chat:send', everyone(`rafale ${n}`));
    await vi.waitFor(() => expect(received(b)).toHaveLength(4));
    expect(textsOf(b)).toEqual(['sans accusé', 'pas une fonction', 'rafale 1', 'rafale 2']);

    // Le serveur est toujours là, et répond à qui lui donne un rappel.
    expect(await send(a.socket, everyone('encore là'))).toEqual({ ok: false, error: 'rate_limited' });
    expect(await send(b.socket, everyone('et B'))).toEqual({ ok: true });
    await vi.waitFor(() => expect(textsOf(b)).toEqual(['sans accusé', 'pas une fonction', 'rafale 1', 'rafale 2', 'et B']));
    // Un client qui ne demande pas d'accusé n'est pas une erreur du serveur.
    expect(lines.filter((line) => (line.level as number) >= 50)).toEqual([]);
  });
});

describe('init.chatHistory', () => {
  test('les 200 derniers messages, du plus ancien au plus récent, à l\'arrivée comme au retour', async () => {
    const srv = await startTestServer();
    const cookie = await srv.inviteAndLogin('a@x.fr');
    const { id } = (await findUserByEmail(srv.db, 'a@x.fr'))!;
    const start = Date.UTC(2026, 2, 4, 9, 0, 0);
    await srv.db.insert(chatMessage).values(
      Array.from({ length: 205 }, (_, i) => ({ userId: id, body: `message ${i + 1}`, createdAt: new Date(start + (i + 1) * 1000) })),
    );

    const socket = srv.connect(cookie);
    const init = await nextInit(socket);
    expect(init.chatHistory).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(init.chatHistory.map((m) => m.text)).toEqual(Array.from({ length: 200 }, (_, i) => `message ${i + 6}`));
    expect(init.chatHistory[0]).toEqual({
      id: expect.stringMatching(UUID),
      channel: 'all',
      userId: id,
      name: 'a',
      text: 'message 6',
      sentAt: new Date(start + 6000).toISOString(),
    });

    // Au retour pendant le délai de grâce (l'avatar n'a pas quitté le monde), l'init redit tout l'historique.
    const again = nextInit(socket);
    cutNetwork(socket);
    expect((await again).chatHistory).toEqual(init.chatHistory);
  });

  test('historique illisible : journalisé, et l\'init part quand même, avec un historique vide', async () => {
    const { logger, lines } = captureLogs();
    const srv = await startTestServer({ logger });
    const a = await enterRecorded(srv, 'a@x.fr');
    expect(await send(a.socket, everyone('déjà là'))).toEqual({ ok: true });

    const failing = failChatReads(srv);
    const joined = nextEvent(a.socket, 'player:joined');
    const b = srv.connect(await srv.inviteAndLogin('b@x.fr'));
    const bInit = await nextInit(b);
    // L'arrivée n'attend pas l'historique : B est au monde, et A l'apprend.
    expect(bInit.chatHistory).toEqual([]);
    expect(bInit.players.map((p) => p.id)).toEqual([a.id]);
    expect((await joined).id).toBe(bInit.self.id);
    expect(lines.filter((line) => line.level === 50)).toEqual([
      expect.objectContaining({
        msg: 'Historique du chat illisible',
        userId: bInit.self.id,
        err: expect.objectContaining({ message: expect.stringContaining('base illisible') }),
      }),
    ]);

    // Au retour pendant le délai de grâce, pareil.
    const again = nextInit(b);
    cutNetwork(b);
    expect((await again).chatHistory).toEqual([]);
    expect(lines.filter((line) => line.level === 50)).toHaveLength(2);

    // La base revenue, l'historique aussi : rien n'a été retenu de la panne.
    failing.mockRestore();
    const c = await enterRecorded(srv, 'c@x.fr');
    expect(c.init.chatHistory).toEqual([expect.objectContaining({ text: 'déjà là', userId: a.id })]);
    expect(lines.filter((line) => line.level === 50)).toHaveLength(2);
  });
});

describe('qui peut écrire', () => {
  test('un joueur pas encore au monde (son arrivée lit la base) est ignoré : ni accusé, ni message', async () => {
    const srv = await startTestServer();
    const b = await enterRecorded(srv, 'b@x.fr');
    const cookieA = await srv.inviteAndLogin('a@x.fr');

    // Les lectures de l'arrivée de A, pas encore lancées, attendent qu'on les libère.
    const slow = slowDatabase(srv, (sql) => /^select\b[\s\S]*\bfrom "user"/i.test(sql));
    srv.realtime.io.once('connection', () => slow.hold());
    const a = srv.connect(cookieA);
    const aEvents = record(a);
    const ack = vi.fn();
    await new Promise<void>((resolve) => {
      a.once('connect', () => {
        a.emit('chat:send', everyone('Trop tôt'), ack);
        raw(a).emit('chat:send', nearby('Trop tôt'), ack);
        resolve();
      });
    });
    await sleep(100);
    expect(aEvents.names()).toEqual([]);

    const init = nextInit(a);
    slow.release();
    await init;
    await sleep(100);
    expect(ack).not.toHaveBeenCalled();
    expect(await srv.db.$count(chatMessage)).toBe(0);
    expect(aEvents.names()).toEqual(['init']);
    // Entrée, elle écrit.
    expect(await send(a, everyone('Je suis là'))).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.events.payloadsOf('chat:message')).toHaveLength(1));
  });

  test('un membre retiré n\'écrit plus : sa socket est ignorée', async () => {
    const srv = await startTestServer();
    const a = await enterRecorded(srv, 'a@x.fr');
    const b = await enterRecorded(srv, 'b@x.fr');

    // Retiré du monde, sa socket encore ouverte : member:removed la ferme dans la foulée (presence.removeMember), mais un message déjà
    // sur le fil ne doit rien changer.
    expect(srv.realtime.world.leave(a.id)).toBeDefined();
    const ack = vi.fn();
    a.socket.emit('chat:send', everyone('Dernier mot'), ack);
    raw(a.socket).emit('chat:send', nearby('Dernier mot'), ack);
    await sleep(150);
    expect(ack).not.toHaveBeenCalled();
    expect(await send(b.socket, everyone('Après lui'))).toEqual({ ok: true });
    await vi.waitFor(() => expect(textsOf(b)).toEqual(['Après lui']));
    expect(await srv.db.$count(chatMessage)).toBe(1);   // le sien seulement
  });

  test('retiré pendant l\'enregistrement de son message : rien n\'est diffusé en son nom', async () => {
    const srv = await startTestServer();
    const a = await enterRecorded(srv, 'a@x.fr');
    const b = await enterRecorded(srv, 'b@x.fr');

    const slow = slowDatabase(srv, isChatWrite);
    slow.hold();
    const ack = vi.fn();
    a.socket.emit('chat:send', everyone('Dernier mot'), ack);
    await slow.reached;   // le message attend la base
    expect(await removeMember({ db: srv.db, events: srv.events }, { actorId: b.id, targetId: a.id })).toBe('removed');
    slow.release();

    await sleep(150);
    expect(ack).not.toHaveBeenCalled();
    expect(textsOf(b)).toEqual([]);
    // Le serveur continue : B écrit, A n'est plus là.
    expect(await send(b.socket, everyone('Après lui'))).toEqual({ ok: true });
    await vi.waitFor(() => expect(textsOf(b)).toEqual(['Après lui']));
  });

  test('retour : socket fermée pendant la lecture de l\'historique → rien ne lui est envoyé ni préparé, et l\'avatar part à la fin du délai de grâce', { timeout: 15_000 }, async () => {
    // Un backend audio/vidéo (faux) : la fin d'un init prépare alors la room LiveKit de la socket (onWelcome, via le coordinateur).
    const media: MediaBackend = { url: 'wss://bureau-test.livekit.test', mintToken: async () => 'jeton', removeParticipant: async () => {} };
    const srv = await startTestServer({ graceMs: 1_000, media });
    const a = await enterRecorded(srv, 'a@x.fr');
    const b = await enterRecorded(srv, 'b@x.fr');
    const resync = vi.spyOn(srv.realtime.coordinator, 'groupMembersOf');
    const slow = slowDatabase(srv, isChatRead);
    slow.hold();
    const oldSocketId = a.socket.id;
    const back = record(a.socket);
    cutNetwork(a.socket);
    await vi.waitFor(() => {
      expect(a.socket.id).not.toBe(oldSocketId);
      expect(srv.realtime.socketsOf(a.id)).toEqual([a.socket.id]);
    });
    await slow.reached;

    a.socket.disconnect();   // l'onglet est refermé aussitôt revenu
    await vi.waitFor(() => expect(srv.realtime.socketsOf(a.id)).toEqual([]));
    slow.release();
    await sleep(150);
    expect(back.names()).toEqual([]);   // pas d'init pour une socket fermée
    expect(resync).not.toHaveBeenCalledWith(a.id);   // ni de room à préparer pour elle
    expect(officeSockets(srv)).toEqual([b.socket.id]);   // et elle n'est pas dans la salle du bureau
    // Sans socket, A part à la fin du délai de grâce, comme après une coupure.
    await vi.waitFor(() => expect(srv.realtime.world.get(a.id)).toBeUndefined(), { timeout: 4000 });
  });

  test('un joueur qui disparaît du monde pendant la lecture de l\'historique de son retour : sa socket est fermée, il revient par une vraie arrivée', { timeout: 15_000 }, async () => {
    const srv = await startTestServer({ graceMs: 5_000 });
    const a = await enterRecorded(srv, 'a@x.fr');
    const slow = slowDatabase(srv, isChatRead);
    slow.hold();
    const oldSocketId = a.socket.id;
    const back = record(a.socket);
    cutNetwork(a.socket);
    await vi.waitFor(() => {
      expect(a.socket.id).not.toBe(oldSocketId);
      expect(srv.realtime.socketsOf(a.id)).toEqual([a.socket.id]);
    });
    await slow.reached;

    expect(srv.realtime.world.leave(a.id)).toBeDefined();   // ce que le serveur ne fait pas, une socket en main
    slow.release();
    // Pas d'init pour une socket dont le joueur n'existe plus (welcome n'a rien à lui dire) : le transport est coupé, et le client
    // revient par une vraie arrivée.
    await vi.waitFor(() => expect(back.names().filter((name) => name === 'init')).toHaveLength(1), { timeout: 5000 });
    expect(back.payloadsOf('init')[0]).toMatchObject({ self: { id: a.id } });
    expect(srv.realtime.world.get(a.id)).toBeDefined();
  });
});
