import type { MediaJoinPayload } from '@bureau/shared';
import type {
  LocalSource,
  MediaDevices,
  MediaParticipant,
  MediaPrefs,
  MediaTransport,
  TransportEvents,
  VideoSource,
} from './media-client';
import { MediaSession } from './media-session';
import { DEFAULT_PREFS } from './prefs';

// Une vidéo attachée (attach), tant que la fonction rendue n'a pas été appelée.
export interface FakeAttachment {
  el: HTMLVideoElement;
  participantId: string;
  source: VideoSource;
}

type Remote = Omit<MediaParticipant, 'isLocal' | 'speaking'>;

// Ce que fait un appel aux périphériques retenu (holdDevices) quand la room part avant sa réponse :
// - finish : il finit tout de suite, sans rien publier, comme LiveKitTransport.setSource ;
// - fail : il échoue, comme la publication que LiveKit abandonne dans une room fermée (PublishTrackError, au bout de 15 s).
export type HeldDeviceOutcome = 'finish' | 'fail';

// Un faux LiveKit : il retient ce qu'on lui demande, et les tests y font entrer des gens, les font parler, refusent un périphérique,
// retiennent une connexion ou un périphérique, coupent la connexion…
class FakeLiveKit implements MediaTransport {
  readonly journal: string[] = [];
  readonly deviceLog: string[] = [];
  readonly attachments: FakeAttachment[] = [];
  devices: MediaDevices = {};
  // L'erreur que le navigateur rend quand on allume ce périphérique (un refus, ou autre chose).
  readonly failures = new Map<'mic' | 'cam', unknown>();
  screenRefused = false;
  failConnect = false;
  connectHold: Promise<void> | null = null;
  deviceHold: { until: Promise<void>; onLeave: HeldDeviceOutcome } | null = null;
  // Les autres personnes de la room (celle où l'on est, ou celle qu'on va rejoindre), dans leur ordre d'arrivée.
  readonly remotes: Remote[] = [];
  speaking = new Set<string>();
  private room: string | null = null;
  private events: TransportEvents | null = null;
  private published = { mic: false, cam: false, screen: false };
  // La connexion en cours, même pas encore aboutie : son numéro, et son départ (résolu quand elle est quittée, annulée ou perdue).
  private connection = 0;
  private left: Promise<void> = Promise.resolve();
  private markLeft: () => void = () => {};

  constructor(private readonly self: { id: string; name: string }) {}

  async connect(p: MediaJoinPayload, devices: MediaDevices, events: TransportEvents): Promise<void> {
    this.journal.push(`join:${p.room}`);
    const connection = this.open();
    if (this.connectHold) await Promise.race([this.connectHold, this.left]);
    // Quittée pendant qu'elle se faisait : comme LiveKit, disconnect() l'annule, et elle échoue.
    if (this.connection !== connection) throw new Error('Client initiated disconnect');
    if (this.failConnect) {
      this.close();
      throw new Error('connexion à LiveKit impossible');
    }
    this.room = p.room;
    this.devices = { ...devices };
    this.events = events;
  }

  async disconnect(): Promise<void> {
    this.journal.push('leave');
    this.close();
  }

  async setSource(source: LocalSource, on: boolean): Promise<void> {
    this.deviceLog.push(`${source}:${on ? 'on' : 'off'}`);
    const connection = this.connection;
    const hold = this.deviceHold;
    if (hold) {
      await Promise.race([hold.until, this.left]);
      if (this.connection !== connection) {
        if (hold.onLeave === 'fail') {
          throw Object.assign(new Error('publishing rejected as engine not connected within timeout'), { name: 'PublishTrackError' });
        }
        return;
      }
    }
    if (on) {
      const failure = source === 'screen' ? (this.screenRefused ? new DOMException('Permission denied', 'NotAllowedError') : undefined) : this.failures.get(source);
      if (failure !== undefined) throw failure;
    }
    this.published[source] = on;
  }

  async useDevices(devices: MediaDevices): Promise<void> {
    this.deviceLog.push(`devices:${JSON.stringify(devices)}`);
    this.devices = { ...devices };
  }

  participants(): MediaParticipant[] {
    if (this.room === null) return [];
    const local: MediaParticipant = { ...this.self, isLocal: true, ...this.published, speaking: this.speaking.has(this.self.id) };
    return [local, ...this.remotes.map((r) => ({ ...r, isLocal: false, speaking: this.speaking.has(r.id) }))];
  }

  attach(el: HTMLVideoElement, participantId: string, source: VideoSource): () => void {
    const attachment = { el, participantId, source };
    this.attachments.push(attachment);
    return () => {
      const index = this.attachments.indexOf(attachment);
      if (index >= 0) this.attachments.splice(index, 1);
    };
  }

  changed(): void {
    this.events?.changed();
  }

  endScreenShare(): void {
    if (!this.published.screen) return;
    this.published.screen = false;
    this.events?.screenShareEnded();
  }

  drop(reason: 'removed' | 'lost'): void {
    const events = this.events;
    this.close();
    events?.disconnected(reason);
  }

  private open(): number {
    this.connection += 1;
    this.left = new Promise<void>((resolve) => (this.markLeft = resolve));
    return this.connection;
  }

