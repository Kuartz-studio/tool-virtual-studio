import type { MediaJoinPayload } from '@bureau/shared';
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
  type RoomEventCallbacks,
  type RoomOptions,
} from 'livekit-client';
import type { LocalSource, MediaDevices, MediaParticipant, MediaTransport, TransportEvents, VideoSource } from './media-client';

// Le transport LiveKit (livekit-client 2), sous la logique de MediaSession. L'appli ne l'importe pas directement : create-media-client.ts
// ne charge ce module (et livekit-client avec lui) qu'au premier join. Rien n'est créé ni demandé aux périphériques avant.

// Les événements de la room après lesquels les participants sont à relire (et les vidéos à rattacher).
const CHANGES = [
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.ParticipantNameChanged,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.LocalTrackPublished,
  RoomEvent.ActiveSpeakersChanged,
  RoomEvent.Reconnected,
] as const;

// Les fins de room qui ne sont pas des pannes : le serveur nous a retirés (à chaque changement de groupe, en même temps que
// media:leave), la room est supprimée ou fermée, ou le même compte l'a rejointe ailleurs (un autre onglet, qui prend la place).
const REMOVED: ReadonlySet<DisconnectReason> = new Set([
  DisconnectReason.PARTICIPANT_REMOVED,
  DisconnectReason.ROOM_DELETED,
  DisconnectReason.ROOM_CLOSED,
  DisconnectReason.DUPLICATE_IDENTITY,
]);

// Un élément vidéo attaché, et la piste qu'il montre en ce moment.
interface Attachment {
  el: HTMLVideoElement;
  participantId: string;
  source: VideoSource;
  track: Track | undefined;
}

// L'adaptateur : une Room LiveKit par connexion, sans autre logique que de traduire.
// - Room avec adaptiveStream (la qualité reçue suit la taille des vignettes, et une vidéo cachée n'est plus reçue) et dynacast
//   (on n'envoie que les qualités que quelqu'un regarde) ;
// - l'audio des autres joue dans des éléments <audio> cachés, créés à chaque piste reçue et retirés quand elle ne l'est plus ;
// - en quittant la room, ou quand elle se termine sans nous, les écouteurs de la room et les éléments audio sont retirés, et les
//   vidéos détachées : elles se rattacheront à la room suivante.
export class LiveKitTransport implements MediaTransport {
  private room: Room | null = null;
  // Résolue quand la room en cours est quittée ou terminée (release) : ce qui attendait encore dans cette room s'arrête alors.
  private released: Promise<void> = Promise.resolve();
  private markReleased: () => void = () => {};
  private readonly unlisten: Array<() => void> = [];
  private readonly audio = new Map<RemoteTrack, HTMLMediaElement>();
  private readonly attachments = new Set<Attachment>();
  // Le volume de chaque personne (absente : 1), et ce que LiveKit en a déjà reçu : il ne change que quand le volume change. Valent pour
  // les rooms suivantes aussi.
  private volumes: Readonly<Record<string, number>> = {};
  private readonly appliedVolumes = new Map<string, number>();

  async connect(p: MediaJoinPayload, devices: MediaDevices, events: TransportEvents): Promise<void> {
    const room = new Room(roomOptions(devices));
    this.room = room;
    this.released = new Promise<void>((resolve) => (this.markReleased = resolve));
    this.listen(room, events);
    try {
      await room.connect(p.url, p.token);
    } catch (err) {
      // LiveKit a déjà fermé la room (et émis Disconnected, qui a pu tout retirer).
      if (this.room === room) this.release();
      throw err;
    }
    this.reattach();
  }

  // Le volume des autres : tout de suite pour ceux qui sont là, dès leur arrivée pour les autres.
  setVolumes(volumes: Readonly<Record<string, number>>): void {
    this.volumes = volumes;
    this.applyVolumes();
  }

  async disconnect(): Promise<void> {
    const room = this.room;
    if (!room) return;
    // D'abord : plus aucun événement de cette room, ni le Disconnected que provoque notre départ.
    this.release();
    await room.disconnect();
  }

  async setSource(source: LocalSource, on: boolean): Promise<void> {
    const local = this.room?.localParticipant;
    if (!local) return;
    const work =
      source === 'mic' ? local.setMicrophoneEnabled(on) : source === 'cam' ? local.setCameraEnabled(on) : local.setScreenShareEnabled(on);
    await this.whileInRoom(work);
  }

  async useDevices(devices: MediaDevices): Promise<void> {
    const choices: Array<[MediaDeviceKind, string | undefined]> = [
      ['audioinput', devices.audioInput],
      ['videoinput', devices.videoInput],
      ['audiooutput', devices.audioOutput],
    ];
    for (const [kind, deviceId] of choices) {
      if (!deviceId || !this.room) continue;
      try {
        await this.whileInRoom(this.room.switchActiveDevice(kind, deviceId));
      } catch {
        // introuvable ou refusé : celui d'avant reste, et les autres changent quand même
      }
    }
  }

  // La lecture des éléments audio de la room, dans le geste de la personne. Refusée, LiveKit dit le son bloqué
  // (AudioPlaybackStatusChanged) et lève.
  async startAudio(): Promise<void> {
    await this.room?.startAudio();
  }

