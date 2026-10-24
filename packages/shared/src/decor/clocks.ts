import type { DecorItem } from './types';

// Les horloges murales de la banque : quatre modèles, quatre tailles, qui donnent l'heure de l'occupant du bureau (son fuseau horaire, celui de
// Paris pour une place libre), en direct. Elles ne viennent pas du pack LimeZu : leurs images sont dessinées par un script à elles
// (`pnpm --filter @bureau/client gen:clocks`, apps/client/scripts/clocks), dans leur propre atlas, que `gen:assets` ne régénère pas. Cette liste
// s'écrit donc à la main, et le catalogue (catalog.ts) la joint aux éléments générés : le sélecteur, les règles de pose (checkDecor) et le
// serveur les traitent comme les autres. Gratuites, comme toute la banque. Le client dessine leurs aiguilles et leurs chiffres à chaque seconde
// (game/wall-clocks.ts) ; l'image de la banque, aiguilles sur 10 h 10, est celle des vignettes et de l'élément qu'on tient.

// L'atlas des horloges (public/assets/decor/horloges.png) : la première rangée a les images de la banque, la seconde, BARE_ROW_OFFSET pixels plus bas,
// les mêmes cadrans sans aiguilles ni chiffres allumés, sur lesquels le jeu dessine l'heure. Deux pixels vides autour de chaque image, comme dans
// les atlas du pack : rien ne déborde d'une image sur sa voisine quand la caméra zoome.
export const CLOCK_ATLAS = { name: 'horloges', width: 202, height: 134, bareRowOffset: 66 } as const;

const clock = (id: string, name: string, w: number, h: number, fx: number): DecorItem => ({
  id,
  cat: 'deco',
  name,
  kind: 'wall',
  w,
  h,
  claim: 0,
  solid: false,
  fx,
  fy: 2,
  atlas: CLOCK_ATLAS.name,
});

// Dans l'ordre où le sélecteur les montre, en tête de « Déco & murs » : de la plus petite à la plus grande.
export const CLOCK_ITEMS: readonly DecorItem[] = [
  // Une case : le cadran rond de cuisine, trotteuse rouge.
  clock('horloge-ronde', 'Horloge ronde', 1, 1, 2),
  // Deux cases de large, une de haut : des chiffres rouges à sept segments, les deux points qui clignotent.
  clock('horloge-led', 'Horloge LED', 2, 1, 36),
  // Deux cases sur deux : le grand cadran de gare, sa trotteuse à palette rouge.
  clock('horloge-gare', 'Horloge de gare', 2, 2, 102),
  // Une case de large, deux de haut : la pendule de bois, son balancier qui bat la seconde.
  clock('horloge-balancier', 'Horloge à balancier', 1, 2, 168),
];

const CLOCK_IDS: ReadonlySet<string> = new Set(CLOCK_ITEMS.map((item) => item.id));

// Cet élément est-il une horloge murale (dont le jeu dessine l'heure) ?
export function isClockId(id: string): boolean {
  return CLOCK_IDS.has(id);
}
