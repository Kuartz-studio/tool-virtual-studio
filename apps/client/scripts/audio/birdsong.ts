// Le chant des oiseaux, fabriqué ici. « Birds SFX » (Cinematic Sound Effects) n'est pas un chant : c'est un vol d'oiseaux qui s'envole (des battements
// d'ailes, un seul petit cri, puis le silence). Le fichier est une banque de phrases : BIRD_PHRASES phrases de BIRD_PHRASE_S secondes chacune, une par
// case, que le lecteur tire au hasard (nature-player.ts) ; chacune commence au début de sa case et s'éteint avant sa fin, réverbération comprise.
// Les phrases imitent des oiseaux de jardin, chacun avec ses notes (des sifflements purs qui glissent vite, avec un peu d'harmoniques) et son rythme :
//   - la mésange charbonnière, son « ti-tu ti-tu ti-tu » ;
//   - le pinson, une descente de notes qui accélère et finit par une fioriture ;
//   - le merle, quelques notes flûtées et graves, puis un gazouillis aigu ;
//   - le rouge-gorge, une suite rapide de notes fines et variées, avec un petit trille ;
//   - le moineau, des « tchip » rauques, irréguliers ;
//   - le troglodyte, un trille vif ;
//   - la tourterelle, au loin, son « hou-houu-hou ».
// Chaque phrase est une interprétation (une graine fixe) : hauteur, tempo et nombre de répétitions changent d'une phrase à l'autre.
import { BIRD_PHRASE_S } from '../../src/audio/nature';
import { between, filtered, mixInto, normalizePeak, reverb, SAMPLE_RATE, seeded } from './synth';

// Une note : son début et sa durée (s), sa hauteur au fil de la note (des points [u, Hz], u de 0 à 1, reliés en douceur), son niveau, et sa couleur.
interface Note {
  at: number;
  seconds: number;
  hz: Array<[number, number]>;
  level: number;
  // La montée et l'extinction, en fractions de la durée.
  attack?: number;
  release?: number;
  // Les harmoniques 2, 3… (fractions du fondamental) : presque rien pour une flûte (le merle), beaucoup pour un cri rauque (le moineau).
  harmonics?: number[];
  // Un vibrato (fréquence, profondeur en fraction de la hauteur) et un roulement du niveau (fréquence, profondeur).
  vibrato?: [number, number];
  tremolo?: [number, number];
  // Un souffle (le roucoulement de la tourterelle), en fraction du niveau.
  breath?: number;
}

// La hauteur au point u d'une note : entre deux points, une courbe en cosinus (une glissade, pas un escalier).
function hzAt(points: Array<[number, number]>, u: number): number {
  for (let i = 1; i < points.length; i++) {
    const [u1, f1] = points[i]!;
    const [u0, f0] = points[i - 1]!;
    if (u <= u1) {
      const t = u1 === u0 ? 1 : (u - u0) / (u1 - u0);
      return f0 + (f1 - f0) * (0.5 - 0.5 * Math.cos(Math.PI * t));
    }
  }
  return points.at(-1)![1];
}

function addNote(into: Float32Array, note: Note, random: () => number): void {
  const start = Math.round(note.at * SAMPLE_RATE);
  const length = Math.max(16, Math.round(note.seconds * SAMPLE_RATE));
  const attack = note.attack ?? 0.12;
  const release = note.release ?? 0.3;
  const harmonics = note.harmonics ?? [0.06];
  const [vibratoHz, vibratoDepth] = note.vibrato ?? [0, 0];
  const [tremoloHz, tremoloDepth] = note.tremolo ?? [0, 0];
  // Une petite dérive au hasard de la hauteur : une voix, pas un oscillateur.
  let drift = 0;
  let phase = random() * 2 * Math.PI;
  for (let i = 0; i < length && start + i < into.length; i++) {
    const u = i / length;
    const t = i / SAMPLE_RATE;
    drift = drift * 0.999 + (random() - 0.5) * 0.0004;
    const hz = hzAt(note.hz, u) * (1 + drift + vibratoDepth * Math.sin(2 * Math.PI * vibratoHz * t));
    phase += (2 * Math.PI * hz) / SAMPLE_RATE;
    let tone = Math.sin(phase);
    for (let h = 0; h < harmonics.length; h++) tone += harmonics[h]! * Math.sin((h + 2) * phase);
    if (note.breath) tone += note.breath * (random() * 2 - 1);
    const rise = u < attack ? 0.5 - 0.5 * Math.cos((Math.PI * u) / attack) : 1;
    const fall = u > 1 - release ? 0.5 + 0.5 * Math.cos((Math.PI * (u - (1 - release))) / release) : 1;
    const roll = 1 - tremoloDepth * (0.5 + 0.5 * Math.sin(2 * Math.PI * tremoloHz * t));
    into[start + i]! += note.level * rise * fall * roll * tone;
  }
}

