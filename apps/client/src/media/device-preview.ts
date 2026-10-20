// L'aperçu de l'écran d'entrée (DeviceCheck) : le micro et la caméra que la personne veut, demandés au navigateur pour qu'elle se voie
// et voie le niveau de son micro avant d'entrer. Ses pistes sont arrêtées à l'entrée (close) : LiveKit demandera les siennes dans la
// première conversation.

// Où en est un périphérique : coupé (pas voulu), demandé (la question du navigateur est peut-être ouverte), allumé, ou en échec
// (refusé, absent, pris par une autre appli, débranché).
export type DeviceAccess = 'off' | 'pending' | 'on' | 'failed';

// Ce que la personne veut : micro et caméra allumés, avec ces périphériques (absents : ceux du système).
export interface PreviewWish {
  mic: boolean;
  cam: boolean;
  audioInput?: string;
  videoInput?: string;
}

// L'aperçu : la piste du micro et celle de la caméra quand ils sont allumés, et où en est chacun.
export interface PreviewState {
  audio: MediaStreamTrack | null;
  video: MediaStreamTrack | null;
  mic: DeviceAccess;
  cam: DeviceAccess;
}

// Ce qu'il faut du navigateur : navigator.mediaDevices et navigator.permissions (ou rien, sur une page non sécurisée).
interface MediaInput {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}
interface PermissionQuery {
  query(descriptor: { name: string }): Promise<{ state: string }>;
}

type Kind = 'audio' | 'video';
type Answer = { tracks: Map<Kind, MediaStreamTrack> } | { error: unknown };

const KINDS = ['audio', 'video'] as const;
const PERMISSION_NAMES: Record<Kind, string> = { audio: 'microphone', video: 'camera' };
// Les refus du navigateur (ou de la personne) : redemander serait lui reposer la question.
const REFUSALS = new Set(['NotAllowedError', 'SecurityError', 'PermissionDeniedError']);

function isRefusal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && REFUSALS.has(String((error as { name?: unknown }).name));
}

// Le périphérique choisi, de préférence : débranché, celui du système le remplace (comme pour LiveKit, qui reçoit le même choix).
function constraint(device: string | undefined): true | MediaTrackConstraints {
  return device ? { deviceId: { ideal: device } } : true;
}

