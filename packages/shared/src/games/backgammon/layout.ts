import { pointIndex } from './board';
import { CHECKERS_PER_SEAT, DICE_COUNT, DIE_SIDES, POINT_COUNT } from './constants';
import type { BackgammonState } from './types';

// Une position écrite comme dans le document des jeux (§ 14.5) : « Blancs {9: 1}, sortis 14 ; Rouges {24: 2, 6: 13} » est
// `{ white: { 9: 1 }, whiteOff: 14, red: { 24: 2, 6: 13 } }`. Chaque camp compte ses points depuis sa maison. Sert aux tests et à `debug:game` (les e2e posent une fin de
// partie telle quelle) : le jeu lui-même ne s'en sert jamais.
export interface BackgammonLayout {
  // Les pions de chaque camp : point (dans sa propre numérotation) → nombre de pions. Blancs : siège 0 ; Rouges : siège 1.
  white?: Readonly<Record<number, number>>;
  red?: Readonly<Record<number, number>>;
  whiteBar?: number;
  redBar?: number;
  whiteOff?: number;
  redOff?: number;
  // Le siège qui a le trait (0 par défaut).
  turn?: 0 | 1;
  // Les dés du tour : avec eux, la phase est `move` ; sans eux, c'est `roll`.
  dice?: readonly number[];
  turns?: number;
}

// Le lancer d'ouverture d'une position fabriquée : une paire sans égalité, pour que l'état soit légal (`invariants`). Il n'a pas d'autre rôle.
const FABRICATED_OPENING: [number, number] = [2, 1];

// L'état de cette position. Lève une erreur si elle est impossible (un camp qui n'a pas ses 15 pions, un point pris par les deux camps) : un test qui se trompe de
// position doit échouer tout de suite et bruyamment, pas jouer sur une position fausse.
export function backgammonStateFrom(layout: BackgammonLayout): BackgammonState {
  const points = new Array<number>(POINT_COUNT).fill(0);
  const seats = [
    { seat: 0, name: 'Blancs', camp: layout.white ?? {}, bar: layout.whiteBar ?? 0, off: layout.whiteOff ?? 0 },
    { seat: 1, name: 'Rouges', camp: layout.red ?? {}, bar: layout.redBar ?? 0, off: layout.redOff ?? 0 },
  ] as const;
  for (const { seat, name, camp, bar, off } of seats) {
    let total = bar + off;
    for (const [pointText, count] of Object.entries(camp)) {
      const point = Number(pointText);
      if (!Number.isInteger(point) || point < 1 || point > POINT_COUNT) throw new Error(`${name} : le point ${pointText} n'existe pas.`);
      if (!Number.isInteger(count) || count < 0) throw new Error(`${name} : ${count} pions sur le point ${point}.`);
      const index = pointIndex(seat, point);
      if (points[index] !== 0) throw new Error(`${name} : le point ${point} est déjà pris (un point ne porte que les pions d'un camp).`);
      // Jamais de -0 : un zéro négatif ne survit pas à JSON.
      points[index] = seat === 0 ? count : 0 - count;
      total += count;
    }
    if (total !== CHECKERS_PER_SEAT) throw new Error(`${name} : ${total} pions au lieu de ${CHECKERS_PER_SEAT} (plateau, barre et sortis ensemble).`);
  }
  const dice = layout.dice ? [...layout.dice] : [];
  if (dice.length !== 0 && (dice.length !== DICE_COUNT || dice.some((die) => !Number.isInteger(die) || die < 1 || die > DIE_SIDES))) {
    throw new Error(`Des dés qui n'en sont pas : ${JSON.stringify(layout.dice)}.`);
  }
  return {
    points,
    bar: [layout.whiteBar ?? 0, layout.redBar ?? 0],
    off: [layout.whiteOff ?? 0, layout.redOff ?? 0],
    turn: layout.turn ?? 0,
    phase: dice.length > 0 ? 'move' : 'roll',
    dice,
    opening: [[...FABRICATED_OPENING]],
    turns: layout.turns ?? 0,
    last: null,
    result: null,
  };
}
