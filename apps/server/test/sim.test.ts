import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIM_BOT_PREFIX, SIM_MEDIA_URL, decodeSimToken, type SimRoomPayload } from '@bureau/shared';
import request from 'supertest';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { createSimHost } from '../src/sim/sim-host';
import { enter, nextEvent, record, startTestServer } from './helpers/realtime';

// Le faux live en entier : ses routes (/api/sim) et le temps réel avec une vraie socket, comme dans le navigateur. Une personne réelle
// entre à l'apparition de la carte de développement, (80, 240) ; une personne fictive apparaît à côté, et elles se parlent au bout de
// 500 ms, le temps du calcul des groupes (ici toutes les 50 ms).
const VOICE = Buffer.from('ID3-voix-factice-0123456789');

function audioDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sim-audio-'));
  writeFileSync(join(dir, 'voix.mp3'), VOICE);
  writeFileSync(join(dir, 'Réunion 2.wav'), 'RIFF');
  writeFileSync(join(dir, 'notes.txt'), 'pas un fichier audio');
  return dir;
}

async function start() {
  const dir = audioDir();
  const sim = createSimHost({ SIM_AUDIO_DIR: dir });
  const srv = await startTestServer({ sim, groupsMs: 50 });
  const cookie = await srv.inviteAndLogin('nina@exemple.fr');
  onTestFinished(() => sim.stop());
  return { srv, sim, dir, cookie, api: request(srv.app) };
}

