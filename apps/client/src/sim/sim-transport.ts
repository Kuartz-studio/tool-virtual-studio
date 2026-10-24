import { decodeSimToken, type MediaJoinPayload, type SimRoomMember } from '@bureau/shared';
import type { LocalSource, MediaDevices, MediaParticipant, MediaTransport, TransportEvents, VideoSource } from '../media/media-client';
import { getSimRoom, subscribeSimConnectionLost, subscribeSimRoom } from './sim-room';

// Le faux LiveKit du navigateur (VITE_SIM=1) : la room est celle que le serveur donne (media:join), mais son contenu aussi. Les
// personnes de la room, le serveur le dit (`sim:room`, sim-room.ts) ; ce qu'elles « disent », c'est le fichier audio de chacune,
// joué en boucle dans un élément <audio> caché, tant qu'elle est dans la room et que l'on y est. En quittant la room, ou quand elle
// change de membres, les éléments s'arrêtent et sont retirés.
//
// La personne qui joue n'est pas entendue : micro, caméra et partage d'écran s'allument et s'éteignent sans rien demander au
// navigateur. Il n'y a pas de vidéo. Les personnes de la room qui ont un fichier audio « parlent » (l'anneau de leur étiquette).
//
// Parquer et reprendre suivent le vrai transport, sans réseau : parquer fait taire la room en retenant son nom ; une reprise de cette room
// (un media:join avec `resume`) la rouvre aussitôt, comme une connexion (il n'y a pas de droits à attendre chez un faux LiveKit).
export class SimTransport implements MediaTransport {
  private parked: string | null = null;
  private room: string | null = null;
  private self: { id: string; name: string } | null = null;
  private events: TransportEvents | null = null;
  private members: SimRoomMember[] = [];
  private published = { mic: false, cam: false, screen: false };
  private sinkId: string | undefined;
  private unsubscribe: Array<() => void> = [];
  // Un élément audio par personne, avec l'adresse qu'il joue (un autre fichier le remplace).
  private readonly players = new Map<string, { el: HTMLAudioElement; src: string }>();
  // Le volume de chaque personne (absente : 1) : celui du jeu, qui baisse avec la distance.
  private volumes: Readonly<Record<string, number>> = {};

  async connect(p: MediaJoinPayload, devices: MediaDevices, events: TransportEvents): Promise<void> {
    this.parked = null;
    const token = decodeSimToken(p.token);
    if (!token) throw new Error('Jeton du faux live illisible');
    this.room = p.room;
    this.self = { id: token.identity, name: token.name };
    this.events = events;
    this.sinkId = devices.audioOutput;
    // Le message de cette room est peut-être déjà arrivé.
    const known = getSimRoom();
    this.members = known?.room === p.room ? known.members : [];
    this.unsubscribe = [
      subscribeSimRoom((message) => {
        if (message.room !== this.room) return;
        this.members = message.members;
        this.sync();
      }),
      // La connexion au serveur est tombée : plus personne ne dira quand quitter la room, elle est perdue.
      subscribeSimConnectionLost(() => {
        const lost = this.events;
        this.leave();
        lost?.disconnected('lost');
      }),
    ];
    this.sync();
  }

  async disconnect(): Promise<void> {
    this.parked = null;
    this.leave();
  }

  async park(): Promise<void> {
    const room = this.room;
    this.leave();
    this.parked = room;
  }

  async resume(p: MediaJoinPayload, devices: MediaDevices, events: TransportEvents): Promise<boolean> {
    if (this.parked === null || this.parked !== p.room || p.resume === undefined) return false;
    await this.connect(p, devices, events);
    return true;
  }

  async unpark(): Promise<void> {
    this.parked = null;
  }

  async setSource(source: LocalSource, on: boolean): Promise<void> {
    this.published[source] = on;
  }

  setVolumes(volumes: Readonly<Record<string, number>>): void {
    this.volumes = volumes;
    for (const [id, { el }] of this.players) el.volume = this.volumeOf(id);
  }

