import type { Entry } from './types';
import { on } from './helpers';

// La collection à part (catégorie `boutique`) : des pièces d'apparat, tirées de parties du pack que les autres curations n'ont pas touchées. Le musée
// (22_Museum : squelettes de dinosaures, vitrines, statue, toiles de maître, colonnes, vases sur socle), le mobilier laqué violet et or du salon
// (2_LivingRoom), les trophées de la planche musique et sport, le plateau de télévision, la salle de bain, la chambre, la boutique de vêtements et
// Halloween, plus quelques tapis de la planche « Generic » que le thème n'avait pas gardés. Aucune n'est une copie d'un élément libre : même planche,
// autre dessin, ou autre planche (un test compare les pixels de chaque pièce à ceux de toute la banque).
//
// Chaque élément a un prix en kuartzons, et les prix suivent quatre raretés (RARITIES) : un Commun s'achète vite, un Légendaire est une pièce de
// collection qu'on met des mois à réunir. Les entrées sont rangées par rareté puis par prix, ce qui est aussi leur ordre dans la liste générée.
// Les règles de pose sont celles des autres éléments (decor.ts) : les gros meubles et les vitrines bloquent, jamais un siège ; un élément mural fait
// deux cases de haut au plus ; une pièce de 5 cases tient dans la pièce compacte (6 × 7).

// Les raretés et leurs prix, en kuartzons. Rien n'est vendu entre deux raretés : un test vérifie que chaque prix tombe dans l'une d'elles.
export const RARITIES = [
  { id: 'commun', label: 'Commun', min: 100, max: 250 },
  { id: 'rare', label: 'Rare', min: 300, max: 900 },
  { id: 'epique', label: 'Épique', min: 1200, max: 3500 },
  { id: 'legendaire', label: 'Légendaire', min: 5000, max: 15000 },
] as const;

export type Rarity = (typeof RARITIES)[number];

// La rareté d'un prix ; undefined s'il tombe entre deux raretés.
export function rarityOf(price: number): Rarity | undefined {
  return RARITIES.find((rarity) => price >= rarity.min && price <= rarity.max);
}

const mu = on('mu', 'boutique');
const lr = on('lr', 'boutique');
const ms = on('ms', 'boutique');
const tv = on('tv', 'boutique');
const ge = on('ge', 'boutique');
const bt = on('bt', 'boutique');
const be = on('be', 'boutique');
const cs = on('cs', 'boutique');
const hw = on('hw', 'boutique');

// ---- Commun : 100 à 250 kuartzons ---------------------------------------------------------------------------------------------
// De quoi poser une première touche : des trophées et des idoles à mettre sur un meuble, des médailles encadrées, des vases, des cordons de velours,
// des tapis ronds, de petits éléments muraux, un chaudron. Les objets qui se posent sur un meuble (`onTop`) gardent le rectangle de la planche tel quel : leur
// socle blanc ou leur ombre laisse un peu de vide en bas, sans conséquence pour un objet qu'on pose n'importe où sur un plateau.
const COMMUN: Entry[] = [
  mu('Papillon suspendu', [9, 36, 1, 2], { kind: 'wall', price: 100 }),
  be('Ours en peluche', [0, 2, 2, 2], { solid: false, price: 100 }),
  be("Guirlande d'étoiles blanches", [8, 77, 2, 2], { kind: 'wall', price: 120 }),
  be("Guirlande d'étoiles dorées", [10, 77, 2, 2], { kind: 'wall', price: 120 }),
  // Les médailles tiennent dans une case (28 × 32 px) au milieu de leur rectangle de deux : le découpage les en sort.
  ms("Médaille d'argent encadrée", [0, 20, 1, 2], { kind: 'wall', crop: [0, 658, 32, 32], price: 130 }),
  ms('Trophée de bronze', [7, 23, 1, 2], { kind: 'onTop', price: 140 }),
  ms("Médaille d'or encadrée", [2, 20, 1, 2], { kind: 'wall', crop: [64, 658, 32, 32], price: 150 }),
  be('Tapis rond orange', [10, 69, 2, 2], { kind: 'floor', price: 150 }),
  be('Tapis rond à pois roses', [13, 74, 2, 2], { kind: 'floor', price: 150 }),
  mu('Cordon de velours doré', [0, 17, 3, 2], { solid: false, price: 160 }),
  mu('Cordon de velours argenté', [10, 17, 3, 2], { solid: false, price: 160 }),
  ms("Trophée d'argent", [8, 23, 1, 2], { kind: 'onTop', price: 180 }),
  lr('Tabouret laqué', [5, 0, 1, 1], { solid: false, price: 180 }),
  mu('Petite amphore rose', [10, 8, 2, 2], { kind: 'onTop', price: 180 }),
  mu('Vase de porcelaine sur socle', [12, 15, 1, 2], { price: 200 }),
  mu('Vase rose sur socle', [13, 15, 1, 2], { price: 200 }),
  ge("Tapis cramoisi à chaîne d'or", [3, 22, 2, 2], { kind: 'floor', price: 200 }),
  ms("Trophée d'or", [9, 23, 1, 2], { kind: 'onTop', price: 220 }),
  mu('Petite amphore dorée', [8, 8, 2, 2], { kind: 'onTop', price: 220 }),
  mu("Idole d'or au rubis", [10, 55, 1, 1], { kind: 'onTop', price: 250 }),
  mu("Idole d'or au saphir", [10, 56, 1, 1], { kind: 'onTop', price: 250 }),
  mu('Cadre de papillons bleus', [2, 34, 2, 2], { kind: 'wall', price: 250 }),
  hw('Chaudron de sorcière', [2, 8, 2, 2], { price: 250 }),
];

