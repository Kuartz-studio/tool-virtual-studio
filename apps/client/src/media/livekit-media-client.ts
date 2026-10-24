import { MEDIA_PARKED_ATTRIBUTE, MEDIA_RESUME_ATTRIBUTE, type MediaJoinPayload } from '@bureau/shared';
import {
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type LocalTrack,
  type Participant,
  type RemoteTrack,
  type RoomEventCallbacks,
  type RoomOptions,
} from 'livekit-client';
import type { LocalSource, MediaDevices, MediaParticipant, MediaTransport, TransportEvents, VideoSource } from './media-client';

// Le transport LiveKit (livekit-client 2), sous la logique de MediaSession. L'appli ne l'importe pas directement : create-media-client.ts
// ne charge ce module (et livekit-client avec lui) qu'au premier join. Rien n'est créé ni demandé aux périphériques avant.

// Les événements de la room après lesquels les participants sont à relire (et les vidéos à rattacher). Les attributs disent qui le serveur a
// parqué dans la room (il l'a quittée) : on ne le montre plus.
const CHANGES = [
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.ParticipantNameChanged,
  RoomEvent.ParticipantAttributesChanged,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.LocalTrackPublished,
  RoomEvent.ActiveSpeakersChanged,
  RoomEvent.Reconnected,
] as const;

// Le temps qu'on laisse à LiveKit pour confirmer une reprise (le serveur rend les droits, LiveKit le dit au client) : au-delà, la reprise
// échoue, et MediaSession se reconnecte avec le jeton. En local, la confirmation arrive en quelques millisecondes ; LiveKit Cloud ajoute un
// aller-retour du serveur jusqu'à lui, puis jusqu'au navigateur.
export const RESUME_TIMEOUT_MS = 2000;

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
//   vidéos détachées : elles se rattacheront à la room suivante ;
// - parquer (park) : la Room reste connectée, mise de côté. Plus rien d'elle n'arrive à MediaSession ni aux haut-parleurs ; le micro est
//   dépublié sans être arrêté (gardé, `keptMic`), la caméra et le partage d'écran s'arrêtent. Le serveur, lui, lui retire tout droit d'y
//   recevoir ou d'y publier. La reprendre (resume) attend que LiveKit dise les droits rendus (l'attribut MEDIA_RESUME_ATTRIBUTE de la
//   personne vaut le `resume` du join), puis la remet en cours : le son des autres revient de lui-même (LiveKit nous réabonne), et
//   MediaSession republie le micro gardé, sans redemander l'accès au navigateur. Une autre connexion ferme la room parquée, mais garde le micro
//   (il sert dans la room suivante) ; la fin du délai (unpark) ou une sortie pour de bon arrêtent tout ;
// - les autres que le serveur a parqués dans la room (MEDIA_PARKED_ATTRIBUTE) ne sont pas montrés : ils l'ont quittée.
export class LiveKitTransport implements MediaTransport {
  private room: Room | null = null;
  // Les périphériques avec lesquels la room en cours a été ouverte (puis ceux de useDevices) : une reprise ne vaut qu'avec les mêmes.
  private roomDevices: MediaDevices = {};
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
  // La room parquée : sa Room, son nom, ses périphériques, et le retrait de l'écouteur qui la suit (sa fin).
  private parked: { room: Room; name: string; devices: MediaDevices; off: () => void } | null = null;
  // Le nom de la room en cours (celui du join).
  private roomName: string | null = null;
  // Le micro dépublié en parquant une room, et le micro choisi quand il a été ouvert : publié tel quel dans la room suivante (la même, ou
  // une autre avec le même micro), sans redemander l'accès au navigateur.
  private kept: { track: LocalTrack; audioInput: string | undefined } | null = null;
  // Les allumages (micro, caméra, partage) que LiveKit n'a pas encore finis, par Room. Une publication partie vers le serveur après qu'il a
  // retiré les droits (on est sorti pendant qu'elle se faisait) reste sans réponse : LiveKit l'attend 10 s, et un nouvel allumage de la même
  // source se contenterait de l'attendre, sans rien publier. Une Room parquée qui en a une en cours ne se reprend donc pas : MediaSession se
  // reconnecte, dans une Room neuve.
  private readonly publishing = new WeakMap<Room, number>();