  async useDevices(devices: MediaDevices): Promise<void> {
    this.sinkId = devices.audioOutput;
    for (const { el } of this.players.values()) this.route(el);
  }

  // Lance la lecture de ce qui n'a pas pu démarrer (le navigateur la veut dans un geste de la personne). Refusée, elle lève et le son
  // reste bloqué.
  async startAudio(): Promise<void> {
    if (this.room === null) return;
    const results = await Promise.allSettled([...this.players.values()].map(({ el }) => (el.paused ? el.play() : undefined)));
    if (results.some((r) => r.status === 'rejected')) throw new DOMException('La lecture du son est refusée.', 'NotAllowedError');
    this.events?.audioPlayback(true);
  }

  participants(): MediaParticipant[] {
    if (this.room === null || this.self === null) return [];
    const local: MediaParticipant = { ...this.self, isLocal: true, ...this.published, speaking: false };
    const others = this.members
      .filter((m) => m.id !== this.self!.id)
      .map((m): MediaParticipant => ({
        id: m.id,
        name: m.name,
        isLocal: false,
        mic: m.audio !== null,
        cam: false,
        screen: false,
        speaking: this.isPlaying(m.id),
      }));
    return [local, ...others];
  }

  // Quitte la room : les sons s'arrêtent et leurs éléments sont retirés, plus aucun événement.
  private leave(): void {
    for (const off of this.unsubscribe.splice(0)) off();
    for (const id of [...this.players.keys()]) this.stop(id);
    this.room = null;
    this.self = null;
    this.events = null;
    this.members = [];
    this.published = { mic: false, cam: false, screen: false };
  }

  // Aucune vidéo dans le faux live.
  attach(_el: HTMLVideoElement, _participantId: string, _source: VideoSource): () => void {
    return () => {};
  }

  private isPlaying(id: string): boolean {
    const player = this.players.get(id);
    return player !== undefined && !player.el.paused;
  }

  // Les éléments audio suivent les personnes de la room : un par personne qui a un fichier, un fichier changé se rejoue, qui part s'arrête.
  private sync(): void {
    const wanted = new Map(this.members.filter((m) => m.id !== this.self?.id && m.audio !== null).map((m) => [m.id, m.audio!]));
    for (const [id, player] of [...this.players]) {
      if (wanted.get(id) !== player.src) this.stop(id);
    }
    for (const [id, src] of wanted) {
      if (!this.players.has(id)) this.start(id, src);
    }
    this.events?.changed();
  }

  private start(id: string, src: string): void {
    const el = document.createElement('audio');
    el.src = src;
    el.loop = true;
    el.preload = 'auto';
    el.hidden = true;
    el.dataset.simBot = id;
    el.volume = this.volumeOf(id);
    // Qui joue, ou s'arrête, se voit tout de suite (l'anneau « parle »).
    const changed = () => this.events?.changed();
    el.addEventListener('playing', changed);
    el.addEventListener('pause', changed);
    this.route(el);
    document.body.append(el);
    this.players.set(id, { el, src });
    el.play().then(undefined, (err: unknown) => {
      // Le navigateur veut un geste de la personne : le son est bloqué, « Activer le son » le relance. Autre échec (fichier illisible) :
      // cette personne reste muette, sans bloquer les autres.
      if (err instanceof DOMException && err.name === 'NotAllowedError') this.events?.audioPlayback(false);
    });
  }

  private stop(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    player.el.pause();
    player.el.removeAttribute('src');
    player.el.load();
    player.el.remove();
  }

  private volumeOf(id: string): number {
    const volume = this.volumes[id] ?? 1;
    return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
  }

  // La sortie audio choisie, quand le navigateur sait la changer.
  private route(el: HTMLAudioElement): void {
    const sink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (this.sinkId && sink.setSinkId) sink.setSinkId(this.sinkId).catch(() => {});
  }
}