// ---- Rare : 300 à 900 kuartzons -----------------------------------------------------------------------------------------------
// Ce qui fait un coin : amphores sur socle, petites toiles, grands tapis, miroirs, mobilier laqué, matériel de plateau, premières vitrines. Les
// trépieds et les miroirs sur pied sont traversables (`solid: false`) : ce sont des pieds fins, pas des meubles, même quand l'image fait trois cases.
const RARE: Entry[] = [
  ge('Tapis de couloir ornemental', [9, 24, 2, 5], { kind: 'floor', price: 400 }),
  tv('Projecteurs de plateau', [8, 0, 2, 3], { solid: false, price: 400 }),
  cs('Psyché ovale dorée', [9, 29, 1, 3], { solid: false, price: 400 }),
  tv('Caméra de cinéma', [0, 0, 2, 2], { solid: false, price: 450 }),
  mu('Amphore rose sur socle', [2, 14, 2, 3], { price: 450 }),
  be('Tapis plan de ville', [4, 78, 4, 3], { kind: 'floor', price: 450 }),
  lr('Table basse laquée', [5, 2, 2, 2], { claim: 2, price: 450 }),
  ms('Podium des champions', [0, 26, 3, 2], { price: 450 }),
  lr('Console laquée', [2, 0, 2, 2], { price: 500 }),
  mu('Tournesol encadré', [4, 21, 1, 2], { kind: 'wall', price: 500 }),
  mu('Marine dorée', [10, 23, 2, 2], { kind: 'wall', price: 600 }),
  bt('Psyché dorée', [4, 8, 2, 3], { solid: false, price: 600 }),
  ge('Grand tapis ornemental', [7, 22, 4, 2], { kind: 'floor', price: 600 }),
  mu("Idole d'or sur piédestal", [11, 55, 1, 2], { price: 650 }),
  cs('Grand miroir doré', [3, 18, 2, 2], { kind: 'wall', price: 650 }),
  mu('Vitrine aux insectes', [14, 73, 2, 4], { price: 700 }),
  mu("Amphore d'or sur socle", [4, 11, 2, 3], { price: 800 }),
  mu('Vitrine au crâne de taureau', [12, 73, 2, 3], { price: 800 }),
];

// ---- Épique : 1 200 à 3 500 kuartzons ------------------------------------------------------------------------------------------
// Les grandes pièces d'une pièce réussie : mobilier laqué, baignoire à pieds, pupitre de plateau, baie vitrée, vitrines de musée, statue, toiles de
// maître et petit squelette de dinosaure. Les cadres des toiles sont à deux cases de haut, comme tout ce qui se pose sur le mur.
const EPIQUE: Entry[] = [
  be('Baie vitrée panoramique', [0, 78, 3, 2], { kind: 'wall', price: 1400 }),
  tv('Pupitre de présentateur', [3, 8, 4, 2], { claim: 2, price: 1500 }),
  lr('Armoire laquée', [0, 1, 2, 3], { price: 1600 }),
  bt('Baignoire à pieds et son canard', [10, 14, 2, 4], { claim: 2, price: 1900 }),
  mu('Vitrine aux fossiles', [10, 61, 3, 3], { claim: 2, price: 1900 }),
  lr('Table laquée', [7, 1, 3, 3], { claim: 2, price: 2200 }),
  mu('Vitrine aux ossements', [10, 67, 5, 3], { claim: 2, price: 2400 }),
  mu('Gardien de pierre', [0, 50, 2, 3], { price: 2600 }),
  mu('La Grande Vague', [4, 27, 2, 2], { kind: 'wall', price: 2800 }),
  mu('La Nuit étoilée', [6, 27, 2, 2], { kind: 'wall', price: 3200 }),
  mu('Squelette de jeune tricératops', [0, 81, 5, 3], { claim: 2, price: 3400 }),
];

// ---- Légendaire : 5 000 à 15 000 kuartzons --------------------------------------------------------------------------------------
// Les pièces de collection : les dinosaures du musée, qui tiennent sur cinq cases de large (la pièce compacte en fait six) et dont le socle occupe
// le bas de l'image (`claim`) pendant que le cou et la tête montent dans la bande de mur ; la colonnade de marbre ; et la toile la plus connue du
// musée. La Joconde fait 70 px de haut dans la planche pour 64 permis au mur : le découpage (`crop`) en retire trois en haut et trois en bas, le
// cadre y perd son liseré sombre, pas son dessin.
const LEGENDAIRE: Entry[] = [
  mu('Colonnade de marbre', [4, 29, 4, 4], { solid: true, price: 5000 }),
  mu('Squelette de tricératops', [6, 84, 5, 4], { claim: 2, price: 6000 }),
  mu('Tricératops sur son socle', [0, 88, 5, 4], { claim: 2, price: 7500 }),
  mu('La Joconde', [12, 27, 2, 3], { kind: 'wall', crop: [384, 885, 64, 64], price: 9000 }),
  mu('Diorama du tricératops', [0, 95, 5, 5], { claim: 3, price: 12000 }),
  mu('Squelette de diplodocus', [5, 100, 5, 5], { claim: 3, price: 15000 }),
];

export const BOUTIQUE_ENTRIES: Entry[] = [...COMMUN, ...RARE, ...EPIQUE, ...LEGENDAIRE];
