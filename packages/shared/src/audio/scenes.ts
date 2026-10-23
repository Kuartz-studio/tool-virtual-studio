// Les ambiances musicales du bureau, rangées par thème : le client en tient les fichiers, les niveaux et les pochettes (audio/catalog.ts), la carte et le
// serveur n'ont besoin que de leurs noms (la scène par défaut d'une pièce, la musique que l'on règle pièce par pièce, gardée en base telle quelle).
// - « default » : les six ambiances du bureau, celles que la carte donne aux pièces, dans l'ordre de la liste du juke-box ;
// - « pirate » : les dix boucles du « Pirate Music Pack Vol. 2 », qu'on choisit à la main, pour soi ou pour sa pièce.
// Un thème de plus : une entrée ici (des identifiants stables, en minuscules et tirets : ils sont gardés en base), puis ce que la compilation réclame côté
// client (sa boucle dans scripts/audio/build-audio.ts, son morceau dans audio/catalog.ts, sa pochette dans office/ambiance-covers.ts, ses textes dans fr.ts).
export const MUSIC_THEMES = {
  default: ['lobby', 'focus', 'sunny', 'dusk', 'drift', 'quest'],
  pirate: [
    'silent-harbor',
    'hidden-booty',
    'oceans-grasp',
    'drunken-sailors',
    'blackened-tide',
    'windward-chase',
    'sea-wolves',
    'black-flag-rise',
    'tempest-call',
    'foggy-shores',
  ],
} as const satisfies Record<string, readonly string[]>;

export type MusicTheme = keyof typeof MUSIC_THEMES;
export type MusicScene = (typeof MUSIC_THEMES)[MusicTheme][number];

// Les thèmes, dans l'ordre du sélecteur : « Par défaut » d'abord.
export const MUSIC_THEME_IDS = Object.keys(MUSIC_THEMES) as MusicTheme[];

// Toutes les ambiances, thème après thème. Un tuple non vide, comme le veut z.enum (protocol.ts) : le type se déduit des thèmes, qu'on n'écrit qu'une fois.
export const MUSIC_SCENES = MUSIC_THEME_IDS.flatMap((theme) => MUSIC_THEMES[theme]) as unknown as readonly [MusicScene, ...MusicScene[]];

// Le thème d'une ambiance.
export function themeOfScene(scene: MusicScene): MusicTheme {
  return MUSIC_THEME_IDS.find((theme) => (MUSIC_THEMES[theme] as readonly MusicScene[]).includes(scene)) ?? 'default';
}
