import { boardFor, positionFrom, type Board } from './board';
import { BAR_POINT, BLOCKING_CHECKERS, DICE_COUNT, DIE_SIDES, DOUBLET_STEPS, HOME_SIZE, POINT_COUNT } from './constants';
import type { BackgammonState, BgPosition, BgStep } from './types';

// Les coups d'un tour. Tout le difficile du backgammon est ici : chercher les étapes permises, et surtout décider, sur le tour entier, combien de dés il faut jouer
// (R7 : jouer les deux dés si c'est possible, les quatre pour un doublé ; sinon autant que possible ; et si un seul dé se joue, le plus grand quand on a le choix).
// La recherche travaille sur `Board` (le plateau vu par celui qui joue), en posant et reprenant chaque étape sur place, avec une mémoire des positions déjà vues :
// un doublé joue souvent les mêmes pions dans un autre ordre, ce qui donne la même position.

// Une étape pour la recherche : 0 veut dire la barre en `from`, la sortie en `to` (les nombres vont plus vite que les chaînes dans la boucle chaude).
interface Step {
  from: number;
  to: number;
  die: number;
  hit: boolean;
}
const BAR = 0;
const OFF = 0;

export const toBgStep = (step: Step): BgStep => ({ from: step.from === BAR ? 'bar' : step.from, to: step.to === OFF ? 'off' : step.to, die: step.die });

// Les dés à jouer, du plus grand au plus petit : deux dés, ou quatre fois le même pour un doublé. Pas de dés (phase `roll`, ou état abîmé) : rien à jouer.
export function diceToPlay(dice: readonly number[]): number[] {
  if (dice.length !== DICE_COUNT) return [];
  const [a, b] = dice as [number, number];
  if (a === b) return new Array<number>(DOUBLET_STEPS).fill(a);
  return a > b ? [a, b] : [b, a];
}

// Les étapes permises avec ce dé, sur la position telle qu'elle est (le reste du tour n'entre pas en compte ici).
function stepsFor(board: Board, die: number): Step[] {
  const steps: Step[] = [];
  if (board.bar > 0) {
    // R9 : un pion sur la barre doit entrer d'abord, sur le point 25 − d de la maison adverse.
    const to = BAR_POINT - die;
    const against = board.opp[to] ?? 0;
    if (against < BLOCKING_CHECKERS) steps.push({ from: BAR, to, die, hit: against === 1 });
    return steps;
  }
  // Le point le plus haut qui porte un pion à soi : la sortie n'est permise que si c'est dans la maison (R10), et un dé trop fort ne sort que ce pion-là.
  let highest = 0;
  for (let point = POINT_COUNT; point >= 1; point--) {
    if ((board.own[point] ?? 0) > 0) {
      highest = point;
      break;
    }
  }
  const mayBearOff = highest <= HOME_SIZE;
  for (let from = highest; from >= 1; from--) {
    if ((board.own[from] ?? 0) === 0) continue;
    const to = from - die;
    if (to >= 1) {
      const against = board.opp[to] ?? 0;
      if (against < BLOCKING_CHECKERS) steps.push({ from, to, die, hit: against === 1 });
    } else if (mayBearOff && (to === 0 || from === highest)) {
      // Sortie : avec le dé exact, ou avec un dé plus fort mais seulement pour le pion le plus éloigné de la sortie (sinon il faut jouer un pion plus haut).
      steps.push({ from, to: OFF, die, hit: false });
    }
  }
  return steps;
}

// Pose une étape sur le plateau, et la reprend : la recherche essaie des milliers de suites sur le même plateau.
function applyStep(board: Board, step: Step): void {
  if (step.from === BAR) board.bar--;
  else board.own[step.from]!--;
  if (step.to === OFF) board.off++;
  else {
    if (step.hit) {
      board.opp[step.to]!--;
      board.oppBar++;
    }
    board.own[step.to]!++;
  }
}

function undoStep(board: Board, step: Step): void {
  if (step.to === OFF) board.off--;
  else {
    board.own[step.to]!--;
    if (step.hit) {
      board.opp[step.to]!++;
      board.oppBar--;
    }
  }
  if (step.from === BAR) board.bar++;
  else board.own[step.from]!++;
}

// Une clé exacte de la position : les pions de chacun sur chaque point, la barre et les sorties. Les nombres de pions vont de 0 à 15 : un caractère chacun.
function boardKey(board: Board): string {
  let key = '';
  for (let point = 1; point <= POINT_COUNT; point++) key += String.fromCharCode(48 + (board.own[point] ?? 0), 48 + (board.opp[point] ?? 0));
  return `${key}${board.bar}.${board.oppBar}.${board.off}.${board.oppOff}`;
}