describe('les routes /api/sim', () => {
  test('sans session : 401, partout', async () => {
    const { api } = await start();
    for (const [method, path] of [['get', '/api/sim'], ['post', '/api/sim/bots'], ['get', '/api/sim/audio/voix.mp3'], ['post', '/api/sim/audio?name=a.mp3']] as const) {
      expect((await api[method](path)).status, `${method} ${path}`).toBe(401);
    }
  });

  test('l\'état : les personnes fictives, et les fichiers audio du dossier (rien d\'autre), par ordre alphabétique', async () => {
    const { api, cookie } = await start();
    const res = await api.get('/api/sim').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.bots).toEqual([]);
    expect(res.body.audio).toEqual([
      { file: 'voix.mp3', url: '/api/sim/audio/voix.mp3', size: VOICE.length },
      { file: 'Réunion 2.wav', url: `/api/sim/audio/${encodeURIComponent('Réunion 2.wav')}`, size: 4 },
    ].sort((a, b) => a.file.localeCompare(b.file, 'fr')));
  });

  test('ajouter, changer le fichier, déplacer, retirer', async () => {
    const { api, cookie } = await start();
    const created = await api.post('/api/sim/bots').set('Cookie', cookie).send({ name: 'Léa', audio: 'voix.mp3' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Léa', audio: 'voix.mp3', target: null });
    expect(created.body.id.startsWith(SIM_BOT_PREFIX)).toBe(true);

    const id = created.body.id as string;
    expect((await api.patch(`/api/sim/bots/${id}`).set('Cookie', cookie).send({ audio: null })).body.audio).toBeNull();
    const moved = await api.post(`/api/sim/bots/${id}/move`).set('Cookie', cookie).send({ x: 400, y: 250 });
    expect(moved.status).toBe(200);
    expect(moved.body).toEqual({ target: { x: 400, y: 250 } });
    expect((await api.get('/api/sim').set('Cookie', cookie)).body.bots).toEqual([expect.objectContaining({ id, audio: null, target: { x: 400, y: 250 } })]);

    expect((await api.delete(`/api/sim/bots/${id}`).set('Cookie', cookie)).status).toBe(204);
    expect((await api.get('/api/sim').set('Cookie', cookie)).body.bots).toEqual([]);
  });

  test('les refus : corps invalide → 400, fichier absent → 400, identifiant inconnu → 404', async () => {
    const { api, cookie } = await start();
    const as = (r: request.Test) => r.set('Cookie', cookie);
    expect((await as(api.post('/api/sim/bots')).send({ name: 'x'.repeat(41) })).status).toBe(400);
    expect((await as(api.post('/api/sim/bots')).send({ audio: 'absent.mp3' })).body).toEqual({ error: 'unknown_audio' });
    expect((await as(api.post('/api/sim/bots')).send({ audio: '../voix.mp3' })).status).toBe(400);
    expect((await as(api.patch('/api/sim/bots/sim-inconnu')).send({ audio: null })).status).toBe(404);
    expect((await as(api.patch('/api/sim/bots/sim-inconnu')).send({})).status).toBe(400);
    expect((await as(api.delete('/api/sim/bots/sim-inconnu'))).status).toBe(404);
    expect((await as(api.post('/api/sim/bots/sim-inconnu/move')).send({ x: 1, y: 1 })).status).toBe(404);

    const { body: bot } = await as(api.post('/api/sim/bots')).send({});
    expect((await as(api.post(`/api/sim/bots/${bot.id}/move`)).send({ x: 'ici', y: 1 })).status).toBe(400);
    expect((await as(api.post(`/api/sim/bots/${bot.id}/move`)).send({ x: 1 })).status).toBe(400);
  });

  test('un fichier audio se lit, avec des portions (Range) pour que le navigateur le boucle ; les autres noms sont introuvables', async () => {
    const { api, cookie } = await start();
    const whole = await api.get('/api/sim/audio/voix.mp3').set('Cookie', cookie);
    expect(whole.status).toBe(200);
    expect(whole.headers['content-type']).toMatch(/audio\/mpeg/);
    expect(Buffer.from(whole.body)).toEqual(VOICE);
    const part = await api.get('/api/sim/audio/voix.mp3').set('Cookie', cookie).set('Range', 'bytes=0-2');
    expect(part.status).toBe(206);
    expect(Buffer.from(part.body).toString()).toBe('ID3');
    for (const name of ['absent.mp3', 'notes.txt', '..%2Fvoix.mp3', '%2E%2E%2F%2E%2E%2Fetc%2Fpasswd', '.cache.mp3']) {
      expect((await api.get(`/api/sim/audio/${name}`).set('Cookie', cookie)).status, name).toBe(404);
    }
  });

  test('importer un fichier audio : écrit dans le dossier, listé ensuite ; un nom ou un corps refusé n\'écrit rien', async () => {
    const { api, cookie, dir } = await start();
    const bytes = Buffer.from('nouveau son');
    const ok = await api.post(`/api/sim/audio?name=${encodeURIComponent('Nouveau son.mp3')}`).set('Cookie', cookie).set('Content-Type', 'audio/mpeg').send(bytes);
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ file: 'Nouveau son.mp3', url: `/api/sim/audio/${encodeURIComponent('Nouveau son.mp3')}`, size: bytes.length });
    expect(readFileSync(join(dir, 'Nouveau son.mp3'))).toEqual(bytes);
    expect((await api.get('/api/sim').set('Cookie', cookie)).body.audio.map((f: { file: string }) => f.file)).toContain('Nouveau son.mp3');

    const post = (name: string, body: Buffer) => api.post(`/api/sim/audio?name=${encodeURIComponent(name)}`).set('Cookie', cookie).set('Content-Type', 'audio/mpeg').send(body);
    expect((await post('../evasion.mp3', bytes)).status).toBe(400);
    expect((await post('sous/dossier.mp3', bytes)).status).toBe(400);
    expect((await post('script.js', bytes)).status).toBe(400);
    expect((await post('vide.mp3', Buffer.alloc(0))).status).toBe(400);
    expect((await api.post('/api/sim/audio').set('Cookie', cookie).set('Content-Type', 'audio/mpeg').send(bytes)).status).toBe(400);
    expect(existsSync(join(dir, '..', 'evasion.mp3'))).toBe(false);
    expect(existsSync(join(dir, 'vide.mp3'))).toBe(false);
  });

  test('le dossier est créé au démarrage s\'il n\'existe pas', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'sim-parent-'));
    const dir = join(parent, 'sim-audio');
    mkdirSync(parent, { recursive: true });
    createSimHost({ SIM_AUDIO_DIR: dir });
    expect(existsSync(dir)).toBe(true);
  });
});

