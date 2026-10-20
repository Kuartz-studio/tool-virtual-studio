import type { MediaJoinPayload } from '@bureau/shared';
import { DisconnectReason, RoomEvent, Track } from 'livekit-client';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createLiveKitMediaClient } from './livekit-media-client';
import type { MediaClient, MediaPrefs } from './media-client';

// L'adaptateur LiveKit, sur une fausse Room (livekit-client remplacé, sauf ses énumérations) : ce qu'il demande à LiveKit, et ce qu'il
// fait de ses événements. La logique (file, rooms, erreurs) est celle de MediaSession, éprouvée par le faux client.

type Listener = (...args: unknown[]) => void;

const lk = vi.hoisted(() => {
  // Ce qui s'est passé, toutes rooms confondues, dans l'ordre.
  const log: string[] = [];

  class FakeTrack {
    readonly attached: HTMLMediaElement[] = [];
    readonly attach = vi.fn((el?: HTMLMediaElement) => {
      const element = el ?? document.createElement(this.kind === 'audio' ? 'audio' : 'video');
      this.attached.push(element);
      return element;
    });
    readonly detach = vi.fn((el?: HTMLMediaElement) => {
      const detached = el ? [el] : [...this.attached];
      for (const element of detached) this.attached.splice(this.attached.indexOf(element), 1);
      return el ?? detached;
    });
    constructor(readonly kind: 'audio' | 'video') {}
  }

  class FakeParticipant {
    isMicrophoneEnabled = false;
    isCameraEnabled = false;
    isScreenShareEnabled = false;
    isSpeaking = false;
    // Les publications, par source (Track.Source) : leur piste vidéo, une fois reçue.
    readonly publications = new Map<string, { source: string; videoTrack?: FakeTrack }>();
    constructor(
      readonly identity: string,
      readonly name: string | undefined,
      readonly isLocal: boolean,
    ) {}
    getTrackPublication(source: string) {
      return this.publications.get(source);
    }
  }

  class FakeLocalParticipant extends FakeParticipant {
    // Ce que getUserMedia ou getDisplayMedia refusent.
    refuse = new Set<string>();
    readonly setMicrophoneEnabled = vi.fn((on: boolean) => this.toggle('mic', on, () => (this.isMicrophoneEnabled = on)));
    readonly setCameraEnabled = vi.fn((on: boolean) => this.toggle('cam', on, () => (this.isCameraEnabled = on)));
    readonly setScreenShareEnabled = vi.fn((on: boolean) => this.toggle('screen', on, () => (this.isScreenShareEnabled = on)));
    private async toggle(kind: string, on: boolean, apply: () => void): Promise<undefined> {
      log.push(`${kind}:${on ? 'on' : 'off'}`);
      if (on && this.refuse.has(kind)) throw new DOMException('Permission denied', 'NotAllowedError');
      apply();
      return undefined;
    }
  }

  class FakeRoom {
    static readonly instances: FakeRoom[] = [];
    static failConnect = false;
    readonly localParticipant = new FakeLocalParticipant('moi', 'Moi', true);
    readonly remoteParticipants = new Map<string, FakeParticipant>();
    readonly listeners = new Map<string, Set<Listener>>();
    readonly connect = vi.fn(async (url: string, token: string) => {
      log.push(`connect:${url}:${token}`);
      if (FakeRoom.failConnect) throw new Error('could not establish signal connection');
    });
    readonly disconnect = vi.fn(async () => {
      log.push('disconnect');
    });
    readonly switchActiveDevice = vi.fn(async (kind: string, deviceId: string) => {
      log.push(`switch:${kind}:${deviceId}`);
      return true;
    });

    constructor(readonly options: unknown) {
      FakeRoom.instances.push(this);
    }

    on(event: string, fn: Listener): this {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(fn);
      return this;
    }

    off(event: string, fn: Listener): this {
      this.listeners.get(event)?.delete(fn);
      return this;
    }

    emit(event: string, ...args: unknown[]): boolean {
      for (const fn of [...(this.listeners.get(event) ?? [])]) fn(...args);
      return true;
    }

    listenerCount(): number {
      let count = 0;
      for (const set of this.listeners.values()) count += set.size;
      return count;
    }

    getParticipantByIdentity(identity: string): FakeParticipant | undefined {
      return identity === this.localParticipant.identity ? this.localParticipant : this.remoteParticipants.get(identity);
    }

    // Une personne arrive dans la room.
    arrive(identity: string, name?: string): FakeParticipant {
      const participant = new FakeParticipant(identity, name, false);
      this.remoteParticipants.set(identity, participant);
      this.emit('participantConnected', participant);
      return participant;
    }
  }

  return { log, FakeRoom, FakeTrack, FakeParticipant };
});

