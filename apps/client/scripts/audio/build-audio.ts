// Range les sons dans l'appli : `pnpm --filter @bureau/client gen:audio [boucles d'Abstraction] [effets] [boucles pirates]`, ou les effets seulement :
// `pnpm --filter @bureau/client gen:audio --effets [effets]` (les boucles ne sont pas refaites, leurs mesures restent celles du fichier généré), ou la nature
// seulement : `pnpm --filter @bureau/client gen:audio --nature [effets]` (ni les boucles ni les effets ne sont refaits).
//   public/assets/audio/music/   une boucle par ambiance, en .ogg (Vorbis) et en .m4a (AAC, pour Safari)
//   public/assets/audio/sfx/     un .wav par effet sonore
//   public/assets/audio/nature/  les bruits de la nature (l'eau, les insectes, les oiseaux, le vent), en .ogg et en .m4a comme la musique
//   src/audio/measured.generated.ts   le volume de chacun, mesuré, pour que toutes les ambiances sonnent aussi fort, et tous les effets de même
// Les boucles et les effets ne sont pas copiés tels quels : ce script les lit là où ils sont (leurs dossiers de téléchargement), garde
// ce qu'il faut, et ce qu'il écrit est commité. Il a besoin de ffmpeg et de ffprobe, et de sox pour encoder les boucles .wav en Vorbis (ffmpeg
// n'a souvent que son encodeur Vorbis expérimental, de piètre qualité).
//   - Boucles : « Music Loop Bundle » d'Abstraction, dossier MUSIC_SRC ; « Pirate Music Pack Vol. 2 », ses versions Loop, dossier PIRATE_MUSIC_SRC.
//   - Effets : « 400 Sounds Pack », dossier SFX_SRC ; la nature y prend l'eau et le vent, et fabrique le reste.
// Le dossier se donne en argument, ou par la variable d'environnement ; à défaut, celui du dossier Téléchargements.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import type { MusicScene } from '@bureau/shared';
import { MEASURED_MUSIC, MEASURED_NATURE, MEASURED_SFX } from '../../src/audio/measured.generated';
import { NATURE_LOOP_MARGIN_S } from '../../src/audio/nature';
import { birdsong } from './birdsong';
import { INSECTS_SECONDS, nightInsects } from './night-insects';
import { POND_BED_SECONDS, POND_SECONDS, pond } from './pond';
import { crossfadeLoop, normalizePeak, peakOf, SAMPLE_RATE, withLoopMargins, writeWav } from './synth';

export const AUDIO_DIR = resolve(import.meta.dirname, '../../public/assets/audio');
export const MEASURED_FILE = resolve(import.meta.dirname, '../../src/audio/measured.generated.ts');

// Les packs de boucles, chacun dans son dossier : la variable d'environnement qui le donne et, à défaut, son chemin dans Téléchargements.
export const MUSIC_PACKS = {
  // Des .ogg (Vorbis), dont le flux est recopié tel quel.
  abstraction: { env: 'MUSIC_SRC', downloads: 'music-loop-bundle-2026-q2' },
  // Des .wav 44,1 kHz, les versions « Loop » (pas « Tracks ») : encodés ici.
  pirate: { env: 'PIRATE_MUSIC_SRC', downloads: join('Pirate Music Pack Vol. 2', 'Loops', 'wav') },
} as const;

export type MusicPack = keyof typeof MUSIC_PACKS;

