import type { MediaJoinPayload } from '@bureau/shared';
import { describe, expect, test, vi } from 'vitest';
import { createMediaClient, LazyTransport } from './create-media-client';
import type { LocalSource, MediaDevices, MediaParticipant, MediaTransport, TransportEvents, VideoSource } from './media-client';

// Le client média de l'appli charge LiveKit (livekit-client, plus de 100 ko) à la demande : au premier media:join suivi, pas avant.
// Le bureau s'ouvre ainsi sans lui.

const loads = vi.hoisted(() => ({ count: 0 }));

// Le vrai adaptateur est remplacé : on ne regarde ici que le moment où son module est chargé.
vi.mock('./livekit-media-client', () => {
  loads.count += 1;
  class LiveKitTransport {
    async connect(): Promise<void> {}
    async disconnect(): Promise<void> {}
    async setSource(): Promise<void> {}
    async useDevices(): Promise<void> {}
    async startAudio(): Promise<void> {}
    participants(): MediaParticipant[] {
      return [];
    }
    attach(): () => void {
      return () => {};
    }
  }
  return { LiveKitTransport };
});

const payload = (room: string): MediaJoinPayload => ({ url: 'wss://livekit.test', room, token: `jeton-${room}` });

const events: TransportEvents = { changed: () => {}, disconnected: () => {}, screenShareEnded: () => {}, audioPlayback: () => {} };

// Un transport qui note ce qu'on lui demande.
class RecordingTransport implements MediaTransport {
  setVolumes?: (volumes: Readonly<Record<string, number>>) => void;
  readonly log: string[] = [];
  readonly attached: Array<{ el: HTMLVideoElement; participantId: string; source: VideoSource }> = [];
  async connect(p: MediaJoinPayload, _devices: MediaDevices, _events: TransportEvents): Promise<void> {
    this.log.push(`connect:${p.room}`);
  }
  async disconnect(): Promise<void> {
    this.log.push('disconnect');
  }
  async setSource(source: LocalSource, on: boolean): Promise<void> {
    this.log.push(`${source}:${on ? 'on' : 'off'}`);
  }
  async useDevices(): Promise<void> {
    this.log.push('devices');
  }
  async startAudio(): Promise<void> {
    this.log.push('startAudio');
  }
  participants(): MediaParticipant[] {
    return [{ id: 'moi', name: 'Moi', isLocal: true, mic: false, cam: false, screen: false, speaking: false }];
  }
  attach(el: HTMLVideoElement, participantId: string, source: VideoSource): () => void {
    const entry = { el, participantId, source };
    this.attached.push(entry);
    return () => this.attached.splice(this.attached.indexOf(entry), 1);
  }
}

