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

// Retiré d'une room (removed) : le temps laissé à la consigne du serveur qui l'explique (media:leave, ou un autre media:join). Passé ce
// délai, la room toujours voulue, c'est un retrait en retard (voir roomEnded) : connection_failed, pour que « Reconnecter » apparaisse.
const REMOVED_RECHECK_MS = 2000;

// Ce qu'a donné l'allumage d'un micro ou d'une caméra :
// - on : allumé ;
// - refused : le navigateur l'a refusé, ou le périphérique est absent ou inutilisable (permission_denied) ;
// - failed : un autre échec (LiveKit n'a pas pu le publier) : il ne marche pas, mais ce n'est pas un refus ;
// - stale : la room a changé pendant ce temps (quittée, rendue caduque, terminée) : rien n'est touché.
type TurnOnResult = 'on' | 'refused' | 'failed' | 'stale';

// Les erreurs de getUserMedia qui disent que le périphérique est refusé, absent ou inutilisable : les seules qui donnent
// permission_denied. Les noms en -Error de la fin sont ceux des anciens Chrome.
const DEVICE_REFUSALS = new Set([
  'NotAllowedError',
  'NotFoundError',
  'NotReadableError',
  'OverconstrainedError',
  'AbortError',
  'SecurityError',
  'PermissionDeniedError',
  'DevicesNotFoundError',
  'TrackStartError',
  'ConstraintNotSatisfiedError',
]);

// Le client média, au-dessus d'un transport : LiveKit (livekit-media-client.ts), ou son faux (fake-media-client.ts), qui fait passer
// cette même logique par les tests. Le transport fait ce qu'on lui dit ; ici, on décide :
// - les opérations (join, leave, micro, caméra, partage, préférences) passent l'une après l'autre, dans l'ordre des appels ;
// - la room : déjà dedans, un join ne fait rien. Une consigne qui en veut une autre (join d'une autre room, leave) quitte la room en
//   cours dès l'appel, même si elle se connecte encore ou allume un périphérique : la connexion est annulée, et rien n'est publié
//   dans une room qu'on quitte. Chaque room est une « session » : une opération qui voit la sienne finir pendant qu'elle attend
//   s'arrête là, sans toucher à l'état voulu ni aux erreurs. Une connexion qui échoue laisse connection_failed et aucune room ;
// - micro et caméra : l'état voulu change tout de suite (l'interface le montre) ; dans une room, le transport suit, en lisant l'état
//   voulu au moment de s'y mettre (couper le micro pendant la connexion : il ne s'allume pas). Refusé, absent ou inutilisable, il
//   passe à « éteint » avec permission_denied, et on reste dans la room ;
// - rien n'est demandé aux périphériques hors room.
export class MediaSession implements MediaClient {
  private snapshot: MediaSnapshot;
  private readonly listeners = new Set<(s: MediaSnapshot) => void>();
  private chosenDevices: MediaDevices;
  // La room que veut la dernière consigne (celle du join, ou aucune après un leave), connue dès l'appel.
  private wanted: string | null = null;
  // Le nombre de consignes reçues (join, leave) : roomEnded sait ainsi si une autre est arrivée après un retrait.
  private instructions = 0;
  // La session de room : change quand une connexion commence et quand la room finit (quittée, rendue caduque, terminée par LiveKit).
  private session = 0;
  // Connecté à snapshot.room : la connexion est faite, et la session n'est pas finie.
  private connected = false;
  // Le départ demandé au transport, tant qu'il n'est pas fini : la connexion suivante l'attend.
  private leaving: Promise<void> | null = null;
  // La file des opérations : la promesse de la dernière, et combien ne sont pas finies.
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  private readonly events: TransportEvents = {
    changed: () => this.refreshParticipants(),
    disconnected: (reason) => this.roomEnded(reason),
    screenShareEnded: () => {
      this.setLocal('screen', false);
      this.refreshParticipants();
    },
    // Le transport ne parle que de la room en cours (connectée, ou qui se connecte).
    audioPlayback: (allowed) => {
      if (this.snapshot.room !== null) this.update({ audioBlocked: !allowed });
    },
  };

  constructor(
    private readonly transport: MediaTransport,
    prefs: MediaPrefs,
  ) {
    this.chosenDevices = devicesOf(prefs);
    this.snapshot = {
      room: null,
      participants: [],
      local: { mic: prefs.mic, cam: prefs.cam, screen: false },
      error: null,
      audioBlocked: false,
    };
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
    this.instructions += 1;
    this.wanted = p.room;
    this.dropUnwantedRoom();
    return this.enqueue(() => this.doJoin(p));
  }