// Les ambiances : l'identifiant de l'ambiance (le nom des fichiers, src/audio/catalog.ts), son pack et sa boucle d'origine. Toutes y sont, thème par
// thème (`satisfies` fait échouer la compilation s'il en manque une).
export const MUSIC_SOURCES = {
  focus: { pack: 'abstraction', file: 'Week 26 - Seaside CORAL REEF.ogg' },
  drift: { pack: 'abstraction', file: 'Week 13 - Primordial Soup JANGLES.ogg' },
  sunny: { pack: 'abstraction', file: 'Week 15 - Sunburn BEACH HOUSE.ogg' },
  lobby: { pack: 'abstraction', file: 'Week 18 - Distant Skyline NIGHT DRIVE.ogg' },
  dusk: { pack: 'abstraction', file: 'Week 19 - Dark Portents MYSTERIOUS TRAVELER.ogg' },
  quest: { pack: 'abstraction', file: 'Week 22 - The Walking Dunes EVENING OASIS.ogg' },
  'silent-harbor': { pack: 'pirate', file: '1. Silent Harbor (Loop).wav' },
  'hidden-booty': { pack: 'pirate', file: '2. Hidden Booty (Loop).wav' },
  'oceans-grasp': { pack: 'pirate', file: '3. Ocean’s Grasp (Loop).wav' },
  'drunken-sailors': { pack: 'pirate', file: '4. Drunken Sailors (Loop).wav' },
  'blackened-tide': { pack: 'pirate', file: '5. Blackened Tide (Loop).wav' },
  'windward-chase': { pack: 'pirate', file: '6. Windward Chase (Loop).wav' },
  'sea-wolves': { pack: 'pirate', file: '7. Sea Wolves (Loop).wav' },
  'black-flag-rise': { pack: 'pirate', file: '8. Black Flag Rise (Loop).wav' },
  'tempest-call': { pack: 'pirate', file: '9. Tempest Call (Loop).wav' },
  'foggy-shores': { pack: 'pirate', file: '10. Foggy Shores (Loop).wav' },
} as const satisfies Record<MusicScene, { pack: MusicPack; file: string }>;

// L'encodage d'une boucle qui n'est pas déjà en Vorbis : la qualité 5 de libvorbis (autour de 160 kbit/s) ; l'AAC de Safari est au même débit.
export const VORBIS_QUALITY = 5;
export const AAC_BITRATE = '160k';

// Les effets : l'identifiant de l'effet (le nom du fichier) et son fichier dans le pack (dossier/nom). Les petits bruits de l'interface
// viennent de son dossier UI, les jingles des événements de Musical Effects (tous au vibraphone, pour rester de la même famille), les portes et les
// serrures de Environment, le café, l'élan et la téléportation de Other, les dés et les pions de Card and Board, la carte du bureau qu'on déplie et qu'on
// replie de Items ; le survol et le double-clic qui envoie l'avatar quelque part, deux petits chocs mats de Materials (un bouchon, du carton), étouffés
// (SFX_MUFFLES) : ceux de UI, l'un remonté de très bas, l'autre très aigu, étaient « agressifs, pas agréables du tout » (Andrea, le 31 octobre) ; la gemme
// qui tourne sur la case où l'on court, une note de boîte à musique de Musical Effects, adoucie elle aussi ; la voix de l'administratrice de l'accueil, qui
// parle pendant que sa réplique s'écrit, un petit « bip » de Retro, étouffé ; une fenêtre qui se ferme, un livre qu'on referme de Items, étouffé. La carte
// qui se déplie (« un peu violente ») et se replie est adoucie de même.
export const SFX_SOURCES = {
  click: 'UI/select_2.wav',
  'toggle-on': 'UI/toggle_on.wav',
  'toggle-off': 'UI/toggle_off.wav',
  'panel-open': 'UI/pop_3.wav',
  'panel-close': 'UI/pop_1.wav',
  'conversation-start': 'UI/pop_2.wav',
  'conversation-end': 'UI/pop_4.wav',
  cancel: 'UI/cancel.wav',
  welcome: 'Musical Effects/vibraphone_level_start.wav',
  arrive: 'Musical Effects/vibraphone_chime_quick.wav',
  message: 'Musical Effects/vibraphone_chime_positive.wav',
  success: 'Musical Effects/vibraphone_positive_long.wav',
  error: 'Musical Effects/vibraphone_negative_quick.wav',
  lost: 'Musical Effects/vibraphone_negative_long.wav',
  knock: 'Other/subtle_knock.wav',
  'door-open': 'Environment/door_open.wav',
  'door-close': 'Environment/door_close.wav',
  lock: 'Environment/lock_lock.wav',
  unlock: 'Environment/lock_unlock.wav',
  coffee: 'Other/drink_slurp.wav',
  boost: 'Other/whoosh_2.wav',
  teleport: 'Other/whoosh_1.wav',
  dice: 'Card and Board/dice_roll_1.wav',
  piece: 'Card and Board/chips_place_1.wav',
  win: 'Other/applause.wav',
  // La progression : une mission reçue (un air de mystère), une tâche cochée (une gemme ramassée), un niveau gagné (la fin de niveau du vibraphone, comme
  // l'arrivée au bureau), des kuartzons dépensés à la boutique.
  mission: 'Musical Effects/vibraphone_mystery.wav',
  xp: 'Items/gem_collect.wav',
  'level-up': 'Musical Effects/vibraphone_level_complete.wav',
  coins: 'Items/coins_gather_medium.wav',
  'map-open': 'Items/map_open.wav',
  'map-close': 'Items/map_close.wav',
  waypoint: 'Materials/cardboard_hit.wav',
  hover: 'Materials/cork_stabbed.wav',
  gem: 'Musical Effects/music_box_chime_quick.wav',
  voice: 'Retro/menu_blip.wav',
  'modal-close': 'Items/book_close.wav',
} as const;

