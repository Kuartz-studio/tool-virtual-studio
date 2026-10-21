// Range les sons dans l'appli : `pnpm --filter @bureau/client gen:audio [dossier des boucles] [dossier des effets]`.
//   public/assets/audio/music/   une boucle par ambiance, en .ogg (celui des boucles d'origine, sans leur pochette) et en .m4a (pour Safari)
//   public/assets/audio/sfx/     un .wav par effet sonore
//   src/audio/measured.generated.ts   le volume de chacun, mesuré, pour que toutes les ambiances sonnent aussi fort, et tous les effets de même
// Les boucles et les effets ne sont pas copiés tels quels : ce script les lit là où ils sont (leurs dossiers de téléchargement), garde
// ce qu'il faut, et ce qu'il écrit est commité. Il a besoin de ffmpeg et de ffprobe.
//   - Boucles : « Music Loop Bundle » d'Abstraction (CC0), dossier MUSIC_SRC.
//   - Effets : « 400 Sounds Pack », dossier SFX_SRC.
// Le dossier se donne en argument, ou par la variable d'environnement ; à défaut, celui du dossier Téléchargements.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

export const AUDIO_DIR = resolve(import.meta.dirname, '../../public/assets/audio');
export const MEASURED_FILE = resolve(import.meta.dirname, '../../src/audio/measured.generated.ts');

// Les ambiances : l'identifiant de l'ambiance (le nom des fichiers, src/audio/catalog.ts) et la boucle d'origine.
export const MUSIC_SOURCES = {
  focus: 'Week 26 - Seaside CORAL REEF.ogg',
  drift: 'Week 13 - Primordial Soup JANGLES.ogg',
  sunny: 'Week 15 - Sunburn BEACH HOUSE.ogg',
  lobby: 'Week 18 - Distant Skyline NIGHT DRIVE.ogg',
  dusk: 'Week 19 - Dark Portents MYSTERIOUS TRAVELER.ogg',
  quest: 'Week 22 - The Walking Dunes EVENING OASIS.ogg',
} as const;

// Les effets : l'identifiant de l'effet (le nom du fichier) et son fichier dans le pack (dossier/nom). Les petits bruits de l'interface
// viennent de son dossier UI, les jingles des événements de Musical Effects (tous au vibraphone, pour rester de la même famille).
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
} as const;

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

export function defaultMusicSource(): string {
  return process.env.MUSIC_SRC ?? join(homedir(), 'Downloads', 'music-loop-bundle-2026-q2');
}

export function defaultSfxSource(): string {
  return process.env.SFX_SRC ?? join(homedir(), 'Downloads', '400 Sounds Pack');
}

function requireFile(path: string): string {
  if (!existsSync(path)) throw new Error(`Fichier introuvable : ${path}`);
  return path;
}

// Une ambiance : la boucle d'origine sans sa pochette ni ses étiquettes (le flux audio est recopié tel quel, donc le son est identique
// à l'échantillon près, et la boucle reste sans coupure), et une copie en AAC pour Safari, qui ne lit pas l'ogg.
function buildMusic(id: keyof typeof MUSIC_SOURCES, musicDir: string): Measured {
  const source = requireFile(join(musicDir, MUSIC_SOURCES[id]));
  const dir = join(AUDIO_DIR, 'music');
  mkdirSync(dir, { recursive: true });
  const ogg = join(dir, `${id}.ogg`);
  ffmpeg(['-i', source, '-map', '0:a', '-map_metadata', '-1', '-c:a', 'copy', ogg]);
  ffmpeg(['-i', source, '-map', '0:a', '-map_metadata', '-1', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', join(dir, `${id}.m4a`)]);
  return { gain: musicGain(parseLoudness(analyse(source, 'ebur128=peak=true'))), seconds: duration(ogg) };
}

// Un effet : le .wav du pack, tel quel.
function buildSfx(id: keyof typeof SFX_SOURCES, sfxDir: string): Measured {
  const source = requireFile(join(sfxDir, SFX_SOURCES[id]));
  const dir = join(AUDIO_DIR, 'sfx');
  mkdirSync(dir, { recursive: true });
  const wav = join(dir, `${id}.wav`);
  copyFileSync(source, wav);
  return { gain: sfxGain(parseLevels(analyse(source, 'astats=metadata=0:reset=0'))), seconds: duration(wav) };
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

export function generateAudio(musicDir: string, sfxDir: string, log: (line: string) => void = () => {}): MeasuredAudio {
  const music = {} as MeasuredAudio['music'];
  for (const id of Object.keys(MUSIC_SOURCES) as Array<keyof typeof MUSIC_SOURCES>) {
    music[id] = buildMusic(id, musicDir);
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
  const musicDir = resolve(process.argv[2] ?? defaultMusicSource());
  const sfxDir = resolve(process.argv[3] ?? defaultSfxSource());
  generateAudio(musicDir, sfxDir, (line) => console.log(line));
  console.log(`Écrit dans ${relative(process.cwd(), AUDIO_DIR)} et ${relative(process.cwd(), MEASURED_FILE)}.`);
}
