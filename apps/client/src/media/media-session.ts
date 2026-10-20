import type { MediaJoinPayload } from '@bureau/shared';
import type {
  LocalSource,
  MediaClient,
  MediaDevices,
  MediaParticipant,
  MediaPrefs,
  MediaSnapshot,
  MediaTransport,
  TransportEvents,
  VideoSource,
} from './media-client';

type DeviceSource = 'mic' | 'cam';

// Le client média, au-dessus d'un transport : LiveKit (livekit-media-client.ts), ou son faux (fake-media-client.ts), qui fait passer
// cette même logique par les tests. Le transport fait ce qu'on lui dit ; ici, on décide :
// - les opérations (join, leave, micro, caméra, partage, préférences) passent l'une après l'autre, dans l'ordre des appels : un
//   changement de room ne se croise jamais avec le précédent, ni avec un micro qu'on allume ;
// - la room : déjà dedans, un join ne fait rien ; dans une autre, on la quitte d'abord ; une connexion qui échoue laisse
//   connection_failed et aucune room, jusqu'au join suivant ;
// - micro et caméra : l'état voulu change tout de suite (l'interface le montre) ; dans une room, le transport suit, en lisant l'état
//   voulu au moment de s'y mettre (couper le micro pendant la connexion : il ne s'allume pas). Un micro ou une caméra qui ne s'allume
//   pas passe à « éteint » avec permission_denied, et on reste dans la room ;
// - rien n'est demandé aux périphériques hors room.
export class MediaSession implements MediaClient {
  private snapshot: MediaSnapshot;
  private readonly listeners = new Set<(s: MediaSnapshot) => void>();
  private chosenDevices: MediaDevices;
  // Connecté à snapshot.room : la connexion est faite, et n'a été ni quittée ni perdue.
  private connected = false;
  // La file des opérations : la promesse de la dernière, et combien ne sont pas finies.
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  private readonly events: TransportEvents = {
    changed: () => this.refreshParticipants(),
    disconnected: (reason) => this.connectionEnded(reason),
    screenShareEnded: () => {
      this.setLocal('screen', false);
      this.refreshParticipants();
    },
  };

  constructor(
    private readonly transport: MediaTransport,
    prefs: MediaPrefs,
  ) {
    this.chosenDevices = devicesOf(prefs);
    this.snapshot = { room: null, participants: [], local: { mic: prefs.mic, cam: prefs.cam, screen: false }, error: null };
  }

  getSnapshot(): MediaSnapshot {
    return this.snapshot;
  }

  subscribe(cb: (s: MediaSnapshot) => void): () => void {
    this.listeners.add(cb);
    cb(this.snapshot);
    return () => {
      this.listeners.delete(cb);
    };
  }

  join(p: MediaJoinPayload): Promise<void> {
    return this.enqueue(() => this.doJoin(p));
  }

  leave(): Promise<void> {
    return this.enqueue(() => this.doLeave());
  }

  setMic(on: boolean): Promise<void> {
    this.setLocal('mic', on);
    return this.enqueue(() => this.applyDevice('mic'));
  }

  setCam(on: boolean): Promise<void> {
    this.setLocal('cam', on);
    return this.enqueue(() => this.applyDevice('cam'));
  }

  setScreenShare(on: boolean): Promise<void> {
    return this.enqueue(() => this.doScreenShare(on));
  }

  setPrefs(p: MediaPrefs): Promise<void> {
    this.chosenDevices = devicesOf(p);
    this.update({ local: { ...this.snapshot.local, mic: p.mic, cam: p.cam } });
    return this.enqueue(async () => {
      if (!this.connected) return;
      try {
        await this.transport.useDevices(this.chosenDevices);
      } catch {
        // un périphérique qui ne répond pas : celui d'avant reste
      }
      await this.applyDevice('mic');
      await this.applyDevice('cam');
    });
  }

  attach(el: HTMLVideoElement, participantId: string, source: VideoSource): () => void {
    return this.transport.attach(el, participantId, source);
  }

  // Résolue quand les opérations demandées jusqu'ici sont finies, et celles demandées entre-temps (pour les tests, qui n'ont pas la
  // promesse d'une opération lancée par une consigne du serveur).
  idle(): Promise<void> {
    return this.tail.then(() => (this.pending === 0 ? undefined : this.idle()));
  }

  private async doJoin(p: MediaJoinPayload): Promise<void> {
    // Déjà là : une socket revenue après une coupure reçoit de nouveau la consigne de sa room (avec un jeton neuf). LiveKit garde sa
    // connexion, et la reprend seul après une coupure ; la quitter pour la rouvrir couperait la conversation.
    if (this.connected && this.snapshot.room === p.room) return;
    if (this.connected) await this.doLeave();

    this.update({ room: p.room, participants: [], error: this.snapshot.error === 'connection_failed' ? null : this.snapshot.error });
    try {
      await this.transport.connect(p, this.chosenDevices, this.events);
    } catch {
      this.update({ room: null, participants: [], error: 'connection_failed' });
      return;
    }
    this.connected = true;
    this.refreshParticipants();

    // Le micro et la caméra voulus, l'un après l'autre : un refus de l'un n'empêche pas l'autre.
    let refused = false;
    for (const kind of ['mic', 'cam'] as const) {
      if (this.connected && this.snapshot.local[kind] && !(await this.turnOn(kind))) refused = true;
    }
    if (refused && this.connected) this.update({ error: 'permission_denied' });
    this.refreshParticipants();
  }

