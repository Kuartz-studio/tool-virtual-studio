import { encodeSimToken, SIM_MEDIA_URL, type SimRoomPayload } from '@bureau/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { TransportEvents } from '../media/media-client';
import { resetSimRoom, setSimRoom, simConnectionLost } from './sim-room';
import { SimTransport } from './sim-transport';

// Les éléments <audio> que le faux transport crée, remplacés par des faux : pas de lecture réelle dans les tests. `play` rend une
// promesse qu'un test peut faire échouer (le navigateur veut un geste).
let playImpl: (el: HTMLMediaElement) => Promise<void>;
const playing = new WeakSet<HTMLMediaElement>();

beforeEach(() => {
  resetSimRoom();
  playImpl = async () => {};
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    return playImpl(this).then(() => {
      playing.add(this);
      Object.defineProperty(this, 'paused', { configurable: true, get: () => !playing.has(this) });
      this.dispatchEvent(new Event('playing'));
    });
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    playing.delete(this);
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(async () => {
  // Un transport qui n'a pas quitté sa room écoute encore le pont : le test suivant le verrait réagir.
  await Promise.all(created.splice(0).map((transport) => transport.disconnect()));
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const created: SimTransport[] = [];
function newTransport(): SimTransport {
  const transport = new SimTransport();
  created.push(transport);
  return transport;
}

const ME = { id: 'moi', name: 'Moi' };
const join = (room = 'r-g1') => ({ url: SIM_MEDIA_URL, room, token: encodeSimToken({ room, identity: ME.id, name: ME.name }) });
const member = (id: string, audio: string | null) => ({ id, name: id.toUpperCase(), audio });
const room = (members: SimRoomPayload['members'], name = 'r-g1'): SimRoomPayload => ({ room: name, members });

function events(): TransportEvents & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    changed: () => void calls.push('changed'),
    disconnected: (reason) => void calls.push(`disconnected:${reason}`),
    screenShareEnded: () => void calls.push('screenShareEnded'),
    audioPlayback: (allowed) => void calls.push(`audioPlayback:${allowed}`),
  };
}

const audios = () => [...document.querySelectorAll<HTMLAudioElement>('audio[data-sim-bot]')];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SimTransport', () => {
  test('rejoindre : soi-même d\'abord, puis ceux de la room ; un fichier audio = un micro allumé qui parle, en boucle', async () => {
    setSimRoom(room([member('moi', null), member('a', '/api/sim/audio/voix.mp3'), member('b', null)]));
    const transport = newTransport();
    await transport.connect(join(), {}, events());
    await settle();

    expect(transport.participants()).toEqual([
      { id: 'moi', name: 'Moi', isLocal: true, mic: false, cam: false, screen: false, speaking: false },
      { id: 'a', name: 'A', isLocal: false, mic: true, cam: false, screen: false, speaking: true },
      { id: 'b', name: 'B', isLocal: false, mic: false, cam: false, screen: false, speaking: false },
    ]);
    const [el, ...others] = audios();
    expect(others).toEqual([]);
    expect(el!.dataset.simBot).toBe('a');
    expect(el!.getAttribute('src')).toBe('/api/sim/audio/voix.mp3');
    expect(el!.loop).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  test('le message de la room peut arriver après la connexion : il remplit la room', async () => {
    const transport = newTransport();
    const ev = events();
    await transport.connect(join(), {}, ev);
    expect(transport.participants().map((p) => p.id)).toEqual(['moi']);
    setSimRoom(room([member('moi', null), member('a', '/api/sim/audio/voix.mp3')]));
    await settle();
    expect(transport.participants().map((p) => p.id)).toEqual(['moi', 'a']);
    expect(audios()).toHaveLength(1);
    expect(ev.calls).toContain('changed');
  });

  test('un message d\'une autre room est ignoré, et celui d\'une autre room déjà reçu aussi', async () => {
    setSimRoom(room([member('moi', null), member('x', '/api/sim/audio/x.mp3')], 'autre-g9'));
    const transport = newTransport();
    await transport.connect(join('r-g1'), {}, events());
    expect(audios()).toHaveLength(0);
    setSimRoom(room([member('moi', null), member('y', '/api/sim/audio/y.mp3')], 'autre-g9'));
    expect(audios()).toHaveLength(0);
    expect(transport.participants().map((p) => p.id)).toEqual(['moi']);
  });

  test('quelqu\'un entre, change de fichier, part : les éléments audio suivent', async () => {
    const transport = newTransport();
    await transport.connect(join(), {}, events());
    setSimRoom(room([member('moi', null), member('a', '/api/sim/audio/1.mp3')]));
    const first = audios()[0]!;
    setSimRoom(room([member('moi', null), member('a', '/api/sim/audio/1.mp3'), member('b', '/api/sim/audio/2.mp3')]));
    expect(audios().map((el) => el.dataset.simBot)).toEqual(['a', 'b']);
    expect(audios()[0]).toBe(first);   // celui qui ne change pas continue sans reprendre

    setSimRoom(room([member('moi', null), member('a', '/api/sim/audio/3.mp3'), member('b', '/api/sim/audio/2.mp3')]));
    expect(audios().find((el) => el.dataset.simBot === 'a')!.getAttribute('src')).toBe('/api/sim/audio/3.mp3');
    expect(first.isConnected).toBe(false);

    setSimRoom(room([member('moi', null), member('b', null)]));
    expect(audios()).toHaveLength(0);
  });

  test('quitter la room : tout s\'arrête et se retire, plus aucun événement ; un message ensuite ne fait rien', async () => {
    setSimRoom(room([member('moi', null), member('a', '/api/sim/audio/voix.mp3')]));
    const transport = newTransport();
    const ev = events();
    await transport.connect(join(), {}, ev);
    expect(audios()).toHaveLength(1);
    await transport.disconnect();
    expect(audios()).toHaveLength(0);
    expect(transport.participants()).toEqual([]);
    const calls = ev.calls.length;
    setSimRoom(room([member('moi', null), member('b', '/api/sim/audio/2.mp3')]));
    expect(audios()).toHaveLength(0);
    expect(ev.calls).toHaveLength(calls);
  });

  test('la connexion au serveur tombe : tous les sons s\'arrêtent, et la room est dite perdue (pas de son qui tourne sans fin)', async () => {
    setSimRoom(room([member('moi', null), member('a', '/api/sim/audio/voix.mp3'), member('b', '/api/sim/audio/voix2.mp3')]));
    const transport = newTransport();
    const ev = events();
    await transport.connect(join(), {}, ev);
    expect(audios()).toHaveLength(2);

    simConnectionLost();
    expect(audios()).toHaveLength(0);
    expect(transport.participants()).toEqual([]);
    expect(ev.calls.at(-1)).toBe('disconnected:lost');

    // Plus rien n'écoute : un message de room arrivé ensuite ne relance aucun son, et une seconde perte ne dit rien de plus.
    const calls = ev.calls.length;
    setSimRoom(room([member('moi', null), member('a', '/api/sim/audio/voix.mp3')]));
    simConnectionLost();
    expect(audios()).toHaveLength(0);
    expect(ev.calls).toHaveLength(calls);
  });

  test('une connexion perdue hors room ne fait rien', () => {
    expect(() => simConnectionLost()).not.toThrow();
  });

  test('revenir dans la même room : le dernier message retenu la remplit tout de suite', async () => {
    const transport = newTransport();
    await transport.connect(join(), {}, events());
    setSimRoom(room([member('moi', null), member('a', '/api/sim/audio/voix.mp3')]));
    await transport.disconnect();
    await transport.connect(join(), {}, events());
    expect(audios()).toHaveLength(1);
  });

  test('le micro, la caméra et le partage s\'allument sans rien demander au navigateur', async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
    const transport = newTransport();
    await transport.connect(join(), {}, events());
    await transport.setSource('mic', true);
    await transport.setSource('cam', true);
    await transport.setSource('screen', true);
    expect(transport.participants()[0]).toMatchObject({ isLocal: true, mic: true, cam: true, screen: true });
    await transport.setSource('mic', false);
    expect(transport.participants()[0]).toMatchObject({ mic: false, cam: true });
    expect(getUserMedia).not.toHaveBeenCalled();
    // Quitter les éteint : la room suivante repart de zéro.
    await transport.disconnect();
    await transport.connect(join(), {}, events());
    expect(transport.participants()[0]).toMatchObject({ mic: false, cam: false, screen: false });
  });

  test('le navigateur refuse la lecture : le son est dit bloqué, et startAudio, dans un geste, le relance', async () => {
    playImpl = () => Promise.reject(new DOMException('geste requis', 'NotAllowedError'));
    setSimRoom(room([member('moi', null), member('a', '/api/sim/audio/voix.mp3')]));
    const transport = newTransport();
    const ev = events();
    await transport.connect(join(), {}, ev);
    await settle();
    expect(ev.calls).toContain('audioPlayback:false');
    expect(transport.participants()[1]!.speaking).toBe(false);

    await expect(transport.startAudio()).rejects.toMatchObject({ name: 'NotAllowedError' });
    playImpl = async () => {};
    await transport.startAudio();
    expect(ev.calls.at(-1)).toBe('audioPlayback:true');
    expect(transport.participants()[1]!.speaking).toBe(true);
  });

  test('un fichier illisible ne bloque pas le son des autres, et ne le dit pas bloqué', async () => {
    playImpl = (el) => (el.dataset.simBot === 'a' ? Promise.reject(new DOMException('format', 'NotSupportedError')) : Promise.resolve());
    setSimRoom(room([member('moi', null), member('a', '/api/sim/audio/cassé.mp3'), member('b', '/api/sim/audio/bon.mp3')]));
    const transport = newTransport();
    const ev = events();
    await transport.connect(join(), {}, ev);
    await settle();
    expect(ev.calls).not.toContain('audioPlayback:false');
    expect(transport.participants().map((p) => [p.id, p.speaking])).toEqual([['moi', false], ['a', false], ['b', true]]);
  });

  test('un jeton illisible : la connexion échoue, sans rien laisser derrière', async () => {
    const transport = newTransport();
    await expect(transport.connect({ url: SIM_MEDIA_URL, room: 'r', token: 'pas un jeton' }, {}, events())).rejects.toThrow(/Jeton/);
    expect(transport.participants()).toEqual([]);
    expect(audios()).toHaveLength(0);
  });

  test('startAudio hors room ne fait rien ; attach rend une fonction sans effet', async () => {
    const transport = newTransport();
    await expect(transport.startAudio()).resolves.toBeUndefined();
    const detach = transport.attach(document.createElement('video'), 'moi', 'camera');
    expect(() => detach()).not.toThrow();
  });

  test('parquer : les sons s\'arrêtent ; la reprise de cette room (avec resume) la rouvre aussitôt ; une autre, ou sans resume, non', async () => {
    setSimRoom(room([member('moi', null), member('a', '/api/sim/audio/voix.mp3')]));
    const transport = newTransport();
    await transport.connect(join(), {}, events());
    await settle();
    expect(audios()).toHaveLength(1);

    await transport.park();
    expect(audios()).toEqual([]);
    expect(transport.participants()).toEqual([]);
    expect(await transport.resume(join(), {}, events())).toBe(false);   // sans resume : le serveur ne l'a pas reprise
    expect(await transport.resume({ ...join('r-g2'), resume: '1' }, {}, events())).toBe(false);
    expect(await transport.resume({ ...join(), resume: '1' }, {}, events())).toBe(true);
    await settle();
    expect(audios()).toHaveLength(1);
    expect(transport.participants().map((p) => p.id)).toEqual(['moi', 'a']);

    // La fin du délai : plus rien à reprendre.
    await transport.park();
    await transport.unpark();
    expect(await transport.resume({ ...join(), resume: '2' }, {}, events())).toBe(false);
  });
});
