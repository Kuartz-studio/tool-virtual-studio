// Le bassin du jardin, fabriqué ici : une eau calme qui clapote contre les pierres de sa bordure, et non un filet d'eau qui coule (le ruissellement du pack,
// continu et aigu, faisait penser à tout autre chose). Une boucle sans raccord de POND_SECONDS secondes, toujours la même (une graine fixe) :
//   - des vaguelettes qui viennent mourir sur les pierres, une toutes les une à trois secondes, parfois suivies de leur reflet. Une eau qui bouge, ce n'est
//     pas un souffle : c'est une foule de petites bulles qui naissent et s'ouvrent. Chaque vaguelette est donc un nuage de bulles (de 600 à 2 600 Hz, chacune
//     une note pure qui monte un peu et s'éteint en quelques millièmes de seconde) qui enfle puis retombe, sur un frottement grave d'eau remuée ;
//   - le reflux : un ou deux « gloup » graves, quand l'eau se retire d'entre deux pierres ;
//   - de temps en temps, un « ploc » : une goutte, un poisson qui happe une mouche ;
//   - le fond : un murmure très bas, presque rien, qui lie le tout ;
//   - et, très bas derrière, le ruissellement du pack (`bed`, sa boucle de 3,7 s), comme un filet d'eau qui coule un peu plus loin.
// Le tout étouffé (les aigus des bulles adoucis, le ruissellement plus encore) : on l'entend de quelques pas, pas l'oreille au-dessus de l'eau. Entre deux
// vaguelettes, presque rien que le filet lointain : c'est ce qui fait un bassin, et non un ruisseau. Tout est posé sur un temps circulaire (ce qui dépasse la fin
// revient au début), et filtres et réverbération passent deux fois (synth.ts).
import { between, filtered, mixInto, normalizePeak, reverb, SAMPLE_RATE, seeded } from './synth';

// La boucle du bassin : six fois celle du ruissellement du pack (3,7 s), pour qu'il tombe juste dedans (écrite telle quelle : 6 × 3,7 ne tombe pas juste en
// nombres à virgule).
export const POND_BED_SECONDS = 3.7;
export const POND_SECONDS = 22.2;
// Les aigus coupés : au-dessus de POND_MUFFLE_HZ pour le clapotis, de BED_MUFFLE_HZ pour le ruissellement ; et le ruissellement, BED_BELOW_DB sous le niveau
// moyen du clapotis.
const POND_MUFFLE_HZ = 1400;
const BED_MUFFLE_HZ = 700;
const BED_BELOW_DB = 9;

const rms = (samples: Float32Array): number => Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);

// Ajoute `source` à `into` à partir de l'échantillon `start` : ce qui dépasse la fin revient au début.
function addAt(into: Float32Array, start: number, source: Float32Array): void {
  for (let i = 0; i < source.length; i++) into[(start + i) % into.length]! += source[i]!;
}

// Une bulle : une note pure qui monte un peu en s'éteignant vite (elle remonte et s'ouvre). `hz` sa hauteur, `tau` (s) le temps de sa décroissance, `rise`
// de combien elle monte (en part de sa hauteur, atteinte en trois `tau`). Une attaque de deux millisecondes : douce, sans clic.
function addBubble(into: Float32Array, at: number, hz: number, tau: number, level: number, rise: number): void {
  const start = ((Math.round(at * SAMPLE_RATE) % into.length) + into.length) % into.length;
  const length = Math.round(tau * 6 * SAMPLE_RATE);
  const bubble = new Float32Array(length);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    phase += (2 * Math.PI * hz * (1 + (rise * Math.min(t, 3 * tau)) / (3 * tau))) / SAMPLE_RATE;
    bubble[i] = level * (1 - Math.exp(-t / 0.002)) * Math.exp(-t / tau) * Math.sin(phase);
  }
  addAt(into, start, bubble);
}

// Le frottement de l'eau remuée : un bruit filtré dans le grave (une bande autour de `hz`), qui enfle en `attack` s puis retombe en `tau` s.
function addSwish(into: Float32Array, at: number, attack: number, tau: number, level: number, hz: number, random: () => number): void {
  const length = Math.round((attack + 6 * tau) * SAMPLE_RATE);
  const noise = new Float32Array(length);
  for (let i = 0; i < length; i++) noise[i] = random() * 2 - 1;
  const band = filtered(filtered(noise, 'bandpass', hz, { q: 0.9 }), 'lowpass', hz * 2.5);
  const rising = attack * SAMPLE_RATE;
  for (let i = 0; i < length; i++) {
    const envelope = i < rising ? 0.5 - 0.5 * Math.cos((Math.PI * i) / rising) : Math.exp(-(i - rising) / (tau * SAMPLE_RATE));
    band[i] = band[i]! * envelope * level;
  }
  addAt(into, Math.round(at * SAMPLE_RATE), band);
}