// Une interprétation : la hauteur et le tempo de cette fois-ci.
interface Take {
  random: () => number;
  pitch: number;
  tempo: number;
}

type Species = (take: Take) => Note[];

const scale = (points: Array<[number, number]>, pitch: number): Array<[number, number]> => points.map(([u, hz]) => [u, hz * pitch]);

// La mésange charbonnière : « ti-tu », quatre à six fois, la note haute brève, la basse accrochée par une petite montée.
const greatTit: Species = ({ random, pitch, tempo }) => {
  const notes: Note[] = [];
  const repeats = 4 + Math.floor(random() * 3);
  let at = 0;
  for (let r = 0; r < repeats; r++) {
    const fade = 1 - 0.06 * r;
    notes.push({ at, seconds: 0.07 * tempo, hz: scale([[0, 6050], [0.25, 6300], [1, 5550]], pitch), level: 0.75 * fade, harmonics: [0.07] });
    at += (0.07 + 0.035) * tempo;
    notes.push({ at, seconds: 0.1 * tempo, hz: scale([[0, 3650], [0.2, 4300], [1, 4050]], pitch), level: fade, harmonics: [0.1, 0.03], attack: 0.08 });
    at += (0.1 + between(random, 0.06, 0.08)) * tempo;
  }
  return notes;
};

// Le pinson : des notes qui descendent en accélérant, une seconde série plus grave et plus rapide, puis la fioriture de la fin.
const chaffinch: Species = ({ random, pitch, tempo }) => {
  const notes: Note[] = [];
  let at = 0;
  const first = 4 + Math.floor(random() * 3);
  for (let i = 0; i < first; i++) {
    const top = 6600 - i * 120;
    notes.push({ at, seconds: 0.045 * tempo, hz: scale([[0, top], [1, top - 1400]], pitch), level: 0.55 + 0.08 * i, attack: 0.1, release: 0.4 });
    at += (0.13 - i * 0.008) * tempo;
  }
  const second = 3 + Math.floor(random() * 3);
  for (let i = 0; i < second; i++) {
    notes.push({ at, seconds: 0.05 * tempo, hz: scale([[0, 4800], [0.3, 5050], [1, 3600]], pitch), level: 0.9, harmonics: [0.1], release: 0.4 });
    at += 0.085 * tempo;
  }
  at += 0.04 * tempo;
  notes.push({ at, seconds: 0.05 * tempo, hz: scale([[0, 6200], [1, 5800]], pitch), level: 0.5 });
  at += 0.08 * tempo;
  notes.push({
    at,
    seconds: 0.24 * tempo,
    hz: scale([[0, 2800], [0.25, 4600], [0.5, 4150], [0.75, 5200], [1, 3300]], pitch),
    level: 1,
    harmonics: [0.15, 0.04],
    attack: 0.06,
  });
  return notes;
};

// Le merle : trois à cinq notes flûtées, graves et lentes, qui montent et descendent, puis un gazouillis aigu et discret.
const blackbird: Species = ({ random, pitch, tempo }) => {
  const notes: Note[] = [];
  const shapes: Array<Array<[number, number]>> = [
    [[0, 1], [0.4, 1.18], [1, 0.92]],
    [[0, 1.12], [1, 0.86]],
    [[0, 1], [0.3, 1.1], [0.6, 0.95], [1, 1.06]],
    [[0, 0.9], [0.7, 1.15], [1, 1.08]],
  ];
  let at = 0;
  const count = 3 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) {
    const base = between(random, 1700, 2600) * pitch;
    const shape = shapes[Math.floor(random() * shapes.length)]!;
    const seconds = between(random, 0.16, 0.34) * tempo;
    notes.push({ at, seconds, hz: shape.map(([u, k]) => [u, base * k]), level: between(random, 0.75, 1), harmonics: [0.05, 0.015], vibrato: [6, 0.01], attack: 0.15, release: 0.35 });
    at += seconds + between(random, 0.05, 0.14) * tempo;
  }
  at += 0.06 * tempo;
  const twitter = 3 + Math.floor(random() * 4);
  for (let i = 0; i < twitter; i++) {
    const top = between(random, 5000, 7200) * pitch;
    notes.push({ at, seconds: between(random, 0.03, 0.05) * tempo, hz: [[0, top], [0.5, top * 1.08], [1, top * 0.8]], level: 0.32, harmonics: [0.04] });
    at += between(random, 0.05, 0.075) * tempo;
  }
  return notes;
};