// Les effets trop longs pour ce qu'ils annoncent : écourtés à `seconds`, avec une extinction sur les `fadeSeconds` dernières secondes. Les
// applaudissements de la victoire durent plus de dix secondes dans le pack.
export const SFX_TRIMS: Partial<Record<keyof typeof SFX_SOURCES, { seconds: number; fadeSeconds: number }>> = {
  win: { seconds: 3.5, fadeSeconds: 0.8 },
};

// Les effets qu'on étouffe : un passe-bas (deux fois, pour une pente plus raide) à `lowpassHz`, et une attaque adoucie sur `attackSeconds`, pour qu'un bruit
// qui revient souvent (le survol) reste doux.
export const SFX_MUFFLES: Partial<Record<keyof typeof SFX_SOURCES, { lowpassHz: number; attackSeconds: number }>> = {
  hover: { lowpassHz: 1100, attackSeconds: 0.006 },
  waypoint: { lowpassHz: 1400, attackSeconds: 0.004 },
  gem: { lowpassHz: 3500, attackSeconds: 0.012 },
  voice: { lowpassHz: 1800, attackSeconds: 0.004 },
  'modal-close': { lowpassHz: 1800, attackSeconds: 0.004 },
  'map-open': { lowpassHz: 2400, attackSeconds: 0.03 },
  'map-close': { lowpassHz: 2400, attackSeconds: 0.02 },
};

// La nature (src/audio/nature.ts) : le vent vient du dossier Environment du « 400 Sounds Pack » (celui des effets), mono dans un fichier stéréo ; l'eau
// du bassin, les insectes de la nuit et le chant des oiseaux sont fabriqués (pond.ts, night-insects.ts, birdsong.ts) : seul, le ruissellement continu du
// pack faisait penser à tout autre chose qu'un bassin (il n'est plus qu'un filet lointain sous le clapotis : `bed`), le pack n'a pas d'insectes, et
// « Birds SFX » (Cinematic Sound Effects) est un vol d'oiseaux qui s'envole, pas un chant. `loop` : une boucle, de cette période (s, un multiple de 10 ms,
// pour tomber juste en échantillons). Le vent est lu par coups, les oiseaux par phrases.
export const NATURE_SOURCES = {
  water: { synth: 'pond', bed: 'Environment/water_babbling_loop.wav', loop: POND_SECONDS },
  insects: { synth: 'insects', loop: INSECTS_SECONDS },
  birds: { synth: 'birds' },
  wind: { file: 'Environment/ambient_wind.wav' },
  // Deux motos qui passent à 90 km/h sur une route (BigSoundBank n° 906, enregistrée dehors, effet Doppler compris), rangée à côté du pack.
  moto: { file: '../BigSoundBank/0906-2-motorcycle-passing.wav' },
} as const;

type NatureSoundId = keyof typeof NATURE_SOURCES;

// Ils sont mono (le lecteur les place dans la stéréo) : un débit plus petit que la musique suffit.
export const NATURE_VORBIS_QUALITY = 4;
export const NATURE_AAC_BITRATE = '80k';

