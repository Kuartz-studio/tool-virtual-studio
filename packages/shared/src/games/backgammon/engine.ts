import { rollDie } from '../rng';
import type { ApplyResult, ForfeitReason, GameResult, GameSetup, Rng } from '../types';
import { boardFor, checkersAt, startingPoints } from './board';
import { CHECKERS_PER_SEAT, DICE_COUNT, DIE_SIDES, HOME_SIZE, MAX_OPENING_ROLLS, POINT_COUNT } from './constants';
import { canMove, checkTurn, playsFor } from './search';
import type { BackgammonEndKind, BackgammonEvent, BackgammonMove, BackgammonState, BgPosition, BgStep } from './types';

// Les règles du backgammon (§ 14 du document des jeux) : créer la partie, lancer, jouer un tour, abandonner, et vérifier qu'un état est légal. Tout est pur : chaque
// fonction rend un nouvel état, sans rien modifier de ce qu'on lui donne. Les dés ne se tirent que dans `createGame` et dans le lancer de `applyMove`.

const other = (seat: 0 | 1): 0 | 1 => (seat === 0 ? 1 : 0);
const refuse = (error: string): { ok: false; error: string } => ({ ok: false, error });

// L'ouverture (R3) : chacun lance un dé, on relance les égalités ; le plus haut commence et joue ces deux dés-là, sans nouveau lancer. `first` est ignoré : le
// lancer décide, comme dans la règle.
export function createGame(setup: GameSetup, rng: Rng): { state: BackgammonState; events: BackgammonEvent[] } {
  if (setup.seats !== 2) throw new Error('Le backgammon se joue à deux.');
  const opening: Array<[number, number]> = [];
  for (;;) {
    if (opening.length >= MAX_OPENING_ROLLS) throw new Error(`L'ouverture ne se départage pas en ${MAX_OPENING_ROLLS} lancers : le générateur est-il constant ?`);
    // L'ordre compte : le dé du siège 0, puis celui du siège 1.
    const roll: [number, number] = [rollDie(rng), rollDie(rng)];
    opening.push(roll);
    if (roll[0] !== roll[1]) break;
  }
  const decisive = opening[opening.length - 1]!;
  const first: 0 | 1 = decisive[0] > decisive[1] ? 0 : 1;
  const state: BackgammonState = {
    points: startingPoints(),
    bar: [0, 0],
    off: [0, 0],
    turn: first,
    phase: 'move',
    dice: [...decisive],
    opening,
    turns: 0,
    last: null,
    result: null,
  };
  return { state, events: [{ type: 'opening', rolls: opening.map(([a, b]): [number, number] => [a, b]), first }] };
}

export function turnOf(state: BackgammonState): number | null {
  return state.phase === 'over' ? null : state.turn;
}

// Phase `roll` : lancer. Phase `move` : un `play` par position finale différente (§ 14.3).
export function legalMovesOf(state: BackgammonState, seat: number): BackgammonMove[] {
  if (state.phase === 'over' || seat !== state.turn) return [];
  if (state.phase === 'roll') return [{ type: 'roll' }];
  return playsFor(boardFor(state, seat), state.dice).plays.map((steps): BackgammonMove => ({ type: 'play', steps }));
}

// Gammon : le perdant n'a sorti aucun pion ; backgammon : en plus, il a un pion sur la barre ou dans la maison du gagnant (R11).
function endKind(position: BgPosition, winner: 0 | 1): BackgammonEndKind {
  const loser = other(winner);
  if (position.off[loser] > 0) return 'simple';
  if (position.bar[loser] > 0) return 'backgammon';
  for (let point = 1; point <= HOME_SIZE; point++) {
    if (checkersAt(position, winner, point).owner === loser) return 'backgammon';
  }
  return 'gammon';
}

export function applyMove(state: BackgammonState, seat: number, move: BackgammonMove, rng: Rng): ApplyResult<BackgammonState, BackgammonEvent> {
  if (state.phase === 'over') return refuse('game_over');
  if (seat !== state.turn) return refuse('not_your_turn');
  if (typeof move !== 'object' || move === null) return refuse('illegal');
  if (move.type === 'roll') return roll(state, state.turn, rng);
  if (move.type === 'play') return playTurn(state, state.turn, move.steps);
  return refuse('illegal');
}

