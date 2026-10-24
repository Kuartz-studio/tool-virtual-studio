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

// Le client média de l'appli : la logique de MediaSession, sur LiveKit. livekit-client (plus de 100 ko) n'est téléchargé qu'une fois le
// bureau ouvert (warmUp, appelé par useMedia) et au plus tard au premier join : le bureau s'affiche sans l'attendre, et la première
// conversation ne l'attend plus.
//
// Avec VITE_SIM=1 (`pnpm dev:sim`), le faux live : la même logique, sur un faux transport qui joue en boucle le fichier audio des
// personnes fictives de la room (sim/sim-transport.ts). Sans lui, ce code n'entre pas dans le build.
export function createMediaClient(prefs: MediaPrefs): MediaClient {
  if (__SIM__) {
    return new MediaSession(new LazyTransport(async () => new (await import('../sim/sim-transport')).SimTransport()), prefs);
  }
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
  // Les volumes demandés, pour le transport quand il arrive.
  private volumes: Readonly<Record<string, number>> = {};

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

  // Parquer, reprendre, fermer la room parquée : seulement une fois chargé (avant, il n'y a jamais eu de room). Un transport qui ne sait pas
  // parquer se déconnecte, et ne reprend rien.
  async park(): Promise<void> {
    const loaded = this.loaded;
    if (!loaded) return;
    if (loaded.park) await loaded.park();
    else await loaded.disconnect();
  }

  async resume(p: MediaJoinPayload, devices: MediaDevices, events: TransportEvents): Promise<boolean> {
    return (await this.loaded?.resume?.(p, devices, events)) ?? false;
  }

  async unpark(): Promise<void> {
    await this.loaded?.unpark?.();
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

  // Télécharge le transport dès l'entrée au bureau plutôt qu'à la première conversation : c'est ce téléchargement, avant la connexion,
  // qui retardait la première conversation d'une session.
  warmUp(): void {
    this.ensureLoaded().catch(() => {
      // Réessayé au premier join, qui échoue alors comme une connexion impossible.
    });
  }

  setVolumes(volumes: Readonly<Record<string, number>>): void {
    this.volumes = volumes;
    this.loaded?.setVolumes?.(volumes);
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
        transport.setVolumes?.(this.volumes);
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