  async connect(p: MediaJoinPayload, devices: MediaDevices, events: TransportEvents): Promise<void> {
    // Une room parquée qu'on ne reprend pas : fermée. Son micro reste, s'il est encore le micro choisi.
    this.dropParked();
    if (this.kept && this.kept.audioInput !== devices.audioInput) this.stopKept();
    const room = new Room(roomOptions(devices));
    this.room = room;
    this.roomName = p.room;
    this.roomDevices = { ...devices };
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
    await this.unpark();
    const room = this.room;
    if (!room) return;
    // D'abord : plus aucun événement de cette room, ni le Disconnected que provoque notre départ.
    this.release();
    await room.disconnect();
  }

  async park(): Promise<void> {
    const room = this.room;
    const name = this.roomName;
    if (!room || name === null) return;
    // D'abord : plus rien de cette room n'arrive à MediaSession (pas même le partage d'écran qui s'arrête juste après), ni aux haut-parleurs.
    this.release();
    this.dropParked();
    const devices = this.roomDevices;
    const onDisconnected = () => {
      // Fermée sans nous (le serveur l'a retirée, la connexion est perdue) : il n'y a plus rien à reprendre. Le micro gardé, lui, reste
      // jusqu'à la fin du délai, ou jusqu'à la room suivante.
      if (this.parked?.room === room) this.parked = null;
    };
    // Une publication qui finit après le parcage (le micro ou la caméra s'allumaient encore quand on est sorti) : dépubliée à son tour. Sans
    // cela, LiveKit, qui l'a déjà retirée chez lui (le serveur a retiré les droits), la croirait publiée, et la reprise se contenterait de la
    // rallumer : personne ne nous entendrait.
    const onLatePublication = () => void this.unpublishAll(room, devices);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.LocalTrackPublished, onLatePublication);
    this.parked = {
      room,
      name,
      devices,
      off: () => {
        room.off(RoomEvent.Disconnected, onDisconnected);
        room.off(RoomEvent.LocalTrackPublished, onLatePublication);
      },
    };
    await this.unpublishAll(room, devices);
  }

  async resume(p: MediaJoinPayload, devices: MediaDevices, events: TransportEvents): Promise<boolean> {
    const parked = this.parked;
    const resume = p.resume;
    if (!parked || parked.name !== p.room || resume === undefined || !sameDevices(parked.devices, devices)) return false;
    if (parked.room.state !== ConnectionState.Connected) return false;
    if (!(await resumed(parked.room, resume))) return false;
    // Fermée, ou remplacée, pendant l'attente (une sortie pour de bon, une autre connexion) : il n'y a plus rien à reprendre. Un allumage
    // d'avant le parcage encore en cours chez LiveKit : on ne la reprend pas (voir `publishing`).
    if (this.parked !== parked || (this.publishing.get(parked.room) ?? 0) > 0) return false;
    parked.off();
    this.parked = null;
    const room = parked.room;
    // Ce que LiveKit croit encore publié (une publication qui a fini pendant le parcage, que le serveur avait déjà retirée) : dépublié, pour que
    // MediaSession republie pour de bon (le micro, gardé, sans redemander l'accès).
    await this.unpublishAll(room, parked.devices);
    this.room = room;
    this.roomName = parked.name;
    this.roomDevices = { ...parked.devices };
    this.released = new Promise<void>((resolve) => (this.markReleased = resolve));
    this.listen(room, events);
    // Ce que LiveKit nous a déjà rendu pendant l'attente (le réabonnement suit les droits de près) : joué comme une piste qui arrive.
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        const track = publication.track;
        if (track && track.kind === Track.Kind.Audio && publication.isSubscribed) this.play(track as RemoteTrack);
      }
    }
    this.reattach();
    this.applyVolumes();
    return true;
  }

  async unpark(): Promise<void> {
    this.dropParked();
    this.stopKept();
  }

  async setSource(source: LocalSource, on: boolean): Promise<void> {
    const room = this.room;
    if (!room) {
      // Hors room, couper le micro arrête celui que la room parquée gardait : l'indicateur du navigateur s'éteint.
      if (source === 'mic' && !on) this.stopKept();
      return;
    }
    const local = room.localParticipant;
    // Le micro gardé d'une room parquée, encore ouvert : publié tel quel (rallumé s'il était coupé), sans redemander l'accès au navigateur.
    if (source === 'mic' && on && this.kept) {
      const { track } = this.kept;
      this.kept = null;
      if (track.mediaStreamTrack.readyState === 'live') {
        const publish = (async () => {
          if (track.isMuted) await track.unmute();
          await local.publishTrack(track);
        })();
        await this.whileInRoom(this.publishingIn(room, publish));
        return;
      }
      track.stop();
    }
    const work =
      source === 'mic' ? local.setMicrophoneEnabled(on) : source === 'cam' ? local.setCameraEnabled(on) : local.setScreenShareEnabled(on);
    await this.whileInRoom(on ? this.publishingIn(room, work) : work);
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
        this.roomDevices = { ...this.roomDevices, [kind === 'audioinput' ? 'audioInput' : kind === 'videoinput' ? 'videoInput' : 'audioOutput']: deviceId };
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
    const present = [...room.remoteParticipants.values()].filter((participant) => participant.attributes[MEDIA_PARKED_ATTRIBUTE] !== '1');
    return [room.localParticipant, ...present].map(toMediaParticipant);
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
    this.roomName = null;
    this.appliedVolumes.clear();
    this.markReleased();
  }

  // Compte cet allumage parmi ceux que LiveKit n'a pas finis dans cette Room, jusqu'à ce qu'il finisse (réussi ou non), même si on a quitté
  // la room entre-temps.
  private publishingIn<T>(room: Room, work: Promise<T>): Promise<T> {
    this.publishing.set(room, (this.publishing.get(room) ?? 0) + 1);
    const settled = () => this.publishing.set(room, (this.publishing.get(room) ?? 1) - 1);
    work.then(settled, settled);
    return work;
  }

  // Dépublie tout ce que la personne publie dans cette room : le micro est gardé (le dernier publié, s'il est encore ouvert ; un autre qu'on
  // garderait déjà est arrêté), le reste (caméra, partage d'écran) s'arrête.
  private async unpublishAll(room: Room, devices: MediaDevices): Promise<void> {
    const local = room.localParticipant;
    for (const publication of [...local.trackPublications.values()]) {
      const track = publication.track;
      if (!track) continue;
      const keep = publication.source === Track.Source.Microphone && track.mediaStreamTrack.readyState === 'live';
      try {
        await local.unpublishTrack(track, !keep);
      } catch {
        // La room se ferme peut-être déjà : une piste qu'on ne garde pas s'arrête quand même.
        if (!keep) track.stop();
      }
      if (keep && this.kept?.track !== track) {
        this.stopKept();
        this.kept = { track, audioInput: devices.audioInput };
      }
    }
  }

  // Ferme la room parquée, s'il y en a une, sans attendre LiveKit. Le micro gardé n'en dépend pas : il reste.
  private dropParked(): void {
    const parked = this.parked;
    if (!parked) return;
    parked.off();
    this.parked = null;
    parked.room.disconnect().catch(() => {
      // abandonnée de toute façon
    });
  }

  private stopKept(): void {
    this.kept?.track.stop();
    this.kept = null;
  }
}