  // Attend ce travail de LiveKit, mais pas au-delà du départ de la room. Une demande d'accès peut rester sans réponse, et LiveKit
  // retient jusqu'à 15 s une publication dans une room fermée : le client média, qui a déjà quitté cette room, n'a pas à l'attendre.
  // Abandonné, le travail finit seul (LiveKit arrête la piste qu'il n'a pas pu publier), et son échec ne compte plus.
  private async whileInRoom(work: Promise<unknown>): Promise<void> {
    const released = this.released;
    work.catch(() => {
      // tant que la room est là, son échec passe par la course ci-dessous ; après son départ, il ne doit pas rester sans réponse
    });
    await Promise.race([work, released]);
  }

  participants(): MediaParticipant[] {
    const room = this.room;
    if (!room) return [];
    return [room.localParticipant, ...room.remoteParticipants.values()].map(toMediaParticipant);
  }

  attach(el: HTMLVideoElement, participantId: string, source: VideoSource): () => void {
    const attachment: Attachment = { el, participantId, source, track: undefined };
    this.attachments.add(attachment);
    this.follow(attachment);
    return () => {
      if (!this.attachments.delete(attachment)) return;
      attachment.track?.detach(el);
      attachment.track = undefined;
    };
  }

  private listen(room: Room, events: TransportEvents): void {
    const on = <E extends keyof RoomEventCallbacks>(event: E, listener: RoomEventCallbacks[E]) => {
      room.on(event, listener);
      this.unlisten.push(() => room.off(event, listener));
    };
    const changed = () => {
      this.reattach();
      this.applyVolumes();
      events.changed();
    };
    on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) this.play(track);
      changed();
    });
    on(RoomEvent.TrackUnsubscribed, (track) => {
      this.silence(track);
      changed();
    });
    on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.source === Track.Source.ScreenShare) events.screenShareEnded();
      changed();
    });
    // Le son des autres permis ou bloqué par le navigateur : LiveKit le dit dès la connexion (son AudioContext ne démarre pas sans
    // geste), et quand un élément audio ne peut pas jouer.
    on(RoomEvent.AudioPlaybackStatusChanged, (playing) => events.audioPlayback(playing));
    for (const event of CHANGES) on(event, changed);
    // La room terminée sans nous : retirés exprès, ou la connexion perdue (LiveKit a déjà essayé de la reprendre).
    on(RoomEvent.Disconnected, (reason) => {
      this.release();
      events.disconnected(reason !== undefined && REMOVED.has(reason) ? 'removed' : 'lost');
    });
  }

  // L'audio d'un autre : un élément <audio> caché, ajouté à la page le temps qu'on reçoive sa piste.
  private play(track: RemoteTrack): void {
    if (this.audio.has(track)) return;
    const element = track.attach();
    element.hidden = true;
    document.body.append(element);
    this.audio.set(track, element);
  }

  private silence(track: RemoteTrack): void {
    const element = this.audio.get(track);
    if (!element) return;
    track.detach(element);
    element.remove();
    this.audio.delete(track);
  }

  // L'élément montre la caméra ou le partage d'écran de la personne, si on le reçoit (le sien : s'il est publié).
  private follow(attachment: Attachment): void {
    const source = attachment.source === 'camera' ? Track.Source.Camera : Track.Source.ScreenShare;
    const track = this.room?.getParticipantByIdentity(attachment.participantId)?.getTrackPublication(source)?.videoTrack;
    if (track === attachment.track) return;
    attachment.track?.detach(attachment.el);
    attachment.track = track;
    track?.attach(attachment.el);
  }

  // Le volume voulu pour chaque autre personne de la room, si LiveKit ne l'a pas déjà : sa voix et le son de son partage d'écran.
  private applyVolumes(): void {
    const room = this.room;
    if (!room) return;
    for (const participant of room.remoteParticipants.values()) {
      const wanted = clampVolume(this.volumes[participant.identity] ?? 1);
      if (this.appliedVolumes.get(participant.identity) === wanted) continue;
      this.appliedVolumes.set(participant.identity, wanted);
      participant.setVolume(wanted, Track.Source.Microphone);
      participant.setVolume(wanted, Track.Source.ScreenShareAudio);
    }
  }

  private reattach(): void {
    for (const attachment of this.attachments) this.follow(attachment);
  }

  // Plus rien de cette room : ses écouteurs, l'audio des autres, les vidéos attachées (qui restent suivies, pour la room suivante),
  // et ce qui y attendait encore (whileInRoom).
  private release(): void {
    for (const off of this.unlisten.splice(0)) off();
    for (const track of [...this.audio.keys()]) this.silence(track);
    for (const attachment of this.attachments) {
      attachment.track?.detach(attachment.el);
      attachment.track = undefined;
    }
    this.room = null;
    this.appliedVolumes.clear();
    this.markReleased();
  }
}

// Un volume entre 0 et 1 ; ce qui n'est pas un nombre vaut le plein volume.
function clampVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
}

function roomOptions(devices: MediaDevices): RoomOptions {
  const options: RoomOptions = { adaptiveStream: true, dynacast: true };
  if (devices.audioInput) options.audioCaptureDefaults = { deviceId: devices.audioInput };
  if (devices.videoInput) options.videoCaptureDefaults = { deviceId: devices.videoInput };
  if (devices.audioOutput) options.audioOutput = { deviceId: devices.audioOutput };
  return options;
}

function toMediaParticipant(p: Participant): MediaParticipant {
  return {
    id: p.identity,
    name: p.name || p.identity,
    isLocal: p.isLocal,
    mic: p.isMicrophoneEnabled,
    cam: p.isCameraEnabled,
    screen: p.isScreenShareEnabled,
    speaking: p.isSpeaking,
  };
}
