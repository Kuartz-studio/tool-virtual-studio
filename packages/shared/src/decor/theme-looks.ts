import type { FloorThemeId, WallThemeId } from './themes';

// La couleur et la matière de chaque sol et de chaque mur, ceux de la boutique compris : l'onglet « Murs et sol » range ses listes par couleur, et son
// sélecteur de matière les filtre. La couleur est celle qu'on voit d'abord (un motif de plusieurs teintes, sans l'une qui domine, est multicolore) ; la
// matière, ce dont le thème a l'air (un « Lin rayé » est un motif, un « Marbre » une pierre, la « Moquette lilas » une moquette).

// Les couleurs, dans l'ordre où l'onglet les montre : du blanc au noir, puis les teintes, du brun au violet, puis ce qui en mêle plusieurs.
export const THEME_COLORS = ['blanc', 'creme', 'beige', 'gris', 'noir', 'brun', 'rouge', 'rose', 'orange', 'vert', 'bleu', 'violet', 'multicolore'] as const;
export type ThemeColor = (typeof THEME_COLORS)[number];

// Les matières, dans l'ordre du sélecteur.
export const THEME_MATERIALS = ['uni', 'bois', 'carrelage', 'moquette', 'pierre', 'beton', 'brique', 'tissu', 'motif'] as const;
export type ThemeMaterial = (typeof THEME_MATERIALS)[number];

export interface ThemeLook {
  color: ThemeColor;
  material: ThemeMaterial;
}

const look = (color: ThemeColor, material: ThemeMaterial): ThemeLook => ({ color, material });

export const FLOOR_LOOKS: Readonly<Record<FloorThemeId, ThemeLook>> = {
  sable: look('beige', 'uni'),
  creme: look('creme', 'carrelage'),
  blanc: look('blanc', 'carrelage'),
  marbre: look('blanc', 'pierre'),
  gris: look('gris', 'carrelage'),
  graphite: look('gris', 'carrelage'),
  beton: look('gris', 'beton'),
  'parquet-clair': look('beige', 'bois'),
  'parquet-brun': look('brun', 'bois'),
  noyer: look('brun', 'bois'),
  'parquet-rouge': look('rouge', 'bois'),
  chevrons: look('rouge', 'bois'),
  sauge: look('vert', 'carrelage'),
  menthe: look('vert', 'carrelage'),
  bleu: look('bleu', 'carrelage'),
  'bleu-clair': look('bleu', 'carrelage'),
  lilas: look('violet', 'moquette'),
  rose: look('rose', 'carrelage'),
  damier: look('brun', 'motif'),
  turquoise: look('bleu', 'carrelage'),
  pierre: look('gris', 'pierre'),
  losanges: look('bleu', 'motif'),
  'bois-noir': look('noir', 'bois'),
  'moquette-noire': look('noir', 'moquette'),
  'carrelage-noir': look('noir', 'carrelage'),
  'noir-mat': look('noir', 'uni'),
};

export const WALL_LOOKS: Readonly<Record<WallThemeId, ThemeLook>> = {
  'gris-perle': look('gris', 'uni'),
  creme: look('creme', 'uni'),
  'sauge-pale': look('vert', 'uni'),
  'brique-claire': look('beige', 'brique'),
  sable: look('beige', 'uni'),
  peche: look('orange', 'uni'),
  lin: look('beige', 'motif'),
  beton: look('gris', 'beton'),
  anthracite: look('gris', 'uni'),
  brun: look('brun', 'uni'),
  'bois-sombre': look('brun', 'bois'),
  'rose-raye': look('rose', 'motif'),
  rouge: look('rouge', 'uni'),
  bleu: look('bleu', 'uni'),
  violet: look('violet', 'uni'),
  'bleu-ciel': look('bleu', 'uni'),
  turquoise: look('bleu', 'uni'),
  'carreaux-bleus': look('bleu', 'carrelage'),
  // Le vert menthe, rayé de pêche.
  menthe: look('vert', 'motif'),
  'vert-gris': look('vert', 'uni'),
  'noir-mat': look('noir', 'uni'),
  'lambris-noir': look('noir', 'bois'),
  'brique-noire': look('noir', 'brique'),
  'carrelage-noir': look('noir', 'carrelage'),
  'mur-velours': look('rouge', 'tissu'),
  'mur-lambris': look('vert', 'bois'),
  'mur-seventies': look('multicolore', 'motif'),
  'mur-losanges': look('multicolore', 'motif'),
  // Des citrouilles orange sur un gris : c'est leur couleur qu'on cherche.
  'mur-citrouilles': look('orange', 'motif'),
  'mur-bibliotheque': look('brun', 'bois'),
  'mur-jungle': look('vert', 'motif'),
  // Des briques presque noires, sous deux tubes de néon.
  'mur-neon': look('noir', 'brique'),
  'mur-marbre-or': look('noir', 'pierre'),
  // Le bleu canard et ses soleils d'or.
  'mur-art-deco': look('bleu', 'motif'),
  'mur-galaxie': look('violet', 'motif'),
  'mur-kuartz': look('violet', 'motif'),
};
