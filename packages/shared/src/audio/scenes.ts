// Les ambiances musicales du bureau, dans l'ordre de la grille du juke-box : le client en tient les fichiers et les niveaux (audio/catalog.ts),
// la carte et le serveur n'ont besoin que de leurs noms (la scène par défaut d'une pièce, la musique que l'on règle pièce par pièce).
export const MUSIC_SCENES = ['lobby', 'focus', 'sunny', 'dusk', 'drift', 'quest'] as const;
export type MusicScene = (typeof MUSIC_SCENES)[number];
