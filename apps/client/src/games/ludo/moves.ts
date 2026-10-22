import { LUDO_HOME, LUDO_STABLE, landingOf, ludo, type LudoState } from '@bureau/shared/games/ludo';
import { ludoFr, t } from './fr';

// Les coups qu'un siège peut jouer en phase `move`, décrits pour l'interface : la liste en boutons (le chemin du clavier, du lecteur d'écran et du téléphone), les chevaux soulignés
// sur le plateau, la case d'arrivée qu'on marque au survol. Les règles ne sont pas refaites ici : `legalMoves` dit les coups, `landingOf` dit où ils mènent et qui ils prennent.

export interface MoveOption {
  // Le cheval joué (0 à 3), tel que le moteur l'attend dans { type: 'move', horse }.
  horse: number;
  from: number;
  // Où il arrive : l'avancée.
  to: number;
  // Le cheval adverse qu'il prend en s'arrêtant là, ou null.
  capture: { seat: number; horse: number } | null;
  // Le nom du bouton : « Sortir un cheval », « Cheval 2 : avancer de 4, prise ! », « Cheval 3 : arrivée ».
  label: string;
}

export function moveOptions(state: LudoState, seat: number): MoveOption[] {
  if (state.phase !== 'move' || state.die === null) return [];
  const die = state.die;
  return ludo.legalMoves(state, seat).flatMap((move) => {
    if (move.type !== 'move') return [];
    const { from, to, captured } = landingOf(state, seat, move.horse, die);
    const taking = captured ? ludoFr.moves.capture : '';
    const n = move.horse + 1;
    const label = from === LUDO_STABLE ? `${ludoFr.moves.exit}${taking}` : to === LUDO_HOME ? t(ludoFr.moves.arrive, { n }) : `${t(ludoFr.moves.advance, { n, steps: die })}${taking}`;
    return [{ horse: move.horse, from, to, capture: captured, label }];
  });
}