vi.mock('livekit-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('livekit-client')>()),
  Room: lk.FakeRoom,
}));

const payload = (room: string): MediaJoinPayload => ({ url: 'wss://livekit.test', room, token: `jeton-${room}` });

const clients: MediaClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.leave();
  lk.FakeRoom.instances.splice(0);
  lk.FakeRoom.failConnect = false;
  lk.log.splice(0);
  document.body.innerHTML = '';
});

function client(prefs: MediaPrefs = { mic: false, cam: false }): MediaClient {
  const created = createLiveKitMediaClient(prefs);
  clients.push(created);
  return created;
}

const lastRoom = () => lk.FakeRoom.instances.at(-1)!;
const audioElements = () => [...document.querySelectorAll('audio')];

describe('createLiveKitMediaClient', () => {
  test('aucune Room ni aucun périphérique avant le premier join, même en changeant micro, caméra et préférences', async () => {
    const media = client({ mic: true, cam: true });
    await media.setMic(false);
    await media.setCam(true);
    await media.setPrefs({ mic: true, cam: true, audioInput: 'micro-usb' });
    await media.setScreenShare(true);
    expect(lk.FakeRoom.instances).toHaveLength(0);
    expect(lk.log).toEqual([]);
  });

  test('join : une Room avec adaptiveStream et dynacast et les périphériques choisis, connectée, puis micro et caméra des préférences', async () => {
    const media = client({ mic: true, cam: true, audioInput: 'micro-usb', videoInput: 'webcam', audioOutput: 'casque' });
    await media.join(payload('r1'));
    expect(lastRoom().options).toEqual({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: { deviceId: 'micro-usb' },
      videoCaptureDefaults: { deviceId: 'webcam' },
      audioOutput: { deviceId: 'casque' },
    });
    expect(lk.log).toEqual(['connect:wss://livekit.test:jeton-r1', 'mic:on', 'cam:on']);
    expect(media.getSnapshot()).toEqual({
      room: 'r1',
      participants: [{ id: 'moi', name: 'Moi', isLocal: true, mic: true, cam: true, screen: false, speaking: false }],
      local: { mic: true, cam: true, screen: false },
      error: null,
    });
  });

  test('sans périphérique choisi : ceux du système (rien dans les options)', async () => {
    const media = client();
    await media.join(payload('r1'));
    expect(lastRoom().options).toEqual({ adaptiveStream: true, dynacast: true });
  });

  test('micro refusé (getUserMedia lève) : dans la room quand même, en réception seule, avec permission_denied', async () => {
    const media = client({ mic: true, cam: false });
    const joined = media.join(payload('r1'));
    lastRoom().localParticipant.refuse.add('mic');
    await joined;
    expect(media.getSnapshot()).toMatchObject({ room: 'r1', local: { mic: false, cam: false }, error: 'permission_denied' });
    expect(lastRoom().disconnect).not.toHaveBeenCalled();
  });

  test('connexion refusée : connection_failed, et la Room abandonnée sans écouteur', async () => {
    lk.FakeRoom.failConnect = true;
    const media = client({ mic: true, cam: true });
    await media.join(payload('r1'));
    expect(media.getSnapshot()).toMatchObject({ room: null, error: 'connection_failed' });
    expect(lastRoom().listenerCount()).toBe(0);
    expect(lk.log).not.toContain('mic:on');
  });

  test('changer de room : l\'ancienne est quittée avant que la nouvelle se connecte, et n\'a plus d\'écouteur', async () => {
    const media = client();
    await media.join(payload('r1'));
    const first = lastRoom();
    await media.join(payload('r2'));
    expect(lk.log).toEqual(['connect:wss://livekit.test:jeton-r1', 'disconnect', 'connect:wss://livekit.test:jeton-r2']);
    expect(first.listenerCount()).toBe(0);
    expect(lk.FakeRoom.instances).toHaveLength(2);
  });

  test('leave : room.disconnect(), et plus aucun écouteur sur la Room', async () => {
    const media = client();
    await media.join(payload('r1'));
    const room = lastRoom();
    expect(room.listenerCount()).toBeGreaterThan(0);
    await media.leave();
    expect(room.disconnect).toHaveBeenCalledOnce();
    expect(room.listenerCount()).toBe(0);
    expect(media.getSnapshot()).toMatchObject({ room: null, participants: [] });
  });
});

