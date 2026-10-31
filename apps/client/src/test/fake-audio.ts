import type { AudioRuntime } from '../audio/engine';

// Un faux contexte audio : il note ce que le moteur de son (audio/engine.ts) lui demande, pour que les tests le lisent. happy-dom n'a pas de
// Web Audio.

export class FakeParam {
  value: number;
  readonly events: Array<{ type: string; value?: number; time?: number; duration?: number; curve?: Float32Array }> = [];

  constructor(value = 1) {
    this.value = value;
  }

  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.events.push({ type: 'set', value, time });
    return this;
  }

  setTargetAtTime(value: number, time: number): this {
    // Le vrai paramètre s'en approche ; ici il y est tout de suite.
    this.value = value;
    this.events.push({ type: 'target', value, time });
    return this;
  }

  setValueCurveAtTime(curve: Float32Array, time: number, duration: number): this {
    this.events.push({ type: 'curve', time, duration, curve });
    // À la fin du fondu, le paramètre est au dernier point de la courbe.
    this.value = curve[curve.length - 1]!;
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.events.push({ type: 'cancel', time });
    return this;
  }
}

export class FakeNode {
  readonly connections = new Set<FakeNode>();
  disconnected = false;

  connect(node: FakeNode): FakeNode {
    this.connections.add(node);
    return node;
  }

  disconnect(): void {
    this.connections.clear();
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

// Une place dans la stéréo (StereoPannerNode), et un filtre (BiquadFilterNode) : ceux de la nature (audio/nature-player.ts).
export class FakePanner extends FakeNode {
  readonly pan = new FakeParam(0);
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new FakeParam(1);
  startedAt: number | null = null;
  // D'où il part dans le son, et combien il en joue (start(when, offset, duration)) ; null : du début, jusqu'au bout.
  startOffset: number | null = null;
  startDuration: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;

  start(when: number, offset?: number, duration?: number): void {
    this.startedAt = when;
    this.startOffset = offset ?? null;
    this.startDuration = duration ?? null;
  }

  stop(when = 0): void {
    this.stoppedAt = when;
  }

  // Le son est fini : le navigateur le dit.
  end(): void {
    this.onended?.();
  }
}

export class FakeBuffer {
  constructor(readonly url: string) {}
}

export class FakeContext {
  currentTime = 0;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  readonly panners: FakePanner[] = [];
  readonly filters: FakeFilter[] = [];
  readonly listeners: Array<() => void> = [];
  resumeCalls = 0;
  closed = false;
  sinkIds: string[] = [];
  // Les octets reçus par decodeAudioData, dans l'ordre : ceux que le faux réseau a rendus.
  decoded: string[] = [];
  // Les adresses dont le décodage échoue (un format que le navigateur ne lit pas).
  undecodable = new Set<string>();

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  createStereoPanner(): FakePanner {
    const panner = new FakePanner();
    this.panners.push(panner);
    return panner;
  }

  createBiquadFilter(): FakeFilter {
    const filter = new FakeFilter();
    this.filters.push(filter);
    return filter;
  }

  async decodeAudioData(bytes: ArrayBuffer): Promise<FakeBuffer> {
    // Les octets du faux réseau sont le texte de l'adresse.
    const url = new TextDecoder().decode(bytes);
    this.decoded.push(url);
    if (this.undecodable.has(url)) throw new DOMException('Unable to decode audio data', 'EncodingError');
    return new FakeBuffer(url);
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    return Promise.resolve();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.state = 'closed';
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') this.listeners.push(listener);
  }

  setSinkId(deviceId: string): Promise<void> {
    this.sinkIds.push(deviceId);
    return Promise.resolve();
  }

  // Le navigateur laisse le son démarrer.
  run(): void {
    this.state = 'running';
    for (const listener of this.listeners) listener();
  }

  // Le navigateur endort le contexte (un onglet longtemps en arrière-plan).
  suspend(): void {
    this.state = 'suspended';
    for (const listener of this.listeners) listener();
  }
}

// Le faux navigateur : un contexte, un réseau qui répond le texte de l'adresse (ou échoue pour celles qu'on dit manquantes), et une
// horloge qu'on avance à la main.
export interface FakeAudio {
  runtime: AudioRuntime;
  context: FakeContext;
  fetched: string[];
  missing: Set<string>;
  // Les formats que le navigateur dit savoir lire (canPlayType) : tous par défaut.
  playable: Set<string>;
  advance(ms: number): void;
}

export function createFakeAudio(options: { supported?: boolean } = {}): FakeAudio {
  const context = new FakeContext();
  let now = 1000;
  const fetched: string[] = [];
  const missing = new Set<string>();
  const playable = new Set<string>(['audio/ogg; codecs="vorbis"', 'audio/mp4; codecs="mp4a.40.2"']);
  const runtime: AudioRuntime = {
    supported: options.supported ?? true,
    createContext: () => context as unknown as AudioContext,
    fetchBytes: async (url) => {
      fetched.push(url);
      if (missing.has(url)) throw new Error(`404 ${url}`);
      return new TextEncoder().encode(url).buffer as ArrayBuffer;
    },
    canPlay: (mime) => playable.has(mime),
    nowMs: () => now,
  };
  return { runtime, context, fetched, missing, playable, advance: (ms) => void (now += ms) };
}
