import { MUSIC_SCENES } from '@bureau/shared';
import { MEASURED_MUSIC, MEASURED_SFX } from './measured.generated';

// Les sons de l'appli : des ambiances (de la musique en boucle) et des effets (tout ce qui n'est pas de la musique). Les fichiers sont
// rangés par scripts/audio/build-audio.ts, qui mesure aussi le volume de chacun (measured.generated.ts) : le gain ci-dessous ramène
// toutes les ambiances au même niveau, et tous les effets au même niveau, pour que les curseurs de l'interface veuillent dire la même
// chose partout.

// ---- Les ambiances --------------------------------------------------------------------------------------------------------------

export type SceneId = keyof typeof MEASURED_MUSIC;

// Dans l'ordre où le panneau Son les propose : de la plus calme à la plus rythmée, ou presque. La liste est celle du partage (le serveur et la carte
// nomment les mêmes ambiances) ; `satisfies` fait échouer la compilation si l'une n'a pas son fichier mesuré.
export const SCENE_IDS = MUSIC_SCENES satisfies readonly SceneId[];

export interface Scene {
  id: SceneId;
  // Le morceau, tel que son auteur le nomme (« Abstraction », Music Loop Bundle, CC0).
  track: string;
  // Le rapport d'amplitude qui l'amène au niveau commun (mesuré).
  gain: number;
}

export const SCENES: Record<SceneId, Scene> = {
  lobby: { id: 'lobby', track: 'Distant Skyline — Night Drive', gain: MEASURED_MUSIC.lobby.gain },
  focus: { id: 'focus', track: 'Seaside — Coral Reef', gain: MEASURED_MUSIC.focus.gain },
  sunny: { id: 'sunny', track: 'Sunburn — Beach House', gain: MEASURED_MUSIC.sunny.gain },
  dusk: { id: 'dusk', track: 'Dark Portents — Mysterious Traveler', gain: MEASURED_MUSIC.dusk.gain },
  drift: { id: 'drift', track: 'Primordial Soup — Jangles', gain: MEASURED_MUSIC.drift.gain },
  quest: { id: 'quest', track: 'The Walking Dunes — Evening Oasis', gain: MEASURED_MUSIC.quest.gain },
};

// Les deux copies de chaque boucle : l'ogg (celui des boucles d'origine, qui se répète sans coupure) pour presque tous les navigateurs, et
// l'AAC pour Safari, qui ne lit pas l'ogg. `mime` sert à demander au navigateur lequel il sait lire.
export const MUSIC_FORMATS = [
  { extension: 'ogg', mime: 'audio/ogg; codecs="vorbis"' },
  { extension: 'm4a', mime: 'audio/mp4; codecs="mp4a.40.2"' },
] as const;

// Les adresses d'une ambiance, dans l'ordre où les essayer : celles que le navigateur dit savoir lire, puis les autres (un navigateur qui
// se trompe sur ce qu'il sait lire retombe ainsi sur l'autre copie).
export function musicUrls(id: SceneId, canPlay: (mime: string) => boolean): string[] {
  const urls = MUSIC_FORMATS.map((format) => ({ url: `/assets/audio/music/${id}.${format.extension}`, ok: canPlay(format.mime) }));
  return [...urls.filter((u) => u.ok), ...urls.filter((u) => !u.ok)].map((u) => u.url);
}

// ---- Les effets -----------------------------------------------------------------------------------------------------------------

export type SfxId = keyof typeof MEASURED_SFX;

export interface Sfx {
  id: SfxId;
  // Le rapport d'amplitude qui l'amène au niveau commun (mesuré), puis sa place dans le mélange : les bruits qui reviennent souvent
  // (un clic) sont plus discrets que ceux qui annoncent quelque chose (un message).
  gain: number;
  // Le délai minimal entre deux lectures du même effet : une rafale (dix messages d'un coup) ne fait qu'un bruit.
  cooldownMs: number;
}

const sfx = (id: SfxId, level: number, cooldownMs: number): Sfx => ({ id, gain: Math.round(MEASURED_SFX[id].gain * level * 1000) / 1000, cooldownMs });

export const SFX: Record<SfxId, Sfx> = {
  click: sfx('click', 0.5, 40),
  'toggle-on': sfx('toggle-on', 0.7, 60),
  'toggle-off': sfx('toggle-off', 0.7, 60),
  'panel-open': sfx('panel-open', 0.6, 60),
  'panel-close': sfx('panel-close', 0.6, 60),
  'conversation-start': sfx('conversation-start', 0.6, 400),
  'conversation-end': sfx('conversation-end', 0.6, 400),
  cancel: sfx('cancel', 0.6, 120),
  welcome: sfx('welcome', 0.8, 2000),
  arrive: sfx('arrive', 0.7, 300),
  message: sfx('message', 0.8, 700),
  success: sfx('success', 0.8, 500),
  error: sfx('error', 0.8, 700),
  lost: sfx('lost', 0.8, 2000),
  knock: sfx('knock', 1, 120),
  'door-open': sfx('door-open', 0.6, 200),
  'door-close': sfx('door-close', 0.6, 200),
  lock: sfx('lock', 0.6, 300),
  unlock: sfx('unlock', 0.6, 300),
  coffee: sfx('coffee', 0.7, 1000),
  boost: sfx('boost', 0.7, 1000),
  teleport: sfx('teleport', 0.8, 600),
  dice: sfx('dice', 0.8, 300),
  piece: sfx('piece', 0.8, 120),
  win: sfx('win', 0.9, 2000),
};

export const SFX_IDS = Object.keys(SFX) as SfxId[];

export const sfxUrl = (id: SfxId): string => `/assets/audio/sfx/${id}.wav`;
