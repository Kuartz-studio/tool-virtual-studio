import { musicUrls, SCENES, SFX, SFX_IDS, sfxUrl, type SceneId, type SfxId } from './catalog';

// Le moteur de son : la musique d'ambiance (une boucle à la fois, avec un fondu enchaîné d'une ambiance à l'autre) et les effets (des
// bruits courts), sur deux circuits séparés que la personne règle chacun de son côté (volume, coupure). La voix des autres, elle, passe par
// LiveKit (media/) : rien ici ne la touche. Le moteur ne sait rien du bureau : on lui dit quelle ambiance jouer (setMusic) et quel effet
// lancer (playSfx).
//
//   ambiance → fondu → baisse quand on parle ┐
//                                            ├→ volume de la musique ┐
//   effet → son propre gain ─────────────────┐                       ├→ sortie
//                                            └→ volume des effets ───┘
//
// Les navigateurs ne laissent démarrer le son qu'après un geste de la personne : le contexte audio n'est créé qu'à unlock(), que
// l'appli appelle à chaque clic ou touche (AudioDirector). Avant, setMusic retient l'ambiance voulue, et playSfx ne fait rien.

// L'état du moteur : `locked` (le navigateur n'a pas encore laissé le son démarrer), `running`, ou `unsupported` (pas de Web Audio).
export type EngineStatus = 'locked' | 'running' | 'unsupported';

export interface EngineSnapshot {
  status: EngineStatus;
  // L'ambiance qu'on entend (ou qui monte) ; null quand la musique est coupée.
  playing: SceneId | null;
}

// Ce que le moteur demande au navigateur : de quoi le remplacer dans les tests.
export interface AudioRuntime {
  // Web Audio existe-t-il ?
  supported: boolean;
  createContext(): AudioContext;
  fetchBytes(url: string): Promise<ArrayBuffer>;
  // Le navigateur sait-il lire ce format (HTMLMediaElement.canPlayType) ?
  canPlay(mime: string): boolean;
  nowMs(): number;
}

export interface SfxOptions {
  // La vitesse de lecture : 1 par défaut, moins pour un son plus grave (et plus long).
  rate?: number;
  // Un facteur de plus sur le volume de l'effet.
  level?: number;
  // Le départ du son, après ce délai.
  delayMs?: number;
}

// Le fondu enchaîné d'une ambiance à l'autre, et celui de la coupure de la musique, en secondes.
export const MUSIC_FADE_S = 2.4;
export const MUSIC_STOP_FADE_S = 0.8;
// Pendant qu'on parle, la musique descend à ce niveau (son rapport d'amplitude) : vite à la baisse, doucement à la remontée. Les durées
// sont celles d'une constante de temps : le niveau est atteint aux trois quarts en une fois, et presque entièrement en trois.
export const DUCK_LEVEL = 0.3;
const DUCK_ATTACK_S = 0.12;
const DUCK_RELEASE_S = 0.5;
// Au plus, ce nombre d'effets en même temps ; au-delà, les suivants sont perdus (un orage de messages ne fait pas un mur de son).
const SFX_MAX_VOICES = 8;
// Un effet demandé avant d'être chargé part quand même, s'il arrive dans ce délai (l'arrivée au bureau, juste après l'« Entrer »).
const SFX_LATE_MS = 1500;
// Les ambiances gardées décodées : la courante et la précédente, ce qu'il faut au fondu d'une pièce à l'autre (et au retour dans la pièce qu'on vient de
// quitter). Pas plus : une boucle pirate de trois minutes pèse près de 60 Mo une fois décodée. Celle qui s'éteint reste jouée par sa voix jusqu'au bout.
const MUSIC_CACHE_SIZE = 2;
// Les points d'un fondu : assez pour une courbe lisse.
const CURVE_POINTS = 64;

// Le curseur de volume (de 0 à 1) devient un gain en carré : l'oreille entend en gros les rapports de volume, et un curseur linéaire
// serait presque tout entier dans sa dernière moitié.
export const levelToGain = (level: number): number => level * level;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// Une voix de musique : la boucle qui joue (ou qui s'éteint), et son gain, celui du fondu.
interface MusicVoice {
  scene: SceneId;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

type SinkContext = AudioContext & { setSinkId?: (deviceId: string) => Promise<void> };

export class AudioEngine {
  private context: AudioContext | null = null;
  private musicBus!: GainNode;
  private duck!: GainNode;
  private sfxBus!: GainNode;