// Lancer les deux dés (R4). Aucun déplacement possible : le tour est perdu, et il passe tout seul à l'autre (R12), dans le même appel (R5).
function roll(state: BackgammonState, seat: 0 | 1, rng: Rng): ApplyResult<BackgammonState, BackgammonEvent> {
  if (state.phase !== 'roll') return refuse('wrong_phase');
  const values: [number, number] = [rollDie(rng), rollDie(rng)];
  const events: BackgammonEvent[] = [{ type: 'dice', seat, values }];
  if (!canMove(boardFor(state, seat), values)) {
    events.push({ type: 'pass', seat });
    return { ok: true, state: { ...state, turn: other(seat), phase: 'roll', dice: [], last: { seat, dice: [...values], steps: [] } }, events };
  }
  return { ok: true, state: { ...state, phase: 'move', dice: [...values] }, events };
}

// Jouer le tour entier d'un bloc : les étapes sont rejouées dans l'ordre reçu, chacune légale sur la position du moment, et il y en a autant que le maximum jouable (R7).
function playTurn(state: BackgammonState, seat: 0 | 1, steps: BgStep[]): ApplyResult<BackgammonState, BackgammonEvent> {
  if (state.phase !== 'move') return refuse('wrong_phase');
  if (!Array.isArray(steps) || steps.length === 0) return refuse('illegal');
  const checked = checkTurn(state, seat, steps);
  if (!checked.ok) return refuse(checked.error);
  const events: BackgammonEvent[] = checked.steps.map(({ from, to, die, hit }) => ({ type: 'step', seat, from, to, die, hit }));
  const next: BackgammonState = {
    ...state,
    points: checked.position.points,
    bar: checked.position.bar,
    off: checked.position.off,
    turns: state.turns + 1,
    last: { seat, dice: [...state.dice], steps: checked.steps.map(({ from, to, die }) => ({ from, to, die })) },
  };
  if (next.off[seat] === CHECKERS_PER_SEAT) {
    const kind = endKind(next, seat);
    const result: GameResult = { ranking: [[seat], [other(seat)]], reason: 'bearoff', detail: { kind } };
    events.push({ type: 'end', winner: seat, kind });
    return { ok: true, state: { ...next, phase: 'over', result }, events };
  }
  return { ok: true, state: { ...next, turn: other(seat), phase: 'roll', dice: [] }, events };
}

// L'abandon, l'inactivité ou le départ (R13) : défaite simple, jamais un gammon, même si la partie vient de commencer.
export function forfeitSeat(state: BackgammonState, seat: number, reason: ForfeitReason): { state: BackgammonState; events: BackgammonEvent[] } {
  if (state.phase === 'over' || (seat !== 0 && seat !== 1)) return { state, events: [] };
  const kind: BackgammonEndKind = 'simple';
  const result: GameResult = { ranking: [[other(seat)], [seat]], reason, detail: { kind } };
  return { state: { ...state, phase: 'over', result }, events: [{ type: 'forfeit', seat, reason }] };
}

const isDie = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= DIE_SIDES;
// Un entier sans -0 (qui ne survivrait pas à JSON), entre 0 et `max` en valeur absolue.
const isCount = (value: unknown, max: number, signed = false): boolean =>
  typeof value === 'number' && Number.isInteger(value) && !Object.is(value, -0) && (signed ? Math.abs(value) <= max : value >= 0 && value <= max);

