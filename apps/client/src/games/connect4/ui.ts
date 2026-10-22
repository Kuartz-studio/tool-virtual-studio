import type { GameResult } from '@bureau/shared';
import type { Connect4Event, Connect4State } from '@bureau/shared/games/connect4';
import type { SfxId } from '../../audio/catalog';
import { t } from '../../i18n/fr';
import { endText } from '../table-view';
import { connect4Fr } from './fr';
import { TOKEN_PALETTES } from './sprites';

// Ce que le Puissance 4 dit à la plateforme (le contrat `GameUi`, § 9.4 du document des jeux) : le nom et la couleur de chaque siège, la fin de la partie, l'annonce d'un jeton au lecteur
// d'écran, les sons d'un lot d'événements, l'aide des règles.

type Drop = Extract<Connect4Event, { type: 'drop' }>;
const isDrop = (event: Connect4Event): event is Drop => event.type === 'drop';

// La pastille de la ligne d'un joueur : le camp du siège, dans la couleur de son jeton.
export function seatLabel(seat: number, _state: Connect4State): { name: string; color: string } {
  return { name: connect4Fr.seats[seat]?.name ?? '', color: (seat === 1 ? TOKEN_PALETTES.yellow : TOKEN_PALETTES.red).b! };
}

// La fin d'une partie. Les deux raisons du jeu sont dites ici ; les autres (abandon, délai, départ) le sont par la plateforme avant d'arriver jusqu'ici, mais on les dit juste aussi si on nous
// les donne.
export function describeResult(result: GameResult, names: string[], _state: Connect4State): string {
  switch (result.reason) {
    case 'four':
      return t(connect4Fr.end.four, { name: names[result.ranking[0]?.[0] ?? -1] ?? '' });
    case 'full':
      return connect4Fr.end.full;
    default:
      return endText(result, names, null);
  }
}

// Ce qu'entend le lecteur d'écran d'un coup : qui joue, dans quelle colonne (de 1 à 7), et la fin de la partie quand ce jeton l'a finie. Rien sans jeton (un saut d'état, un abandon : la
// plateforme dit elle-même ce qu'il y a à dire).
export function announce(events: Connect4Event[], state: Connect4State, names: string[]): string | null {
  const dropped = events.filter(isDrop).at(-1);
  if (!dropped) return null;
  const sentence = t(connect4Fr.announce.drop, { name: names[dropped.seat] ?? '', n: dropped.col + 1 });
  const ended = events.some((event) => event.type === 'end') && state.result !== null;
  return ended ? `${sentence} ${describeResult(state.result!, names, state)}` : sentence;
}

// Un jeton fait « piece », une fois chacun. La fin de partie n'ajoute rien (la victoire est jouée par la plateforme), ni un abandon.
export function sounds(events: Connect4Event[], _mySeat: number | null): SfxId[] {
  return events.filter(isDrop).map(() => 'piece');
}

// L'aide « Règles » du panneau.
export const rules: string[] = [...connect4Fr.rules];