  // L'ambiance voulue, celle qui joue, et celle qu'on charge.
  private wanted: SceneId | null = null;
  private voice: MusicVoice | null = null;
  private loading: SceneId | null = null;
  // Les voix qui s'éteignent (fondu en cours).
  private readonly fading = new Set<MusicVoice>();
  private readonly musicBuffers = new Map<SceneId, Promise<AudioBuffer>>();

  private readonly sfxBuffers = new Map<SfxId, AudioBuffer>();
  private readonly sfxLoading = new Map<SfxId, Promise<AudioBuffer | null>>();
  private readonly sfxLastAt = new Map<SfxId, number>();
  private sfxActive = 0;

  private musicLevel = 0.6;
  private sfxLevel = 0.8;
  private sfxOn = true;
  private ducked = false;
  private outputDevice: string | undefined;
  private sinkTouched = false;

  private snapshot: EngineSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly runtime: AudioRuntime) {
    this.snapshot = { status: runtime.supported ? 'locked' : 'unsupported', playing: null };
  }

  // ---- L'état -------------------------------------------------------------------------------------------------------------------

  getSnapshot = (): EngineSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private setSnapshot(patch: Partial<EngineSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    if (next.status === this.snapshot.status && next.playing === this.snapshot.playing) return;
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }

  // ---- Le geste de la personne --------------------------------------------------------------------------------------------------

  // À appeler dans un clic ou une touche : crée le contexte audio la première fois, et le remet en marche chaque fois que le navigateur
  // l'a endormi (un onglet resté longtemps en arrière-plan, sur téléphone). Sans effet quand le son marche déjà.
  unlock(): void {
    if (this.snapshot.status === 'unsupported') return;
    if (this.context === null) {
      const context = this.runtime.createContext();
      this.context = context;
      this.buildGraph(context);
      context.addEventListener('statechange', () => this.onContextState());
      this.applyOutputDevice();
      // Tout de suite : le chargement se fait pendant que le contexte démarre.
      if (this.sfxOn) this.preloadSfx();
      void this.applyMusic();
    }
    if (this.context.state !== 'running') this.context.resume().then(() => this.onContextState(), () => {});
    this.onContextState();
  }

  private onContextState(): void {
    if (this.context === null) return;
    this.setSnapshot({ status: this.context.state === 'running' ? 'running' : 'locked' });
  }

  private buildGraph(context: AudioContext): void {
    this.musicBus = context.createGain();
    this.musicBus.gain.value = levelToGain(this.musicLevel);
    this.duck = context.createGain();
    this.duck.gain.value = this.ducked ? DUCK_LEVEL : 1;
    this.sfxBus = context.createGain();
    this.sfxBus.gain.value = levelToGain(this.sfxLevel);
    this.duck.connect(this.musicBus);
    this.musicBus.connect(context.destination);
    this.sfxBus.connect(context.destination);
  }

  // ---- Les réglages -------------------------------------------------------------------------------------------------------------

  setMusicLevel(level: number): void {
    this.musicLevel = clamp01(level);
    this.glide(this.musicBus?.gain, levelToGain(this.musicLevel), 0.03);
  }

  setSfxLevel(level: number): void {
    this.sfxLevel = clamp01(level);
    this.glide(this.sfxBus?.gain, levelToGain(this.sfxLevel), 0.03);
  }

  // Les effets coupés ne se lancent plus, et ne se chargent pas ; rallumés, ils se chargent (une fois).
  setSfxEnabled(on: boolean): void {
    this.sfxOn = on;
    if (on && this.context !== null) this.preloadSfx();
  }

  // La musique descend pendant qu'on parle (ou qu'on écoute quelqu'un), et remonte après.
  setDucked(ducked: boolean): void {
    this.ducked = ducked;
    this.glide(this.duck?.gain, ducked ? DUCK_LEVEL : 1, ducked ? DUCK_ATTACK_S : DUCK_RELEASE_S);
  }

