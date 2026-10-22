import type { Entry } from './types';
import { named, on } from './helpers';

// Les planches « Modern Interiors » retenues pour ce qui manque au pack Office : salon, bibliothèque, cuisine, salle de conférence,
// musique, plein air (la salle de sport et le sous-sol ont les leurs : gym.ts, basement.ts).

// ---- Salon (Living Room) -----------------------------------------------------------------------------------------------
const lrPlant = on('lr', 'plantes');
const lrDeco = on('lr', 'deco');
const lrStuff = on('lr', 'papeterie');
const lrSeat = on('lr', 'sieges');
const lrChill = on('lr', 'detente');
const lrStore = on('lr', 'rangement');

const LIVING_ROOM: Entry[] = [
  lrPlant('Ficus', [10, 0]),
  lrPlant('Arbuste', [12, 0]),
  lrPlant('Palmier', [13, 0]),
  lrPlant('Plante verte en pot', [12, 20]),
  lrPlant('Grande plante en pot', [13, 21]),
  lrPlant('Plante haute', [15, 21]),
  lrPlant('Succulente', [0, 5]),
  ...named('Lampadaire', [[11, 9], [12, 9], [13, 9], [12, 12], [13, 12]], lrDeco, { kind: 'object', claim: 1, solid: false }),
  ...named('Lampe de chevet', [[14, 7], [15, 7], [14, 9], [15, 9], [14, 13], [15, 13]], lrStuff, { kind: 'onTop' }),
  ...named('Tableau', [[0, 26], [1, 26], [2, 26], [0, 28], [0, 30], [0, 32]], lrDeco, { kind: 'wall' }),
  lrSeat('Canapé gris, trois places', [1, 28, 3, 2], { claim: 2, solid: false }),
  lrSeat('Canapé gris clair, trois places', [4, 28, 3, 2], { claim: 2, solid: false }),
  lrSeat('Canapé brun, trois places', [7, 28, 3, 2], { claim: 2, solid: false }),
  lrSeat('Canapé lilas, trois places', [7, 30, 3, 2], { claim: 2, solid: false }),
  ...named('Coussin', [[12, 30], [14, 30], [11, 31], [12, 31], [13, 31], [14, 31], [11, 33], [13, 33]], lrChill, { kind: 'onTop' }),
  lrChill('Cheminée avec feu', [4, 24, 2, 3], { kind: 'object', claim: 2, solid: true }),
  ...named('Poêle', [[9, 42], [12, 37, 2, 3], [14, 37, 2, 3], [14, 42]], lrChill, { kind: 'object', claim: 2, solid: true }),
  ...named('Armoire en bois', [[7, 4], [11, 4], [13, 4]], lrStore, { claim: 1 }),
  lrStore('Grande armoire', [7, 7], { claim: 1 }),
  lrStore('Buffet', [9, 7, 2, 3], { claim: 1 }),
];

// ---- Salle de conférence ----------------------------------------------------------------------------------------------
const cfDesk = on('cf', 'bureaux');
const cfSeat = on('cf', 'sieges');
const cfDeco = on('cf', 'deco');
const cfScreen = on('cf', 'ecrans');

const CONFERENCE: Entry[] = [
  cfDesk('Table de conférence ovale', [0, 1, 5, 3], { claim: 2 }),
  cfDesk("Comptoir d'accueil", [8, 4, 5, 2], { claim: 2 }),
  cfDesk('Banc de bois', [0, 4, 5, 2], { claim: 2 }),
  cfDeco('Grand tapis blanc', [0, 8, 5, 3], { kind: 'floor' }),
  cfDeco('Tapis rouge', [5, 4, 1, 2], { kind: 'floor' }),
  cfDeco('Tapis rouge et bleu', [6, 4, 1, 2], { kind: 'floor' }),
  cfDeco('Tapis bleu', [7, 4, 1, 2], { kind: 'floor' }),
  cfSeat('Chaise de réunion beige', [7, 0, 1, 2], { solid: false }),
  cfSeat('Chaise de réunion sombre', [8, 0, 1, 2], { solid: false }),
  cfSeat('Chaise de réunion noire', [9, 0, 1, 2], { solid: false }),
  cfDeco('Portrait (A)', [14, 2], { kind: 'wall' }),
  cfDeco('Portrait (B)', [15, 2], { kind: 'wall' }),
  cfDeco('Extincteur', [13, 7], { kind: 'object', claim: 1, solid: false }),
  cfScreen('Borne tactile', [14, 7], { kind: 'object', claim: 1, solid: true }),
];