// Combien d'étapes on peut encore jouer au plus à partir de cette position avec ces dés restants (triés du plus grand au plus petit). La mémoire garde le meilleur de
// chaque (position, dés restants) : l'ordre dans lequel on est arrivé là n'y change rien.
function bestFrom(board: Board, remaining: readonly number[], memo: Map<string, number>): number {
  if (remaining.length === 0) return 0;
  const key = `${boardKey(board)}/${remaining.join('')}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  let best = 0;
  for (let index = 0; index < remaining.length && best < remaining.length; index++) {
    const die = remaining[index]!;
    // Les dés sont triés : un dé égal au précédent donnerait les mêmes étapes.
    if (index > 0 && die === remaining[index - 1]) continue;
    const rest = remaining.filter((_, position) => position !== index);
    for (const step of stepsFor(board, die)) {
      applyStep(board, step);
      const length = 1 + bestFrom(board, rest, memo);
      undoStep(board, step);
      if (length > best) best = length;
      // Tous les dés sont joués : on ne peut pas faire mieux.
      if (best === remaining.length) break;
    }
  }
  memo.set(key, best);
  return best;
}

// R7, le cas du dé unique : quand on ne peut jouer qu'un seul dé (`max` vaut 1) avec deux dés différents, il faut jouer le plus grand s'il se joue. Rend le dé
// imposé à la première étape, ou null quand on a le choix.
function mandatoryDie(board: Board, dice: readonly number[], max: number): number | null {
  if (max !== 1 || dice.length !== DICE_COUNT || dice[0] === dice[1]) return null;
  const larger = Math.max(dice[0]!, dice[1]!);
  return stepsFor(board, larger).length > 0 ? larger : null;
}

// Parcourt les suites qui jouent `target` étapes de plus, et note, pour chaque position finale, la première suite trouvée qui y mène.
function collect(
  board: Board,
  remaining: readonly number[],
  path: Step[],
  target: number,
  mandatory: number | null,
  memo: Map<string, number>,
  found: Map<string, Step[]>,
  seen: Set<string>,
): void {
  if (target === 0) {
    const key = boardKey(board);
    if (!found.has(key)) found.set(key, path.map((step) => ({ ...step })));
    return;
  }
  const node = `${boardKey(board)}/${remaining.join('')}`;
  if (seen.has(node)) return;
  seen.add(node);
  for (let index = 0; index < remaining.length; index++) {
    const die = remaining[index]!;
    if (index > 0 && die === remaining[index - 1]) continue;
    if (mandatory !== null && path.length === 0 && die !== mandatory) continue;
    const rest = remaining.filter((_, position) => position !== index);
    for (const step of stepsFor(board, die)) {
      applyStep(board, step);
      // Seules les suites qui peuvent encore atteindre le maximum comptent : un pas qui l'empêcherait est illégal (R7 se décide sur le tour entier).
      if (1 + bestFrom(board, rest, memo) === target) {
        path.push(step);
        collect(board, rest, path, target - 1, mandatory, memo, found, seen);
        path.pop();
      }
      undoStep(board, step);
    }
  }
}

// Tous les tours légaux de ce plateau avec ces dés : un par position finale différente (la première suite d'étapes qui y mène), et le nombre de dés à jouer.
export function playsFor(board: Board, dice: readonly number[]): { max: number; plays: BgStep[][] } {
  const remaining = diceToPlay(dice);
  const memo = new Map<string, number>();
  const max = bestFrom(board, remaining, memo);
  if (max === 0) return { max, plays: [] };
  const found = new Map<string, Step[]>();
  collect(board, remaining, [], max, mandatoryDie(board, dice, max), memo, found, new Set());
  return { max, plays: [...found.values()].map((path) => path.map(toBgStep)) };
}

// Peut-on jouer au moins une étape avec ces dés ? (Le tour est passé sinon.) Bien moins cher que de compter le maximum.
export function canMove(board: Board, dice: readonly number[]): boolean {
  return diceToPlay(dice).some((die) => stepsFor(board, die).length > 0);
}

// Retrouve, parmi les étapes permises, celle qu'une étape reçue désigne : un dé encore à jouer, un départ, une arrivée. Rend null si ce n'est pas une étape bien formée
// ou si elle n'est pas permise sur la position du moment.
function findStep(board: Board, raw: BgStep, remaining: readonly number[]): Step | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { from, to, die } = raw;
  const fromOk = from === 'bar' || (Number.isInteger(from) && from >= 1 && from <= POINT_COUNT);
  const toOk = to === 'off' || (Number.isInteger(to) && to >= 1 && to <= POINT_COUNT);
  if (!fromOk || !toOk || !Number.isInteger(die) || die < 1 || die > DIE_SIDES || !remaining.includes(die)) return null;
  const fromNumber = from === 'bar' ? BAR : from;
  const toNumber = to === 'off' ? OFF : to;
  return stepsFor(board, die).find((step) => step.from === fromNumber && step.to === toNumber) ?? null;
}

// Ce que `playTurn` a décidé d'un `play` : refusé (avec un code court en anglais), ou accepté avec le plateau obtenu et les étapes jouées.
export type TurnCheck =
  | { ok: true; position: BgPosition; steps: Array<BgStep & { hit: boolean }> }
  | { ok: false; error: 'illegal' | 'incomplete' | 'larger_die' };

// Vérifie un tour entier rejoué dans l'ordre reçu : chaque étape légale sur la position du moment avec un dé encore à jouer, autant d'étapes que le maximum jouable
// (R7), et le plus grand dé quand un seul se joue.
export function checkTurn(state: BackgammonState, seat: number, steps: readonly BgStep[]): TurnCheck {
  const board = boardFor(state, seat);
  const remaining = diceToPlay(state.dice);
  const max = bestFrom(board, remaining, new Map());
  if (steps.length > max) return { ok: false, error: 'illegal' };
  if (steps.length < max) return { ok: false, error: 'incomplete' };
  const mandatory = mandatoryDie(board, state.dice, max);
  const played: Array<BgStep & { hit: boolean }> = [];
  for (const [index, raw] of steps.entries()) {
    const step = findStep(board, raw, remaining);
    if (!step) return { ok: false, error: 'illegal' };
    if (index === 0 && mandatory !== null && step.die !== mandatory) return { ok: false, error: 'larger_die' };
    applyStep(board, step);
    remaining.splice(remaining.indexOf(step.die), 1);
    played.push({ ...toBgStep(step), hit: step.hit });
  }
  return { ok: true, position: positionFrom(board, seat), steps: played };
}

// Le nombre de dés qu'il faut jouer ce tour-ci (R7) : le tour est complet quand on en a joué autant. 0 hors de la phase `move`.
export function maxPlayableSteps(state: BackgammonState): number {
  if (state.phase !== 'move') return 0;
  return bestFrom(boardFor(state, state.turn), diceToPlay(state.dice), new Map());
}

// Les étapes qu'on peut jouer ensuite, quand on a déjà joué `done` : celles qui laissent encore finir un tour légal (un préfixe d'une suite légale maximale). Vide si
// `done` n'est pas un début de tour légal, ou si le tour est complet. C'est ce que l'interface éclaire.
export function nextSteps(state: BackgammonState, done: readonly BgStep[]): BgStep[] {
  if (state.phase !== 'move') return [];
  const board = boardFor(state, state.turn);
  const remaining = diceToPlay(state.dice);
  const memo = new Map<string, number>();
  const max = bestFrom(board, remaining, memo);
  const mandatory = mandatoryDie(board, state.dice, max);
  for (const raw of done) {
    const step = findStep(board, raw, remaining);
    if (!step) return [];
    applyStep(board, step);
    remaining.splice(remaining.indexOf(step.die), 1);
  }
  const need = max - done.length;
  if (need <= 0) return [];
  const next = new Map<string, BgStep>();
  for (let index = 0; index < remaining.length; index++) {
    const die = remaining[index]!;
    if (index > 0 && die === remaining[index - 1]) continue;
    if (mandatory !== null && done.length === 0 && die !== mandatory) continue;
    const rest = remaining.filter((_, position) => position !== index);
    for (const step of stepsFor(board, die)) {
      applyStep(board, step);
      if (1 + bestFrom(board, rest, memo) === need) next.set(`${step.from}>${step.to}/${step.die}`, toBgStep(step));
      undoStep(board, step);
    }
  }
  return [...next.values()];
}

// Le plateau après ces étapes, sans hasard ni obligation de finir le tour : pour montrer en aperçu ce que le joueur est en train de jouer. Rend null si une étape n'est
// pas permise sur la position du moment (ou si un dé manque).
export function previewSteps(state: BackgammonState, steps: readonly BgStep[]): BgPosition | null {
  const board = boardFor(state, state.turn);
  // Hors de la phase `move`, il n'y a pas de dé à jouer (une partie finie garde ceux de son dernier tour, qui sont déjà joués).
  const remaining = state.phase === 'move' ? diceToPlay(state.dice) : [];
  for (const raw of steps) {
    const step = findStep(board, raw, remaining);
    if (!step) return null;
    applyStep(board, step);
    remaining.splice(remaining.indexOf(step.die), 1);
  }
  return positionFrom(board, state.turn);
}