// Le rouge-gorge : des notes fines et rapides, haut puis bas, qui montent, descendent ou font une bosse, et un petit trille au milieu.
const robin: Species = ({ random, pitch, tempo }) => {
  const notes: Note[] = [];
  let at = 0;
  const count = 8 + Math.floor(random() * 5);
  const trillAt = 3 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) {
    if (i === trillAt) {
      const hz = between(random, 5600, 6600) * pitch;
      const repeats = 4 + Math.floor(random() * 4);
      for (let r = 0; r < repeats; r++) {
        notes.push({ at, seconds: 0.025 * tempo, hz: [[0, hz * 1.05], [1, hz * 0.9]], level: 0.6, attack: 0.15, release: 0.45 });
        at += 0.045 * tempo;
      }
      at += 0.03 * tempo;
    }
    const base = (i % 2 === 0 ? between(random, 4800, 7400) : between(random, 3000, 4800)) * pitch;
    const kind = Math.floor(random() * 3);
    const hz: Array<[number, number]> = kind === 0 ? [[0, base * 0.85], [1, base * 1.15]] : kind === 1 ? [[0, base * 1.15], [1, base * 0.85]] : [[0, base * 0.9], [0.5, base * 1.12], [1, base * 0.92]];
    const seconds = between(random, 0.035, 0.1) * tempo;
    notes.push({ at, seconds, hz, level: between(random, 0.6, 1), harmonics: [0.05] });
    at += seconds + between(random, 0.015, 0.055) * tempo;
  }
  return notes;
};

// Le moineau : des « tchip » rauques (riches en harmoniques, un peu roulés), quatre à sept, à intervalles irréguliers.
const sparrow: Species = ({ random, pitch, tempo }) => {
  const notes: Note[] = [];
  let at = 0;
  const count = 4 + Math.floor(random() * 4);
  for (let i = 0; i < count; i++) {
    const k = between(random, 0.93, 1.07) * pitch;
    notes.push({
      at,
      seconds: between(random, 0.07, 0.11) * tempo,
      hz: scale([[0, 3000], [0.35, 4300], [0.7, 4000], [1, 3200]], k),
      level: between(random, 0.7, 1),
      harmonics: [0.5, 0.28, 0.12],
      tremolo: [85, 0.3],
      attack: 0.1,
      release: 0.35,
    });
    at += between(random, 0.14, 0.4) * tempo;
  }
  return notes;
};

// Le troglodyte : deux notes d'appel, puis un trille vif qui enfle et retombe.
const wren: Species = ({ random, pitch, tempo }) => {
  const notes: Note[] = [];
  let at = 0;
  for (let i = 0; i < 2; i++) {
    notes.push({ at, seconds: 0.06 * tempo, hz: scale([[0, 5200], [0.5, 6100], [1, 5400]], pitch), level: 0.6 });
    at += 0.13 * tempo;
  }
  const count = 12 + Math.floor(random() * 6);
  for (let i = 0; i < count; i++) {
    const swell = Math.sin((Math.PI * (i + 0.5)) / count);
    notes.push({ at, seconds: 0.03 * tempo, hz: scale([[0, 7000], [1, 4800]], pitch), level: 0.45 + 0.55 * swell, harmonics: [0.06], attack: 0.1, release: 0.45 });
    at += 0.068 * tempo;
  }
  return notes;
};

