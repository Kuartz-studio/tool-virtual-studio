import { MEDIA_PARK_MS, type MediaJoinPayload } from '@bureau/shared';
import { DisconnectReason, RoomEvent, Track } from 'livekit-client';
import { afterEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { LiveKitTransport, RESUME_TIMEOUT_MS } from './livekit-media-client';
import type { MediaClient, MediaPrefs } from './media-client';
import { MediaSession } from './media-session';

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
    // Une piste locale (le micro, la caméra) : arrêtée, elle ne se republie plus ; coupée (isMuted), unmute la rallume.
    readonly mediaStreamTrack = { readyState: 'live' as 'live' | 'ended' };
    isMuted = false;
    readonly stop = vi.fn(() => {
      this.mediaStreamTrack.readyState = 'ended';
    });
    readonly unmute = vi.fn(async () => {
      this.isMuted = false;
    });
    constructor(
      readonly kind: 'audio' | 'video',
      readonly source?: string,
    ) {}
  }

  // Une publication : sa source, sa piste vidéo une fois reçue, ou sa piste (locale, ou reçue avec isSubscribed).
  interface FakePublication {
    source: string;
    videoTrack?: FakeTrack;
    track?: FakeTrack;
    isSubscribed?: boolean;
  }

  class FakeParticipant {
    isMicrophoneEnabled = false;
    isCameraEnabled = false;
    isScreenShareEnabled = false;
    isSpeaking = false;
    // Ses attributs : le serveur en pose un sur qui est parqué dans la room, et sur qui il reprend.
    attributes: Record<string, string> = {};
    // Les publications, par source (Track.Source) : leur piste vidéo, une fois reçue.
    readonly publications = new Map<string, FakePublication>();
    get trackPublications(): Map<string, FakePublication> {
      return this.publications;
    }
    // Les volumes que la page a demandés à LiveKit pour cette personne : [source, volume].
    readonly volumeCalls: Array<[string, number]> = [];
    readonly setVolume = vi.fn((volume: number, source: string) => {
      this.volumeCalls.push([source, volume]);
    });
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
    // Retient les allumages : une demande d'accès sans réponse, ou une publication que LiveKit garde dans une room fermée (15 s).
    hold: Promise<void> | null = null;
    // Ses droits dans la room, tels que LiveKit les dit (le serveur les retire en la parquant, les rend en la reprenant).
    permissions: { canSubscribe: boolean } | undefined = { canSubscribe: true };
    readonly setMicrophoneEnabled = vi.fn((on: boolean) => this.toggle('mic', on, () => (this.isMicrophoneEnabled = on)));
    readonly setCameraEnabled = vi.fn((on: boolean) => this.toggle('cam', on, () => (this.isCameraEnabled = on)));
    readonly setScreenShareEnabled = vi.fn((on: boolean) => this.toggle('screen', on, () => (this.isScreenShareEnabled = on)));
    // Dépublier une piste locale (`stop` : l'arrêter aussi) ; publier une piste qu'on a gardée.
    readonly unpublishTrack = vi.fn(async (track: FakeTrack, stop?: boolean) => {
      log.push(`unpublish:${track.source}:${stop ? 'stop' : 'keep'}`);
      if (track.source) this.publications.delete(track.source);
      if (track.source === 'microphone') this.isMicrophoneEnabled = false;
      if (track.source === 'camera') this.isCameraEnabled = false;
      if (stop) track.stop();
    });
    readonly publishTrack = vi.fn(async (track: FakeTrack) => {
      log.push(`publish:${track.source}`);
      this.publications.set(track.source!, { source: track.source!, track });
      if (track.source === 'microphone') this.isMicrophoneEnabled = true;
    });
    private async toggle(kind: string, on: boolean, apply: () => void): Promise<undefined> {
      log.push(`${kind}:${on ? 'on' : 'off'}`);
      if (this.hold) await this.hold;
      if (on && this.refuse.has(kind)) throw new DOMException('Permission denied', 'NotAllowedError');
      apply();
      // Allumés, le micro et la caméra sont publiés : une piste locale, que parquer dépublie.
      const source = kind === 'mic' ? 'microphone' : kind === 'cam' ? 'camera' : null;
      if (on && source !== null && !this.publications.has(source)) {
        this.publications.set(source, { source, track: new FakeTrack(kind === 'mic' ? 'audio' : 'video', source) });
      }
      return undefined;
    }
  }

  class FakeRoom {
    static readonly instances: FakeRoom[] = [];
    static failConnect = false;
    // Retient les connexions (un serveur lent) ; disconnect() annule celle qui attend, comme LiveKit.
    static holdConnect: Promise<void> | null = null;
    readonly localParticipant = new FakeLocalParticipant('moi', 'Moi', true);
    readonly remoteParticipants = new Map<string, FakeParticipant>();
    readonly listeners = new Map<string, Set<Listener>>();
    private cancelConnect: ((err: Error) => void) | null = null;
    // L'état de la connexion, comme ConnectionState : connectée une fois connect fini, déconnectée après disconnect.
    state: 'disconnected' | 'connected' = 'disconnected';
    readonly connect = vi.fn(async (url: string, token: string) => {
      log.push(`connect:${url}:${token}`);
      const hold = FakeRoom.holdConnect;
      if (hold) {
        await new Promise<void>((resolve, reject) => {
          this.cancelConnect = reject;
          void hold.then(resolve);
        });
      }
      if (FakeRoom.failConnect) throw new Error('could not establish signal connection');
      this.state = 'connected';
    });
    readonly disconnect = vi.fn(async () => {
      log.push('disconnect');
      this.state = 'disconnected';
      this.cancelConnect?.(new Error('Client initiated disconnect'));
      this.cancelConnect = null;
    });
    // Le serveur parque la personne (plus aucun droit de recevoir), puis la reprend : LiveKit le lui dit, l'attribut de la reprise d'abord,
    // ses droits ensuite, dans la même mise à jour.
    serverParks(): void {
      this.localParticipant.permissions = { canSubscribe: false };
      this.emit('participantPermissionsChanged', { canSubscribe: true }, this.localParticipant);
    }
    serverResumes(resume: string): void {
      this.localParticipant.attributes = { ...this.localParticipant.attributes, 'bureau.resume': resume };
      this.emit('participantAttributesChanged', { 'bureau.resume': resume }, this.localParticipant);
      this.localParticipant.permissions = { canSubscribe: true };
      this.emit('participantPermissionsChanged', { canSubscribe: false }, this.localParticipant);
    }
    readonly switchActiveDevice = vi.fn(async (kind: string, deviceId: string) => {
      log.push(`switch:${kind}:${deviceId}`);
      return true;
    });
    // Comme LiveKit : startAudio lance la lecture des éléments audio ; hors d'un geste, le navigateur la refuse, la Room dit le son
    // bloqué (AudioPlaybackStatusChanged), et startAudio lève.
    static refuseAudio = false;
    canPlaybackAudio = true;
    readonly startAudio = vi.fn(async () => {
      log.push('startAudio');
      if (FakeRoom.refuseAudio) {
        this.setPlayback(false);
        throw new DOMException('play() failed because the user didn\'t interact with the document first.', 'NotAllowedError');
      }
      this.setPlayback(true);
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

    // La lecture de l'audio permise ou bloquée par le navigateur, comme handleAudioPlaybackStarted et handleAudioPlaybackFailed.
    setPlayback(playing: boolean): void {
      if (this.canPlaybackAudio === playing) return;
      this.canPlaybackAudio = playing;
      this.emit('audioPlaybackChanged', playing);
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
  lk.FakeRoom.holdConnect = null;
  lk.FakeRoom.refuseAudio = false;
  lk.log.splice(0);
  document.body.innerHTML = '';
});

// La logique de MediaSession sur LiveKitTransport : le client média de l'appli, sans le chargement à la demande (create-media-client.ts).
function client(prefs: MediaPrefs = { mic: false, cam: false }): MediaClient {
  const created = new MediaSession(new LiveKitTransport(), prefs);
  clients.push(created);
  return created;
}

const lastRoom = () => lk.FakeRoom.instances.at(-1)!;
const audioElements = () => [...document.querySelectorAll('audio')];
// Laisse le client avancer aussi loin qu'il peut (la fausse Room n'attend que des promesses, ou ce que retient le test).
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('le volume des autres (setVolumes)', () => {
  const transportOf = (): { media: MediaClient; transport: LiveKitTransport } => {
    const transport = new LiveKitTransport();
    const media = new MediaSession(transport, { mic: false, cam: false });
    clients.push(media);
    return { media, transport };
  };

  test('à ceux qui sont déjà là : leur voix et le son de leur partage d\'écran, une fois', async () => {
    const { media, transport } = transportOf();
    await media.join(payload('r1'));
    const bob = lastRoom().arrive('bob', 'Bob');
    bob.volumeCalls.length = 0;   // le plein volume du départ
    transport.setVolumes({ bob: 0.4 });
    expect(bob.volumeCalls).toEqual([[Track.Source.Microphone, 0.4], [Track.Source.ScreenShareAudio, 0.4]]);
    transport.setVolumes({ bob: 0.4 });
    expect(bob.volumeCalls).toHaveLength(2);
    transport.setVolumes({ bob: 0.1 });
    expect(bob.volumeCalls.at(-1)).toEqual([Track.Source.ScreenShareAudio, 0.1]);
  });

  test('à ceux qui arrivent ensuite, dès leur arrivée ; sans entrée, plein volume', async () => {
    const { media, transport } = transportOf();
    await media.join(payload('r1'));
    transport.setVolumes({ zoe: 0 });
    const zoe = lastRoom().arrive('zoe', 'Zoé');
    const ana = lastRoom().arrive('ana', 'Ana');
    expect(zoe.volumeCalls[0]).toEqual([Track.Source.Microphone, 0]);
    expect(ana.volumeCalls[0]).toEqual([Track.Source.Microphone, 1]);
  });

  test('un volume hors de 0 à 1 est ramené dans ces bornes, un volume illisible vaut le plein volume', async () => {
    const { media, transport } = transportOf();
    await media.join(payload('r1'));
    const bob = lastRoom().arrive('bob', 'Bob');
    transport.setVolumes({ bob: 3 });
    expect(bob.volumeCalls[0]![1]).toBe(1);
    transport.setVolumes({ bob: -2 });
    expect(bob.volumeCalls.at(-1)![1]).toBe(0);
    transport.setVolumes({ bob: Number.NaN });
    expect(bob.volumeCalls.at(-1)![1]).toBe(1);
  });

  test('ils valent aussi pour la room suivante : une personne qui y est déjà reçoit son volume', async () => {
    const { media, transport } = transportOf();
    await media.join(payload('r1'));
    transport.setVolumes({ bob: 0.5 });
    await media.join(payload('r2'));
    const bob = lastRoom().arrive('bob', 'Bob');
    expect(bob.volumeCalls[0]).toEqual([Track.Source.Microphone, 0.5]);
  });

  test('hors room : rien à régler, et rien ne plante', () => {
    const { transport } = transportOf();
    expect(() => transport.setVolumes({ bob: 0.5 })).not.toThrow();
  });
});

describe('LiveKitTransport, sous MediaSession', () => {
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
      audioBlocked: false,
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

  test('leave pendant la connexion : room.disconnect() l\'annule tout de suite, sans micro ni caméra, sans erreur', async () => {
    lk.FakeRoom.holdConnect = new Promise(() => {});   // la connexion n'aboutirait jamais d'elle-même
    const media = client({ mic: true, cam: true });
    const joined = media.join(payload('r1'));
    await media.leave();
    await joined;
    expect(lk.log).toEqual(['connect:wss://livekit.test:jeton-r1', 'disconnect']);
    expect(media.getSnapshot()).toMatchObject({ room: null, local: { mic: true, cam: true }, error: null });
    expect(lastRoom().listenerCount()).toBe(0);
  });

  test('dans la room, allumer attend la réponse de LiveKit : le micro n\'est allumé qu\'une fois publié', async () => {
    const media = client({ mic: false, cam: false });
    await media.join(payload('r1'));
    const room = lastRoom();
    let publish!: () => void;
    room.localParticipant.hold = new Promise((resolve) => (publish = resolve));
    let done = false;
    const turnedOn = media.setMic(true).then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    expect(media.getSnapshot().participants[0]!.mic).toBe(false);
    publish();
    await turnedOn;
    expect(media.getSnapshot().participants[0]!.mic).toBe(true);
  });

  test('LiveKit renonce pendant la connexion (Disconnected), puis la connexion aboutit quand même : la room reste finie, rien n\'y est allumé', async () => {
    let connected!: () => void;
    lk.FakeRoom.holdConnect = new Promise((resolve) => (connected = resolve));
    const media = client({ mic: true, cam: true });
    const joined = media.join(payload('r1'));
    lastRoom().emit(RoomEvent.Disconnected, DisconnectReason.SIGNAL_CLOSE);
    connected();
    await joined;
    expect(media.getSnapshot()).toMatchObject({ room: null, participants: [], error: 'connection_failed' });
    expect(lk.log).toEqual(['connect:wss://livekit.test:jeton-r1']);
    // Hors room, comme il se doit : un partage d'écran demandé ne se fait pas.
    await media.setScreenShare(true);
    expect(media.getSnapshot().local.screen).toBe(false);
  });

  test.each([
    ['retirée par le serveur (Disconnected)', 'removed'],
    ['quittée (media:leave)', 'left'],
  ] as const)(
    'la room %s pendant que le micro s\'allume (LiveKit retient la publication) : rien n\'attend, le micro voulu reste, la room suivante se connecte',
    async (_, end) => {
      const media = client({ mic: true, cam: false });
      const first = media.join(payload('r1'));
      const room = lastRoom();
      room.localParticipant.hold = new Promise(() => {});   // jamais : comme une publication dans une room fermée, pendant 15 s
      await flush();
      expect(lk.log).toEqual(['connect:wss://livekit.test:jeton-r1', 'mic:on']);

      if (end === 'removed') room.emit(RoomEvent.Disconnected, DisconnectReason.PARTICIPANT_REMOVED);
      else void media.leave();
      await first;
      await media.join(payload('r2'));
      expect(lk.log.at(-2)).toBe('connect:wss://livekit.test:jeton-r2');
      expect(media.getSnapshot()).toMatchObject({
        room: 'r2',
        participants: [{ id: 'moi', mic: true }],
        local: { mic: true, cam: false },
        error: null,
      });
      expect(room.listenerCount()).toBe(0);
    },
  );
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

describe('le son des autres', () => {
  test('startAudio : room.startAudio() dans la room ; hors room, aucune Room n\'est créée', async () => {
    const media = client();
    await media.startAudio();
    expect(lk.FakeRoom.instances).toHaveLength(0);
    await media.join(payload('r1'));
    await media.startAudio();
    expect(lastRoom().startAudio).toHaveBeenCalledOnce();
  });

  test('AudioPlaybackStatusChanged : le son bloqué (audioBlocked), puis permis', async () => {
    const media = client();
    await media.join(payload('r1'));
    lastRoom().setPlayback(false);
    expect(media.getSnapshot().audioBlocked).toBe(true);
    lastRoom().setPlayback(true);
    expect(media.getSnapshot().audioBlocked).toBe(false);
  });

  test('bloqué dès la connexion (LiveKit le dit pendant room.connect) : audioBlocked aussi', async () => {
    lk.FakeRoom.holdConnect = new Promise(() => {});
    const media = client();
    void media.join(payload('r1'));
    await flush();
    lastRoom().setPlayback(false);
    expect(media.getSnapshot()).toMatchObject({ room: 'r1', audioBlocked: true });
  });

  test('startAudio refusé hors d\'un geste (LiveKit lève) : rien ne rejette, et le son reste bloqué', async () => {
    const media = client();
    await media.join(payload('r1'));
    lk.FakeRoom.refuseAudio = true;
    await expect(media.startAudio()).resolves.toBeUndefined();
    expect(media.getSnapshot().audioBlocked).toBe(true);
    lk.FakeRoom.refuseAudio = false;
    await media.startAudio();
    expect(media.getSnapshot().audioBlocked).toBe(false);
  });

  test('après la room, plus rien de ses événements de lecture', async () => {
    const media = client();
    await media.join(payload('r1'));
    const room = lastRoom();
    await media.leave();
    room.setPlayback(false);
    expect(media.getSnapshot().audioBlocked).toBe(false);
  });
});

describe('parquer et reprendre', () => {
  const resumeOf = (room: string, resume: string): MediaJoinPayload => ({ ...payload(room), resume });
  const fakeTimers = () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
  };

  test('parquer : la Room reste connectée et se tait ; le micro est dépublié sans être arrêté, la caméra arrêtée ; plus rien d\'elle n\'arrive', async () => {
    const media = client({ mic: true, cam: true });
    await media.join(payload('r1'));
    const room = lastRoom();
    const ana = room.arrive('ana', 'Ana');
    room.emit(RoomEvent.TrackSubscribed, new lk.FakeTrack('audio'), { source: Track.Source.Microphone }, ana);
    expect(audioElements()).toHaveLength(1);
    const mic = room.localParticipant.publications.get(Track.Source.Microphone)!.track!;
    const cam = room.localParticipant.publications.get(Track.Source.Camera)!.track!;

    await media.leave({ park: true });
    expect(room.disconnect).not.toHaveBeenCalled();
    expect(lk.log.slice(-2)).toEqual([`unpublish:${Track.Source.Microphone}:keep`, `unpublish:${Track.Source.Camera}:stop`]);
    expect(mic.stop).not.toHaveBeenCalled();
    expect(cam.stop).toHaveBeenCalledOnce();
    expect(audioElements()).toHaveLength(0);
    expect(media.getSnapshot()).toMatchObject({ room: null, participants: [], local: { mic: true, cam: true } });
    // Ses événements ne comptent plus : quelqu'un arrive, quelqu'un parle, rien ne change ; seule sa fin est suivie.
    room.arrive('bob', 'Bob');
    room.emit(RoomEvent.TrackSubscribed, new lk.FakeTrack('audio'), { source: Track.Source.Microphone }, ana);
    expect(media.getSnapshot().participants).toEqual([]);
    expect(audioElements()).toHaveLength(0);
    expect(room.listenerCount()).toBe(2);   // sa fin, et une publication qui finirait après coup
  });

  test.each([
    ['LiveKit le dit (LocalTrackPublished) : dépubliée tout de suite', true],
    ['sans que LiveKit le dise : dépubliée à la reprise', false],
  ])('le micro s\'allumait encore en sortant, et sa publication finit dans la room parquée (%s) ; la reprise le republie pour de bon', async (_, announced) => {
    const media = client({ mic: true, cam: false });
    const joined = media.join(payload('r1'));
    const room = lastRoom();
    let publish!: () => void;
    room.localParticipant.hold = new Promise((resolve) => (publish = resolve));
    await flush();
    expect(lk.log).toEqual(['connect:wss://livekit.test:jeton-r1', 'mic:on']);
    await media.leave({ park: true });
    room.localParticipant.hold = null;
    publish();
    await joined;
    await flush();
    const mic = room.localParticipant.publications.get(Track.Source.Microphone)!;
    if (announced) {
      room.emit(RoomEvent.LocalTrackPublished, mic, room.localParticipant);
      await flush();
      expect(lk.log.at(-1)).toBe(`unpublish:${Track.Source.Microphone}:keep`);
    }
    const back = media.join(resumeOf('r1', '1'));
    room.serverResumes('1');
    await back;
    expect(lk.log.slice(-2)).toEqual([`unpublish:${Track.Source.Microphone}:keep`, `publish:${Track.Source.Microphone}`]);
    expect(mic.track!.stop).not.toHaveBeenCalled();
    expect(media.getSnapshot().participants[0]).toMatchObject({ id: 'moi', mic: true });
  });

  test('reprendre : attend que LiveKit confirme la reprise ; la même Room reprend, le micro gardé est publié tel quel, la caméra rallumée', async () => {
    const media = client({ mic: true, cam: true });
    await media.join(payload('r1'));
    const room = lastRoom();
    const mic = room.localParticipant.publications.get(Track.Source.Microphone)!.track!;
    await media.leave({ park: true });
    room.serverParks();
    room.localParticipant.attributes = { 'bureau.resume': '4' };   // la reprise d'avant ne compte pas

    const back = media.join(resumeOf('r1', '5'));
    await flush();
    expect(media.getSnapshot()).toMatchObject({ room: 'r1', participants: [] });   // en attente de LiveKit
    room.serverResumes('5');
    await back;
    expect(lk.FakeRoom.instances).toHaveLength(1);
    expect(room.connect).toHaveBeenCalledOnce();
    expect(lk.log.slice(-2)).toEqual([`publish:${Track.Source.Microphone}`, 'cam:on']);
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledOnce();   // celui du premier join : pas de nouvel accès au micro
    expect(mic.stop).not.toHaveBeenCalled();
    expect(media.getSnapshot()).toMatchObject({ room: 'r1', participants: [{ id: 'moi', mic: true, cam: true }], error: null });
    // Le son des autres revient : une piste reçue joue de nouveau.
    const ana = room.arrive('ana', 'Ana');
    room.emit(RoomEvent.TrackSubscribed, new lk.FakeTrack('audio'), { source: Track.Source.Microphone }, ana);
    expect(audioElements()).toHaveLength(1);
  });

  test('une piste rendue pendant l\'attente (LiveKit réabonne avant de confirmer) joue dès la reprise', async () => {
    const media = client();
    await media.join(payload('r1'));
    const room = lastRoom();
    const ana = room.arrive('ana', 'Ana');
    await media.leave({ park: true });
    const voice = new lk.FakeTrack('audio');
    ana.publications.set(Track.Source.Microphone, { source: Track.Source.Microphone, track: voice, isSubscribed: true });
    room.emit(RoomEvent.TrackSubscribed, voice, ana.publications.get(Track.Source.Microphone), ana);
    expect(audioElements()).toHaveLength(0);
    const back = media.join(resumeOf('r1', '1'));
    room.serverResumes('1');
    await back;
    expect(voice.attached).toHaveLength(1);
    expect(audioElements()).toHaveLength(1);
  });

  test('un allumage que LiveKit n\'a pas encore fini au moment du parcage (sans réponse du serveur, qui a retiré les droits) : pas de reprise, une Room neuve', async () => {
    const media = client({ mic: true, cam: false });
    const joined = media.join(payload('r1'));
    const parked = lastRoom();
    parked.localParticipant.hold = new Promise(() => {});   // la publication du micro ne finira jamais (LiveKit l'abandonne au bout de 10 s)
    await flush();
    await media.leave({ park: true });
    await joined;
    const back = media.join(resumeOf('r1', '1'));
    parked.serverResumes('1');
    await back;
    expect(lk.FakeRoom.instances).toHaveLength(2);
    expect(parked.disconnect).toHaveBeenCalledOnce();
    expect(lastRoom().localParticipant.setMicrophoneEnabled).toHaveBeenCalledExactlyOnceWith(true);
    expect(media.getSnapshot()).toMatchObject({ room: 'r1', participants: [{ id: 'moi', mic: true }] });
  });

  test('une reprise que LiveKit ne confirme pas à temps : la parquée est fermée, une Room neuve se connecte avec le jeton, et y publie le micro gardé', async () => {
    fakeTimers();
    const media = client({ mic: true, cam: false });
    await media.join(payload('r1'));
    const parked = lastRoom();
    await media.leave({ park: true });
    const back = media.join(resumeOf('r1', '5'));
    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS);
    await back;
    expect(parked.disconnect).toHaveBeenCalledOnce();
    expect(parked.listenerCount()).toBe(0);
    expect(lk.FakeRoom.instances).toHaveLength(2);
    expect(lastRoom().connect).toHaveBeenCalledExactlyOnceWith('wss://livekit.test', 'jeton-r1');
    expect(lk.log.at(-1)).toBe(`publish:${Track.Source.Microphone}`);
    expect(media.getSnapshot()).toMatchObject({ room: 'r1', error: null });
  });

  test('sans `resume`, ou une autre room : pas de reprise ; la parquée est fermée, le micro gardé publié dans la nouvelle', async () => {
    const media = client({ mic: true, cam: false });
    await media.join(payload('r1'));
    const parked = lastRoom();
    const mic = parked.localParticipant.publications.get(Track.Source.Microphone)!.track!;
    await media.leave({ park: true });
    await media.join(payload('r2'));
    expect(parked.disconnect).toHaveBeenCalledOnce();
    expect(lastRoom().localParticipant.publishTrack).toHaveBeenCalledExactlyOnceWith(mic);
    expect(lastRoom().localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  });

  test('un autre micro choisi entre-temps : la reprise n\'a pas lieu, le micro gardé est arrêté, le nouveau ouvert', async () => {
    const media = client({ mic: true, cam: false });
    await media.join(payload('r1'));
    const parked = lastRoom();
    const mic = parked.localParticipant.publications.get(Track.Source.Microphone)!.track!;
    await media.leave({ park: true });
    await media.setPrefs({ mic: true, cam: false, audioInput: 'micro-usb' });
    const back = media.join(resumeOf('r1', '2'));
    parked.serverResumes('2');
    await back;
    expect(lk.FakeRoom.instances).toHaveLength(2);
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(lastRoom().localParticipant.setMicrophoneEnabled).toHaveBeenCalledExactlyOnceWith(true);
  });

  test('la fin du délai (MEDIA_PARK_MS) : la Room parquée fermée, le micro gardé arrêté', async () => {
    fakeTimers();
    const media = client({ mic: true, cam: false });
    await media.join(payload('r1'));
    const parked = lastRoom();
    const mic = parked.localParticipant.publications.get(Track.Source.Microphone)!.track!;
    await media.leave({ park: true });
    await vi.advanceTimersByTimeAsync(MEDIA_PARK_MS - 1);
    expect(parked.disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(parked.disconnect).toHaveBeenCalledOnce();
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(parked.listenerCount()).toBe(0);
  });

  test('couper le micro pendant le parcage : le micro gardé s\'arrête tout de suite (l\'indicateur du navigateur s\'éteint)', async () => {
    const media = client({ mic: true, cam: false });
    await media.join(payload('r1'));
    const mic = lastRoom().localParticipant.publications.get(Track.Source.Microphone)!.track!;
    await media.leave({ park: true });
    await media.setMic(false);
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(lastRoom().disconnect).not.toHaveBeenCalled();   // la room, elle, reste parquée
  });

  test('une sortie pour de bon pendant le parcage ferme tout ; LiveKit qui ferme la parquée ne gêne rien', async () => {
    const media = client({ mic: true, cam: false });
    await media.join(payload('r1'));
    const first = lastRoom();
    const mic = first.localParticipant.publications.get(Track.Source.Microphone)!.track!;
    await media.leave({ park: true });
    await media.leave();
    expect(first.disconnect).toHaveBeenCalledOnce();
    expect(mic.stop).toHaveBeenCalledOnce();

    await media.join(payload('r2'));
    const second = lastRoom();
    await media.leave({ park: true });
    second.emit(RoomEvent.Disconnected, DisconnectReason.PARTICIPANT_REMOVED);   // le serveur l'a retirée (la fin de son délai à lui)
    expect(media.getSnapshot()).toMatchObject({ room: null, error: null });
    const back = media.join(resumeOf('r2', '3'));
    await back;
    expect(lk.FakeRoom.instances).toHaveLength(3);   // plus rien à reprendre : une connexion neuve
  });

  test('ceux que le serveur a parqués dans la room ne sont pas montrés, et reviennent quand il les reprend', async () => {
    const media = client();
    await media.join(payload('r1'));
    const room = lastRoom();
    const ana = room.arrive('ana', 'Ana');
    room.arrive('bob', 'Bob');
    ana.attributes = { 'bureau.parked': '1' };
    room.emit(RoomEvent.ParticipantAttributesChanged, { 'bureau.parked': '1' }, ana);
    expect(media.getSnapshot().participants.map((p) => p.id)).toEqual(['moi', 'bob']);
    ana.attributes = {};
    room.emit(RoomEvent.ParticipantAttributesChanged, { 'bureau.parked': '' }, ana);
    expect(media.getSnapshot().participants.map((p) => p.id)).toEqual(['moi', 'ana', 'bob']);
  });
});
