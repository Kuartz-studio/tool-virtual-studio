import { GAME_TURN_WARNING_MS, type GameChairView, type GameMatchView, type GameResult, type GameTableView } from '@bureau/shared';
import { fr, t } from '../i18n/fr';

// Ce que les composants des jeux lisent d'une table, en fonctions pures (sans React) : où est une personne (siège, chaise), le compte à rebours, comment une fin de partie
// se dit, et où en est la revanche.

// Le siège de cette personne dans la partie, ou null (spectateur, ou pas de partie).
export function seatOf(match: GameMatchView | null | undefined, userId: string | null): number | null {
  if (!match || userId === null) return null;
  const seat = match.players.findIndex((player) => player.userId === userId);
  return seat === -1 ? null : seat;
}

// La chaise de cette personne à la table, ou null.
export function chairOf(table: GameTableView | undefined, userId: string | null): number | null {
  if (!table || userId === null) return null;
  const chair = table.chairs.findIndex((candidate) => candidate?.userId === userId);
  return chair === -1 ? null : chair;
}

// Un compte à rebours en minutes et secondes (« 1:12 »), les secondes entamées comptant pour une entière ; jamais négatif.
export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// Le compte à rebours du coup ne s'affiche que dans la dernière minute.
export const countdownVisible = (turnMs: number | null): boolean => turnMs !== null && turnMs <= GAME_TURN_WARNING_MS;

// Un écart de note, avec son signe : « +16 », « −16 » (le vrai signe moins), « ±0 ».
export function formatDelta(delta: number): string {
  if (delta === 0) return '±0';
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

// Le siège seul en tête d'un résultat, ou null (une nulle, ou des ex æquo en tête, n'ont pas de vainqueur seul).
export function soleWinner(result: GameResult | null): number | null {
  const best = result?.ranking[0];
  return best?.length === 1 ? best[0]! : null;
}

// « Alice », « Alice et Claire », « Alice, Bastien et Claire ».
export const listOf = (names: string[]): string => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} et ${names.at(-1)}`);

// La fin d'une partie, en une phrase. Les raisons que la plateforme écrit (abandon, délai, départ, accord) sont dites ici ; celle d'un jeu (« Échec et mat », « Gammon »…) l'est par le
// module du jeu (`own`) ; sans module, le vainqueur ou la nulle. `names` : le nom de chaque siège.
export function endText(result: GameResult, names: string[], own: ((result: GameResult, names: string[]) => string) | null): string {
  const winners = (result.ranking[0] ?? []).map((seat) => names[seat] ?? '');
  const loser = names[result.ranking.at(-1)?.[0] ?? -1] ?? '';
  const twoPlayers = result.ranking.length === 2 && result.ranking.every((group) => group.length === 1);
  switch (result.reason) {
    case 'agreement':
      return fr.games.end.agreement;
    case 'resign':
    case 'timeout':
    case 'disconnect': {
      if (twoPlayers) return t(fr.games.end[result.reason], { loser, winner: winners[0] ?? '' });
      return t(fr.games.end[`${result.reason}Many`], { loser });
    }
    default:
      if (own) return own(result, names);
      if (result.ranking.length === 1 && winners.length > 1) return fr.games.end.drawn;
      return winners.length === 1 ? t(fr.games.end.winner, { name: winners[0]! }) : t(fr.games.end.winners, { names: listOf(winners) });
  }
}

// La phrase de la revanche pour cette personne assise, au bout d'une partie : qui l'a déjà acceptée (« prêt »), qui on attend. Elle commence quand toutes les personnes assises,
// assez nombreuses, l'ont acceptée : `minPlayers` est celui du jeu, null quand son module n'est pas là.
export function rematchLine(table: GameTableView, selfId: string | null, minPlayers: number | null): string {
  const seated = table.chairs.flatMap((chair) => (chair ? [chair] : []));
  if (minPlayers !== null && seated.length < minPlayers) return t(fr.games.lobby.needMore, { count: minPlayers });
  const others = seated.filter((chair) => chair.userId !== selfId);
  const accepted = others.filter((chair) => chair.ready).map((chair) => chair.name);
  const waiting = others.filter((chair) => !chair.ready).map((chair) => chair.name);
  if (seated.some((chair) => chair.userId === selfId && chair.ready)) {
    return waiting.length > 0 ? t(fr.games.rematch.asked, { names: listOf(waiting) }) : fr.games.lobby.allReady;
  }
  if (accepted.length === 0) return fr.games.rematch.open;
  const many = accepted.length > 1;
  if (waiting.length === 0) return t(many ? fr.games.rematch.askedByMany : fr.games.rematch.askedBy, { names: listOf(accepted) });
  return t(many ? fr.games.rematch.askedByManyAndWaiting : fr.games.rematch.askedByAndWaiting, { names: listOf(accepted), others: listOf([...waiting, fr.games.you]) });
}

// Les personnes assises qui ont accepté une revanche que cette personne, assise elle aussi, n'a pas encore acceptée ; personne sans partie finie à cette table.
export function rematchAskers(table: GameTableView | undefined, selfId: string | null): GameChairView[] {
  if (table?.match?.status !== 'ended' || selfId === null) return [];
  const mine = table.chairs.find((chair) => chair?.userId === selfId);
  if (!mine || mine.ready) return [];
  return table.chairs.flatMap((chair) => (chair && chair.userId !== selfId && chair.ready ? [chair] : []));
}

export interface RatingLine {
  userId: string;
  name: string;
  before: number;
  after: number;
  delta: number;
}

// Les changements de note d'une partie finie et classée, dans l'ordre des sièges ; rien sans notes (non classée, base en panne, partie en cours).
export function ratingLines(match: GameMatchView | null | undefined): RatingLine[] {
  if (!match?.ratings) return [];
  return match.players.flatMap((player) => {
    const rating = match.ratings!.find((candidate) => candidate.userId === player.userId);
    return rating ? [{ userId: player.userId, name: player.name, before: rating.before, after: rating.after, delta: rating.after - rating.before }] : [];
  });
}