// Le filtre ffmpeg qui étouffe un effet.
export function muffleFilter({ lowpassHz, attackSeconds }: { lowpassHz: number; attackSeconds: number }): string {
  return `lowpass=f=${lowpassHz},lowpass=f=${lowpassHz},afade=t=in:d=${attackSeconds}`;
}

// Le filtre ffmpeg d'une extinction sur la fin d'un son écourté.
export function fadeOutFilter({ seconds, fadeSeconds }: { seconds: number; fadeSeconds: number }): string {
  return `afade=t=out:st=${round(seconds - fadeSeconds, 3)}:d=${fadeSeconds}`;
}

// Les niveaux visés. Une ambiance est ramenée à ce volume intégré (LUFS) quand le curseur est à fond, et jamais au-dessus de ce pic ; un
// effet, à ce niveau RMS de son moment le plus fort (dB, par rapport au maximum numérique) : ses fichiers vont de très doux à très forts.
export const MUSIC_TARGET_LUFS = -16;
export const SFX_TARGET_RMS_DB = -18;
export const MAX_PEAK_DB = -1;
// On ne monte ni ne baisse un effet de plus que cela : au-delà, le fichier est le problème, pas le niveau.
const SFX_MAX_CORRECTION_DB = 12;

export interface Measured {
  gain: number;
  seconds: number;
}

export interface MeasuredAudio {
  music: Record<keyof typeof MUSIC_SOURCES, Measured>;
  sfx: Record<keyof typeof SFX_SOURCES, Measured>;
  // seconds : pour une boucle, sa période (le fichier a ses marges en plus).
  nature: Record<NatureSoundId, Measured>;
}

// ---- Mesures --------------------------------------------------------------------------------------------------------------------

// Le dernier nombre qui suit ce motif dans la sortie de ffmpeg.
function lastNumber(text: string, pattern: RegExp): number | null {
  let found: number | null = null;
  for (const match of text.matchAll(pattern)) found = Number(match[1]);
  return found;
}

// Le volume intégré (LUFS) et le pic (dBFS) d'un son, d'après le bilan du filtre ebur128 de ffmpeg (peak=true).
export function parseLoudness(report: string): { loudness: number; peak: number } {
  const loudness = lastNumber(report, /^\s*I:\s+(-?\d+(?:\.\d+)?) LUFS/gm);
  const peak = lastNumber(report, /^\s*Peak:\s+(-?\d+(?:\.\d+)?) dBFS/gm);
  if (loudness === null || peak === null) throw new Error('Bilan ebur128 illisible : ffmpeg a changé de format ?');
  return { loudness, peak };
}

// Le pic et le niveau RMS du moment le plus fort (dB) d'un son, d'après le bloc « Overall » du filtre astats.
export function parseLevels(report: string): { peak: number; rmsPeak: number } {
  const overall = report.slice(report.lastIndexOf('Overall'));
  const peak = lastNumber(overall, /Peak level dB:\s+(-?\d+(?:\.\d+)?)/g);
  const rmsPeak = lastNumber(overall, /RMS peak dB:\s+(-?\d+(?:\.\d+)?)/g);
  if (peak === null || rmsPeak === null) throw new Error('Bilan astats illisible : ffmpeg a changé de format ?');
  return { peak, rmsPeak };
}

const fromDb = (db: number): number => 10 ** (db / 20);
const round = (value: number, digits: number): number => Math.round(value * 10 ** digits) / 10 ** digits;

// Le gain (rapport d'amplitude, 1 = inchangé) qui ramène une ambiance à MUSIC_TARGET_LUFS, sans que son pic dépasse MAX_PEAK_DB.
export function musicGain({ loudness, peak }: { loudness: number; peak: number }): number {
  const correction = Math.min(MUSIC_TARGET_LUFS - loudness, MAX_PEAK_DB - peak);
  return round(fromDb(correction), 3);
}

// Le gain d'un bruit de la nature : au même volume intégré que les ambiances, sans limite de pic. Elle ne joue jamais près du maximum (ses niveaux,
// NATURE_LEVELS dans src/audio/nature.ts, sont tous à -12 dB ou moins), et l'eau qui bouillonne ou le vent, très crêtés, resteraient sinon bien trop bas.
export function natureGain(loudness: number): number {
  return round(fromDb(MUSIC_TARGET_LUFS - loudness), 3);
}