// Le serveur a-t-il repris la personne dans cette room ? Son attribut de reprise vaut `resume` (jamais celui d'une reprise d'avant) et elle peut
// de nouveau recevoir : LiveKit envoie les deux d'un bloc, l'attribut d'abord. Rend vrai dès que c'est le cas, faux au bout de RESUME_TIMEOUT_MS,
// ou si la room se ferme entre-temps.
function resumed(room: Room, resume: string): Promise<boolean> {
  const done = () => room.localParticipant.attributes[MEDIA_RESUME_ATTRIBUTE] === resume && room.localParticipant.permissions?.canSubscribe === true;
  if (done()) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      room.off(RoomEvent.ParticipantAttributesChanged, check);
      room.off(RoomEvent.ParticipantPermissionsChanged, check);
      room.off(RoomEvent.Disconnected, closed);
      resolve(ok);
    };
    const check = () => {
      if (done()) finish(true);
    };
    const closed = () => finish(false);
    const timer = setTimeout(() => finish(false), RESUME_TIMEOUT_MS);
    room.on(RoomEvent.ParticipantAttributesChanged, check);
    room.on(RoomEvent.ParticipantPermissionsChanged, check);
    room.on(RoomEvent.Disconnected, closed);
  });
}

function sameDevices(a: MediaDevices, b: MediaDevices): boolean {
  return a.audioInput === b.audioInput && a.videoInput === b.videoInput && a.audioOutput === b.audioOutput;
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