// Un chargement que le test fait aboutir (ou échouer) quand il veut.
function deferredLoad() {
  const transport = new RecordingTransport();
  let resolve!: (t: MediaTransport) => void;
  let reject!: (err: Error) => void;
  const load = vi.fn(
    () =>
      new Promise<MediaTransport>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return { transport, load, finish: () => resolve(transport), fail: (err = new Error('chunk introuvable')) => reject(err) };
}

describe('LazyTransport', () => {
  test('rien n\'est chargé avant la première connexion : pas de participants, et micro, caméra, périphériques et son ne font rien', async () => {
    const { load } = deferredLoad();
    const lazy = new LazyTransport(load);
    await lazy.setSource('mic', true);
    await lazy.useDevices({ audioInput: 'micro-usb' });
    await lazy.startAudio();
    await lazy.disconnect();
    expect(lazy.participants()).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  test('la première connexion charge le transport, une seule fois ; ensuite, tout lui est passé', async () => {
    const { transport, load, finish } = deferredLoad();
    const lazy = new LazyTransport(load);
    const connected = lazy.connect(payload('r1'), {}, events);
    finish();
    await connected;
    await lazy.setSource('cam', true);
    await lazy.startAudio();
    await lazy.disconnect();
    await lazy.connect(payload('r2'), {}, events);
    expect(load).toHaveBeenCalledOnce();
    expect(transport.log).toEqual(['connect:r1', 'cam:on', 'startAudio', 'disconnect', 'connect:r2']);
    expect(lazy.participants()).toHaveLength(1);
  });

  test('une vidéo attachée avant le chargement est passée au transport une fois chargé ; détachée avant, elle ne l\'est jamais', async () => {
    const { transport, load, finish } = deferredLoad();
    const lazy = new LazyTransport(load);
    const kept = document.createElement('video');
    const dropped = document.createElement('video');
    const detachKept = lazy.attach(kept, 'ana', 'camera');
    const detachDropped = lazy.attach(dropped, 'bob', 'screen');
    detachDropped();
    const connected = lazy.connect(payload('r1'), {}, events);
    finish();
    await connected;
    expect(transport.attached).toEqual([{ el: kept, participantId: 'ana', source: 'camera' }]);
    // Attachée après le chargement : directement.
    const late = document.createElement('video');
    lazy.attach(late, 'zoe', 'camera');
    expect(transport.attached).toHaveLength(2);
    detachKept();
    expect(transport.attached.map((a) => a.el)).toEqual([late]);
  });

  test('disconnect pendant le chargement : la connexion qui l\'attendait échoue (annulée), sans se connecter', async () => {
    const { transport, load, finish } = deferredLoad();
    const lazy = new LazyTransport(load);
    const connected = lazy.connect(payload('r1'), {}, events);
    await lazy.disconnect();
    // Une autre connexion, demandée pendant ce même chargement, se fait.
    const second = lazy.connect(payload('r2'), {}, events);
    finish();
    await expect(connected).rejects.toThrow();
    await second;
    expect(transport.log).toEqual(['connect:r2']);
  });

  test('warmUp charge le transport tout de suite, une seule fois, sans se connecter : la première connexion ne l\'attend plus', async () => {
    const { transport, load, finish } = deferredLoad();
    const lazy = new LazyTransport(load);
    lazy.warmUp();
    lazy.warmUp();
    expect(load).toHaveBeenCalledOnce();
    finish();
    await Promise.resolve();
    expect(transport.log).toEqual([]);
    await lazy.connect(payload('r1'), {}, events);
    expect(load).toHaveBeenCalledOnce();
    expect(transport.log).toEqual(['connect:r1']);
  });

  test('warmUp qui échoue (réseau coupé) ne lève rien, et la première connexion réessaie le chargement', async () => {
    const transport = new RecordingTransport();
    const load = vi.fn<() => Promise<MediaTransport>>().mockRejectedValueOnce(new Error('chunk introuvable')).mockResolvedValue(transport);
    const lazy = new LazyTransport(load);
    lazy.warmUp();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await lazy.connect(payload('r1'), {}, events);
    expect(load).toHaveBeenCalledTimes(2);
    expect(transport.log).toEqual(['connect:r1']);
  });

  test('setVolumes : retenu avant le chargement et passé au transport dès qu\'il est chargé, puis passé tel quel', async () => {
    const { transport, load, finish } = deferredLoad();
    const volumes: Array<Record<string, number>> = [];
    transport.setVolumes = (v) => {
      volumes.push({ ...v });
    };
    const lazy = new LazyTransport(load);
    lazy.setVolumes({ bob: 0.3 });   // rien de chargé : retenu
    expect(volumes).toEqual([]);
    const connected = lazy.connect(payload('r1'), {}, events);
    finish();
    await connected;
    expect(volumes).toEqual([{ bob: 0.3 }]);
    lazy.setVolumes({ bob: 0.6 });
    expect(volumes).toEqual([{ bob: 0.3 }, { bob: 0.6 }]);
  });

  test('le chargement échoue (réseau coupé, nouvelle version déployée) : la connexion échoue, et la suivante réessaie', async () => {
    const transport = new RecordingTransport();
    const load = vi.fn<() => Promise<MediaTransport>>().mockRejectedValueOnce(new Error('chunk introuvable')).mockResolvedValue(transport);
    const lazy = new LazyTransport(load);
    await expect(lazy.connect(payload('r1'), {}, events)).rejects.toThrow('chunk introuvable');
    await lazy.connect(payload('r1'), {}, events);
    expect(load).toHaveBeenCalledTimes(2);
    expect(transport.log).toEqual(['connect:r1']);
  });

  test('parquer, reprendre, fermer la parquée : rien avant le chargement ; ensuite passés au transport, ou, s\'il ne sait pas parquer, une déconnexion et pas de reprise', async () => {
    const plain = new RecordingTransport();
    const lazy = new LazyTransport(async () => plain);
    await lazy.park();
    expect(await lazy.resume({ ...payload('r1'), resume: '1' }, {}, events)).toBe(false);
    await lazy.unpark();
    expect(plain.log).toEqual([]);
    await lazy.connect(payload('r1'), {}, events);
    await lazy.park();
    expect(await lazy.resume({ ...payload('r1'), resume: '1' }, {}, events)).toBe(false);
    expect(plain.log).toEqual(['connect:r1', 'disconnect']);

    const parking = Object.assign(new RecordingTransport(), {
      park: vi.fn(async () => {}),
      resume: vi.fn(async () => true),
      unpark: vi.fn(async () => {}),
    });
    const lazier = new LazyTransport(async () => parking);
    await lazier.connect(payload('r1'), {}, events);
    await lazier.park();
    expect(await lazier.resume({ ...payload('r1'), resume: '1' }, { audioInput: 'micro' }, events)).toBe(true);
    await lazier.unpark();
    expect(parking.park).toHaveBeenCalledOnce();
    expect(parking.resume).toHaveBeenCalledWith({ ...payload('r1'), resume: '1' }, { audioInput: 'micro' }, events);
    expect(parking.unpark).toHaveBeenCalledOnce();
  });
});

describe('createMediaClient', () => {
  test('livekit-client n\'est chargé qu\'au premier join : ni à la création, ni par micro, caméra, son, préférences ou vidéos', async () => {
    const client = createMediaClient({ mic: true, cam: true });
    await client.setMic(false);
    await client.setCam(true);
    await client.setPrefs({ mic: true, cam: true, audioInput: 'micro-usb' });
    await client.startAudio();
    client.attach(document.createElement('video'), 'ana', 'camera')();
    await client.leave();
    expect(loads.count).toBe(0);

    await client.join(payload('r1'));
    expect(loads.count).toBe(1);
    expect(client.getSnapshot().room).toBe('r1');
  });
});
