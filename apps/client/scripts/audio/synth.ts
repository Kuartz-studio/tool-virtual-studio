// De quoi fabriquer des sons à partir de rien (les insectes de la nuit, les oiseaux : night-insects.ts, birdsong.ts) et retoucher une boucle : un hasard
// qu'on rejoue (la même graine donne le même son d'une fabrication à l'autre, donc le même fichier commité), des filtres, une réverbération de jardin,
// et l'écriture d'un .wav. Tout travaille sur des Float32Array mono, à SAMPLE_RATE (celui de tous les fichiers de l'appli, et du contexte audio).
import { writeFileSync } from 'node:fs';

export const SAMPLE_RATE = 44100;

// Un hasard déterministe (mulberry32) : des nombres dans [0, 1[, toujours les mêmes pour une même graine.
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Un nombre au hasard entre `min` et `max`.
export const between = (random: () => number, min: number, max: number): number => min + (max - min) * random();

// ---- Filtres ----------------------------------------------------------------------------------------------------------------------

export type FilterKind = 'lowpass' | 'highpass' | 'bandpass';

// Un biquad (les formules de Robert Bristow-Johnson) : passe-bas, passe-haut, ou passe-bande (gain de 1 au centre).
export function biquad(kind: FilterKind, hz: number, q = Math.SQRT1_2): [number, number, number, number, number] {
  const w = (2 * Math.PI * hz) / SAMPLE_RATE;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  let b: [number, number, number];
  if (kind === 'lowpass') b = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  else if (kind === 'highpass') b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  else b = [alpha, 0, -alpha];
  return [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

// Le signal filtré (un nouveau tableau). `circular` : le signal est une boucle ; on le passe deux fois et on garde le second passage, où le filtre a déjà
// la queue de la fin : la sortie est aussi une boucle, sans raccord.
export function filtered(input: Float32Array, kind: FilterKind, hz: number, options: { q?: number; circular?: boolean } = {}): Float32Array {
  const [b0, b1, b2, a1, a2] = biquad(kind, hz, options.q);
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const passes = options.circular ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < input.length; i++) {
      const x = input[i]!;
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
  }
  return out;
}

// ---- Réverbération ----------------------------------------------------------------------------------------------------------------

// Les retards de Freeverb (en échantillons, à 44,1 kHz) : huit filtres en peigne en parallèle, puis quatre passe-tout en série.
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];

// La réverbération d'un signal (la partie réverbérée seule, à ajouter au son direct) : celle d'un jardin, un peu d'espace autour des sons. `seconds` : le
// temps qu'elle met à s'éteindre de 60 dB ; `dampHz` : les aigus qu'elle perd à chaque réflexion ; `predelayMs` : l'écart entre le son direct et elle.
// `circular` : comme pour les filtres, une boucle reste une boucle.
export function reverb(input: Float32Array, options: { seconds: number; dampHz: number; predelayMs?: number; circular?: boolean }): Float32Array {
  const n = input.length;
  const predelay = Math.round(((options.predelayMs ?? 0) / 1000) * SAMPLE_RATE);
  const damp = Math.exp((-2 * Math.PI * options.dampHz) / SAMPLE_RATE);
  const combs = COMBS.map((length) => ({ buffer: new Float32Array(length), index: 0, store: 0, feedback: 10 ** ((-3 * length) / (options.seconds * SAMPLE_RATE)) }));
  const allpasses = ALLPASSES.map((length) => ({ buffer: new Float32Array(length), index: 0 }));
  const out = new Float32Array(n);
  const passes = options.circular ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      const source = i - predelay;
      const x = (source >= 0 ? input[source]! : options.circular ? input[source + n]! : 0) * 0.03;
      let sum = 0;
      for (const comb of combs) {
        const y = comb.buffer[comb.index]!;
        comb.store = y * (1 - damp) + comb.store * damp;
        comb.buffer[comb.index] = x + comb.store * comb.feedback;
        comb.index = (comb.index + 1) % comb.buffer.length;
        sum += y;
      }
      for (const allpass of allpasses) {
        const delayed = allpass.buffer[allpass.index]!;
        allpass.buffer[allpass.index] = sum + delayed * 0.5;
        allpass.index = (allpass.index + 1) % allpass.buffer.length;
        sum = delayed - sum;
      }
      out[i] = sum;
    }
  }
  return out;
}

// ---- Mélange ----------------------------------------------------------------------------------------------------------------------

// Ajoute `source` × `gain` dans `into` (même longueur).
export function mixInto(into: Float32Array, source: Float32Array, gain = 1): void {
  for (let i = 0; i < into.length; i++) into[i]! += source[i]! * gain;
}

export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  return peak;
}

// Ramène le pic à `db` (dB sous le maximum numérique).
export function normalizePeak(samples: Float32Array, db: number): Float32Array {
  const scale = 10 ** (db / 20) / Math.max(peakOf(samples), 1e-9);
  for (let i = 0; i < samples.length; i++) samples[i]! *= scale;
  return samples;
}

// ---- Boucles ----------------------------------------------------------------------------------------------------------------------

// Une boucle sans raccord de `period` échantillons, tirée d'un son plus long qui ne boucle pas tout à fait : son début se fond dans ce qui suit la période
// (un fondu à puissance constante, pour un bruit comme l'eau), si bien que la fin de la période enchaîne sur le début sans saut.
export function crossfadeLoop(source: Float32Array, period: number): Float32Array {
  const fade = source.length - period;
  if (fade <= 0) throw new Error(`Il faut un son plus long que la boucle : ${source.length} échantillons pour ${period}.`);
  const out = source.slice(0, period);
  for (let i = 0; i < fade; i++) {
    const u = (i + 0.5) / fade;
    out[i] = source[i]! * Math.sin((u * Math.PI) / 2) + source[i + period]! * Math.cos((u * Math.PI) / 2);
  }
  return out;
}

// La boucle telle qu'on la range : la période, avec `margin` échantillons de sa fin devant et de son début derrière. Le lecteur boucle sur la période
// seule (loopStart, loopEnd) : ce que les encodeurs abîment aux bords d'un fichier (l'amorce de l'AAC, que Safari ne retire pas toujours, ses derniers
// échantillons, la fenêtre de Vorbis) tombe dans les marges, et un décalage de l'amorce ne fait que glisser la période, qui boucle toujours.
export function withLoopMargins(period: Float32Array, margin: number): Float32Array {
  const n = period.length;
  const out = new Float32Array(n + 2 * margin);
  for (let i = 0; i < out.length; i++) out[i] = period[(((i - margin) % n) + n) % n]!;
  return out;
}

// ---- Fichiers ---------------------------------------------------------------------------------------------------------------------

// Un .wav mono en flottants 32 bits (que sox et ffmpeg lisent tels quels, sans arrondi avant l'encodage) : le bloc `fmt ` long (avec sa taille
// d'extension, nulle) et le bloc `fact` (le nombre d'échantillons), qu'un format autre que le PCM entier doit avoir.
export function writeWav(path: string, samples: Float32Array): void {
  const data = Buffer.alloc(samples.length * 4);
  for (let i = 0; i < samples.length; i++) data.writeFloatLE(samples[i]!, i * 4);
  const header = Buffer.alloc(58);
  header.write('RIFF', 0);
  header.writeUInt32LE(50 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(18, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(32, 34);
  header.writeUInt16LE(0, 36);
  header.write('fact', 38);
  header.writeUInt32LE(4, 42);
  header.writeUInt32LE(samples.length, 46);
  header.write('data', 50);
  header.writeUInt32LE(data.length, 54);
  writeFileSync(path, Buffer.concat([header, data]));
}