// L'aperçu tient les pistes voulues à jour, une demande après l'autre (want), et les arrête toutes à la fin (close) :
// - une seule demande pour le micro et la caméra ensemble : une seule question du navigateur ;
// - si elle échoue, chacun est redemandé seul, pour garder celui qui marche (pas de caméra sur l'ordinateur, caméra prise par une autre
//   appli). Après un refus, seulement ce que le navigateur dit déjà permis : sinon, ce serait lui reposer la question ;
// - un changement ne touche que ce qui change : couper la caméra n'arrête que sa piste, changer de micro ne redemande que le micro ;
// - un périphérique en échec n'est pas redemandé tant que le choix de la personne ne change pas (le couper puis le rallumer, ou en
//   choisir un autre).
export class DevicePreview {
  private readonly live = new Map<Kind, { track: MediaStreamTrack; device: string | undefined; unlisten: () => void }>();
  // Les périphériques en échec, avec le choix (le périphérique) qui a échoué.
  private readonly failed = new Map<Kind, string | undefined>();
  private readonly pending = new Set<Kind>();
  private wish: PreviewWish = { mic: false, cam: false };
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly media: MediaInput | undefined,
    private readonly permissions: PermissionQuery | undefined,
    private readonly onChange: (state: PreviewState) => void,
  ) {}

  want(wish: PreviewWish): void {
    this.queue = this.queue
      .then(() => this.sync(wish))
      .catch((err: unknown) => {
        // Une erreur inattendue (onChange qui lève) ne doit pas bloquer les demandes suivantes : elle est relancée à part, et se voit
        // comme toute erreur non rattrapée.
        setTimeout(() => {
          throw err;
        });
      });
  }

  // Résolue quand les demandes faites jusqu'ici sont finies (pour les tests).
  idle(): Promise<void> {
    return this.queue;
  }

  // Arrête toutes les pistes. Une réponse du navigateur qui arriverait après est arrêtée aussitôt, et plus rien n'est annoncé.
  close(): void {
    this.closed = true;
    for (const kind of KINDS) this.drop(kind);
  }

  private async sync(wish: PreviewWish): Promise<void> {
    if (this.closed) return;
    this.wish = wish;
    const needed: Kind[] = [];
    for (const kind of KINDS) {
      const on = kind === 'audio' ? wish.mic : wish.cam;
      const device = deviceOf(wish, kind);
      if (!on) {
        this.drop(kind);
        this.failed.delete(kind);
        continue;
      }
      const live = this.live.get(kind);
      if (live && live.device === device) continue;
      this.drop(kind);
      if (this.failed.has(kind) && this.failed.get(kind) === device) continue;
      this.failed.delete(kind);
      needed.push(kind);
    }

    if (needed.length > 0) {
      for (const kind of needed) this.pending.add(kind);
      this.publish();
      const answers = await this.acquire(needed, wish);
      for (const kind of needed) {
        this.pending.delete(kind);
        const track = answers.get(kind);
        if (!track) this.failed.set(kind, deviceOf(wish, kind));
        else if (this.closed) track.stop();
        else this.keep(kind, track, deviceOf(wish, kind));
      }
    }
    this.publish();
  }

  // Les pistes obtenues, par périphérique (absent : en échec).
  private async acquire(kinds: Kind[], wish: PreviewWish): Promise<Map<Kind, MediaStreamTrack>> {
    const got = new Map<Kind, MediaStreamTrack>();
    if (!this.media) return got;
    const together = await this.request(kinds, wish);
    if ('tracks' in together) return together.tracks;
    if (kinds.length === 1) return got;
    for (const kind of kinds) {
      if (isRefusal(together.error) && !(await this.isGranted(kind))) continue;
      const alone = await this.request([kind], wish);
      const track = 'tracks' in alone ? alone.tracks.get(kind) : undefined;
      if (track) got.set(kind, track);
    }
    return got;
  }

  private async request(kinds: Kind[], wish: PreviewWish): Promise<Answer> {
    try {
      const stream = await this.media!.getUserMedia({
        audio: kinds.includes('audio') && constraint(wish.audioInput),
        video: kinds.includes('video') && constraint(wish.videoInput),
      });
      const tracks = new Map<Kind, MediaStreamTrack>();
      const audio = stream.getAudioTracks()[0];
      const video = stream.getVideoTracks()[0];
      if (audio) tracks.set('audio', audio);
      if (video) tracks.set('video', video);
      return { tracks };
    } catch (error) {
      return { error };
    }
  }

  private async isGranted(kind: Kind): Promise<boolean> {
    try {
      return (await this.permissions?.query({ name: PERMISSION_NAMES[kind] }))?.state === 'granted';
    } catch {
      // Permissions indisponible, ou qui ne connaît pas ce nom (Firefox ancien) : on ne sait pas.
      return false;
    }
  }

  // Garde la piste ; si elle se termine sans nous (débranchée), le périphérique est en échec.
  private keep(kind: Kind, track: MediaStreamTrack, device: string | undefined): void {
    const onEnded = () => {
      if (this.live.get(kind)?.track !== track) return;
      this.drop(kind);
      this.failed.set(kind, device);
      this.publish();
    };
    track.addEventListener('ended', onEnded);
    this.live.set(kind, { track, device, unlisten: () => track.removeEventListener('ended', onEnded) });
  }

  private drop(kind: Kind): void {
    const live = this.live.get(kind);
    if (!live) return;
    live.unlisten();
    live.track.stop();
    this.live.delete(kind);
  }

  private publish(): void {
    if (this.closed) return;
    const access = (kind: Kind): DeviceAccess => {
      if (!(kind === 'audio' ? this.wish.mic : this.wish.cam)) return 'off';
      if (this.pending.has(kind)) return 'pending';
      return this.live.has(kind) ? 'on' : 'failed';
    };
    this.onChange({
      audio: this.live.get('audio')?.track ?? null,
      video: this.live.get('video')?.track ?? null,
      mic: access('audio'),
      cam: access('video'),
    });
  }
}

function deviceOf(wish: PreviewWish, kind: Kind): string | undefined {
  return kind === 'audio' ? wish.audioInput : wish.videoInput;
}
