// Un faux navigator.mediaDevices et un faux navigator.permissions, pour l'écran d'entrée (DeviceCheck, DevicePreview) : happy-dom n'a
// ni micro, ni caméra, ni getUserMedia.

type Kind = 'audio' | 'video';

// Une piste de micro ou de caméra : stop() l'arrête (de notre fait), end() la termine sans nous (périphérique débranché).
export class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  stopped = false;
  enabled = true;
  readonly id = `piste-${Math.random().toString(36).slice(2)}`;

  constructor(
    readonly kind: Kind,
    readonly deviceId: string,
    readonly label: string,
  ) {
    super();
  }

  stop(): void {
    this.stopped = true;
    this.readyState = 'ended';
  }

  end(): void {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }

  getSettings(): { deviceId: string } {
    return { deviceId: this.deviceId };
  }
}

interface FakeDevice {
  kind: MediaDeviceKind;
  deviceId: string;
  label: string;
}

// Le deviceId demandé (`{ deviceId: { ideal } }`), s'il y en a un.
function requestedDevice(constraint: boolean | MediaTrackConstraints | undefined): string | undefined {
  if (typeof constraint !== 'object') return undefined;
  const id = constraint.deviceId;
  if (typeof id === 'string') return id;
  if (id && typeof id === 'object' && !Array.isArray(id)) {
    const value = (id as ConstrainDOMStringParameters).ideal ?? (id as ConstrainDOMStringParameters).exact;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

// Comme un navigateur : une demande qui comprend un périphérique refusé (refuse) échoue en entier par NotAllowedError, une qui comprend
// un périphérique absent (missing) par NotFoundError. Les libellés des périphériques ne sont donnés qu'une fois un accès accordé.
export class FakeMediaDevices extends EventTarget {
  readonly calls: MediaStreamConstraints[] = [];
  readonly tracks: FakeTrack[] = [];
  readonly refuse = new Set<Kind>();
  readonly missing = new Set<Kind>();
  granted = false;
  readonly list: FakeDevice[] = [
    { kind: 'audioinput', deviceId: 'default', label: 'Micro intégré' },
    { kind: 'audioinput', deviceId: 'micro-usb', label: 'Micro USB' },
    { kind: 'videoinput', deviceId: 'webcam', label: 'Webcam' },
    { kind: 'audiooutput', deviceId: 'default', label: 'Haut-parleurs intégrés' },
    { kind: 'audiooutput', deviceId: 'casque', label: 'Casque' },
  ];
  private hold: Promise<void> | null = null;

  // Les réponses attendent (la question du navigateur est ouverte) jusqu'à l'appel de la fonction rendue.
  holdAnswers(): () => void {
    let release!: () => void;
    this.hold = new Promise<void>((resolve) => (release = resolve));
    return () => {
      this.hold = null;
      release();
    };
  }

  async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    this.calls.push(constraints);
    const kinds = (['audio', 'video'] as const).filter((kind) => constraints[kind]);
    if (this.hold) await this.hold;
    if (kinds.some((kind) => this.refuse.has(kind))) throw new DOMException('Permission denied', 'NotAllowedError');
    if (kinds.some((kind) => this.missing.has(kind))) throw new DOMException('Requested device not found', 'NotFoundError');
    const tracks = kinds.map((kind) => {
      const deviceKind: MediaDeviceKind = kind === 'audio' ? 'audioinput' : 'videoinput';
      const wanted = requestedDevice(constraints[kind]);
      const device = this.list.find((d) => d.kind === deviceKind && d.deviceId === wanted) ?? this.list.find((d) => d.kind === deviceKind)!;
      return new FakeTrack(kind, device.deviceId, device.label);
    });
    this.tracks.push(...tracks);
    this.granted = true;
    return new MediaStream(tracks as unknown as MediaStreamTrack[]);
  }

  async enumerateDevices(): Promise<MediaDeviceInfo[]> {
    return this.list.map((d) => ({ ...d, label: this.granted ? d.label : '', groupId: '', toJSON: () => ({}) }) as MediaDeviceInfo);
  }

  // Un périphérique branché ou débranché.
  change(): void {
    this.dispatchEvent(new Event('devicechange'));
  }
}

export class FakePermissions {
  readonly states = new Map<string, PermissionState>();
  failQueries = false;

  async query({ name }: { name: string }): Promise<{ state: PermissionState }> {
    if (this.failQueries) throw new TypeError(`'${name}' is not a valid enum value of type PermissionName.`);
    return { state: this.states.get(name) ?? 'prompt' };
  }
}

// Pose ces faux sur navigator, le temps d'un test ; la fonction rendue les retire.
export function installMediaDevices(devices: FakeMediaDevices | undefined, permissions = new FakePermissions()): () => void {
  const previous = {
    mediaDevices: Object.getOwnPropertyDescriptor(navigator, 'mediaDevices'),
    permissions: Object.getOwnPropertyDescriptor(navigator, 'permissions'),
  };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: permissions });
  return () => {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(navigator, name, descriptor);
      else delete (navigator as unknown as Record<string, unknown>)[name];
    }
  };
}
