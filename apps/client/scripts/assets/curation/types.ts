import type { DecorCategoryId, DecorKind } from '@bureau/shared';

// Un élément retenu dans une planche : son rectangle en cases (x, y, largeur, hauteur), son nom, sa catégorie et la façon dont il se pose.
// Ce qui n'est pas dit prend la valeur par défaut de sa catégorie (defaultsOf, dans decor.ts).
export interface Entry {
  sheet: string;
  // Le rectangle de l'objet, en cases (x, y, largeur, hauteur) ; ou `at`, la case de son coin haut-gauche, quand la découpe automatique
  // de la planche (segment.ts) l'isole bien : le rectangle est alors celui de l'objet trouvé là.
  rect?: readonly [number, number, number, number];
  at?: readonly [number, number];
  // Le découpage au pixel près (x, y, largeur, hauteur, en pixels de la planche ; largeur et hauteur multiples de 32), quand le rectangle en
  // cases est trop grand ou mal calé pour l'objet. `rect` (ou `at`) reste ce qui fait l'identifiant. Hors de la planche, l'image est transparente.
  crop?: readonly [number, number, number, number];
  name: string;
  cat: DecorCategoryId;
  kind?: DecorKind;
  claim?: number;
  solid?: boolean;
}

export type EntryOptions = Partial<Pick<Entry, 'kind' | 'claim' | 'solid' | 'crop'>>;

// Les planches sources, par clé (celle des identifiants : `of-4-12` est la case 4, 12 de la planche `of`), relatives au dossier des ressources.
export const SHEETS: Record<string, string> = {
  of: 'Modern_Office_Revamped_v1.2/Modern_Office_32x32.png',
  lr: 'moderninteriors-win/1_Interiors/32x32/Theme_Sorter_32x32/2_LivingRoom_32x32.png',
  cf: 'moderninteriors-win/1_Interiors/32x32/Theme_Sorter_32x32/13_Conference_Hall_32x32.png',
  tv: 'moderninteriors-win/1_Interiors/32x32/Theme_Sorter_32x32/23_Television_and_Film_Studio_32x32.png',
  ms: 'moderninteriors-win/1_Interiors/32x32/Theme_Sorter_32x32/6_Music_and_sport_32x32.png',
  ki: 'moderninteriors-win/1_Interiors/32x32/Theme_Sorter_32x32/12_Kitchen_32x32.png',
  cl: 'moderninteriors-win/1_Interiors/32x32/Theme_Sorter_32x32/5_Classroom_and_library_32x32.png',
  fi: 'moderninteriors-win/1_Interiors/32x32/Theme_Sorter_32x32/9_Fishing_32x32.png',
  ge: 'moderninteriors-win/1_Interiors/32x32/Theme_Sorter_32x32/1_Generic_32x32.png',
};