  // Hors de la room : rien de publié, personne d'autre, plus d'événement, et ce qui attendait dans cette room s'arrête.
  private close(): void {
    this.connection += 1;
    this.markLeft();
    this.room = null;
    this.events = null;
    this.published = { mic: false, cam: false, screen: false };
    this.remotes.splice(0);
    this.speaking.clear();
  }
}

// Le faux client média, pour les tests : la vraie logique (MediaSession), sur un faux LiveKit. Sans réseau ni périphérique.
// - journal : ce qui arrive à la connexion, `join:<room>` à chaque connexion tentée, `leave` à chaque départ ;
// - deviceLog : ce qui est demandé aux périphériques, `mic:on`, `cam:off`, `screen:on`, `devices:{…}` ;
// - les commandes des tests jouent LiveKit et le navigateur : refuser un périphérique (ou le faire échouer autrement), faire
//   attendre un périphérique, faire échouer ou attendre la connexion, faire entrer, changer, parler ou partir des gens, arrêter le
//   partage d'écran depuis le navigateur, perdre la connexion ou en être retiré.
// Comme LiveKit, une connexion quittée pendant qu'elle se fait est annulée (et échoue). Comme LiveKitTransport, un appel aux
// périphériques qui attend encore quand la room part finit tout de suite.
// L'identité de la personne (soi-même, dans participants) est `moi`, « Moi », sauf autre choix.
export class FakeMediaClient extends MediaSession {
  readonly journal: readonly string[];
  readonly deviceLog: readonly string[];
  private readonly livekit: FakeLiveKit;

  constructor(prefs: MediaPrefs = DEFAULT_PREFS, self: { id: string; name: string } = { id: 'moi', name: 'Moi' }) {
    const livekit = new FakeLiveKit(self);
    super(livekit, prefs);
    this.livekit = livekit;
    this.journal = livekit.journal;
    this.deviceLog = livekit.deviceLog;
  }

  // Les périphériques de la connexion en cours (ceux du join, puis de setPrefs).
  get devices(): MediaDevices {
    return this.livekit.devices;
  }

  get attachments(): readonly FakeAttachment[] {
    return this.livekit.attachments;
  }

  // Le navigateur refuse ces périphériques (NotAllowedError), jusqu'à allowDevices().
  denyDevices(...sources: Array<'mic' | 'cam'>): void {
    this.failDevices(new DOMException('Permission denied', 'NotAllowedError'), ...sources);
  }

  // Allumer ces périphériques lève cette erreur (un refus du navigateur, ou un autre échec), jusqu'à allowDevices().
  failDevices(error: unknown, ...sources: Array<'mic' | 'cam'>): void {
    for (const source of sources) this.livekit.failures.set(source, error);
  }

  allowDevices(): void {
    this.livekit.failures.clear();
  }

  // Les appels aux périphériques attendent (l'accès demandé à la personne, la caméra qui chauffe) jusqu'à l'appel de la fonction
  // rendue. Si la room part avant, ils finissent tout de suite, ou échouent (HeldDeviceOutcome).
  holdDevices(onLeave: HeldDeviceOutcome = 'finish'): () => void {
    let release!: () => void;
    const hold = { until: new Promise<void>((resolve) => (release = resolve)), onLeave };
    this.livekit.deviceHold = hold;
    return () => {
      if (this.livekit.deviceHold === hold) this.livekit.deviceHold = null;
      release();
    };
  }

  // Le choix de l'écran à partager est refusé ou fermé.
  refuseScreenShare(refuse = true): void {
    this.livekit.screenRefused = refuse;
  }

  // Les connexions échouent (jusqu'à failConnections(false)).
  failConnections(fail = true): void {
    this.livekit.failConnect = fail;
  }

  // Les connexions attendent ; la fonction rendue les laisse aboutir.
  holdConnections(): () => void {
    let release!: () => void;
    this.livekit.connectHold = new Promise<void>((resolve) => (release = resolve));
    return () => {
      this.livekit.connectHold = null;
      release();
    };
  }

  // Quelqu'un est dans la room (ou y sera quand on la rejoindra).
  addRemote(p: { id: string; name?: string; mic?: boolean; cam?: boolean; screen?: boolean }): void {
    this.livekit.remotes.push({ id: p.id, name: p.name ?? p.id, mic: p.mic ?? false, cam: p.cam ?? false, screen: p.screen ?? false });
    this.livekit.changed();
  }

  updateRemote(id: string, patch: Partial<Omit<Remote, 'id'>>): void {
    const remote = this.livekit.remotes.find((r) => r.id === id);
    if (remote) Object.assign(remote, patch);
    this.livekit.changed();
  }

  removeRemote(id: string): void {
    const index = this.livekit.remotes.findIndex((r) => r.id === id);
    if (index >= 0) this.livekit.remotes.splice(index, 1);
    this.livekit.changed();
  }

  // Ceux qui parlent maintenant (soi-même compris), comme ActiveSpeakersChanged.
  setSpeaking(...ids: string[]): void {
    this.livekit.speaking = new Set(ids);
    this.livekit.changed();
  }

  // « Arrêter le partage », dans le navigateur.
  endScreenShare(): void {
    this.livekit.endScreenShare();
  }

  // La room se termine sans qu'on la quitte : la connexion perdue (LiveKit renonce à la reprendre), ou retirés exprès (le serveur,
  // à un changement de groupe ; un autre onglet).
  dropConnection(reason: 'removed' | 'lost' = 'lost'): void {
    this.livekit.drop(reason);
  }
}
