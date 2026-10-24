// Range les sons dans l'appli : `pnpm --filter @bureau/client gen:audio [boucles d'Abstraction] [effets] [boucles pirates]`.
//   public/assets/audio/music/   une boucle par ambiance, en .ogg (Vorbis) et en .m4a (AAC, pour Safari)
//   public/assets/audio/sfx/     un .wav par effet sonore
//   src/audio/measured.generated.ts   le volume de chacun, mesuré, pour que toutes les ambiances sonnent aussi fort, et tous les effets de même
// Les boucles et les effets ne sont pas copiés tels quels : ce script les lit là où ils sont (leurs dossiers de téléchargement), garde
// ce qu'il faut, et ce qu'il écrit est commité. Il a besoin de ffmpeg et de ffprobe, et de sox pour encoder les boucles .wav en Vorbis (ffmpeg
// n'a souvent que son encodeur Vorbis expérimental, de piètre qualité).
//   - Boucles : « Music Loop Bundle » d'Abstraction, dossier MUSIC_SRC ; « Pirate Music Pack Vol. 2 », ses versions Loop, dossier PIRATE_MUSIC_SRC.
//   - Effets : « 400 Sounds Pack », dossier SFX_SRC.
// Le dossier se donne en argument, ou par la variable d'environnement ; à défaut, celui du dossier Téléchargements.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import type { MusicScene } from '@bureau/shared';

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
// viennent de son dossier UI, les jingles des événements de Musical Effects (tous au vibraphone, pour rester de la même famille), les portes et
// les serrures de Environment, le café, l'élan et la téléportation de Other, les dés et les pions de Card and Board.
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
} as const;

// Les effets trop longs pour ce qu'ils annoncent : écourtés à `seconds`, avec une extinction sur les `fadeSeconds` dernières secondes. Les
// applaudissements de la victoire durent plus de dix secondes dans le pack.
export const SFX_TRIMS: Partial<Record<keyof typeof SFX_SOURCES, { seconds: number; fadeSeconds: number }>> = {
  win: { seconds: 3.5, fadeSeconds: 0.8 },
};

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
export function vorbisArgs(source: string, ogg: string): string[] {
  return [source, '--comment', '', '-C', String(VORBIS_QUALITY), ogg];
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

// Un effet : le .wav du pack, tel quel ; ou écourté avec une extinction (SFX_TRIMS). Le volume est mesuré sur le fichier qu'on range.
function buildSfx(id: keyof typeof SFX_SOURCES, sfxDir: string): Measured {
  const source = requireFile(join(sfxDir, SFX_SOURCES[id]));
  const dir = join(AUDIO_DIR, 'sfx');
  mkdirSync(dir, { recursive: true });
  const wav = join(dir, `${id}.wav`);
  const trim = SFX_TRIMS[id];
  if (trim) ffmpeg(['-i', source, '-t', String(trim.seconds), '-af', fadeOutFilter(trim), '-c:a', 'pcm_s16le', wav]);
  else copyFileSync(source, wav);
  return { gain: sfxGain(parseLevels(analyse(wav, 'astats=metadata=0:reset=0'))), seconds: duration(wav) };
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
  ].join('\n');
}

export function generateAudio(musicDirs: Record<MusicPack, string>, sfxDir: string, log: (line: string) => void = () => {}): MeasuredAudio {
  const music = {} as MeasuredAudio['music'];
  for (const id of Object.keys(MUSIC_SOURCES) as Array<keyof typeof MUSIC_SOURCES>) {
    music[id] = buildMusic(id, musicDirs);
    log(`ambiance ${id} : ${music[id].seconds} s, gain ${music[id].gain}`);
  }
  const sfx = {} as MeasuredAudio['sfx'];
  for (const id of Object.keys(SFX_SOURCES) as Array<keyof typeof SFX_SOURCES>) {
    sfx[id] = buildSfx(id, sfxDir);
    log(`effet ${id} : ${sfx[id].seconds} s, gain ${sfx[id].gain}`);
  }
  const measured = { music, sfx };
  mkdirSync(resolve(MEASURED_FILE, '..'), { recursive: true });
  writeFileSync(MEASURED_FILE, renderMeasuredSource(measured));
  return measured;
}

// `tsx scripts/audio/build-audio.ts` s'exécute directement ; importé par un test, ce module n'écrit rien.
if (/[\\/]build-audio\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  const [abstraction, sfx, pirate] = process.argv.slice(2);
  const musicDirs = { abstraction: resolve(abstraction ?? defaultMusicSource('abstraction')), pirate: resolve(pirate ?? defaultMusicSource('pirate')) };
  generateAudio(musicDirs, resolve(sfx ?? defaultSfxSource()), (line) => console.log(line));
  console.log(`Écrit dans ${relative(process.cwd(), AUDIO_DIR)} et ${relative(process.cwd(), MEASURED_FILE)}.`);
}
