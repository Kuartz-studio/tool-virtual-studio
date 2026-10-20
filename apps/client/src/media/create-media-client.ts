import type { MediaJoinPayload } from '@bureau/shared';
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

// Le client média de l'appli : la logique de MediaSession, sur LiveKit. livekit-client (plus de 100 ko) n'est téléchargé qu'au premier
// join, c'est-à-dire à la première conversation : le bureau s'ouvre sans lui, et une personne qui reste seule ne le charge jamais.
export function createMediaClient(prefs: MediaPrefs): MediaClient {
  return new MediaSession(new LazyTransport(async () => new (await import('./livekit-media-client')).LiveKitTransport()), prefs);
}

// Une vidéo attachée avant le chargement du transport : elle lui sera passée une fois chargé.
interface PendingAttachment {
  el: HTMLVideoElement;
  participantId: string;
  source: VideoSource;
  detach: (() => void) | null;
}

// Un transport chargé à la demande, à la première connexion. Avant, il n'y a pas de room : micro, caméra, périphériques et son ne font
// rien, personne n'est dans la room, et les vidéos attachées attendent le chargement. Un chargement qui échoue (réseau coupé, nouvelle
// version déployée entre-temps) fait échouer la connexion, comme une connexion impossible ; la suivante réessaie.
export class LazyTransport implements MediaTransport {
  private loaded: MediaTransport | null = null;
  private loading: Promise<MediaTransport> | null = null;
  // Change à chaque disconnect : une connexion qui attendait le chargement est alors annulée.
  private generation = 0;
  private readonly pending = new Set<PendingAttachment>();

  constructor(private readonly load: () => Promise<MediaTransport>) {}

  async connect(p: MediaJoinPayload, devices: MediaDevices, events: TransportEvents): Promise<void> {
    const generation = this.generation;
    const transport = await this.ensureLoaded();
    // Quittée pendant le chargement : comme LiveKit, la connexion annulée échoue, sans rien laisser derrière.
    if (generation !== this.generation) throw new Error('Client initiated disconnect');
    await transport.connect(p, devices, events);
  }

  async disconnect(): Promise<void> {
    this.generation += 1;
    await this.loaded?.disconnect();
  }

  async setSource(source: LocalSource, on: boolean): Promise<void> {
    await this.loaded?.setSource(source, on);
  }

  async useDevices(devices: MediaDevices): Promise<void> {
    await this.loaded?.useDevices(devices);
  }

  async startAudio(): Promise<void> {
    await this.loaded?.startAudio();
  }

  participants(): MediaParticipant[] {
    return this.loaded?.participants() ?? [];
  }

  attach(el: HTMLVideoElement, participantId: string, source: VideoSource): () => void {
    if (this.loaded) return this.loaded.attach(el, participantId, source);
    const entry: PendingAttachment = { el, participantId, source, detach: null };
    this.pending.add(entry);
    return () => {
      this.pending.delete(entry);
      entry.detach?.();
      entry.detach = null;
    };
  }

  private ensureLoaded(): Promise<MediaTransport> {
    if (this.loaded) return Promise.resolve(this.loaded);
    this.loading ??= this.load().then(
      (transport) => {
        this.loaded = transport;
        for (const entry of this.pending) entry.detach = transport.attach(entry.el, entry.participantId, entry.source);
        this.pending.clear();
        return transport;
      },
      (err: unknown) => {
        this.loading = null;
        throw err;
      },
    );
    return this.loading;
  }
}
