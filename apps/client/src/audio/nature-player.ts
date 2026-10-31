import { NATURE, type NatureId } from './catalog';
import {
  BIRD_PHRASE_S,
  gustShape,
  NATURE_CROSSFADE_S,
  NATURE_LEVELS,
  NATURE_LOOP_MARGIN_S,
  NatureSchedule,
  SILENT_NATURE,
  WATER_FOLLOW_S,
  WATER_WALL_HZ,
  WIND_DULL_HZ,
  type BirdPhrase,
  type Gust,
  type MotoPass,
  type NatureMix,
} from './nature';

// Le lecteur de la nature : ce que nature.ts décide, en son. Il vit dans le contexte audio du moteur (engine.ts), qui le crée la première fois qu'il y a
// quelque chose à entendre, et sort sur le circuit des effets : leur volume, et leur coupure qui le fait taire.
//
//   l'eau (deux voix de sa boucle) ─┬→ à l'air libre ────────────────┬→ sa place ┐
//                                   └→ à travers le mur → passe-bas ─┘           │
//   les insectes (la boucle à gauche, la même décalée à droite) ─────────────────┤
//   les oiseaux (une phrase de la banque, à sa place) ───────────────────────────┼→ la nature → les effets
//   le vent (un coup : un passe-bas qui s'ouvre, monte et retombe, et passe) ────┤
//   la moto (un passage, d'un côté à l'autre) ───────────────────────────────────┘
//
// Chaque bruit a son gain, qui suit ce qu'on doit entendre (set) : en fondu sur NATURE_CROSSFADE_S quand on passe la porte (ou que la lumière change),
// de près quand on longe l'eau. Les phrases des oiseaux, les coups de vent et les passages de la moto partent quand le calendrier (NatureSchedule) le dit.

export interface NatureRuntime {
  // Le son décodé d'un fichier de la nature ; null s'il ne se charge pas (on ne réessaie pas).
  load(id: NatureId): Promise<AudioBuffer | null>;
  nowMs(): number;
  random(): number;
}

// Le lecteur demande au calendrier ce qui part, toutes les NATURE_TICK_MS ms, tant que des oiseaux, du vent ou la moto peuvent se faire entendre.
export const NATURE_TICK_MS = 250;
// Une boucle qui s'est tue reste prête ce temps (ms) avant d'être arrêtée : longer la porte ne la relance pas à chaque pas.
const LOOP_REST_MS = 6000;
// Une boucle qui démarre (son fichier vient d'arriver, son gain est peut-être déjà haut) monte en douceur : une constante de temps, en secondes.
const LOOP_START_S = 0.2;

type LoopId = 'water' | 'insects';

// Les voix d'une boucle : la même boucle lue plusieurs fois, chacune à sa vitesse, à son niveau, à sa place dans la stéréo, et décalée de `shift` (une
// fraction de la période) par rapport à la première, qui part d'un endroit au hasard. L'eau : le bassin, une fois (ses 24 s de clapotis ne se répètent pas
// à l'oreille). Les insectes : la boucle à gauche, la même une demi-boucle plus loin à droite : ils sont tout autour.
const LOOP_VOICES: Record<LoopId, ReadonlyArray<{ rate: number; level: number; pan: number; shift: number }>> = {
  water: [{ rate: 1, level: 1, pan: 0, shift: 0 }],
  insects: [
    { rate: 1, level: 1, pan: -0.6, shift: 0 },
    { rate: 1, level: 1, pan: 0.6, shift: 0.5 },
  ],
};

interface Loop {
  // Là où ses voix se rejoignent.
  input: AudioNode;
  sources: AudioBufferSourceNode[];
  starting: boolean;
  rest: ReturnType<typeof setTimeout> | null;
}

// Une place dans la stéréo ; dans un navigateur qui n'en a pas, un gain neutre (le son reste au milieu).
function panner(context: AudioContext, pan: number): { node: AudioNode; pan: AudioParam | null } {
  if (typeof context.createStereoPanner !== 'function') return { node: context.createGain(), pan: null };
  const node = context.createStereoPanner();
  node.pan.value = pan;
  return { node, pan: node.pan };
}

