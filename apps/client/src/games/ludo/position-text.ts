import { LUDO_FIRST_LANE, LUDO_HOME, LUDO_STABLE, LUDO_ENTRY, horseScore, type LudoState } from '@bureau/shared/games/ludo';
import { ludoFr, t } from './fr';

// L'équivalent texte du plateau (« Position des chevaux », § 16.6 du document des jeux) : le lecteur d'écran le lit à la place de l'image. Une phrase par couleur en jeu, qui dit où est
// chacun de ses quatre chevaux, par son numéro (celui du bouton « Cheval 2 : avancer de 4 »). Et ce que vaut une avancée, pour le classement de fin de partie.

// Où est ce cheval, en une expression : à l'écurie, sur sa case de départ, à tant de cases de son départ, dans son allée, arrivé.
function whereIs(advance: number, n: number): string {
  if (advance === LUDO_STABLE) return t(ludoFr.board.horseStable, { n });
  if (advance === LUDO_ENTRY) return t(ludoFr.board.horseStart, { n });
  if (advance >= LUDO_HOME) return t(ludoFr.board.horseHome, { n });
  if (advance >= LUDO_FIRST_LANE) return t(ludoFr.board.horseLane, { n, k: advance - LUDO_FIRST_LANE + 1 });
  return advance === 1 ? t(ludoFr.board.horseTrackOne, { n }) : t(ludoFr.board.horseTrack, { n, steps: advance });
}

// Les lignes de « Position des chevaux », une par siège, dans l'ordre des sièges. `names` : le nom de chaque siège (peut en manquer, dans l'aperçu) ; `mySeat` : « (toi) ».
export function positionLines(state: LudoState, names: readonly string[], mySeat: number | null): string[] {
  return state.horses.map((row, seat) => {
    const color = ludoFr.colorNames[state.colors[seat]!] ?? '';
    const name = names[seat] ?? '';
    const gone = state.out.some((entry) => entry.seat === seat);
    if (gone) return t(ludoFr.board.positionOut, { color, name });
    const horses = row.map((advance, index) => whereIs(advance, index + 1)).join(ludoFr.board.positionJoin);
    if (name === '') return t(ludoFr.board.positionSeatAnonymous, { color, horses });
    return t(seat === mySeat ? ludoFr.board.positionSeatMine : ludoFr.board.positionSeat, { color, name, horses });
  });
}

// Ce que vaut un siège au classement : la somme de ce que valent ses chevaux (0 à l'écurie, avancée + 1 sur la piste et dans l'allée, 57 arrivé) ; 228 au plus.
export function scoreOf(row: readonly number[]): number {
  return row.reduce((sum, advance) => sum + horseScore(advance), 0);
}
