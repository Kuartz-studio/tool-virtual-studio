// Les insectes de la nuit, fabriqués ici : les packs de sons n'en ont pas. Une boucle sans raccord de INSECTS_SECONDS secondes, toujours la même (une
// graine fixe), qui doit sonner comme un jardin la nuit, pas comme des bips :
//   - des grillons des champs, deux tout près et trois un peu plus loin : chacun chante à sa hauteur (entre 4,2 et 5 kHz) des « cri-cri » de trois à
//     cinq impulsions très courtes (15 ms, une note pure qui glisse un peu vers le grave, avec ses harmoniques), plus ou moins vite, par séries
//     entrecoupées de silences ;
//   - un grillon d'arbre, plus loin, qui trille sans s'arrêter vers 3 kHz (une quarantaine d'impulsions par seconde), par longues séries ;
//   - un chœur lointain : une vingtaine de grillons, très bas, que la distance et la réverbération fondent en un tapis qui scintille ;
//   - l'air de la nuit : un souffle grave, à peine audible, qui lie le tout.
// Pour que la boucle n'ait pas de raccord, tout est posé sur un temps circulaire : chaque chanteur a un rythme dont un nombre entier de périodes tient dans
// la boucle (seules ses petites irrégularités changent d'un chant à l'autre), la queue d'une impulsion qui dépasse la fin revient au début, et filtres et
// réverbération passent deux fois (synth.ts).
import { between, filtered, mixInto, normalizePeak, reverb, SAMPLE_RATE, seeded } from './synth';

export const INSECTS_SECONDS = 20;

// La forme d'une impulsion : une montée en douceur sur le premier quart, puis une descente plus longue ; u va de 0 à 1.
function pulseEnvelope(u: number): number {
  const attack = 0.25;
  return u < attack ? 0.5 - 0.5 * Math.cos((Math.PI * u) / attack) : 0.5 + 0.5 * Math.cos((Math.PI * (u - attack)) / (1 - attack));
}

interface Pulse {
  // Le début (s), la durée (s), la hauteur (Hz) et le niveau (amplitude) de l'impulsion.
  at: number;
  seconds: number;
  hz: number;
  level: number;
  // La glissade vers le grave pendant l'impulsion (fraction de la hauteur) ; les harmoniques 2 et 3 (fractions du fondamental).
  glide: number;
  harmonics: [number, number];
}

// Ajoute une impulsion dans la boucle : ce qui dépasse la fin revient au début.
function addPulse(into: Float32Array, pulse: Pulse, random: () => number): void {
  const start = Math.round(pulse.at * SAMPLE_RATE);
  const length = Math.max(8, Math.round(pulse.seconds * SAMPLE_RATE));
  let phase = random() * 2 * Math.PI;
  for (let i = 0; i < length; i++) {
    const u = i / length;
    phase += (2 * Math.PI * pulse.hz * (1 + pulse.glide * (0.5 - u))) / SAMPLE_RATE;
    const tone = Math.sin(phase) + pulse.harmonics[0] * Math.sin(2 * phase) + pulse.harmonics[1] * Math.sin(3 * phase);
    const index = (start + i) % into.length;
    into[index]! += pulse.level * pulseEnvelope(u) * tone;
  }
}

// Un chanteur : où il chante, à quel rythme, et comment.
interface Singer {
  hz: number;
  level: number;
  // Le temps entre deux chants (s), avant qu'il soit ajusté pour qu'un nombre entier de chants tienne dans la boucle.
  period: number;
  // Les impulsions d'un chant : leur nombre, leur durée et l'écart entre leurs débuts (s).
  pulses: number;
  pulseSeconds: number;
  pulseGap: number;
  // Les séries : la part de chants chantés (le reste, des silences, groupés) et la longueur moyenne d'une série, en chants ; `ramp` : en combien de chants
  // une série monte à son niveau (un trille ne démarre pas d'un coup).
  singing: number;
  run: number;
  ramp: number;
  glide: number;
  harmonics: [number, number];
}

// Le profil d'un « cri-cri » : la deuxième impulsion est la plus forte, les dernières s'éteignent un peu.
const CHIRP_SHAPE = [0.72, 1, 0.94, 0.82, 0.66];