function gainOf(context: AudioContext, value: number): GainNode {
  const gain = context.createGain();
  gain.gain.value = value;
  return gain;
}

export class NaturePlayer {
  private readonly out: GainNode;
  private readonly waterOpen: GainNode;
  private readonly waterWall: GainNode;
  private readonly waterPan: AudioParam | null;
  private readonly insects: GainNode;
  private readonly birds: GainNode;
  private readonly wind: GainNode;
  private readonly moto: GainNode;
  private readonly loops: Record<LoopId, Loop>;
  private readonly buffers = new Map<NatureId, AudioBuffer>();
  private readonly loading = new Map<NatureId, Promise<AudioBuffer | null>>();
  // Les phrases et les coups de vent qui jouent.
  private readonly voices = new Set<AudioBufferSourceNode>();
  // Le dernier but de chaque gain : un pas qui ne change rien n'ajoute rien à sa courbe.
  private readonly targets = new WeakMap<AudioParam, number>();
  private readonly schedule: NatureSchedule;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private mix: NatureMix = SILENT_NATURE;
  // Quand on a passé la porte pour la dernière fois (temps du contexte, s) : l'eau finit son fondu avant de suivre les pas de près.
  private crossedAt = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(
    private readonly context: AudioContext,
    output: AudioNode,
    private readonly runtime: NatureRuntime,
  ) {
    this.out = context.createGain();
    this.out.connect(output);

    const water = gainOf(context, NATURE_LEVELS.water * NATURE.water.gain);
    this.waterOpen = gainOf(context, 0);
    this.waterWall = gainOf(context, 0);
    const wall = context.createBiquadFilter();
    wall.type = 'lowpass';
    wall.frequency.value = WATER_WALL_HZ;
    wall.Q.value = Math.SQRT1_2;
    const place = panner(context, 0);
    this.waterPan = place.pan;
    water.connect(this.waterOpen);
    water.connect(this.waterWall);
    this.waterOpen.connect(place.node);
    this.waterWall.connect(wall);
    wall.connect(place.node);
    place.node.connect(this.out);

    this.insects = gainOf(context, 0);
    this.birds = gainOf(context, 0);
    this.wind = gainOf(context, 0);
    this.moto = gainOf(context, 0);
    for (const layer of [this.insects, this.birds, this.wind, this.moto]) layer.connect(this.out);

    this.loops = {
      water: { input: water, sources: [], starting: false, rest: null },
      insects: { input: this.insects, sources: [], starting: false, rest: null },
    };
    this.schedule = new NatureSchedule(runtime.random, Math.round(NATURE.birds.seconds / BIRD_PHRASE_S), NATURE.wind.seconds);
  }

  // Ce qu'on doit entendre maintenant.
  set(mix: NatureMix): void {
    if (this.disposed) return;
    const now = this.context.currentTime;
    if (mix.outside !== this.mix.outside) this.crossedAt = now;
    this.mix = mix;
    // Une constante de temps : le fondu est presque fini (95 %) en trois.
    const fade = NATURE_CROSSFADE_S / 3;
    const follow = now - this.crossedAt < NATURE_CROSSFADE_S ? fade : WATER_FOLLOW_S;
    this.glide(this.waterOpen.gain, mix.water.open, follow);
    this.glide(this.waterWall.gain, mix.water.wall, follow);
    if (this.waterPan !== null) this.glide(this.waterPan, mix.water.pan, WATER_FOLLOW_S);
    this.glide(this.insects.gain, NATURE_LEVELS.insects * NATURE.insects.gain * mix.insects, fade);
    this.glide(this.birds.gain, mix.birds > 0 ? 1 : 0, fade);
    this.glide(this.wind.gain, mix.wind > 0 ? 1 : 0, fade);
    this.glide(this.moto.gain, mix.moto > 0 ? 1 : 0, fade);

    this.keepLoop('water', mix.water.open + mix.water.wall > 0);
    this.keepLoop('insects', mix.insects > 0);
    if (mix.birds > 0) void this.buffer('birds');
    if (mix.wind > 0) void this.buffer('wind');
    if (mix.moto > 0) void this.buffer('moto');

    const scheduled = mix.birds > 0 || mix.wind > 0 || mix.moto > 0;
    if (scheduled && this.ticker === null) {
      this.ticker = setInterval(this.tick, NATURE_TICK_MS);
      this.tick();
    } else if (!scheduled && this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
      // Le calendrier oublie ses prochains départs : au retour, tout repart du début.
      this.schedule.due(this.runtime.nowMs(), mix);
    }
  }

