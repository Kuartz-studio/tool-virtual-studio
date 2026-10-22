// La géométrie des petits chevaux (document des jeux § 16) : une piste commune de 52 cases parcourue dans le sens des aiguilles d'une montre, et, pour chaque couleur,
// une écurie, une case de départ sur la piste, une allée de 5 cases et l'arrivée. Tout se compte en « avancée » : ce qu'un cheval a parcouru depuis sa case de départ.

// Les chevaux de chaque joueur.
export const LUDO_HORSES = 4;
// Les cases de la piste commune.
export const LUDO_TRACK = 52;
// L'avancée d'un cheval à l'écurie.
export const LUDO_STABLE = -1;
// L'avancée d'un cheval qui vient de sortir de l'écurie : sa case de départ.
export const LUDO_ENTRY = 0;
// La dernière avancée sur la piste commune : un cheval fait 51 cases (son départ, plus 50 pas), puis entre dans son allée.
export const LUDO_LAST_TRACK = 50;
// La première des 5 cases de l'allée (51 à 55), propre à chaque couleur : personne d'autre n'y passe.
export const LUDO_FIRST_LANE = 51;
// L'avancée d'un cheval arrivé. L'arrivée reçoit les quatre chevaux d'une couleur : c'est la seule case où ils peuvent être plusieurs.
export const LUDO_HOME = 56;
// La case de piste du départ de chaque couleur : rouge, vert, jaune, bleu. Un quart de tour de piste les sépare.
export const LUDO_START = [0, 13, 26, 39] as const;
// Les couleurs des sièges, selon le nombre de joueurs : à deux, couleurs opposées (la même distance entre eux).
export const LUDO_COLORS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] } as const;

// Les faces du dé.
export const LUDO_DIE_SIDES = 6;
// Le dé qui sort un cheval de l'écurie.
export const LUDO_EXIT_DIE = 6;
// Le dé qui fait rejouer, même s'il n'a pas pu être joué.
export const LUDO_REROLL_DIE = 6;
// Au troisième 6 de suite dans un même tour, ce 6 n'est pas joué et le tour passe.
export const LUDO_MAX_SIXES = 3;
// Sans cheval en jeu, le joueur a jusqu'à ce nombre de lancers dans son tour pour faire un 6.
export const LUDO_MAX_TRIES = 3;

// La case de la piste commune où se trouve un cheval de cette couleur à cette avancée ; null s'il n'est pas sur la piste (écurie, allée, arrivée), donc ni pris ni preneur.
// C'est le seul passage de l'avancée à la case : deux chevaux ne se rencontrent que sur la piste, par cette case.
export function trackCell(color: number, advance: number): number | null {
  if (advance < LUDO_ENTRY || advance > LUDO_LAST_TRACK) return null;
  return (LUDO_START[color]! + advance) % LUDO_TRACK;
}

// Ce que vaut un cheval au classement : 0 à l'écurie, avancée + 1 sur la piste et dans l'allée, 57 arrivé.
export function horseScore(advance: number): number {
  return advance + 1;
}
