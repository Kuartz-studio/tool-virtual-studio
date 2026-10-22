// Le classement Elo des jeux. Départ à 1200 ; K = 32 tant que le joueur a joué moins de 30 parties classées à ce jeu (avant celle-ci), puis 20 ; à plusieurs
// joueurs, comparaison par paires. La note est un entier, arrondi une seule fois par joueur et par partie.
export const ELO_START = 1200;
export const ELO_K_NEW = 32;
export const ELO_K = 20;
export const ELO_K_NEW_GAMES = 30;

// Le score attendu d'un joueur de cette note contre celui de l'autre : 1 / (1 + 10^((adversaire − joueur) / 400)).
export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

// Le coefficient K d'un joueur qui a déjà joué ce nombre de parties classées à ce jeu.
export function kFactor(gamesBefore: number): number {
  return gamesBefore < ELO_K_NEW_GAMES ? ELO_K_NEW : ELO_K;
}

// L'arrondi à l'entier le plus proche, la moitié loin de zéro : 15,5 → 16 et −15,5 → −16 (Math.round, lui, ramène −15,5 à −15).
export function roundHalfAwayFromZero(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

// Les nouvelles notes d'une partie. `ranking` est en indices de `players`, du meilleur groupe au moins bon (un groupe = des ex æquo). Rend un changement par
// joueur, dans l'ordre de `players`. Pour chaque autre joueur : S vaut 1 si le joueur est dans un meilleur groupe, 0,5 dans le même, 0 dans un moins bon ;
// la note change de (K / (n − 1)) × (S − attendu), additionné sur tous les autres. À deux, c'est l'Elo ordinaire. Les notes d'avant la partie servent à tous
// les calculs.
export function eloChanges(
  players: ReadonlyArray<{ userId: string; rating: number; games: number }>,
  ranking: ReadonlyArray<ReadonlyArray<number>>,
): Array<{ userId: string; before: number; after: number }> {
  const groupOf = new Map<number, number>();
  ranking.forEach((group, index) => group.forEach((seat) => groupOf.set(seat, index)));
  const count = players.length;
  return players.map((player, i) => {
    if (count < 2) return { userId: player.userId, before: player.rating, after: player.rating };
    const k = kFactor(player.games) / (count - 1);
    let delta = 0;
    players.forEach((other, j) => {
      if (j === i) return;
      const mine = groupOf.get(i);
      const theirs = groupOf.get(j);
      if (mine === undefined || theirs === undefined) throw new Error(`eloChanges : le classement ne contient pas le joueur ${mine === undefined ? i : j}`);
      const score = mine < theirs ? 1 : mine === theirs ? 0.5 : 0;
      delta += k * (score - expectedScore(player.rating, other.rating));
    });
    return { userId: player.userId, before: player.rating, after: player.rating + roundHalfAwayFromZero(delta) };
  });
}