describe('les événements de la Room', () => {
  test('participants : soi-même puis les autres, avec micro, caméra, partage et nom (l\'identité à défaut)', async () => {
    const media = client({ mic: true, cam: false });
    await media.join(payload('r1'));
    const room = lastRoom();
    const ana = room.arrive('ana', 'Ana');
    ana.isCameraEnabled = true;
    ana.isScreenShareEnabled = true;
    room.emit(RoomEvent.TrackPublished);
    room.arrive('bob');
    expect(media.getSnapshot().participants).toEqual([
      { id: 'moi', name: 'Moi', isLocal: true, mic: true, cam: false, screen: false, speaking: false },
      { id: 'ana', name: 'Ana', isLocal: false, mic: false, cam: true, screen: true, speaking: false },
      { id: 'bob', name: 'bob', isLocal: false, mic: false, cam: false, screen: false, speaking: false },
    ]);

    room.remoteParticipants.delete('bob');
    room.emit(RoomEvent.ParticipantDisconnected);
    expect(media.getSnapshot().participants.map((p) => p.id)).toEqual(['moi', 'ana']);
  });

  test('ActiveSpeakersChanged met à jour speaking', async () => {
    const media = client();
    await media.join(payload('r1'));
    const room = lastRoom();
    const ana = room.arrive('ana', 'Ana');
    ana.isSpeaking = true;
    room.localParticipant.isSpeaking = true;
    room.emit(RoomEvent.ActiveSpeakersChanged, [room.localParticipant, ana]);
    expect(media.getSnapshot().participants.map((p) => [p.id, p.speaking])).toEqual([
      ['moi', true],
      ['ana', true],
    ]);
    ana.isSpeaking = false;
    room.emit(RoomEvent.ActiveSpeakersChanged, [room.localParticipant]);
    expect(media.getSnapshot().participants.map((p) => [p.id, p.speaking])).toEqual([
      ['moi', true],
      ['ana', false],
    ]);
  });

  test('l\'audio des autres : un <audio> caché par piste reçue, retiré quand elle ne l\'est plus, et tous en quittant la room', async () => {
    const media = client();
    await media.join(payload('r1'));
    const room = lastRoom();
    const ana = room.arrive('ana', 'Ana');
    const bob = room.arrive('bob', 'Bob');
    const anaVoice = new lk.FakeTrack('audio');
    const bobVoice = new lk.FakeTrack('audio');

    room.emit(RoomEvent.TrackSubscribed, anaVoice, { source: Track.Source.Microphone }, ana);
    room.emit(RoomEvent.TrackSubscribed, bobVoice, { source: Track.Source.Microphone }, bob);
    expect(audioElements()).toHaveLength(2);
    for (const element of audioElements()) expect(element.hidden).toBe(true);
    expect(anaVoice.attached).toEqual([audioElements()[0]]);

    room.emit(RoomEvent.TrackUnsubscribed, anaVoice, { source: Track.Source.Microphone }, ana);
    expect(audioElements()).toHaveLength(1);
    expect(anaVoice.attached).toEqual([]);

    await media.leave();
    expect(audioElements()).toHaveLength(0);
    expect(bobVoice.attached).toEqual([]);
  });

  test.each([
    ['sans raison', undefined],
    ['SIGNAL_CLOSE', DisconnectReason.SIGNAL_CLOSE],
    ['CONNECTION_TIMEOUT', DisconnectReason.CONNECTION_TIMEOUT],
    ['SERVER_SHUTDOWN', DisconnectReason.SERVER_SHUTDOWN],
  ])('connexion perdue (Disconnected sans leave, %s) : connection_failed, audio retiré, plus d\'écouteur', async (_, reason) => {
    const media = client();
    await media.join(payload('r1'));
    const room = lastRoom();
    const ana = room.arrive('ana', 'Ana');
    room.emit(RoomEvent.TrackSubscribed, new lk.FakeTrack('audio'), { source: Track.Source.Microphone }, ana);

    room.emit(RoomEvent.Disconnected, reason);
    expect(media.getSnapshot()).toMatchObject({ room: null, participants: [], error: 'connection_failed' });
    expect(audioElements()).toHaveLength(0);
    expect(room.listenerCount()).toBe(0);
  });

  test.each([
    ['PARTICIPANT_REMOVED (le serveur, à un changement de groupe)', DisconnectReason.PARTICIPANT_REMOVED],
    ['DUPLICATE_IDENTITY (le même compte, dans un autre onglet)', DisconnectReason.DUPLICATE_IDENTITY],
    ['ROOM_DELETED', DisconnectReason.ROOM_DELETED],
    ['ROOM_CLOSED', DisconnectReason.ROOM_CLOSED],
  ])('retiré exprès (%s) : plus de room, sans erreur, et tout est retiré', async (_, reason) => {
    const media = client();
    await media.join(payload('r1'));
    const room = lastRoom();
    const ana = room.arrive('ana', 'Ana');
    room.emit(RoomEvent.TrackSubscribed, new lk.FakeTrack('audio'), { source: Track.Source.Microphone }, ana);

    room.emit(RoomEvent.Disconnected, reason);
    expect(media.getSnapshot()).toMatchObject({ room: null, participants: [], error: null });
    expect(audioElements()).toHaveLength(0);
    expect(room.listenerCount()).toBe(0);
  });

  test('partage d\'écran arrêté par le navigateur (LocalTrackUnpublished) : screen repasse à false', async () => {
    const media = client();
    await media.join(payload('r1'));
    await media.setScreenShare(true);
    expect(media.getSnapshot().local.screen).toBe(true);
    const room = lastRoom();
    room.localParticipant.isScreenShareEnabled = false;
    room.emit(RoomEvent.LocalTrackUnpublished, { source: Track.Source.ScreenShare }, room.localParticipant);
    expect(media.getSnapshot().local.screen).toBe(false);
    expect(media.getSnapshot().participants[0]!.screen).toBe(false);
  });

  test('changer de périphériques dans la room : switchActiveDevice, pour chacun de ceux choisis', async () => {
    const media = client({ mic: true, cam: false });
    await media.join(payload('r1'));
    await media.setPrefs({ mic: true, cam: false, audioInput: 'micro-usb', audioOutput: 'casque' });
    expect(lk.log).toContain('switch:audioinput:micro-usb');
    expect(lk.log).toContain('switch:audiooutput:casque');
    expect(lk.log.some((entry) => entry.startsWith('switch:videoinput'))).toBe(false);
  });
});