// ---- Télévision --------------------------------------------------------------------------------------------------------
const tvScreen = on('tv', 'ecrans');
const tvSeat = on('tv', 'sieges');
const tvChill = on('tv', 'detente');

const TELEVISION: Entry[] = [
  tvScreen('Télévision murale', [10, 1, 3, 2], { kind: 'wall' }),
  tvScreen('Écran géant mural', [10, 3, 5, 2], { kind: 'wall' }),
  tvScreen('Télévision murale étroite', [13, 1], { kind: 'wall' }),
  tvSeat('Fauteuil club beige', [5, 3], { claim: 1, solid: false }),
  tvSeat('Fauteuil club gris', [7, 3], { claim: 1, solid: false }),
  tvSeat('Fauteuil club brun', [5, 5], { claim: 1, solid: false }),
  tvSeat('Fauteuil club ardoise', [7, 5], { claim: 1, solid: false }),
  tvSeat('Tabouret rouge', [14, 1], { solid: false }),
  tvChill('Pouf vert', [15, 1], { kind: 'object', claim: 1, solid: false }),
  tvChill('Pouf bleu', [15, 2], { kind: 'object', claim: 1, solid: false }),
];

// ---- Cuisine (pause café) -----------------------------------------------------------------------------------------------
const kiCafe = on('ki', 'cafe');
const kiSeat = on('ki', 'sieges');

const KITCHEN: Entry[] = [
  kiCafe('Table de cuisine claire', [3, 15], { claim: 3 }),
  kiCafe('Table de cuisine rousse', [6, 15], { claim: 3 }),
  kiCafe('Table de cuisine claire, longue', [3, 18], { claim: 3 }),
  kiCafe('Table de cuisine vitrée', [6, 18], { claim: 3 }),
  kiCafe('Table carrée', [9, 13], { claim: 2 }),
  kiCafe('Table ronde basse', [9, 15], { claim: 2 }),
  kiCafe('Table rousse basse', [11, 15], { claim: 2 }),
  kiCafe('Banc de cantine (A)', [9, 17], { claim: 2 }),
  kiCafe('Banc de cantine (B)', [12, 17], { claim: 2 }),
  kiCafe('Banc de cantine (C)', [9, 19], { claim: 2 }),
  kiCafe('Banc de cantine (D)', [12, 19], { claim: 2 }),
  kiCafe('Comptoir bois (A)', [9, 21], { claim: 2 }),
  kiCafe('Comptoir bois (B)', [12, 21], { claim: 2 }),
  kiCafe('Réfrigérateur blanc', [9, 23, 1, 3], { claim: 1 }),
  kiCafe('Réfrigérateur gris', [10, 23, 1, 3], { claim: 1 }),
  kiCafe('Réfrigérateur sombre', [11, 23, 1, 3], { claim: 1 }),
  kiCafe('Réfrigérateur clair', [12, 23, 1, 3], { claim: 1 }),
  kiCafe('Bouilloire (A)', [13, 23], { kind: 'onTop' }),
  kiCafe('Bouilloire (B)', [14, 23], { kind: 'onTop' }),
  kiCafe('Machine à expresso', [15, 23], { kind: 'onTop' }),
  kiCafe("Pack de bouteilles d'eau (A)", [12, 13], { kind: 'object', claim: 1, solid: false }),
  kiCafe("Pack de bouteilles d'eau (B)", [13, 13], { kind: 'object', claim: 1, solid: false }),
  kiCafe("Pack de bouteilles d'eau (C)", [14, 13], { kind: 'object', claim: 1, solid: false }),
  kiCafe('Bouteille', [10, 11], { kind: 'onTop' }),
  kiCafe('Bouteille verte', [10, 12], { kind: 'onTop' }),
  kiSeat('Chaise de cuisine rousse', [4, 11], { solid: false }),
  kiSeat('Chaise de cuisine brune', [5, 11], { solid: false }),
  kiSeat('Chaise de cuisine claire', [6, 11], { solid: false }),
  kiSeat('Chaise de cuisine ambrée', [7, 11], { solid: false }),
  kiSeat('Chaise de cuisine (dos, A)', [4, 13], { solid: false }),
  kiSeat('Chaise de cuisine (dos, B)', [5, 13], { solid: false }),
  kiSeat('Chaise de cuisine (dos, C)', [6, 13], { solid: false }),
  kiSeat('Chaise de cuisine (dos, D)', [7, 13], { solid: false }),
];