  // La sortie du son choisie à l'écran d'entrée (« Sortie du son »). Les navigateurs qui ne savent pas choisir la sortie d'un contexte audio
  // (Safari, Firefox) jouent sur celle du système.
  setOutputDevice(deviceId: string | undefined): void {
    this.outputDevice = deviceId;
    this.applyOutputDevice();
  }

  private applyOutputDevice(): void {
    const context = this.context as SinkContext | null;
    if (context === null || typeof context.setSinkId !== 'function') return;
    if (this.outputDevice === undefined && !this.sinkTouched) return;
    this.sinkTouched = true;
    // '' : la sortie par défaut du système.
    context.setSinkId(this.outputDevice ?? '').catch(() => {});
  }

  // Le paramètre rejoint cette valeur en douceur (une constante de temps de `seconds`) : pas de claquement quand on bouge un curseur.
  private glide(param: AudioParam | undefined, value: number, seconds: number): void {
    if (this.context === null || param === undefined) return;
    param.setTargetAtTime(value, this.context.currentTime, seconds);
  }

  // Le paramètre va à cette valeur en `seconds` secondes, d'où il est : une courbe à puissance constante (un fondu enchaîné ne creuse
  // pas le volume au milieu), qui s'enchaîne sur un fondu en cours.
  private fade(param: AudioParam, to: number, seconds: number): void {
    const context = this.context!;
    const now = context.currentTime;
    const from = param.value;
    const curve = new Float32Array(CURVE_POINTS);
    for (let i = 0; i < CURVE_POINTS; i++) {
      const t = i / (CURVE_POINTS - 1);
      curve[i] = from + (to - from) * (to >= from ? Math.sin((t * Math.PI) / 2) : 1 - Math.cos((t * Math.PI) / 2));
    }
    param.cancelScheduledValues(now);
    param.setValueAtTime(from, now);
    param.setValueCurveAtTime(curve, now, seconds);
  }

  // ---- La musique ---------------------------------------------------------------------------------------------------------------

  // Joue cette ambiance (en fondu depuis celle qui joue), ou coupe la musique (null). Avant unlock(), retient seulement le choix.
  setMusic(scene: SceneId | null): void {
    this.wanted = scene;
    void this.applyMusic();
  }

  private async applyMusic(): Promise<void> {
    const context = this.context;
    if (context === null) return;
    const wanted = this.wanted;
    if (wanted === null) {
      this.stopMusic();
      return;
    }
    if (this.voice?.scene === wanted || this.loading === wanted) return;

    this.loading = wanted;
    let buffer: AudioBuffer | null;
    try {
      buffer = await this.musicBuffer(wanted);
    } catch {
      buffer = null;
    }
    if (this.loading === wanted) this.loading = null;
    // Entre-temps, la personne a changé d'avis (ou le moteur est fermé) : cette ambiance n'a plus d'objet.
    if (buffer === null || this.context !== context || this.wanted !== wanted) return;
    this.startVoice(wanted, buffer);
  }

  private startVoice(scene: SceneId, buffer: AudioBuffer): void {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.duck);