// Le gain d'un effet : son moment le plus fort à SFX_TARGET_RMS_DB, sans que son pic dépasse MAX_PEAK_DB.
export function sfxGain({ peak, rmsPeak }: { peak: number; rmsPeak: number }): number {
  const wanted = Math.max(-SFX_MAX_CORRECTION_DB, Math.min(SFX_MAX_CORRECTION_DB, SFX_TARGET_RMS_DB - rmsPeak));
  return round(fromDb(Math.min(wanted, MAX_PEAK_DB - peak)), 3);
}

// ---- ffmpeg ---------------------------------------------------------------------------------------------------------------------

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-v', 'error', '-nostats', '-hide_banner', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
}

// Le bilan d'un filtre d'analyse : ffmpeg l'écrit sur stderr, que Node ne rend qu'avec spawnSync.
function analyse(file: string, filter: string): string {
  const run = spawnSync('ffmpeg', ['-nostats', '-hide_banner', '-i', file, '-af', filter, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (run.status !== 0) throw new Error(`ffmpeg n'a pas pu analyser ${file} : ${run.stderr}`);
  return run.stderr;
}

function duration(file: string): number {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return round(Number(out.trim()), 3);
}

// ---- Fabrication ----------------------------------------------------------------------------------------------------------------

export function defaultMusicSource(pack: MusicPack): string {
  const { env, downloads } = MUSIC_PACKS[pack];
  return process.env[env] ?? join(homedir(), 'Downloads', downloads);
}

export function defaultSfxSource(): string {
  return process.env.SFX_SRC ?? join(homedir(), 'Downloads', '400 Sounds Pack');
}

function requireFile(path: string): string {
  if (!existsSync(path)) throw new Error(`Fichier introuvable : ${path}`);
  return path;
}

// La commande sox qui encode une boucle en Ogg Vorbis, sans étiquettes (pas même le « Processed by SoX » qu'il écrit d'ordinaire).
export function vorbisArgs(source: string, ogg: string, quality = VORBIS_QUALITY): string[] {
  return [source, '--comment', '', '-C', String(quality), ogg];
}

// Une ambiance, en deux copies. L'ogg : une boucle déjà en Vorbis est recopiée sans sa pochette ni ses étiquettes (le flux audio tel quel, donc le son
// est identique à l'échantillon près, et la boucle reste sans coupure) ; une autre (un .wav) est encodée en Vorbis, qui garde sa durée exacte. Puis une
// copie en AAC pour Safari, qui ne lit pas l'ogg. Le volume est mesuré sur la boucle d'origine.
function buildMusic(id: keyof typeof MUSIC_SOURCES, musicDirs: Record<MusicPack, string>): Measured {
  const { pack, file } = MUSIC_SOURCES[id];
  const source = requireFile(join(musicDirs[pack], file));
  const dir = join(AUDIO_DIR, 'music');
  mkdirSync(dir, { recursive: true });
  const ogg = join(dir, `${id}.ogg`);
  if (extname(source).toLowerCase() === '.ogg') ffmpeg(['-i', source, '-map', '0:a', '-map_metadata', '-1', '-c:a', 'copy', ogg]);
  else execFileSync('sox', vorbisArgs(source, ogg), { stdio: ['ignore', 'ignore', 'inherit'] });
  ffmpeg(['-i', source, '-map', '0:a', '-map_metadata', '-1', '-c:a', 'aac', '-b:a', AAC_BITRATE, '-movflags', '+faststart', join(dir, `${id}.m4a`)]);
  return { gain: musicGain(parseLoudness(analyse(source, 'ebur128=peak=true'))), seconds: duration(ogg) };
}

// Un effet : le .wav du pack, tel quel ; ou étouffé (SFX_MUFFLES), ou écourté avec une extinction (SFX_TRIMS). Le volume est mesuré sur le fichier qu'on range.
function buildSfx(id: keyof typeof SFX_SOURCES, sfxDir: string): Measured {
  const source = requireFile(join(sfxDir, SFX_SOURCES[id]));
  const dir = join(AUDIO_DIR, 'sfx');
  mkdirSync(dir, { recursive: true });
  const wav = join(dir, `${id}.wav`);
  const trim = SFX_TRIMS[id];
  const muffle = SFX_MUFFLES[id];
  const filters = [muffle && muffleFilter(muffle), trim && fadeOutFilter(trim)].filter((filter): filter is string => Boolean(filter));
  if (filters.length > 0) ffmpeg(['-i', source, ...(trim ? ['-t', String(trim.seconds)] : []), '-af', filters.join(','), '-c:a', 'pcm_s16le', wav]);
  else copyFileSync(source, wav);
  return { gain: sfxGain(parseLevels(analyse(wav, 'astats=metadata=0:reset=0'))), seconds: duration(wav) };
}

// Un son, en mono à SAMPLE_RATE, tel que ffmpeg le décode.
function decodeMono(file: string): Float32Array {
  const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

// Le son d'un bruit de la nature, mono : fabriqué, ou lu dans le pack (et, pour une boucle, sa période sans raccord). Le mono de ffmpeg (les deux côtés
// additionnés, à -3 dB chacun) et le fondu de la boucle peuvent dépasser le maximum : le pic est alors ramené à MAX_PEAK_DB.
function natureSamples(id: NatureSoundId, sfxDir: string): Float32Array {
  const source: { file?: string; synth?: string; bed?: string; loop?: number } = NATURE_SOURCES[id];
  if (source.synth === 'pond') return pond(undefined, crossfadeLoop(decodeMono(requireFile(join(sfxDir, source.bed ?? ''))), Math.round(POND_BED_SECONDS * SAMPLE_RATE)));
  if (source.synth === 'insects') return nightInsects();
  if (source.synth === 'birds') return birdsong();
  const decoded = decodeMono(requireFile(join(sfxDir, source.file ?? '')));
  const samples = source.loop === undefined ? decoded : crossfadeLoop(decoded, Math.round(source.loop * SAMPLE_RATE));
  return peakOf(samples) > fromDb(MAX_PEAK_DB) ? normalizePeak(samples, MAX_PEAK_DB) : samples;
}

// Un bruit de la nature, en deux copies comme la musique : l'ogg (Vorbis, par sox) et l'AAC pour Safari. Une boucle est rangée avec ses marges
// (withLoopMargins) ; sa durée mesurée est sa période, au millième de seconde, qui doit tomber juste en échantillons (le lecteur boucle dessus). Le volume
// est mesuré sur ce qu'on range.
function buildNature(id: NatureSoundId, sfxDir: string, scratch: string): Measured {
  const samples = natureSamples(id, sfxDir);
  const loop = 'loop' in NATURE_SOURCES[id];
  const seconds = round(samples.length / SAMPLE_RATE, 3);
  if (loop && Math.abs(seconds * SAMPLE_RATE - samples.length) > 1e-6) throw new Error(`La boucle ${id} ne tombe pas juste : ${samples.length} échantillons.`);
  const wav = join(scratch, `${id}.wav`);
  writeWav(wav, loop ? withLoopMargins(samples, Math.round(NATURE_LOOP_MARGIN_S * SAMPLE_RATE)) : samples);
  const dir = join(AUDIO_DIR, 'nature');
  mkdirSync(dir, { recursive: true });
  execFileSync('sox', vorbisArgs(wav, join(dir, `${id}.ogg`), NATURE_VORBIS_QUALITY), { stdio: ['ignore', 'ignore', 'inherit'] });
  ffmpeg(['-i', wav, '-map_metadata', '-1', '-c:a', 'aac', '-b:a', NATURE_AAC_BITRATE, '-movflags', '+faststart', join(dir, `${id}.m4a`)]);
  return { gain: natureGain(parseLoudness(analyse(wav, 'ebur128=peak=true')).loudness), seconds };
}

function buildAllNature(sfxDir: string, log: (line: string) => void): MeasuredAudio['nature'] {
  const scratch = mkdtempSync(join(tmpdir(), 'bureau-nature-'));
  try {
    const nature = {} as MeasuredAudio['nature'];
    for (const id of Object.keys(NATURE_SOURCES) as NatureSoundId[]) {
      nature[id] = buildNature(id, sfxDir, scratch);
      log(`nature ${id} : ${nature[id].seconds} s, gain ${nature[id].gain}`);
    }
    return nature;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Le fichier généré : les gains et les durées, que lit src/audio/catalog.ts.
export function renderMeasuredSource(measured: MeasuredAudio): string {
  const rows = (table: Record<string, Measured>) =>
    Object.entries(table)
      .map(([id, { gain, seconds }]) => `  ${/^[a-z]+$/.test(id) ? id : `'${id}'`}: { gain: ${gain}, seconds: ${seconds} },`)
      .join('\n');
  return [
    '// Généré par `pnpm --filter @bureau/client gen:audio` (scripts/audio/build-audio.ts) : ne pas modifier à la main.',
    '// gain : le rapport d\'amplitude qui ramène le son au niveau visé (1 = inchangé) ; seconds : sa durée.',
    '',
    'export const MEASURED_MUSIC = {',
    rows(measured.music),
    '} as const;',
    '',
    'export const MEASURED_SFX = {',
    rows(measured.sfx),
    '} as const;',
    '',
    'export const MEASURED_NATURE = {',
    rows(measured.nature),
    '} as const;',
    '',
  ].join('\n');
}

function writeMeasured(measured: MeasuredAudio): MeasuredAudio {
  mkdirSync(resolve(MEASURED_FILE, '..'), { recursive: true });
  writeFileSync(MEASURED_FILE, renderMeasuredSource(measured));
  return measured;
}

export function generateAudio(musicDirs: Record<MusicPack, string>, sfxDir: string, log: (line: string) => void = () => {}): MeasuredAudio {
  const music = {} as MeasuredAudio['music'];
  for (const id of Object.keys(MUSIC_SOURCES) as Array<keyof typeof MUSIC_SOURCES>) {
    music[id] = buildMusic(id, musicDirs);
    log(`ambiance ${id} : ${music[id].seconds} s, gain ${music[id].gain}`);
  }
  return generateSfx(music, sfxDir, log, buildAllNature(sfxDir, log));
}

// Les effets seulement : `music` (et `nature`) sont les mesures des boucles (et de la nature), reprises telles quelles dans le fichier généré.
export function generateSfx(
  music: MeasuredAudio['music'],
  sfxDir: string,
  log: (line: string) => void = () => {},
  nature: MeasuredAudio['nature'] = MEASURED_NATURE,
): MeasuredAudio {
  const sfx = {} as MeasuredAudio['sfx'];
  for (const id of Object.keys(SFX_SOURCES) as Array<keyof typeof SFX_SOURCES>) {
    sfx[id] = buildSfx(id, sfxDir);
    log(`effet ${id} : ${sfx[id].seconds} s, gain ${sfx[id].gain}`);
  }
  return writeMeasured({ music, sfx, nature });
}

// La nature seulement : les mesures des boucles et des effets sont reprises telles quelles.
export function generateNature(sfxDir: string, log: (line: string) => void = () => {}): MeasuredAudio {
  return writeMeasured({ music: MEASURED_MUSIC, sfx: MEASURED_SFX, nature: buildAllNature(sfxDir, log) });
}

// `tsx scripts/audio/build-audio.ts` s'exécute directement ; importé par un test, ce module n'écrit rien.
if (/[\\/]build-audio\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  const args = process.argv.slice(2);
  if (args[0] === '--effets') {
    generateSfx(MEASURED_MUSIC, resolve(args[1] ?? defaultSfxSource()), (line) => console.log(line));
  } else if (args[0] === '--nature') {
    generateNature(resolve(args[1] ?? defaultSfxSource()), (line) => console.log(line));
  } else {
    const [abstraction, sfx, pirate] = args;
    const musicDirs = { abstraction: resolve(abstraction ?? defaultMusicSource('abstraction')), pirate: resolve(pirate ?? defaultMusicSource('pirate')) };
    generateAudio(musicDirs, resolve(sfx ?? defaultSfxSource()), (line) => console.log(line));
  }
  console.log(`Écrit dans ${relative(process.cwd(), AUDIO_DIR)} et ${relative(process.cwd(), MEASURED_FILE)}.`);
}