describe('la vidéo (attach)', () => {
  test('la caméra de quelqu\'un : attachée quand sa piste arrive, même après coup, détachée quand elle part ; la fonction rendue détache', async () => {
    const media = client();
    await media.join(payload('r1'));
    const room = lastRoom();
    const ana = room.arrive('ana', 'Ana');
    const video = document.createElement('video');
    const detach = media.attach(video, 'ana', 'camera');

    const camera = new lk.FakeTrack('video');
    ana.publications.set(Track.Source.Camera, { source: Track.Source.Camera, videoTrack: camera });
    room.emit(RoomEvent.TrackSubscribed, camera, ana.publications.get(Track.Source.Camera), ana);
    expect(camera.attach).toHaveBeenCalledExactlyOnceWith(video);

    ana.publications.delete(Track.Source.Camera);
    room.emit(RoomEvent.TrackUnsubscribed, camera, { source: Track.Source.Camera }, ana);
    expect(camera.detach).toHaveBeenCalledExactlyOnceWith(video);

    const again = new lk.FakeTrack('video');
    ana.publications.set(Track.Source.Camera, { source: Track.Source.Camera, videoTrack: again });
    room.emit(RoomEvent.TrackSubscribed, again, ana.publications.get(Track.Source.Camera), ana);
    expect(again.attach).toHaveBeenCalledExactlyOnceWith(video);
    detach();
    expect(again.detach).toHaveBeenCalledExactlyOnceWith(video);
    // Détachée : les pistes suivantes ne la touchent plus.
    const later = new lk.FakeTrack('video');
    ana.publications.set(Track.Source.Camera, { source: Track.Source.Camera, videoTrack: later });
    room.emit(RoomEvent.TrackSubscribed, later, ana.publications.get(Track.Source.Camera), ana);
    expect(later.attach).not.toHaveBeenCalled();
  });

  test('son propre partage d\'écran : attaché quand il est publié ; détaché en quittant la room', async () => {
    const media = client();
    await media.join(payload('r1'));
    const room = lastRoom();
    const video = document.createElement('video');
    media.attach(video, 'moi', 'screen');

    const screen = new lk.FakeTrack('video');
    room.localParticipant.publications.set(Track.Source.ScreenShare, { source: Track.Source.ScreenShare, videoTrack: screen });
    room.emit(RoomEvent.LocalTrackPublished, room.localParticipant.publications.get(Track.Source.ScreenShare), room.localParticipant);
    expect(screen.attach).toHaveBeenCalledExactlyOnceWith(video);

    await media.leave();
    expect(screen.detach).toHaveBeenCalledExactlyOnceWith(video);
  });

  test('attachée avant d\'entrer dans la room : la piste est attachée une fois la room rejointe', async () => {
    const media = client();
    const video = document.createElement('video');
    media.attach(video, 'moi', 'camera');
    const joined = media.join(payload('r1'));
    const camera = new lk.FakeTrack('video');
    lastRoom().localParticipant.publications.set(Track.Source.Camera, { source: Track.Source.Camera, videoTrack: camera });
    await joined;
    expect(camera.attach).toHaveBeenCalledExactlyOnceWith(video);
  });
});