// Une phrase par violation (§ 14.3) ; [] quand l'état est légal. Les e2e fabriquent des états (`debug:game`) : on ne fait confiance à rien de ce qu'on lit.
export function invariantsOf(state: BackgammonState): string[] {
  const raw: unknown = state;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return ['l\'état n\'est pas un objet'];
  const s = raw as Record<string, unknown>;
  const problems: string[] = [];

  // La forme d'abord : la suite suppose que chaque champ a la bonne.
  const points = s.points;
  if (!Array.isArray(points) || points.length !== POINT_COUNT || !points.every((count) => isCount(count, CHECKERS_PER_SEAT, true))) {
    problems.push(`points doit être ${POINT_COUNT} entiers de -${CHECKERS_PER_SEAT} à ${CHECKERS_PER_SEAT}`);
  }
  for (const name of ['bar', 'off'] as const) {
    const pair = s[name];
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((count) => isCount(count, CHECKERS_PER_SEAT))) problems.push(`${name} doit être deux entiers de 0 à ${CHECKERS_PER_SEAT}`);
  }
  if (s.turn !== 0 && s.turn !== 1) problems.push(`turn vaut ${JSON.stringify(s.turn)} au lieu de 0 ou 1`);
  if (s.phase !== 'roll' && s.phase !== 'move' && s.phase !== 'over') problems.push(`phase vaut ${JSON.stringify(s.phase)}`);
  if (!Array.isArray(s.dice) || !s.dice.every(isDie) || (s.dice.length !== 0 && s.dice.length !== DICE_COUNT)) problems.push('dice doit être vide ou deux dés de 1 à 6');
  const opening = s.opening;
  if (!Array.isArray(opening) || opening.length === 0 || !opening.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every(isDie))) {
    problems.push('opening doit être une liste non vide de paires de dés');
  } else {
    const decisive = opening[opening.length - 1] as number[];
    if (decisive[0] === decisive[1]) problems.push('le dernier lancer d\'ouverture est une égalité : il aurait dû être relancé');
  }
  if (!isCount(s.turns, Number.MAX_SAFE_INTEGER)) problems.push('turns doit être un entier positif');
  const last = s.last;
  if (last !== null) {
    const turnRecord = last as Record<string, unknown> | undefined;
    const shaped = typeof turnRecord === 'object' && (turnRecord.seat === 0 || turnRecord.seat === 1) && Array.isArray(turnRecord.dice) && Array.isArray(turnRecord.steps);
    if (!shaped) problems.push('last doit être null ou { seat, dice, steps }');
  }
  const result = s.result as { ranking?: unknown; reason?: unknown } | null | undefined;
  if (result !== null && (typeof result !== 'object' || !Array.isArray(result.ranking) || typeof result.reason !== 'string')) problems.push('result doit être null ou un résultat');
  if (problems.length > 0) return problems;

  // Le fond.
  const typed = state;
  for (const seat of [0, 1] as const) {
    let onBoard = 0;
    for (const count of typed.points) if ((seat === 0 && count > 0) || (seat === 1 && count < 0)) onBoard += Math.abs(count);
    const total = onBoard + typed.bar[seat] + typed.off[seat];
    if (total !== CHECKERS_PER_SEAT) problems.push(`le siège ${seat} a ${total} pions (${onBoard} sur le plateau, ${typed.bar[seat]} sur la barre, ${typed.off[seat]} sortis) au lieu de ${CHECKERS_PER_SEAT}`);
  }
  if (typed.phase === 'roll' && typed.dice.length !== 0) problems.push('phase roll : les dés doivent être vides');
  if (typed.phase === 'move' && typed.dice.length !== DICE_COUNT) problems.push('phase move : il faut deux dés');
  if ((typed.phase === 'over') !== (typed.result !== null)) problems.push('la phase over et le résultat vont ensemble : l\'un n\'existe pas sans l\'autre');
  if (typed.result !== null) {
    const ranked = typed.result.ranking.flat().sort();
    if (ranked.length !== 2 || ranked[0] !== 0 || ranked[1] !== 1) problems.push('le classement du résultat doit contenir chaque siège une fois');
  }
  for (const seat of [0, 1] as const) {
    if (typed.off[seat] !== CHECKERS_PER_SEAT) continue;
    // 15 sortis : ce siège a gagné, et la partie est finie.
    if (typed.phase !== 'over' || typed.result?.ranking[0]?.[0] !== seat) problems.push(`le siège ${seat} a sorti ses ${CHECKERS_PER_SEAT} pions : il doit avoir gagné`);
  }
  if (typed.phase === 'move' && !canMove(boardFor(typed, typed.turn), typed.dice)) problems.push('phase move sans aucun coup possible : le lancer aurait dû passer le tour');
  return problems;
}