  leave(): Promise<void> {
    this.instructions += 1;
    this.wanted = null;
    this.dropUnwantedRoom();
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
      const session = this.session;
      try {
        await this.transport.useDevices(this.chosenDevices);
      } catch {
        // un périphérique qui ne répond pas : celui d'avant reste
      }
      if (this.session !== session) return;
      await this.applyDevice('mic');
      await this.applyDevice('cam');
    });
  }

  warmUp(): void {
    this.transport.warmUp?.();
  }

  setVolumes(volumes: Readonly<Record<string, number>>): void {
    this.transport.setVolumes?.(volumes);
  }

  attach(el: HTMLVideoElement, participantId: string, source: VideoSource): () => void {
    return this.transport.attach(el, participantId, source);
  }

  // Hors de la file, et tout de suite : le navigateur ne laisse lancer le son que pendant le geste de la personne, qui ne doit pas
  // attendre une opération en cours (un micro dont l'accès est encore demandé).
  startAudio(): Promise<void> {
    return this.transport.startAudio().catch(() => {
      // Refusé (hors d'un geste) : le son reste bloqué, et audioBlocked le dit déjà.
    });
  }

  // Résolue quand les opérations demandées jusqu'ici sont finies, et celles demandées entre-temps (pour les tests, qui n'ont pas la
  // promesse d'une opération lancée par une consigne du serveur).
  idle(): Promise<void> {
    return this.tail.then(() => (this.pending === 0 ? undefined : this.idle()));
  }

  private async doJoin(p: MediaJoinPayload): Promise<void> {
    // Une consigne plus récente l'a rendue caduque avant son tour.
    if (this.wanted !== p.room) return;
    // Déjà là : une socket revenue après une coupure reçoit de nouveau la consigne de sa room (avec un jeton neuf). LiveKit garde sa
    // connexion, et la reprend seul après une coupure ; la quitter pour la rouvrir couperait la conversation.
    if (this.connected && this.snapshot.room === p.room) return;
    // La room d'avant a été quittée dès la consigne (dropUnwantedRoom) : on attend la fin de ce départ, pour garder l'ordre. Sans départ
    // en cours, la connexion commence tout de suite, dans l'appel.
    if (this.leaving) {
      await this.leaving;
      if (this.wanted !== p.room) return;
    }

    const session = ++this.session;
    this.update({ room: p.room, participants: [], error: this.snapshot.error === 'connection_failed' ? null : this.snapshot.error });
    // Un abonné, prévenu juste au-dessus, a pu quitter cette room ou en demander une autre dans l'appel même : son départ a déjà eu
    // lieu (dropUnwantedRoom, quand rien n'était encore connecté), et une connexion lancée maintenant ne serait plus jamais quittée.
    if (this.session !== session) return;
    try {
      await this.transport.connect(p, this.chosenDevices, this.events);
    } catch {
      // Annulée par une consigne plus récente, ou déjà terminée par LiveKit (roomEnded) : rien de plus à faire.
      if (this.session !== session) return;
      this.endSession({ error: 'connection_failed' }, false);
      return;
    }
    // Rendue caduque pendant la connexion : dropUnwantedRoom l'a déjà quittée.
    if (this.session !== session) return;
    this.connected = true;
    this.refreshParticipants();

    // Le micro et la caméra voulus, l'un après l'autre : un refus de l'un n'empêche pas l'autre. Si la room finit entre-temps, on
    // s'arrête : rien n'est publié dans une room qu'on quitte.
    let refused = false;
    for (const kind of ['mic', 'cam'] as const) {
      if (!this.snapshot.local[kind]) continue;
      const result = await this.turnOn(kind, session);
      if (result === 'stale') return;
      if (result === 'refused') refused = true;
    }
    if (refused) this.update({ error: 'permission_denied' });
    this.refreshParticipants();
  }

  private async doLeave(): Promise<void> {
    // La room a été quittée dès la consigne (dropUnwantedRoom). Une connexion qui avait échoué n'est plus attendue : son erreur
    // s'efface. leave() se résout une fois le départ fini.
    if (this.snapshot.error === 'connection_failed') this.update({ error: null });
    if (this.leaving) await this.leaving;
  }

  // Après setMic, setCam ou setPrefs : dans une room, le micro ou la caméra suivent l'état voulu. Rallumer après un refus redemande
  // l'accès ; accepté, l'erreur s'efface.
  private async applyDevice(kind: DeviceSource): Promise<void> {
    if (!this.connected) return;
    const session = this.session;
    if (this.snapshot.local[kind]) {
      const result = await this.turnOn(kind, session);
      if (result === 'stale') return;
      if (result === 'refused') this.update({ error: 'permission_denied' });
      else if (result === 'on' && this.snapshot.error === 'permission_denied') this.update({ error: null });
    } else {
      try {
        await this.transport.setSource(kind, false);
      } catch {
        // éteindre n'échoue pas en pratique ; sinon, rien à faire de plus
      }
      if (this.session !== session) return;
    }
    this.refreshParticipants();
  }

  // Allume le micro ou la caméra dans la room de cette session. S'il ne s'allume pas (refusé, absent, inutilisable, ou impossible à
  // publier), il passe à « éteint » dans l'état voulu : c'est la personne qui le rallumera, ce qui redemandera l'accès (le redemander
  // à chaque room ferait revenir la question du navigateur à chaque conversation). Mais si la room a changé pendant ce temps, l'échec
  // ou le succès ne disent plus rien : l'état voulu reste tel quel, pour la room suivante.
  private async turnOn(kind: DeviceSource, session: number): Promise<TurnOnResult> {
    try {
      await this.transport.setSource(kind, true);
    } catch (err) {
      if (this.session !== session) return 'stale';
      this.setLocal(kind, false);
      return isDeviceRefusal(err) ? 'refused' : 'failed';
    }
    return this.session === session ? 'on' : 'stale';
  }

  private async doScreenShare(on: boolean): Promise<void> {
    if (!this.connected || this.snapshot.local.screen === on) return;
    const session = this.session;
    try {
      await this.transport.setSource('screen', on);
    } catch {
      // Le choix de l'écran fermé, ou refusé : rien ne change, et ce n'est pas un problème de micro ou de caméra.
      return;
    }
    if (this.session !== session) return;
    this.setLocal('screen', on);
    this.refreshParticipants();
  }

  // Une consigne plus récente rend caduque la room en cours (connectée, ou qui se connecte encore) : on la quitte tout de suite, sans
  // attendre ce qu'elle fait. LiveKit annule la connexion en cours ; un micro ou une caméra qui s'allumaient s'arrêtent là (le
  // transport finit l'appel dès la room quittée), sans rien publier ; et la file n'attend plus rien d'elle.
  private dropUnwantedRoom(): void {
    if (this.snapshot.room === null || this.snapshot.room === this.wanted) return;
    this.endSession({}, true);
  }

  // La room terminée par LiveKit, connectée ou encore en train de se connecter. Perdue, c'est connection_failed. Retirés exprès, ce
  // n'est pas une erreur : un changement de groupe dont le media:leave (ou le media:join d'une autre room) n'est pas encore arrivé, ou
  // un autre onglet (session:replaced, puis leave). Mais si REMOVED_RECHECK_MS plus tard aucune consigne n'est venue et que la room est
  // toujours voulue, c'est un retrait en retard : demandé pour un groupe qu'on a quitté puis retrouvé, LiveKit l'a appliqué à la
  // connexion d'après. Le serveur, pour qui l'on est dans la room, ne dira plus rien : connection_failed, et « Reconnecter ».
  private roomEnded(reason: 'removed' | 'lost'): void {
    const room = this.snapshot.room;
    if (room === null) return;
    this.endSession(reason === 'lost' ? { error: 'connection_failed' } : {}, false);
    if (reason === 'lost') return;
    const instructions = this.instructions;
    setTimeout(() => {
      if (this.instructions === instructions && this.wanted === room && this.snapshot.room === null) this.update({ error: 'connection_failed' });
    }, REMOVED_RECHECK_MS);
  }

  // Finit la session : plus de room, ni de participants, ni de partage d'écran, ni de son bloqué (la room suivante dira le sien).
  // `disconnect` : quitter aussi la room chez le transport (pas quand LiveKit l'a déjà fait).
  private endSession(patch: Partial<MediaSnapshot>, disconnect: boolean): void {
    this.session += 1;
    this.connected = false;
    if (disconnect) {
      const leaving: Promise<void> = this.transport
        .disconnect()
        .catch(() => {
          // la room est abandonnée de toute façon
        })
        .then(() => {
          if (this.leaving === leaving) this.leaving = null;
        });
      this.leaving = leaving;
    }
    this.update({ room: null, participants: [], local: { ...this.snapshot.local, screen: false }, audioBlocked: false, ...patch });
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

function isDeviceRefusal(err: unknown): boolean {
  return typeof err === 'object' && err !== null && DEVICE_REFUSALS.has(String((err as { name?: unknown }).name));
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
    a.audioBlocked === b.audioBlocked &&
    a.local.mic === b.local.mic &&
    a.local.cam === b.local.cam &&
    a.local.screen === b.local.screen &&
    (a.participants === b.participants || sameParticipants(a.participants, b.participants))
  );
}