  // Plus aucun son, et le lecteur n'est plus utilisable.
  dispose(): void {
    this.disposed = true;
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
    for (const id of ['water', 'insects'] as const) this.stopLoop(id);
    for (const source of this.voices) source.stop();
    this.voices.clear();
    this.out.disconnect();
  }

  private glide(param: AudioParam, value: number, seconds: number): void {
    if (this.targets.get(param) === value) return;
    this.targets.set(param, value);
    param.setTargetAtTime(value, this.context.currentTime, seconds);
  }

  // ---- Les boucles ------------------------------------------------------------------------------------------------------------------

  // Une boucle qu'on doit entendre est lancée (une fois son fichier chargé) ; tue depuis LOOP_REST_MS, elle est arrêtée.
  private keepLoop(id: LoopId, wanted: boolean): void {
    const loop = this.loops[id];
    if (!wanted) {
      if (loop.sources.length > 0 && loop.rest === null) loop.rest = setTimeout(() => this.stopLoop(id), LOOP_REST_MS);
      return;
    }
    if (loop.rest !== null) clearTimeout(loop.rest);
    loop.rest = null;
    if (loop.sources.length > 0 || loop.starting) return;
    loop.starting = true;
    void this.buffer(id).then((buffer) => {
      loop.starting = false;
      const still = id === 'water' ? this.mix.water.open + this.mix.water.wall > 0 : this.mix.insects > 0;
      if (buffer !== null && !this.disposed && still && loop.sources.length === 0) this.startLoop(id, buffer);
    });
  }

