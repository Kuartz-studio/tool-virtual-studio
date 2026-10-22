import type { ActivityState } from '../protocol';

// Les modes tout prêts, à la manière d'Apple : « Normal » n'en est pas un (c'est l'absence de mode : la tuile verte), les deux autres se prennent comme les modes
// qu'on crée, sans être à soi : on ne les modifie ni ne les supprime (« dupliquer en mode perso » les copie dans ses propres modes). Leur identifiant commence par
// `preset:`, ce qui les distingue des modes qu'on crée (des uuid) : le serveur les prend ici, jamais en base.
// - Concentration : la porte du bureau se ferme, le reste ne change pas (on entend, on est entendu) ;
// - Sport : on n'entend ni n'est entendu, et le serveur vous conduit à la salle de sport (`place`), puis vous ramène au bureau quand vous en sortez.
export const PRESET_MODES: readonly ActivityState[] = [
  { id: 'preset:focus', label: 'Concentration', color: '#6d28d9', icon: 'headphones', allowEntry: false, hear: true, heard: true },
  { id: 'preset:sport', label: 'Sport', color: '#f97316', icon: 'dumbbell', allowEntry: true, hear: false, heard: false, place: 'gym' },
];

// La couleur de « Normal », la tuile verte de l'absence de mode.
export const NORMAL_COLOR = '#22c55e';

export const PRESET_PREFIX = 'preset:';
export const isPresetId = (id: string): boolean => id.startsWith(PRESET_PREFIX);

// Le mode tout prêt de cet identifiant, ou undefined.
export const presetById = (id: string): ActivityState | undefined => PRESET_MODES.find((mode) => mode.id === id);