// Une vaguelette qui meurt sur les pierres, de force `strength` (de 0 à 1) : son frottement, son nuage de bulles (serré vers sa crête, puis qui s'égrène),
// et son reflux.
function addLap(into: Float32Array, at: number, strength: number, random: () => number): void {
  const attack = between(random, 0.08, 0.16);
  const tau = between(random, 0.16, 0.3);
  addSwish(into, at, attack, tau, 0.13 * strength, between(random, 280, 480), random);
  const count = Math.round(between(random, 60, 100) * strength);
  for (let k = 0; k < count; k++) {
    const crest = at + attack * Math.sqrt(random());
    const when = random() < 0.55 ? crest + tau * -Math.log(1 - 0.9 * random()) * 0.7 : crest;
    const hz = 2 ** between(random, Math.log2(600), Math.log2(2600));
    addBubble(into, when, hz, between(random, 4, 9) / hz, between(random, 0.03, 0.09) * strength, between(random, 0.1, 0.4));
  }
  const gurgles = random() < 0.6 ? 1 : 2;
  for (let g = 0; g < gurgles; g++) {
    const hz = between(random, 170, 380);
    addBubble(into, at + attack + between(random, 0.15, 0.45), hz, between(random, 6, 12) / hz, between(random, 0.045, 0.09) * strength, between(random, 0.15, 0.4));
  }
}

// Un « ploc » : un petit choc sourd, puis une bulle qui monte nettement (la goutte qui entre dans l'eau).
function addPlop(into: Float32Array, at: number, level: number, random: () => number): void {
  addSwish(into, at, 0.002, 0.006, 0.3 * level, 900, random);
  const hz = between(random, 380, 950);
  addBubble(into, at + 0.004, hz, between(random, 12, 22) / hz, level, between(random, 0.3, 0.6));
}

// `bed` : le ruissellement, une boucle de POND_BED_SECONDS (sans lui, le clapotis seul).
export function pond(seed = 7, bed?: Float32Array): Float32Array {
  const random = seeded(seed);
  const length = Math.round(POND_SECONDS * SAMPLE_RATE);
  const water = new Float32Array(length);

  // Les vaguelettes : irrégulières, une sur trois suivie de son reflet, plus faible ; rien dans la dernière seconde, pour que la boucle garde son souffle.
  for (let t = between(random, 0.2, 0.6); t < POND_SECONDS - 1; t += between(random, 1.1, 2.9)) {
    const strength = between(random, 0.55, 1);
    addLap(water, t, strength, random);
    if (random() < 0.35) addLap(water, t + between(random, 0.18, 0.35), strength * between(random, 0.35, 0.6), random);
  }
  // Les « ploc », de loin en loin ; parfois deux à la suite (le poisson).
  for (let t = between(random, 1, 3); t < POND_SECONDS - 1; t += between(random, 3.5, 8)) {
    const level = between(random, 0.07, 0.12);
    addPlop(water, t, level, random);
    if (random() < 0.25) addPlop(water, t + between(random, 0.09, 0.16), level * 0.6, random);
  }

  // Le murmure du fond : un bruit très grave, qui ondule lentement (trois fois par boucle : elle tombe juste).
  const murmur = new Float32Array(length);
  for (let i = 0; i < length; i++) murmur[i] = random() * 2 - 1;
  const low = filtered(filtered(murmur, 'lowpass', 240, { circular: true }), 'lowpass', 240, { circular: true });
  for (let i = 0; i < length; i++) low[i] = low[i]! * (0.7 + 0.3 * Math.sin((2 * Math.PI * 3 * i) / length));
  mixInto(water, normalizePeak(low, -32));

  // Un peu d'espace (les pierres, le jardin autour), le très grave retiré, les aigus étouffés.
  mixInto(water, reverb(water, { seconds: 0.5, dampHz: 2500, predelayMs: 8, circular: true }), 0.18);
  const muffled = (samples: Float32Array, hz: number) => filtered(filtered(samples, 'lowpass', hz, { circular: true }), 'lowpass', hz, { circular: true });
  const clean = muffled(filtered(water, 'highpass', 70, { circular: true }), POND_MUFFLE_HZ);
  if (bed) {
    if (bed.length * 6 !== length) throw new Error(`Le ruissellement doit faire ${POND_BED_SECONDS} s : ${bed.length} échantillons pour ${length / 6}.`);
    const stream = muffled(Float32Array.from({ length }, (_, i) => bed[i % bed.length]!), BED_MUFFLE_HZ);
    mixInto(clean, stream, (rms(clean) * 10 ** (-BED_BELOW_DB / 20)) / Math.max(rms(stream), 1e-9));
  }
  return normalizePeak(clean, -3);
}