  // Les voix d'une boucle, chacune sur la période seule (entre les marges du fichier).
  private startLoop(id: LoopId, buffer: AudioBuffer): void {
    const context = this.context;
    const loop = this.loops[id];
    const period = NATURE[id].seconds;
    const from = this.runtime.random();
    for (const voice of LOOP_VOICES[id]) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = NATURE_LOOP_MARGIN_S;
      source.loopEnd = NATURE_LOOP_MARGIN_S + period;
      source.playbackRate.value = voice.rate;
      const gain = gainOf(context, 0);
      gain.gain.setTargetAtTime(voice.level, context.currentTime, LOOP_START_S);
      source.connect(gain);
      const place = voice.pan === 0 ? null : panner(context, voice.pan);
      if (place === null) gain.connect(loop.input);
      else {
        gain.connect(place.node);
        place.node.connect(loop.input);
      }
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        place?.node.disconnect();
      };
      source.start(context.currentTime, NATURE_LOOP_MARGIN_S + ((from + voice.shift) % 1) * period);
      loop.sources.push(source);
    }
  }

  private stopLoop(id: LoopId): void {
    const loop = this.loops[id];
    if (loop.rest !== null) clearTimeout(loop.rest);
    loop.rest = null;
    for (const source of loop.sources) source.stop();
    loop.sources = [];
  }

  // ---- Les oiseaux et le vent ---------------------------------------------------------------------------------------------------------

  private readonly tick = (): void => {
    const events = this.schedule.due(this.runtime.nowMs(), this.mix);
    // Un contexte endormi (le navigateur ne laisse pas encore jouer, un onglet en arrière-plan) : ce qui devait partir est perdu, pas retardé.
    if (this.context.state !== 'running') return;
    for (const event of events) {
      if (event.kind === 'phrase') this.playPhrase(event);
      else if (event.kind === 'gust') this.playGust(event);
      else this.playMoto(event);
    }
  };

  // Une phrase de la banque, entière (sa case), à sa vitesse, à sa place. Pas encore chargée : elle ne part pas, la suivante partira.
  private playPhrase(phrase: BirdPhrase): void {
    const buffer = this.buffers.get('birds');
    if (buffer === undefined) return;
    const context = this.context;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = phrase.rate;
    const gain = gainOf(context, NATURE_LEVELS.birds * NATURE.birds.gain * phrase.level);
    const place = panner(context, phrase.pan);
    source.connect(gain);
    gain.connect(place.node);
    place.node.connect(this.birds);
    this.track(source, [gain, place.node]);
    source.start(context.currentTime, phrase.phrase * BIRD_PHRASE_S, BIRD_PHRASE_S);
  }

  // Un coup de vent : il monte et retombe (gustShape), s'éclaircit avec lui (le passe-bas s'ouvre de WIND_DULL_HZ jusqu'à son `brightHz`, en suivant la
  // même forme, d'octave en octave), et passe d'un côté à l'autre.
  private playGust(gust: Gust): void {
    const buffer = this.buffers.get('wind');
    if (buffer === undefined) return;
    const context = this.context;
    const at = context.currentTime + 0.02;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = gust.rate;
    const tone = context.createBiquadFilter();
    tone.type = 'lowpass';
    const gain = context.createGain();
    const place = panner(context, gust.panFrom);
    const shape = gustShape(gust);
    const level = NATURE_LEVELS.wind * NATURE.wind.gain * gust.level;
    gain.gain.setValueCurveAtTime(shape.map((value) => value * level), at, gust.seconds);
    tone.frequency.setValueCurveAtTime(shape.map((value) => WIND_DULL_HZ * (gust.brightHz / WIND_DULL_HZ) ** value), at, gust.seconds);
    place.pan?.setValueCurveAtTime(Float32Array.of(gust.panFrom, gust.panTo), at, gust.seconds);
    source.connect(tone);
    tone.connect(gain);
    gain.connect(place.node);
    place.node.connect(this.wind);
    this.track(source, [tone, gain, place.node]);
    source.start(at, gust.offset, gust.seconds * gust.rate);
  }

  // Un passage de la moto : l'enregistrement entier (il arrive, passe et s'éloigne, avec son effet Doppler), à sa vitesse, d'un côté à l'autre de la
  // stéréo. Rentrer pendant qu'elle passe l'éteint en fondu (son calque, comme le vent). Pas encore chargée : elle ne passe pas, la suivante passera.
  private playMoto(pass: MotoPass): void {
    const buffer = this.buffers.get('moto');
    if (buffer === undefined) return;
    const context = this.context;
    const at = context.currentTime + 0.02;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = pass.rate;
    const gain = gainOf(context, NATURE_LEVELS.moto * NATURE.moto.gain * pass.level);
    const place = panner(context, pass.panFrom);
    place.pan?.setValueCurveAtTime(Float32Array.of(pass.panFrom, pass.panTo), at, buffer.duration / pass.rate);
    source.connect(gain);
    gain.connect(place.node);
    place.node.connect(this.moto);
    this.track(source, [gain, place.node]);
    source.start(at);
  }

  private track(source: AudioBufferSourceNode, nodes: AudioNode[]): void {
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
  }

  // ---- Les fichiers -----------------------------------------------------------------------------------------------------------------

  // Un fichier, chargé une seule fois.
  private buffer(id: NatureId): Promise<AudioBuffer | null> {
    const known = this.buffers.get(id);
    if (known !== undefined) return Promise.resolve(known);
    let loading = this.loading.get(id);
    if (loading === undefined) {
      loading = this.runtime.load(id).then((buffer) => {
        if (buffer !== null) this.buffers.set(id, buffer);
        return buffer;
      });
      this.loading.set(id, loading);
    }
    return loading;
  }
}