    if (this.voice !== null) this.release(this.voice, MUSIC_FADE_S);
    const voice: MusicVoice = { scene, source, gain };
    this.voice = voice;
    source.start(context.currentTime);
    this.fade(gain.gain, SCENES[scene].gain, MUSIC_FADE_S);
    this.setSnapshot({ playing: scene });
  }

  private stopMusic(): void {
    if (this.voice !== null) this.release(this.voice, MUSIC_STOP_FADE_S);
    this.voice = null;
    this.setSnapshot({ playing: null });
  }

  // Une voix s'éteint en fondu, puis ses nœuds sont défaits.
  private release(voice: MusicVoice, seconds: number): void {
    this.fade(voice.gain.gain, 0, seconds);
    voice.source.stop(this.context!.currentTime + seconds + 0.1);
    voice.source.onended = () => {
      voice.source.disconnect();
      voice.gain.disconnect();
      this.fading.delete(voice);
    };
    this.fading.add(voice);
  }

  // L'ambiance décodée : l'ogg d'abord, ou ce que le navigateur sait lire ; si le décodage échoue, l'autre copie (Safari prétend parfois
  // lire ce qu'il ne décode pas).
  private musicBuffer(scene: SceneId): Promise<AudioBuffer> {
    const cached = this.musicBuffers.get(scene);
    if (cached !== undefined) {
      // Relue : elle redevient la plus récente.
      this.musicBuffers.delete(scene);
      this.musicBuffers.set(scene, cached);
      return cached;
    }
    const context = this.context!;
    const urls = musicUrls(scene, (mime) => this.runtime.canPlay(mime));
    const decoded = this.decodeFirst(context, urls);
    this.musicBuffers.set(scene, decoded);
    decoded.catch(() => {
      // Un échec n'est pas gardé : le prochain essai recharge.
      if (this.musicBuffers.get(scene) === decoded) this.musicBuffers.delete(scene);
    });
    this.trimMusicCache();
    return decoded;
  }

  private async decodeFirst(context: AudioContext, urls: readonly string[]): Promise<AudioBuffer> {
    let failure: unknown = new Error('Aucune adresse à essayer');
    for (const url of urls) {
      try {
        return await context.decodeAudioData(await this.runtime.fetchBytes(url));
      } catch (error) {
        failure = error;
      }
    }
    throw failure;
  }

  private trimMusicCache(): void {
    for (const scene of [...this.musicBuffers.keys()]) {
      if (this.musicBuffers.size <= MUSIC_CACHE_SIZE) return;
      if (scene !== this.voice?.scene && scene !== this.wanted && scene !== this.loading) this.musicBuffers.delete(scene);
    }
  }

  // ---- Les effets ---------------------------------------------------------------------------------------------------------------

  playSfx(id: SfxId, options: SfxOptions = {}): void {
    const context = this.context;
    if (context === null || !this.sfxOn || context.state !== 'running') return;
    const buffer = this.sfxBuffers.get(id);
    if (buffer === undefined) {
      // Pas encore chargé : s'il arrive à temps, il part.
      const requestedAt = this.runtime.nowMs();
      void this.loadSfx(id).then((loaded) => {
        if (loaded !== null && this.runtime.nowMs() - requestedAt < SFX_LATE_MS) this.playSfx(id, options);
      });
      return;
    }
    const nowMs = this.runtime.nowMs();
    const last = this.sfxLastAt.get(id);
    if ((last !== undefined && nowMs - last < SFX[id].cooldownMs) || this.sfxActive >= SFX_MAX_VOICES) return;
    this.sfxLastAt.set(id, nowMs);

    const source = context.createBufferSource();
    source.buffer = buffer;
    if (options.rate !== undefined) source.playbackRate.value = options.rate;
    const gain = context.createGain();
    gain.gain.value = SFX[id].gain * (options.level ?? 1);
    source.connect(gain);
    gain.connect(this.sfxBus);
    this.sfxActive++;
    source.onended = () => {
      this.sfxActive--;
      source.disconnect();
      gain.disconnect();
    };
    source.start(context.currentTime + (options.delayMs ?? 0) / 1000);
  }

  private preloadSfx(): void {
    for (const id of SFX_IDS) void this.loadSfx(id);
  }

  // Un effet, chargé une seule fois ; null s'il ne se charge pas (on ne réessaie pas : le fichier manque ou est abîmé).
  private loadSfx(id: SfxId): Promise<AudioBuffer | null> {
    const known = this.sfxBuffers.get(id);
    if (known !== undefined) return Promise.resolve(known);
    const loading = this.sfxLoading.get(id);
    if (loading !== undefined) return loading;
    const context = this.context;
    if (context === null) return Promise.resolve(null);
    const promise = this.runtime
      .fetchBytes(sfxUrl(id))
      .then((bytes) => context.decodeAudioData(bytes))
      .then(
        (buffer) => {
          this.sfxBuffers.set(id, buffer);
          return buffer;
        },
        () => null,
      );
    this.sfxLoading.set(id, promise);
    return promise;
  }

  // ---- La fin -------------------------------------------------------------------------------------------------------------------

  // Ferme le contexte (les tests) : plus aucun son, et le moteur n'est plus utilisable.
  dispose(): void {
    const context = this.context;
    this.context = null;
    this.wanted = null;
    this.voice = null;
    this.fading.clear();
    this.musicBuffers.clear();
    this.sfxBuffers.clear();
    this.sfxLoading.clear();
    if (context !== null) void context.close().catch(() => {});
    this.setSnapshot({ status: this.runtime.supported ? 'locked' : 'unsupported', playing: null });
  }
}