// ---- Bibliothèque -----------------------------------------------------------------------------------------------------
const clStore = on('cl', 'rangement');
const clStuff = on('cl', 'papeterie');

const LIBRARY: Entry[] = [
  ...named('Bibliothèque claire', [[0, 13], [4, 13], [6, 13], [8, 13], [10, 13]], clStore, { claim: 1 }),
  clStore('Bibliothèque étroite claire', [3, 13], { claim: 1 }),
  ...named('Bibliothèque sable', [[0, 16], [4, 16], [6, 16], [8, 16], [10, 16]], clStore, { claim: 1 }),
  clStore('Bibliothèque étroite sable', [3, 16], { claim: 1 }),
  ...named('Bibliothèque rousse', [[0, 19], [4, 19], [6, 19], [8, 19], [10, 19]], clStore, { claim: 1 }),
  clStore('Bibliothèque étroite rousse', [3, 19], { claim: 1 }),
  clStuff('Livres en tas (A)', [12, 15]),
  clStuff('Livres en tas (B)', [12, 17]),
  clStuff('Livres (C)', [12, 19]),
  clStuff('Livres (D)', [13, 19]),
  clStuff('Globe terrestre (A)', [13, 1]),
  clStuff('Globe terrestre (B)', [14, 1]),
  clStuff('Pupitre à livre (A)', [14, 14]),
  clStuff('Pupitre à livre (B)', [14, 17]),
];

// ---- Musique ------------------------------------------------------------------------------------------------------------
const msChill = on('ms', 'detente');
const msStuff = on('ms', 'papeterie');

const MUSIC: Entry[] = [
  ...named('Piano droit', [[0, 1, 2, 3], [2, 1, 2, 3], [4, 1, 2, 3]], msChill, { kind: 'object', claim: 2, solid: true }),
  ...named('Tabouret de piano', [[0, 4, 2, 1], [2, 4, 2, 1], [4, 4, 2, 1]], msChill, { kind: 'object', claim: 1, solid: false }),
  ...named('Piano à queue', [[0, 12, 2, 3], [2, 12, 2, 3], [4, 12, 2, 3], [0, 15, 2, 3], [2, 15, 2, 3], [4, 15, 2, 3]], msChill, { kind: 'object', claim: 3, solid: true }),
  ...named('Guitare acoustique', [[7, 2], [8, 2], [9, 2]], msChill, { kind: 'object', claim: 1, solid: false }),
  ...named('Guitare électrique', [[10, 2], [11, 2], [12, 2]], msChill, { kind: 'object', claim: 1, solid: false }),
  msChill('Amplis', [6, 0], { kind: 'object', claim: 2, solid: true }),
  ...named('Harpe', [[13, 0], [13, 2], [13, 4], [13, 6]], msChill, { kind: 'object', claim: 1, solid: true }),
  msChill('Batterie rousse', [0, 18, 3, 2], { kind: 'object', claim: 2, solid: true }),
  msChill('Batterie bleue', [3, 18, 3, 2], { kind: 'object', claim: 2, solid: true }),
  msChill('Batterie rouge', [6, 18, 3, 2], { kind: 'object', claim: 2, solid: true }),
  ...named('Pied de micro', [[6, 15], [7, 15], [8, 15], [9, 15], [10, 15]], msChill, { kind: 'object', claim: 1, solid: false }),
  msStuff('Clavier de musique sombre', [6, 17, 2, 1]),
  msStuff('Clavier de musique rouge', [8, 17, 2, 1]),
  msStuff('Clavier de musique bleu', [10, 17, 2, 1]),
  ...named('Ballon', [[10, 8], [11, 8], [12, 8], [8, 9], [9, 9], [8, 10]], msChill, { kind: 'object', claim: 1, solid: false }),
];

