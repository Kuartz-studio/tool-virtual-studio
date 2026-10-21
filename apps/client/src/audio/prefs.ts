import { SCENE_IDS, type SceneId } from './catalog';

// Les réglages du son, gardés dans le navigateur (localStorage), d'une visite à l'autre : la musique et les effets s'allument ou
// s'éteignent chacun de leur côté, avec leur volume (le curseur, de 0 à 1), et l'ambiance est celle du lieu (« auto ») ou toujours la
// même. Rien de cela n'est envoyé au serveur : c'est un choix de cet appareil.
const KEY = 'bureau.audio.v1';

export interface AudioPrefs {
  musicOn: boolean;
  musicVolume: number;
  sfxOn: boolean;
  sfxVolume: number;
  // « auto » : l'ambiance de l'endroit où l'on est ; sinon, celle-là, partout.
  scene: 'auto' | SceneId;
}

// Sans réglage enregistré : tout est allumé, la musique en fond (elle ne couvre pas les voix), les effets un peu plus présents.
export const DEFAULT_AUDIO_PREFS: Readonly<AudioPrefs> = { musicOn: true, musicVolume: 0.6, sfxOn: true, sfxVolume: 0.8, scene: 'auto' };

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// Les réglages enregistrés. Ce qui n'est pas lisible (rien d'enregistré, JSON abîmé, valeur d'un autre type, ambiance qui n'existe plus)
// prend sa valeur par défaut, champ par champ. Le stockage peut lever (navigation privée, cookies bloqués) : valeurs par défaut.
export function loadAudioPrefs(): AudioPrefs {
  const prefs: AudioPrefs = { ...DEFAULT_AUDIO_PREFS };
  let stored: unknown;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return prefs;
    stored = JSON.parse(raw);
  } catch {
    return prefs;
  }
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return prefs;
  const fields = stored as Record<string, unknown>;
  if (typeof fields.musicOn === 'boolean') prefs.musicOn = fields.musicOn;
  if (typeof fields.sfxOn === 'boolean') prefs.sfxOn = fields.sfxOn;
  if (typeof fields.musicVolume === 'number' && Number.isFinite(fields.musicVolume)) prefs.musicVolume = clamp01(fields.musicVolume);
  if (typeof fields.sfxVolume === 'number' && Number.isFinite(fields.sfxVolume)) prefs.sfxVolume = clamp01(fields.sfxVolume);
  if (fields.scene === 'auto' || (typeof fields.scene === 'string' && (SCENE_IDS as readonly string[]).includes(fields.scene))) {
    prefs.scene = fields.scene as AudioPrefs['scene'];
  }
  return prefs;
}

// Enregistre les réglages. Un stockage refusé ou plein ne fait rien : ils valent pour cette visite.
export function saveAudioPrefs(prefs: AudioPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // stockage indisponible : rien à faire
  }
}