// La tourterelle turque, au loin : « hou-houu-hou », grave, doux, avec un peu de souffle.
const dove: Species = ({ pitch, tempo }) => {
  const notes: Note[] = [];
  const coo = { harmonics: [0.25, 0.08], attack: 0.25, release: 0.35, breath: 0.05, vibrato: [4, 0.006] as [number, number] };
  notes.push({ at: 0, seconds: 0.2 * tempo, hz: scale([[0, 520], [0.3, 570], [1, 540]], pitch), level: 0.7, ...coo });
  notes.push({ at: 0.28 * tempo, seconds: 0.42 * tempo, hz: scale([[0, 590], [0.2, 620], [1, 560]], pitch), level: 1, ...coo });
  notes.push({ at: 0.82 * tempo, seconds: 0.28 * tempo, hz: scale([[0, 540], [1, 500]], pitch), level: 0.75, ...coo });
  return notes;
};

// Les phrases de la banque, dans l'ordre des cases : l'oiseau, son niveau dans le jardin, et sa distance (le loin perd ses aigus et prend plus de réverbération).
const BANK: Array<{ species: Species; level: number; far?: boolean }> = [
  { species: greatTit, level: 0.9 },
  { species: blackbird, level: 0.9 },
  { species: chaffinch, level: 0.85 },
  { species: robin, level: 0.65 },
  { species: sparrow, level: 0.6 },
  { species: greatTit, level: 0.75, far: true },
  { species: blackbird, level: 0.8, far: true },
  { species: wren, level: 0.6 },
  { species: chaffinch, level: 0.7, far: true },
  { species: robin, level: 0.6 },
  { species: sparrow, level: 0.5, far: true },
  { species: dove, level: 0.5, far: true },
];

export const BIRD_PHRASES = BANK.length;

// Où commence une phrase dans sa case (s) : un rien de silence, pour qu'une phrase lue un peu plus tôt (l'amorce d'un décodeur) ne perde pas son début.
const LEAD_S = 0.06;
// La place laissée, à la fin de chaque case, à la réverbération de la dernière note (s) : une interprétation lente perd ses dernières notes plutôt que de
// déborder. Et la fin de la case s'éteint sur TAIL_FADE_S : rien ne passe jamais sur la phrase suivante.
const TAIL_ROOM_S = 0.6;
const TAIL_FADE_S = 0.25;

// Une phrase dans sa case : les notes, la distance, un peu de jardin autour ; son niveau ramené à celui des autres (moyenne quadratique de ce qui sonne).
function phrase(entry: (typeof BANK)[number], random: () => number): Float32Array {
  const length = Math.round(BIRD_PHRASE_S * SAMPLE_RATE);
  const dry = new Float32Array(length);
  const take: Take = { random, pitch: between(random, 0.95, 1.05), tempo: between(random, 0.92, 1.08) };
  const notes = entry.species(take).filter((note) => LEAD_S + note.at + note.seconds <= BIRD_PHRASE_S - TAIL_ROOM_S);
  for (const note of notes) addNote(dry, { ...note, at: note.at + LEAD_S }, random);
  const near = entry.far ? filtered(filtered(dry, 'lowpass', 3800), 'lowpass', 3800) : dry;
  const out = near.slice();
  mixInto(out, reverb(near, { seconds: entry.far ? 1.4 : 0.9, dampHz: 5500, predelayMs: entry.far ? 25 : 12 }), entry.far ? 0.7 : 0.22);
  let sum = 0;
  let count = 0;
  for (const value of near) {
    if (Math.abs(value) < 1e-4) continue;
    sum += value * value;
    count++;
  }
  const scaleTo = (0.12 * entry.level * (entry.far ? 0.6 : 1)) / Math.sqrt(sum / Math.max(1, count));
  const fade = Math.round(TAIL_FADE_S * SAMPLE_RATE);
  for (let i = 0; i < length; i++) out[i]! *= scaleTo * Math.min(1, (length - i) / fade);
  return out;
}

// La banque : les phrases bout à bout, une par case de BIRD_PHRASE_S secondes, mono, à SAMPLE_RATE, son pic à -3 dB.
export function birdsong(seed = 2604): Float32Array {
  const random = seeded(seed);
  const length = Math.round(BIRD_PHRASE_S * SAMPLE_RATE);
  const bank = new Float32Array(length * BANK.length);
  BANK.forEach((entry, i) => bank.set(phrase(entry, random), i * length));
  return normalizePeak(bank, -3);
}