// Les chants d'un chanteur, sur toute la boucle. Le rythme est une grille (un nombre entier de périodes dans la boucle) : un chant manquant laisse un
// silence, une irrégularité décale un chant d'un peu, mais rien ne s'accumule, et la fin de la boucle enchaîne sur son début au même rythme.
function sing(into: Float32Array, singer: Singer, random: () => number): void {
  const seconds = into.length / SAMPLE_RATE;
  const count = Math.max(1, Math.round(seconds / singer.period));
  const period = seconds / count;
  const offset = random() * period;
  // Chantera-t-il ce chant ? Des séries de chants et des séries de silences, de longueurs au hasard.
  let singingNow = random() < singer.singing;
  let left = Math.ceil(random() * singer.run);
  let sung = singer.ramp;
  for (let k = 0; k < count; k++) {
    if (left-- <= 0) {
      const was = singingNow;
      singingNow = random() < singer.singing;
      if (singingNow && !was) sung = 0;
      left = Math.ceil(between(random, 0.4, 1.6) * (singingNow ? singer.run : singer.run * (1 - singer.singing) * 2));
    }
    if (!singingNow) continue;
    const at = offset + k * period + between(random, -0.04, 0.04) * period;
    const level = singer.level * between(random, 0.82, 1.08) * Math.min(1, ++sung / singer.ramp);
    for (let p = 0; p < singer.pulses; p++) {
      addPulse(
        into,
        {
          at: at + p * singer.pulseGap * between(random, 0.96, 1.04),
          seconds: singer.pulseSeconds * between(random, 0.92, 1.08),
          hz: singer.hz * between(random, 0.996, 1.004),
          level: level * (CHIRP_SHAPE[Math.min(p, CHIRP_SHAPE.length - 1)] ?? 1) * between(random, 0.88, 1.06),
          glide: singer.glide,
          harmonics: singer.harmonics,
        },
        random,
      );
    }
  }
}

// Un grillon des champs : des « cri-cri » de trois à cinq impulsions, un à trois par seconde.
function fieldCricket(random: () => number, hz: number, level: number): Singer {
  return {
    hz,
    level,
    period: between(random, 0.38, 0.72),
    pulses: 3 + Math.floor(random() * 3),
    pulseSeconds: between(random, 0.013, 0.018),
    pulseGap: between(random, 0.028, 0.036),
    singing: between(random, 0.75, 0.92),
    run: between(random, 8, 20),
    ramp: 1,
    glide: between(random, 0.025, 0.045),
    harmonics: [between(random, 0.04, 0.08), between(random, 0.01, 0.025)],
  };
}

// Le grillon d'arbre : une seule impulsion par « chant », mais une quarantaine par seconde, par longues séries (un trille).
function treeCricket(random: () => number, hz: number, level: number): Singer {
  return {
    hz,
    level,
    period: between(random, 0.021, 0.025),
    pulses: 1,
    pulseSeconds: between(random, 0.011, 0.013),
    pulseGap: 0,
    singing: 0.82,
    run: between(random, 180, 300),
    ramp: 14,
    glide: 0.02,
    harmonics: [0.05, 0.01],
  };
}

// L'air de la nuit : un souffle grave et très bas, qui ondule lentement (deux fois par boucle : l'ondulation aussi boucle).
function nightAir(length: number, random: () => number): Float32Array {
  const noise = new Float32Array(length);
  for (let i = 0; i < length; i++) noise[i] = random() * 2 - 1;
  const air = filtered(filtered(noise, 'lowpass', 700, { circular: true }), 'highpass', 90, { circular: true });
  for (let i = 0; i < length; i++) air[i]! *= 1 + 0.35 * Math.sin((2 * Math.PI * 2 * i) / length);
  return air;
}

// La boucle des insectes : INSECTS_SECONDS secondes, mono, à SAMPLE_RATE, son pic à -3 dB.
export function nightInsects(seed = 1931, seconds = INSECTS_SECONDS): Float32Array {
  const random = seeded(seed);
  const length = Math.round(seconds * SAMPLE_RATE);
  const near = new Float32Array(length);
  const middle = new Float32Array(length);
  const far = new Float32Array(length);

  // Deux grillons tout près, à des hauteurs bien distinctes ; trois un peu plus loin.
  sing(near, fieldCricket(random, 4720, 0.4), random);
  sing(near, fieldCricket(random, 4330, 0.28), random);
  for (const hz of [4880, 4510, 4190]) sing(middle, fieldCricket(random, hz * between(random, 0.99, 1.01), between(random, 0.1, 0.16)), random);
  // Le grillon d'arbre, et le chœur lointain.
  sing(middle, treeCricket(random, between(random, 2950, 3150), 0.07), random);
  for (let i = 0; i < 22; i++) sing(far, fieldCricket(random, between(random, 3700, 5300), between(random, 0.012, 0.04)), random);

  const out = new Float32Array(length);
  // Près : le son direct, un peu de jardin autour. Plus loin : moins d'aigus, plus de réverbération. Le chœur : presque toute en réverbération.
  mixInto(out, near);
  mixInto(out, reverb(near, { seconds: 0.7, dampHz: 6000, predelayMs: 12, circular: true }), 0.5);
  const softened = filtered(middle, 'lowpass', 7500, { circular: true });
  mixInto(out, softened, 0.85);
  mixInto(out, reverb(softened, { seconds: 1.1, dampHz: 5000, predelayMs: 20, circular: true }), 0.9);
  const distant = filtered(far, 'lowpass', 6000, { circular: true });
  mixInto(out, distant, 0.5);
  mixInto(out, reverb(distant, { seconds: 1.8, dampHz: 4500, predelayMs: 30, circular: true }), 1.6);
  mixInto(out, nightAir(length, random), 0.025);
  return normalizePeak(out, -3);
}
