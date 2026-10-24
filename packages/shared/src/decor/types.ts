// La banque d'éléments : de quoi décorer un bureau (et meubler la carte). Les images viennent du pack LimeZu, triées par catégorie par
// apps/client/scripts/assets (`pnpm gen:assets`) ; ce fichier dit seulement ce qu'est un élément, le reste (liste, atlas) est généré.

// Les catégories, dans l'ordre où le panneau les montre : ce qui touche au poste de travail d'abord, le reste ensuite, et la collection à part en
// dernier : `boutique`, les seuls éléments qui ont un prix (DecorItem.price), tirés de parties du pack que les autres catégories n'utilisent pas.
export const DECOR_CATEGORIES = [
  { id: 'ecrans', label: 'Écrans & informatique' },
  { id: 'bureaux', label: 'Bureaux & tables' },
  { id: 'sieges', label: 'Sièges & canapés' },
  { id: 'rangement', label: 'Rangement' },
  { id: 'papeterie', label: 'Objets de bureau' },
  { id: 'plantes', label: 'Plantes' },
  { id: 'deco', label: 'Déco & murs' },
  { id: 'cafe', label: 'Pause & café' },
  { id: 'detente', label: 'Détente & loisirs' },
  { id: 'sport', label: 'Sport & jeux' },
  { id: 'boutique', label: 'Boutique' },
] as const;

export type DecorCategoryId = (typeof DECOR_CATEGORIES)[number]['id'];

// Comment un élément se pose :
// - object : un meuble ou un objet posé au sol. Il occupe `claim` rangées de cases en bas de son image (jamais deux objets sur les
//   mêmes cases) et bloque le passage si `solid` ;
// - floor : à même le sol (tapis) : sous tout le monde, il ne bloque rien et peut passer sous les meubles ;
// - onTop : un petit objet qu'on pose sur un meuble (écran, lampe, tasse) : il se superpose aux objets, jamais à un autre objet du même
//   genre ;
// - wall : accroché au mur du fond, dans la bande de mur au-dessus de la pièce (2 cases de haut au plus).
export const DECOR_KINDS = ['object', 'floor', 'onTop', 'wall'] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];

// Un élément de la banque. `w` et `h` sont la taille de l'image en cases ; `claim`, le nombre de rangées du bas qu'il occupe au sol.
// `atlas` et `fx`, `fy` disent où est l'image (en pixels) dans l'atlas de sa catégorie. `price`, le prix en écus (un entier d'au moins 1) : tous les
// éléments de la catégorie `boutique` en ont un, aucun autre n'en a (ils sont libres) ; le générateur et les tests le vérifient.
export interface DecorItem {
  id: string;
  cat: DecorCategoryId;
  name: string;
  kind: DecorKind;
  w: number;
  h: number;
  claim: number;
  solid: boolean;
  fx: number;
  fy: number;
  price?: number;
}

// Un élément posé dans la pièce d'un bureau : `x` et `y` sont la position du coin haut-gauche de son empreinte, en cases au dixième près (2.5 : au
// milieu de la troisième case ; voir DECOR_STEPS), comptées depuis le coin haut-gauche de la pièce. Pour un élément `wall`, `y` est toujours 0 : il
// se pose sur la bande de mur, seul `x` compte.
export interface PlacedItem {
  id: string;
  x: number;
  y: number;
}