// ---- Plein air (parasols et transats) ---------------------------------------------------------------------------------
const fiChill = on('fi', 'detente');

const OUTDOOR: Entry[] = [
  fiChill('Parasol vert', [0, 16, 3, 3], { kind: 'object', claim: 1, solid: false }),
  fiChill('Parasol bleu', [3, 16, 3, 3], { kind: 'object', claim: 1, solid: false }),
  fiChill('Parasol clair', [6, 16, 3, 3], { kind: 'object', claim: 1, solid: false }),
  fiChill('Parasol clair (B)', [9, 15, 3, 3], { kind: 'object', claim: 1, solid: false }),
  ...named('Parasol et transat', [[12, 16], [0, 19], [4, 19], [8, 19], [12, 19], [0, 22], [4, 22], [8, 22], [12, 22]], fiChill, { kind: 'object', claim: 2, solid: false }),
];

// ---- Divers (le thème « Generic ») : tapis, fenêtres, tableaux, miroirs, tables, chaises ----------------------------------------
const geDeco = on('ge', 'deco');
const geDesk = on('ge', 'bureaux');
const geSeat = on('ge', 'sieges');
const gePlant = on('ge', 'plantes');
const geStuff = on('ge', 'papeterie');

const GENERIC: Entry[] = [
  ...named('Tapis', [[9, 4], [13, 5], [9, 7], [13, 9], [9, 10], [11, 10], [8, 13], [12, 21], [0, 44], [0, 46], [9, 31]], geDeco, { kind: 'floor' }),
  ...named('Fenêtre', [[6, 43], [8, 43], [10, 43], [12, 43], [14, 43], [14, 45], [14, 47], [7, 8], [5, 9]], geDeco, { kind: 'wall' }),
  ...named('Paysage encadré', [[0, 13], [2, 13], [4, 13]], geDeco, { kind: 'wall' }),
  ...named('Miroir', [[9, 29], [11, 29], [12, 29]], geDeco, { kind: 'wall' }),
  ...named('Ardoise', [[3, 44], [3, 46]], geDeco, { kind: 'wall' }),
  gePlant('Palmier en pot', [13, 25]),
  gePlant('Arbre en pot (A)', [13, 28]),
  gePlant('Arbre en pot (B)', [15, 28]),
  ...named('Téléphone à cadran', [[10, 39], [12, 39], [10, 41], [12, 41]], geStuff, { kind: 'onTop' }),
  ...named('Banc en bois', [[0, 15], [2, 15]], geSeat, { claim: 2, solid: false }),
  ...named('Tabouret en bois', [[0, 17], [1, 17], [2, 17], [0, 19], [1, 19], [2, 19]], geSeat, { solid: false }),
  ...named('Chaise en bois', [[4, 11], [5, 11], [9, 50], [10, 50], [11, 50], [12, 50]], geSeat, { solid: false }),
  geSeat('Canapé rouge', [6, 11, 4, 2], { claim: 2, solid: false }),
  ...named('Grande table', [[0, 5], [0, 8], [0, 34], [5, 34], [0, 37], [5, 37]], geDesk, { claim: 3 }),
  ...named('Table carrée', [[10, 33], [13, 33], [10, 35], [13, 35]], geDesk, { claim: 2 }),
];

export const INTERIOR_ENTRIES: Entry[] = [
  ...GENERIC,
  ...LIVING_ROOM,
  ...CONFERENCE,
  ...TELEVISION,
  ...KITCHEN,
  ...LIBRARY,
  ...MUSIC,
  ...OUTDOOR,
];
