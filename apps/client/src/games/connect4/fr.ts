import { t } from '../../i18n/fr';

// Tous les textes du Puissance 4 : ce que dit le plateau, ce que lit le lecteur d'écran, comment le jeu dit sa fin, l'aide des règles. Ce qui est commun aux quatre jeux (« À toi de jouer »,
// « Abandonner », les notes) est écrit par la plateforme : i18n/fr.ts, section `games`.
export const connect4Fr = {
  // Les deux camps, par siège : le siège 0 joue les jetons rouges, le siège 1 les jaunes. `name` : la pastille de la ligne du joueur ; `adjective` : la couleur dans une phrase.
  seats: [
    { name: 'Rouge', adjective: 'rouge' },
    { name: 'Jaune', adjective: 'jaune' },
  ],
  // Le groupe des sept colonnes : ce que lit un lecteur d'écran en y entrant.
  columns: 'Colonnes',
  // Une colonne, de bas en haut : « Colonne 4 : rouge, jaune, rouge ; 3 places libres ».
  column: 'Colonne {n} : {tokens} ; {free}',
  emptyColumn: 'vide',
  freePlaces: { none: 'colonne pleine', one: '1 place libre', many: '{count} places libres' },
  // Ce que le lecteur d'écran entend d'un jeton.
  announce: { drop: '{name} joue en colonne {n}.' },
  // La fin de la partie, pour les deux raisons du jeu (celles de la plateforme : abandon, délai, départ, sont à elle).
  end: { four: 'Quatre alignés : {name} gagne.', full: 'Grille pleine : nulle.' },
  // L'aide « Règles » du panneau.
  rules: [
    'Sept colonnes, six rangées : chacun son tour, on lâche un jeton de sa couleur dans une colonne.',
    'Le jeton tombe tout en bas de la colonne, ou sur le dernier jeton posé.',
    'Le premier qui aligne quatre jetons gagne, en ligne, en colonne ou en diagonale.',
    'Si la grille se remplit sans quatre alignés, la partie est nulle.',
    'À chaque revanche, c\'est l\'autre qui commence.',
    'Au clavier : les flèches choisissent la colonne, Entrée ou Espace lâche le jeton, et les touches 1 à 7 jouent leur colonne.',
  ],
} as const;

// Le nom d'une colonne pour le lecteur d'écran : son numéro (de 1 à 7), ses jetons de bas en haut (un siège chacun), et ce qu'il y reste de place.
export function columnLabel(col: number, seats: readonly number[], free: number): string {
  const tokens = seats.length === 0 ? connect4Fr.emptyColumn : seats.map((seat) => connect4Fr.seats[seat]?.adjective ?? '').join(', ');
  const places = free === 0 ? connect4Fr.freePlaces.none : free === 1 ? connect4Fr.freePlaces.one : t(connect4Fr.freePlaces.many, { count: free });
  return t(connect4Fr.column, { n: col + 1, tokens, free: places });
}
