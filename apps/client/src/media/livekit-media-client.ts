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
import type {
  LocalSource,
  MediaClient,
  MediaDevices,
  MediaParticipant,
  MediaPrefs,
  MediaTransport,
  TransportEvents,
  VideoSource,
} from './media-client';
import { MediaSession } from './media-session';

// Le client média de l'appli : la logique de MediaSession, sur LiveKit (livekit-client 2). Rien n'est créé ni demandé aux
// périphériques avant le premier join.
export function createLiveKitMediaClient(prefs: MediaPrefs): MediaClient {
  return new MediaSession(new LiveKitTransport(), prefs);
}

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
  private readonly unlisten: Array<() => void> = [];
  private readonly audio = new Map<RemoteTrack, HTMLMediaElement>();
  private readonly attachments = new Set<Attachment>();

  async connect(p: MediaJoinPayload, devices: MediaDevices, events: TransportEvents): Promise<void> {
    const room = new Room(roomOptions(devices));
    this.room = room;
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
    if (source === 'mic') await local.setMicrophoneEnabled(on);
    else if (source === 'cam') await local.setCameraEnabled(on);
    else await local.setScreenShareEnabled(on);
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
        await this.room.switchActiveDevice(kind, deviceId);
      } catch {
        // introuvable ou refusé : celui d'avant reste, et les autres changent quand même
      }
    }
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

  private reattach(): void {
    for (const attachment of this.attachments) this.follow(attachment);
  }

  // Plus rien de cette room : ses écouteurs, l'audio des autres, les vidéos attachées (qui restent suivies, pour la room suivante).
  private release(): void {
    for (const off of this.unlisten.splice(0)) off();
    for (const track of [...this.audio.keys()]) this.silence(track);
    for (const attachment of this.attachments) {
      attachment.track?.detach(attachment.el);
      attachment.track = undefined;
    }
    this.room = null;
  }
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