describe('le temps réel', () => {
  test('la personne fictive est au monde pour tous ; une personne réelle qui s\'en approche reçoit la room, le faux jeton et le son', async () => {
    const { srv, api, cookie } = await start();
    const { socket, id: me } = await enter(srv, cookie);
    const received = record(socket);

    const joined = nextEvent(socket, 'player:joined');
    const { body: bot } = await api.post('/api/sim/bots').set('Cookie', cookie).send({ name: 'Zoé', audio: 'voix.mp3' });
    expect(await joined).toMatchObject({ id: bot.id, name: 'Zoé', media: { mic: true, cam: false, screen: false } });

    // À moins de 3 cases, toutes les deux à l'arrêt : un groupe se forme au bout de 500 ms, et la room arrive avec son contenu.
    await vi.waitFor(() => expect(received.names()).toContain('sim:room'), { timeout: 5000 });
    await vi.waitFor(() => expect(received.names()).toContain('media:join'), { timeout: 5000 });

    const join = received.payloadsOf('media:join')[0] as { url: string; room: string; token: string };
    expect(join.url).toBe(SIM_MEDIA_URL);
    expect(decodeSimToken(join.token)).toEqual({ room: join.room, identity: me, name: 'nina' });

    const room = received.payloadsOf('sim:room')[0] as SimRoomPayload;
    expect(room.room).toBe(join.room);
    expect(room.members).toHaveLength(2);
    expect(room.members).toContainEqual({ id: me, name: 'nina', audio: null });
    expect(room.members).toContainEqual({ id: bot.id, name: 'Zoé', audio: '/api/sim/audio/voix.mp3' });

    // Changer le fichier : la room est redite avec le nouveau, sans media:join de plus.
    await api.patch(`/api/sim/bots/${bot.id}`).set('Cookie', cookie).send({ audio: 'Réunion 2.wav' });
    await vi.waitFor(() => expect(received.payloadsOf('sim:room')).toHaveLength(2));
    expect((received.payloadsOf('sim:room')[1] as SimRoomPayload).members.find((m) => m.id === bot.id)!.audio).toBe(`/api/sim/audio/${encodeURIComponent('Réunion 2.wav')}`);
    expect(received.payloadsOf('media:join')).toHaveLength(1);
  });

  test('elle s\'éloigne à pied, au-delà de 4 cases : la room se défait (media:leave), puis elle repart quand on la retire', async () => {
    const { srv, api, cookie } = await start();
    const { socket } = await enter(srv, cookie);
    const received = record(socket);
    const { body: bot } = await api.post('/api/sim/bots').set('Cookie', cookie).send({ audio: 'voix.mp3' });
    await vi.waitFor(() => expect(received.names()).toContain('media:join'), { timeout: 5000 });

    // 6 cases plus loin : elle y marche (110 px/s), sans se téléporter.
    await api.post(`/api/sim/bots/${bot.id}/move`).set('Cookie', cookie).send({ x: 80 + 6 * 32, y: 240 });
    // Le `media:leave` qui compte vient après le `media:join` : le serveur en envoie aussi un à toute socket qui arrive hors groupe.
    const afterJoin = () => received.names().slice(received.names().indexOf('media:join'));
    await vi.waitFor(() => expect(afterJoin()).toContain('media:leave'), { timeout: 8000 });
    const ticks = received.payloadsOf('world:tick') as Array<{ moves: Array<{ id: string; x: number; moving: boolean }> }>;
    const xs = ticks.flatMap((t) => t.moves.filter((m) => m.id === bot.id).map((m) => m.x));
    expect(xs.length).toBeGreaterThan(5);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));   // elle n'a fait que s'avancer, pas à pas
    expect(new Set(xs).size).toBeGreaterThan(5);

    const left = nextEvent(socket, 'player:left');
    await api.delete(`/api/sim/bots/${bot.id}`).set('Cookie', cookie);
    expect(await left).toEqual({ id: bot.id });
  });

  test('un autre onglet qui arrive voit la personne fictive dans son init, et la personne réelle n\'est pas ajoutée aux fictives', async () => {
    const { srv, api, cookie } = await start();
    const { body: bot } = await api.post('/api/sim/bots').set('Cookie', cookie).send({});
    const other = await srv.inviteAndLogin('omar@exemple.fr');
    const { init } = await enter(srv, other);
    expect(init.players.map((p) => p.id)).toContain(bot.id);
    expect((await api.get('/api/sim').set('Cookie', other)).body.bots).toHaveLength(1);
  });

  test('sans le faux live, /api/sim n\'existe pas', async () => {
    const srv = await startTestServer({});
    const cookie = await srv.inviteAndLogin('nina@exemple.fr');
    expect((await request(srv.app).get('/api/sim').set('Cookie', cookie)).status).toBe(404);
  });
});
