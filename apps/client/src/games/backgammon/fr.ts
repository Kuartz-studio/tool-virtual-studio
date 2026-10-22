// Tous les textes du backgammon (§ 12.3 du document des jeux) : ce qui est sur le tablier, les noms des cases pour le lecteur d'écran, ce que le jeu annonce, la fin de partie et
// l'aide des règles. Les `{nom}` sont remplacés par `t` (i18n/fr.ts). Les textes communs à tous les jeux (les boutons du cadre, la ligne d'état, l'abandon) sont à la plateforme.
export const fr = {
  // Le tablier : son nom, ses deux rangées, la barre et la sortie.
  board: 'Tablier de backgammon',
  rows: { top: 'Rangée du haut : points 13 à 24', bottom: 'Rangée du bas : points 12 à 1, la barre et la sortie' },
  // Les camps : le siège 0 joue les Blancs, le siège 1 les Rouges.
  seats: { white: 'Blancs', red: 'Rouges' },
  // Les pions et leur accord, par camp : au singulier et au pluriel.
  pieces: {
    white: { one: 'pion blanc', many: 'pions blancs' },
    red: { one: 'pion rouge', many: 'pions rouges' },
  },
  point: 'Point {point}',
  bar: 'Barre',
  off: 'Sortie',
  empty: 'vide',
  noneOff: 'aucun pion sorti',
  offOne: '1 pion sorti',
  offMany: '{count} pions sortis',
  and: 'et',
  // L'état d'une case : on le dit après son contenu.
  states: { playable: 'jouable', selected: 'sélectionné', selectedFeminine: 'sélectionnée', target: 'arrivée possible', moved: 'dernier coup' },
  // Les gestes : lancer les dés, défaire la dernière étape, envoyer le tour, sortir un pion (disposition serrée, sans zone de sortie).
  roll: 'Lancer les dés',
  undo: 'Annuler',
  confirm: 'Valider',
  bearOff: 'Sortir',
  // Ce qu'on lit sous le tablier : les étapes jouées, la course, les pions sortis, les dés.
  steps: 'Ton tour : {steps}',
  stepsHint: 'Choisis un pion jouable, puis son arrivée.',
  stepsDone: 'Le tour est complet : valide-le.',
  onlyOne: 'Un seul dé peut être joué.',
  onlySome: '{count} dés seulement peuvent être joués.',
  race: 'Course : {parts}',
  offTotals: 'Sortis : {parts}',
  you: 'toi',
  dice: 'Dés : {values}',
  diceDouble: 'Dés : {values}, doublé',
  noDice: 'Pas de dés',
  // Un tour perdu : ce qui s'affiche un instant.
  noMove: 'Aucun coup possible',
  cantMove: '{name} ne peut pas jouer',
  // Les étapes : « 13→8 », « barre→20 », « 3→sortie ».
  stepBar: 'barre',
  stepOff: 'sortie',
  // Ce que lit le lecteur d'écran (annonces).
  announce: {
    opening: '{name} commence avec {a} et {b}.',
    tie: 'Égalité à l\'ouverture : on relance.',
    rolls: '{name} lance {a} et {b}.',
    plays: '{name} joue {steps}.',
    playsHit: '{name} joue {steps}, et frappe.',
    stepFrom: '{from} vers {to}',
    fromBar: 'la barre',
    toOff: 'la sortie',
    pass: '{name} ne peut pas jouer.',
  },
  // La fin d'une partie : les quinze pions sortis, et ce qu'on y ajoute quand le perdant n'a rien sorti.
  end: {
    bearoff: '{name} a sorti tous ses pions.',
    gammon: 'Gammon !',
    backgammon: 'Backgammon !',
    wins: '{name} gagne.',
  },
  // L'aide « Règles » : de quatre à huit phrases courtes.
  rules: [
    'Chacun ramène ses 15 pions dans sa maison, en bas à droite, puis les sort : le premier qui a tout sorti gagne.',
    'À ton tour, lance les deux dés et joue-les l\'un après l\'autre : un même pion peut jouer les deux. Un doublé se joue quatre fois.',
    'Un point où l\'adversaire a deux pions ou plus est fermé. Un pion adverse seul est frappé : il repart de la barre.',
    'Un pion sur la barre doit rentrer avant tout autre coup, dans la maison adverse.',
    'Tu dois jouer tous les dés que tu peux ; si un seul se joue, joue le plus grand.',
    'Tu ne sors des pions que lorsque tous les autres sont dans ta maison.',
    'Gammon et backgammon sont affichés, mais comptent comme une victoire simple.',
    'Au clavier : les flèches se déplacent sur le tablier, Entrée prend un pion puis le pose, Échap annule le choix.',
  ],
} as const;