  private async doLeave(): Promise<void> {
    if (!this.connected) {
      // Pas de room. Celle dont la connexion avait échoué n'est plus attendue : son erreur s'efface.
      if (this.snapshot.error === 'connection_failed') this.update({ error: null });
      return;
    }
    this.connected = false;
    try {
      await this.transport.disconnect();
    } catch {
      // la room est abandonnée de toute façon
    }
    this.update({ room: null, participants: [], local: { ...this.snapshot.local, screen: false } });
  }

  // Après setMic, setCam ou setPrefs : dans une room, le micro ou la caméra suivent l'état voulu. Rallumer après un refus redemande
  // l'accès ; accepté, l'erreur s'efface.
  private async applyDevice(kind: DeviceSource): Promise<void> {
    if (!this.connected) return;
    if (this.snapshot.local[kind]) {
      const on = await this.turnOn(kind);
      if (!this.connected) return;
      if (!on) this.update({ error: 'permission_denied' });
      else if (this.snapshot.error === 'permission_denied') this.update({ error: null });
    } else {
      try {
        await this.transport.setSource(kind, false);
      } catch {
        // éteindre n'échoue pas en pratique ; sinon, rien à faire de plus
      }
    }
    this.refreshParticipants();
  }

  // Allume le micro ou la caméra. Refusé, absent ou inutilisable : il passe à « éteint » dans l'état voulu, et c'est la personne qui
  // le rallumera (ce qui redemandera l'accès). Le redemander à chaque room ferait revenir la question du navigateur à chaque
  // conversation.
  private async turnOn(kind: DeviceSource): Promise<boolean> {
    try {
      await this.transport.setSource(kind, true);
      return true;
    } catch {
      this.setLocal(kind, false);
      return false;
    }
  }

  private async doScreenShare(on: boolean): Promise<void> {
    if (!this.connected || this.snapshot.local.screen === on) return;
    try {
      await this.transport.setSource('screen', on);
    } catch {
      // Le choix de l'écran fermé, ou refusé : rien ne change, et ce n'est pas un problème de micro ou de caméra.
      return;
    }
    if (!this.connected) return;
    this.setLocal('screen', on);
    this.refreshParticipants();
  }

  // La room terminée sans nous : perdue, c'est connection_failed ; retirés exprès (un changement de groupe dont le media:leave n'est
  // pas encore arrivé), ce n'est pas une erreur.
  private connectionEnded(reason: 'removed' | 'lost'): void {
    if (!this.connected) return;
    this.connected = false;
    const error = reason === 'lost' ? 'connection_failed' : this.snapshot.error;
    this.update({ room: null, participants: [], local: { ...this.snapshot.local, screen: false }, error });
  }

  private refreshParticipants(): void {
    if (!this.connected) return;
    const participants = this.transport.participants();
    if (!sameParticipants(participants, this.snapshot.participants)) this.update({ participants });
  }

  private setLocal(kind: LocalSource, on: boolean): void {
    this.update({ local: { ...this.snapshot.local, [kind]: on } });
  }

  // Un nouvel état, annoncé à chacun, s'il diffère du précédent.
  private update(patch: Partial<MediaSnapshot>): void {
    const next: MediaSnapshot = { ...this.snapshot, ...patch };
    if (sameSnapshot(next, this.snapshot)) return;
    this.snapshot = next;
    for (const cb of [...this.listeners]) {
      try {
        cb(next);
      } catch (err) {
        // Un abonné qui lève (un écouteur du jeu, par media:speaking) ne doit ni priver les suivants de l'état, ni arrêter
        // l'opération en cours, qui laisserait une room à moitié rejointe : son erreur est relancée à part, et se voit comme toute
        // erreur non rattrapée.
        setTimeout(() => {
          throw err;
        });
      }
    }
  }

  // File vide : l'opération commence tout de suite, dans l'appel (le navigateur n'ouvre le choix de l'écran que pendant le clic de la
  // personne). Sinon, après la dernière. Les opérations ne rejettent pas : leurs échecs deviennent l'état (`error`).
  private enqueue(op: () => Promise<void>): Promise<void> {
    const idle = this.pending === 0;
    this.pending += 1;
    const run = idle ? op() : this.tail.then(op);
    const done = run.then(
      () => {
        this.pending -= 1;
      },
      () => {
        this.pending -= 1;
      },
    );
    this.tail = done;
    return done;
  }
}

function devicesOf(p: MediaPrefs): MediaDevices {
  return { audioInput: p.audioInput, videoInput: p.videoInput, audioOutput: p.audioOutput };
}

function sameParticipants(a: readonly MediaParticipant[], b: readonly MediaParticipant[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i]!;
      return (
        p.id === q.id &&
        p.name === q.name &&
        p.isLocal === q.isLocal &&
        p.mic === q.mic &&
        p.cam === q.cam &&
        p.screen === q.screen &&
        p.speaking === q.speaking
      );
    })
  );
}

function sameSnapshot(a: MediaSnapshot, b: MediaSnapshot): boolean {
  return (
    a.room === b.room &&
    a.error === b.error &&
    a.local.mic === b.local.mic &&
    a.local.cam === b.local.cam &&
    a.local.screen === b.local.screen &&
    (a.participants === b.participants || sameParticipants(a.participants, b.participants))
  );
}
