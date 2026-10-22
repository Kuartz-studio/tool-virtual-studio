import { describe, expect, test } from 'vitest';
import { deepFreeze } from '../conformance';
import { rngFromDice, scriptedRng } from '../rng';
import { FORFEIT_REASONS } from '../types';
import {
  fabricateLudo,
  landingOf,
  LUDO_COLORS,
  LUDO_HOME,
  LUDO_START,
  LUDO_TRACK,
  ludo,
  ludoMoveSchema,
  trackCell,
  type LudoEvent,
  type LudoFabrication,
  type LudoState,
} from './index';

// Les cas nommés du § 16.5 du document des jeux, C1 à C24, un test par cas, son numéro en tête du titre ; les cas C25 et suivants sont ceux que le document laisse implicites
// (passer par-dessus ses chevaux, l'allée, les sorties en série, le plateau…). Les états sont fabriqués par `fabricateLudo` (avancées par siège) et les dés imposés par
// `rngFromDice` : aucun test ne dépend du hasard.

const STABLE = [-1, -1, -1, -1];

// Un état fabriqué et gelé : si une règle modifiait son argument au lieu de rendre un nouvel état, elle lèverait.
function fab(spec: LudoFabrication): LudoState {
  return deepFreeze(fabricateLudo(spec));
}

// Un générateur qui lève dès qu'on lui demande un nombre : jouer un cheval ne tire jamais de dé.
const noDice = () => scriptedRng([]);

interface Step {
  state: LudoState;
  events: LudoEvent[];
}

// Le siège qui a le trait lance le dé et tire cette face. Le lancer tire exactement une valeur du générateur : une seconde lèverait.
function roll(state: LudoState, die: number): Step {
  const rng = scriptedRng(rngFromDice([die]));
  const out = ludo.apply(state, state.turn, { type: 'roll' }, rng);
  if (!out.ok) throw new Error(`le lancer d'un ${die} est refusé : ${out.error}`);
  expect(() => rng(), 'un lancer tire un seul dé').toThrow(/plus de valeurs/);
  return { state: deepFreeze(out.state), events: out.events };
}

// Le siège qui a le trait joue ce cheval, sans tirer de dé.
function play(state: LudoState, horse: number): Step {
  const out = ludo.apply(state, state.turn, { type: 'move', horse }, noDice());
  if (!out.ok) throw new Error(`le cheval ${horse} ne peut pas jouer : ${out.error}`);
  return { state: deepFreeze(out.state), events: out.events };
}

// Une suite de lancers : l'étape de chacun.
function rolls(state: LudoState, dice: number[]): Step[] {
  const steps: Step[] = [];
  let current = state;
  for (const die of dice) {
    const step = roll(current, die);
    steps.push(step);
    current = step.state;
  }
  return steps;
}

const dice = (seat: number, value: number): LudoEvent => ({ type: 'dice', seat, value });
const pass = (seat: number, reason: 'no-move' | 'retry' | 'bonus' | 'third-six'): LudoEvent => ({ type: 'pass', seat, reason });
const turnTo = (seat: number): LudoEvent => ({ type: 'turn', seat });

describe('petits chevaux : créer la partie', () => {
  test('C1 : create à quatre joueurs, le siège 2 commence : couleurs, chevaux à l\'écurie, trait au siège 2, phase roll', () => {
    const { state, events } = ludo.create({ seats: 4, first: 2 }, noDice());
    expect(state).toStrictEqual({
      colors: [0, 1, 2, 3],
      horses: [STABLE, STABLE, STABLE, STABLE],
      turn: 2,
      phase: 'roll',
      die: null,
      sixes: 0,
      tries: 0,
      out: [],
      moves: 0,
      last: null,
      result: null,
    });
    expect(events).toEqual([]);
    expect(ludo.turn(state)).toBe(2);
    expect(ludo.result(state)).toBeNull();
    expect(ludo.legalMoves(state, 2)).toEqual([{ type: 'roll' }]);
    for (const seat of [0, 1, 3]) expect(ludo.legalMoves(state, seat)).toEqual([]);
    expect(ludo.invariants(state)).toEqual([]);
    expect(ludo).toMatchObject({ id: 'ludo', label: 'Petits chevaux', minPlayers: 2, maxPlayers: 4, drawOffers: false });
  });

  test('C2 : create à deux et à trois : couleurs [0, 2] et [0, 1, 2], et l\'exemple JSON du document', () => {
    const two = ludo.create({ seats: 2, first: 1 }, noDice()).state;
    expect(two.colors).toEqual([0, 2]);
    expect(two.horses).toEqual([STABLE, STABLE]);
    expect(two.turn).toBe(1);
    // L'exemple du § 16.3 : trois joueurs, le siège 1 commence.
    expect(ludo.create({ seats: 3, first: 1 }, noDice()).state).toStrictEqual({
      colors: [0, 1, 2],
      horses: [STABLE, STABLE, STABLE],
      turn: 1,
      phase: 'roll',
      die: null,
      sixes: 0,
      tries: 0,
      out: [],
      moves: 0,
      last: null,
      result: null,
    });
    for (const seats of [2, 3, 4]) expect(ludo.create({ seats, first: 0 }, noDice()).state.colors).toEqual([...LUDO_COLORS[seats as 2 | 3 | 4]]);
  });

  test('C46 : une partie qui n\'est pas de 2 à 4 joueurs, ou dont le premier n\'est pas un siège, est une erreur de la plateforme : create lève', () => {
    for (const seats of [0, 1, 5, 2.5]) expect(() => ludo.create({ seats, first: 0 }, noDice())).toThrow(RangeError);
    for (const first of [-1, 4, 0.5]) expect(() => ludo.create({ seats: 4, first }, noDice())).toThrow(RangeError);
  });
});

describe('petits chevaux : sortir, le 6, les essais', () => {
  test('C3 : tout à l\'écurie, dé 6 : un seul coup (sortir le cheval 0) ; après lui, avancée 0, même siège en phase roll, sixes 1', () => {
    const start = fab({ horses: [STABLE, STABLE, STABLE] });
    const rolled = roll(start, 6);
    expect(rolled.events).toEqual([dice(0, 6)]);
    expect(rolled.state).toMatchObject({ phase: 'move', die: 6, sixes: 1, tries: 1, turn: 0 });
    expect(ludo.legalMoves(rolled.state, 0)).toEqual([{ type: 'move', horse: 0 }]);

    const moved = play(rolled.state, 0);
    expect(moved.events).toEqual([{ type: 'move', seat: 0, horse: 0, from: -1, to: 0 }]);
    expect(moved.state.horses[0]).toEqual([0, -1, -1, -1]);
    expect(moved.state).toMatchObject({ turn: 0, phase: 'roll', die: null, sixes: 1, moves: 1 });
    expect(moved.state.last).toStrictEqual({ seat: 0, horse: 0, from: -1, to: 0 });
    expect(ludo.countedMoves(moved.state)).toBe(1);
    expect(ludo.invariants(moved.state)).toEqual([]);
  });

  test('C4 : tout à l\'écurie, dés 3, 2 puis 5 : retry, retry, puis no-move ; le tour passe et les essais repartent de zéro', () => {
    const [first, second, third] = rolls(fab({ horses: [STABLE, STABLE] }), [3, 2, 5]) as [Step, Step, Step];
    expect(first.events).toEqual([dice(0, 3), pass(0, 'retry')]);
    expect(first.state).toMatchObject({ turn: 0, phase: 'roll', tries: 1, die: null });
    expect(second.events).toEqual([dice(0, 2), pass(0, 'retry')]);
    expect(second.state).toMatchObject({ turn: 0, phase: 'roll', tries: 2 });
    expect(third.events).toEqual([dice(0, 5), pass(0, 'no-move'), turnTo(1)]);
    expect(third.state).toMatchObject({ turn: 1, phase: 'roll', tries: 0, sixes: 0, die: null });
    // Un lancer ou un tour passé ne sont pas des coups.
    expect(ludo.countedMoves(third.state)).toBe(0);
  });

  test('C5 : tout à l\'écurie, dés 1, 2 puis 6 : au troisième lancer, la sortie est jouable', () => {
    const [, , third] = rolls(fab({ horses: [STABLE, STABLE] }), [1, 2, 6]) as [Step, Step, Step];
    expect(third.events).toEqual([dice(0, 6)]);
    expect(third.state).toMatchObject({ turn: 0, phase: 'move', die: 6, tries: 3, sixes: 1 });
    expect(ludo.legalMoves(third.state, 0)).toEqual([{ type: 'move', horse: 0 }]);
  });

  test('C6 : un cheval à l\'avancée 10, dés 6, 6, 6 : deux coups joués, puis third-six ; le tour passe, le troisième 6 ne bouge rien, sixes revient à 0', () => {
    const start = fab({ horses: [[10, -1, -1, -1], STABLE] });
    const first = roll(start, 6);
    expect(ludo.legalMoves(first.state, 0)).toEqual([{ type: 'move', horse: 0 }, { type: 'move', horse: 1 }]);
    const afterFirst = play(first.state, 0);
    expect(afterFirst.state).toMatchObject({ turn: 0, phase: 'roll', sixes: 1 });
    expect(afterFirst.state.horses[0]).toEqual([16, -1, -1, -1]);

    const second = roll(afterFirst.state, 6);
    expect(second.state.sixes).toBe(2);
    const afterSecond = play(second.state, 0);
    expect(afterSecond.state).toMatchObject({ turn: 0, phase: 'roll', sixes: 2, moves: 2 });
    expect(afterSecond.state.horses[0]).toEqual([22, -1, -1, -1]);

    const third = roll(afterSecond.state, 6);
    expect(third.events).toEqual([dice(0, 6), pass(0, 'third-six'), turnTo(1)]);
    expect(third.state).toMatchObject({ turn: 1, phase: 'roll', die: null, sixes: 0, tries: 0, moves: 2 });
    expect(third.state.horses).toEqual(afterSecond.state.horses);
    expect(ludo.invariants(third.state)).toEqual([]);
  });

  test('C7 : chevaux à 56, 56, 56 et 53, dé 6 : aucun coup (53 + 6 dépasse), bonus ; même siège en phase roll', () => {
    const start = fab({ horses: [[56, 56, 56, 53], STABLE] });
    const rolled = roll(start, 6);
    expect(rolled.events).toEqual([dice(0, 6), pass(0, 'bonus')]);
    expect(rolled.state).toMatchObject({ turn: 0, phase: 'roll', die: null, sixes: 1 });
    expect(rolled.state.horses).toEqual(start.horses);
  });

  test('C22 : deux chevaux arrivés, deux à l\'écurie, dés 2, 4 puis 1 : les arrivés ne sont pas en jeu, trois essais, puis le tour passe', () => {
    const [first, second, third] = rolls(fab({ horses: [[56, 56, -1, -1], STABLE] }), [2, 4, 1]) as [Step, Step, Step];
    expect(first.events).toEqual([dice(0, 2), pass(0, 'retry')]);
    expect(second.events).toEqual([dice(0, 4), pass(0, 'retry')]);
    expect(third.events).toEqual([dice(0, 1), pass(0, 'no-move'), turnTo(1)]);
    expect(third.state).toMatchObject({ turn: 1, tries: 0, sixes: 0 });
  });

  test('C23 : un 6 joué, puis un 2 : le tour passe ; au tour suivant, sixes et tries sont à 0', () => {
    const start = fab({ horses: [[10, -1, -1, -1], STABLE] });
    const sixPlayed = play(roll(start, 6).state, 0);
    expect(sixPlayed.state.sixes).toBe(1);
    const twoPlayed = play(roll(sixPlayed.state, 2).state, 0);
    expect(twoPlayed.events).toEqual([{ type: 'move', seat: 0, horse: 0, from: 16, to: 18 }, turnTo(1)]);
    expect(twoPlayed.state).toMatchObject({ turn: 1, phase: 'roll', sixes: 0, tries: 0, die: null });

    // Même remise à zéro quand des essais avaient été faits avant le 6 : 1 (essai), 6 (sortie), 2 (le cheval avance).
    const [retry, six] = rolls(fab({ horses: [STABLE, STABLE] }), [1, 6]) as [Step, Step];
    expect(retry.state.tries).toBe(1);
    expect(six.state).toMatchObject({ phase: 'move', tries: 2, sixes: 1 });
    const out = play(six.state, 0);
    const advanced = play(roll(out.state, 2).state, 0);
    expect(advanced.state.horses[0]).toEqual([2, -1, -1, -1]);
    expect(advanced.state).toMatchObject({ turn: 1, sixes: 0, tries: 0 });
  });

  test('C28 : un 6 qui ne peut pas être joué fait rejouer, et les 6 s\'additionnent jusqu\'au troisième, qui passe le tour', () => {
    const start = fab({ horses: [[56, 56, 56, 53], STABLE] });
    const [first, second, third] = rolls(start, [6, 6, 6]) as [Step, Step, Step];
    expect(first.events).toEqual([dice(0, 6), pass(0, 'bonus')]);
    expect(first.state).toMatchObject({ turn: 0, sixes: 1 });
    expect(second.events).toEqual([dice(0, 6), pass(0, 'bonus')]);
    expect(second.state).toMatchObject({ turn: 0, sixes: 2 });
    expect(third.events).toEqual([dice(0, 6), pass(0, 'third-six'), turnTo(1)]);
    expect(third.state).toMatchObject({ turn: 1, sixes: 0 });
  });

  test('C29 : après un 6 injouable, un dé injouable passe le tour (un cheval est en jeu : pas d\'essai de plus)', () => {
    const start = fab({ horses: [[56, 56, 56, 53], STABLE] });
    const [six, four] = rolls(start, [6, 4]) as [Step, Step];
    expect(six.state).toMatchObject({ turn: 0, sixes: 1 });
    expect(four.events).toEqual([dice(0, 4), pass(0, 'no-move'), turnTo(1)]);
    expect(four.state).toMatchObject({ turn: 1, sixes: 0, tries: 0 });
  });

  test('C43 : sans cheval en jeu, un essai manqué puis un 6 : la sortie, avec deux essais déjà comptés', () => {
    const [miss, six] = rolls(fab({ horses: [STABLE, STABLE] }), [1, 6]) as [Step, Step];
    expect(miss.events).toEqual([dice(0, 1), pass(0, 'retry')]);
    expect(six.events).toEqual([dice(0, 6)]);
    expect(ludo.legalMoves(six.state, 0)).toEqual([{ type: 'move', horse: 0 }]);
  });

  test('C36 : un état fabriqué à trois essais déjà faits reste légal après un lancer, même sans cheval en jeu', () => {
    const start = fab({ horses: [STABLE, STABLE], tries: 3 });
    const six = roll(start, 6);
    expect(six.state).toMatchObject({ phase: 'move', tries: 3 });
    expect(ludo.invariants(six.state)).toEqual([]);
    const four = roll(start, 4);
    expect(four.events).toEqual([dice(0, 4), pass(0, 'no-move'), turnTo(1)]);
    expect(ludo.invariants(four.state)).toEqual([]);
  });
});

describe('petits chevaux : avancer, prendre, passer par-dessus', () => {
  test('C8 : quatre joueurs, rouge à 10, vert à 1 (case 14), rouge tire 4 : prise, le cheval vert retourne à l\'écurie', () => {
    const start = fab({ horses: [[10, -1, -1, -1], [1, -1, -1, -1], STABLE, STABLE] });
    expect(trackCell(1, 1)).toBe(14);
    const moved = play(roll(start, 4).state, 0);
    expect(moved.events).toEqual([
      { type: 'move', seat: 0, horse: 0, from: 10, to: 14 },
      { type: 'capture', seat: 0, victim: { seat: 1, horse: 0 } },
      turnTo(1),
    ]);
    expect(moved.state.horses).toEqual([[14, -1, -1, -1], STABLE, STABLE, STABLE]);
    expect(moved.state.last).toStrictEqual({ seat: 0, horse: 0, from: 10, to: 14, captured: { seat: 1, horse: 0 } });
    // Une prise n'ajoute pas un coup de plus : un cheval déplacé, un coup.
    expect(moved.state.moves).toBe(1);
    expect(ludo.invariants(moved.state)).toEqual([]);
  });

  test('C9 : vert à l\'avancée 39 (case 0, le départ des rouges), rouge tout à l\'écurie tire 6 : la sortie prend le cheval vert', () => {
    const start = fab({ horses: [STABLE, [39, -1, -1, -1], STABLE, STABLE] });
    expect(trackCell(1, 39)).toBe(0);
    const rolled = roll(start, 6);
    expect(ludo.legalMoves(rolled.state, 0)).toEqual([{ type: 'move', horse: 0 }]);
    const moved = play(rolled.state, 0);
    expect(moved.events).toEqual([
      { type: 'move', seat: 0, horse: 0, from: -1, to: 0 },
      { type: 'capture', seat: 0, victim: { seat: 1, horse: 0 } },
    ]);
    expect(moved.state.horses).toEqual([[0, -1, -1, -1], STABLE, STABLE, STABLE]);
    // Un 6 donne un nouveau lancer, prise comprise.
    expect(moved.state).toMatchObject({ turn: 0, phase: 'roll', sixes: 1 });
  });

  test('C10 : vert à l\'avancée 45 (case 6), rouge à 2 tire 4 : prise (tour de piste : (13 + 45) mod 52 = 6)', () => {
    const start = fab({ horses: [[2, -1, -1, -1], [45, -1, -1, -1], STABLE, STABLE] });
    expect(trackCell(1, 45)).toBe(6);
    const moved = play(roll(start, 4).state, 0);
    expect(moved.events).toContainEqual({ type: 'capture', seat: 0, victim: { seat: 1, horse: 0 } });
    expect(moved.state.horses[0]).toEqual([6, -1, -1, -1]);
    expect(moved.state.horses[1]).toEqual(STABLE);
  });

  test('C11 : rouge à 5 et à 8, dé 3 : seul le cheval à 8 est jouable (5 + 3 tomberait sur son propre cheval)', () => {
    const start = fab({ horses: [[5, 8, -1, -1], STABLE] });
    const rolled = roll(start, 3);
    expect(ludo.legalMoves(rolled.state, 0)).toEqual([{ type: 'move', horse: 1 }]);
    expect(ludo.apply(rolled.state, 0, { type: 'move', horse: 0 }, noDice())).toEqual({ ok: false, error: 'illegal' });
    expect(play(rolled.state, 1).state.horses[0]).toEqual([5, 11, -1, -1]);
  });

  test('C12 : rouge un cheval à 0 et trois à l\'écurie, dé 6 : pas de sortie (sa case de départ est prise par lui), seul coup : le cheval à 0 va à 6', () => {
    const rolled = roll(fab({ horses: [[0, -1, -1, -1], STABLE] }), 6);
    expect(ludo.legalMoves(rolled.state, 0)).toEqual([{ type: 'move', horse: 0 }]);
    expect(ludo.apply(rolled.state, 0, { type: 'move', horse: 1 }, noDice())).toEqual({ ok: false, error: 'illegal' });
    const moved = play(rolled.state, 0);
    expect(moved.state.horses[0]).toEqual([6, -1, -1, -1]);
    expect(moved.state).toMatchObject({ turn: 0, phase: 'roll', sixes: 1 });
  });

  test('C13 : deux joueurs, rouge à 5, jaune (siège 1) à 33 (case 7), rouge tire 4 : il passe par-dessus et s\'arrête en case 9, sans prise', () => {
    const start = fab({ horses: [[5, -1, -1, -1], [33, -1, -1, -1]] });
    expect(trackCell(2, 33)).toBe(7);
    const moved = play(roll(start, 4).state, 0);
    expect(moved.events).toEqual([{ type: 'move', seat: 0, horse: 0, from: 5, to: 9 }, turnTo(1)]);
    expect(trackCell(0, moved.state.horses[0]![0]!)).toBe(9);
    expect(moved.state.horses[1]).toEqual([33, -1, -1, -1]);
  });

  test('C26 : on passe aussi par-dessus ses propres chevaux : rouge à 5 et à 7, dé 4, le cheval à 5 va en 9', () => {
    const rolled = roll(fab({ horses: [[5, 7, -1, -1], STABLE] }), 4);
    expect(ludo.legalMoves(rolled.state, 0)).toEqual([{ type: 'move', horse: 0 }, { type: 'move', horse: 1 }]);
    expect(play(rolled.state, 0).state.horses[0]).toEqual([9, 7, -1, -1]);
  });

  test('C14 : un cheval à 54, les autres à l\'écurie : le 2 est l\'arrivée ; le 3 dépasserait, aucun coup, no-move et le tour passe', () => {
    const start = fab({ horses: [[54, -1, -1, -1], STABLE] });
    const two = roll(start, 2);
    expect(ludo.legalMoves(two.state, 0)).toEqual([{ type: 'move', horse: 0 }]);
    const arrived = play(two.state, 0);
    expect(arrived.state.horses[0]).toEqual([LUDO_HOME, -1, -1, -1]);
    expect(arrived.events).toEqual([{ type: 'move', seat: 0, horse: 0, from: 54, to: 56 }, turnTo(1)]);
    expect(arrived.state.result).toBeNull();

    const three = roll(start, 3);
    expect(three.events).toEqual([dice(0, 3), pass(0, 'no-move'), turnTo(1)]);
    expect(three.state).toMatchObject({ turn: 1, tries: 0 });
    expect(three.state.horses).toEqual(start.horses);
  });

  test('C15 : un cheval dans son allée n\'est jamais pris, et aucun cheval adverse n\'a une avancée qui mène dans une allée de cette couleur', () => {
    // Seules les avancées de 0 à 50 sont sur la piste commune : l\'allée (51 à 55), l\'arrivée (56) et l\'écurie n'ont aucune case commune.
    for (const color of [0, 1, 2, 3]) {
      for (const advance of [-1, 51, 52, 53, 54, 55, 56]) expect(trackCell(color, advance)).toBeNull();
      for (let advance = 0; advance <= 50; advance++) expect(trackCell(color, advance)).not.toBeNull();
    }
    // Rouge garde quatre chevaux dans son allée pendant que chacun des trois autres arrive, en un seul coup, sur chacune des 51 cases de piste qu'il peut atteindre.
    const lane = [51, 52, 53, 55];
    for (const seat of [1, 2, 3]) {
      for (let to = 0; to <= 50; to++) {
        const horses = [lane, STABLE, STABLE, STABLE].map((row) => [...row]);
        horses[seat] = to === 0 ? [...STABLE] : [to - 1, -1, -1, -1];
        const state = fab({ horses, turn: seat, die: to === 0 ? 6 : 1 });
        const moved = play(state, 0);
        expect(moved.state.horses[seat]![0]).toBe(to);
        expect(moved.state.horses[0]).toEqual(lane);
        expect(moved.events.some((event) => event.type === 'capture')).toBe(false);
      }
    }
  });

  test('C25 : entrer dans son allée ne prend personne : rouge de 49 à 51 pendant qu\'un cheval vert est sur la case de piste 51 ; la dernière case de piste (50), elle, prend', () => {
    const lane = fab({ horses: [[49, -1, -1, -1], [38, -1, -1, -1], STABLE, STABLE] });
    expect(trackCell(1, 38)).toBe(51);
    const entered = play(roll(lane, 2).state, 0);
    expect(entered.state.horses).toEqual([[51, -1, -1, -1], [38, -1, -1, -1], STABLE, STABLE]);
    expect(entered.events).toEqual([{ type: 'move', seat: 0, horse: 0, from: 49, to: 51 }, turnTo(1)]);

    const last = fab({ horses: [[48, -1, -1, -1], [37, -1, -1, -1], STABLE, STABLE] });
    expect(trackCell(0, 50)).toBe(trackCell(1, 37));
    const taken = play(roll(last, 2).state, 0);
    expect(taken.events).toContainEqual({ type: 'capture', seat: 0, victim: { seat: 1, horse: 0 } });
  });

  test('C27 : dans l\'allée aussi, jamais sur son propre cheval ; l\'arrivée, elle, reçoit les quatre', () => {
    const blocked = roll(fab({ horses: [[51, 53, -1, -1], STABLE] }), 2);
    expect(ludo.legalMoves(blocked.state, 0)).toEqual([{ type: 'move', horse: 1 }]);

    const stacked = roll(fab({ horses: [[56, 56, 54, 50], STABLE] }), 2);
    expect(ludo.legalMoves(stacked.state, 0)).toEqual([{ type: 'move', horse: 2 }, { type: 'move', horse: 3 }]);
    expect(play(stacked.state, 2).state.horses[0]).toEqual([56, 56, 56, 50]);
  });

  test('C21 : trois chevaux à l\'écurie et un 6 : legalMoves n\'a qu\'une sortie, celle du premier cheval à l\'écurie', () => {
    const inPlayFirst = roll(fab({ horses: [[20, -1, -1, -1], STABLE] }), 6);
    expect(ludo.legalMoves(inPlayFirst.state, 0)).toEqual([{ type: 'move', horse: 0 }, { type: 'move', horse: 1 }]);
    expect(ludo.apply(inPlayFirst.state, 0, { type: 'move', horse: 2 }, noDice())).toEqual({ ok: false, error: 'illegal' });
    expect(ludo.apply(inPlayFirst.state, 0, { type: 'move', horse: 3 }, noDice())).toEqual({ ok: false, error: 'illegal' });

    const stableFirst = roll(fab({ horses: [[-1, 5, -1, -1], STABLE] }), 6);
    expect(ludo.legalMoves(stableFirst.state, 0)).toEqual([{ type: 'move', horse: 0 }, { type: 'move', horse: 1 }]);
  });

  test('C32 : un siège n\'est pas une couleur : à deux, le siège 1 joue jaune et sort sur la case 26, où il prend le cheval rouge', () => {
    expect(ludo.create({ seats: 2, first: 1 }, noDice()).state.colors).toEqual([0, 2]);
    const start = fab({ horses: [[26, -1, -1, -1], STABLE], turn: 1 });
    expect(trackCell(0, 26)).toBe(LUDO_START[2]);
    const moved = play(roll(start, 6).state, 0);
    expect(moved.events).toEqual([
      { type: 'move', seat: 1, horse: 0, from: -1, to: 0 },
      { type: 'capture', seat: 1, victim: { seat: 0, horse: 0 } },
    ]);
    expect(moved.state.horses).toEqual([STABLE, [0, -1, -1, -1]]);
  });

  test('C42 : l\'aperçu d\'un coup donne l\'arrivée et la prise, sans rien jouer', () => {
    const state = fab({ horses: [[10, -1, -1, -1], [1, -1, -1, -1], STABLE, STABLE] });
    expect(landingOf(state, 0, 0, 4)).toEqual({ from: 10, to: 14, captured: { seat: 1, horse: 0 } });
    expect(landingOf(state, 0, 0, 3)).toEqual({ from: 10, to: 13, captured: null });
    expect(landingOf(state, 0, 1, 6)).toEqual({ from: -1, to: 0, captured: null });
    expect(landingOf(state, 1, 1, 6)).toEqual({ from: -1, to: 0, captured: null });
  });
});

describe('petits chevaux : l\'arrivée et la fin de la partie', () => {
  test('C16 : siège 0 à 56, 56, 56 et 55, il tire 1 : fin finished, avancées 228, 43, 43 et 6, classement [[0], [1, 2], [3]]', () => {
    const start = fab({
      horses: [[56, 56, 56, 55], [20, 21, -1, -1], [42, -1, -1, -1], [5, -1, -1, -1]],
    });
    const rolled = roll(start, 1);
    expect(ludo.legalMoves(rolled.state, 0)).toEqual([{ type: 'move', horse: 3 }]);
    const ended = play(rolled.state, 3);
    expect(ended.events).toEqual([{ type: 'move', seat: 0, horse: 3, from: 55, to: 56 }, { type: 'end', ranking: [[0], [1, 2], [3]] }]);
    expect(ended.state.phase).toBe('over');
    expect(ludo.result(ended.state)).toEqual({ ranking: [[0], [1, 2], [3]], reason: 'finished', detail: { scores: [228, 43, 43, 6] } });
    expect(ludo.turn(ended.state)).toBeNull();
    expect(ended.state.moves).toBe(1);
    expect(ludo.invariants(ended.state)).toEqual([]);
    for (let seat = 0; seat < 4; seat++) expect(ludo.legalMoves(ended.state, seat)).toEqual([]);
  });

  test('C34 : le quatrième cheval arrivé finit la partie même avec un 6 : pas de lancer de plus', () => {
    const start = fab({ horses: [[56, 56, 56, 50], [5, -1, -1, -1]], die: 6 });
    const ended = play(start, 3);
    expect(ended.events).toEqual([{ type: 'move', seat: 0, horse: 3, from: 50, to: 56 }, { type: 'end', ranking: [[0], [1]] }]);
    expect(ended.state).toMatchObject({ phase: 'over', die: null });
    expect(ludo.result(ended.state)).toEqual({ ranking: [[0], [1]], reason: 'finished', detail: { scores: [228, 6] } });
    expect(ludo.turn(ended.state)).toBeNull();
  });

  test('C31 : classement final : les sièges sortis derrière tous les autres, du dernier sorti au premier ; les ex æquo groupés', () => {
    // Siège 2 sorti avant la fin : il est dernier, même s\'il avait de l\'avance. Sièges 1 (43) et 3 (6) classés à leur avancée.
    const oneOut = fab({
      horses: [[56, 56, 56, 55], [20, 21, -1, -1], STABLE, [5, -1, -1, -1]],
      die: 1,
      out: [{ seat: 2, reason: 'resign' }],
    });
    expect(ludo.result(play(oneOut, 3).state)?.ranking).toEqual([[0], [1], [3], [2]]);

    // Deux ex æquo à 43 (un cheval en 42 vaut autant que deux en 20 et 21) : un seul groupe.
    const tie = fab({
      horses: [[56, 56, 56, 55], [20, 21, -1, -1], STABLE, [42, -1, -1, -1]],
      die: 1,
      out: [{ seat: 2, reason: 'timeout' }],
    });
    expect(ludo.result(play(tie, 3).state)).toMatchObject({ ranking: [[0], [1, 3], [2]], detail: { scores: [228, 43, 0, 43] } });

    // Deux sortis : le dernier sorti devant celui qui est sorti avant lui.
    const twoOut = fab({
      horses: [[56, 56, 56, 55], STABLE, [7, -1, -1, -1], STABLE],
      die: 1,
      out: [{ seat: 1, reason: 'resign' }, { seat: 3, reason: 'timeout' }],
    });
    expect(ludo.result(play(twoOut, 3).state)?.ranking).toEqual([[0], [2], [3], [1]]);
  });
});

describe('petits chevaux : un siège sort de la partie', () => {
  test('C17 : quatre joueurs, pendant le tour du siège 1, le siège 2 abandonne : ses chevaux à −1, la partie continue ; après le siège 1 vient le siège 3', () => {
    const start = fab({ horses: [STABLE, [3, -1, -1, -1], [40, 3, -1, -1], STABLE], turn: 1 });
    const left = ludo.forfeit(start, 2, 'resign');
    expect(left.events).toEqual([{ type: 'forfeit', seat: 2, reason: 'resign' }]);
    expect(left.state.horses[2]).toEqual(STABLE);
    expect(left.state.out).toEqual([{ seat: 2, reason: 'resign' }]);
    expect(left.state).toMatchObject({ turn: 1, phase: 'roll', result: null });
    expect(ludo.turn(left.state)).toBe(1);
    expect(ludo.invariants(left.state)).toEqual([]);
    // Ce n'est ni une prise ni un coup.
    expect(ludo.countedMoves(left.state)).toBe(0);

    const finished = play(roll(deepFreeze(left.state), 2).state, 0);
    expect(finished.events).toEqual([{ type: 'move', seat: 1, horse: 0, from: 3, to: 5 }, turnTo(3)]);
    expect(finished.state.turn).toBe(3);
  });

  test('C39 : le siège qui a le trait sort en pleine phase move : le tour passe au suivant, le dé et les compteurs sont remis à zéro', () => {
    const start = fab({ horses: [STABLE, STABLE, [10, -1, -1, -1], STABLE], turn: 2, die: 4, sixes: 1 });
    const left = ludo.forfeit(start, 2, 'timeout');
    expect(left.events).toEqual([{ type: 'forfeit', seat: 2, reason: 'timeout' }, turnTo(3)]);
    expect(left.state).toMatchObject({ turn: 3, phase: 'roll', die: null, sixes: 0, tries: 0, out: [{ seat: 2, reason: 'timeout' }], result: null });
    expect(left.state.horses[2]).toEqual(STABLE);
    expect(ludo.invariants(left.state)).toEqual([]);
  });

  test('C18 : trois joueurs : le siège 1, puis le siège 2 sortent : fin, classement [[0], [2], [1]], raison de la dernière sortie', () => {
    const start = fab({ horses: [[10, 20, -1, -1], [5, -1, -1, -1], [7, -1, -1, -1]], turn: 1 });
    const first = ludo.forfeit(start, 1, 'timeout');
    expect(first.state).toMatchObject({ turn: 2, result: null, phase: 'roll' });
    expect(first.events).toEqual([{ type: 'forfeit', seat: 1, reason: 'timeout' }, turnTo(2)]);

    const second = ludo.forfeit(deepFreeze(first.state), 2, 'disconnect');
    expect(second.events).toEqual([{ type: 'forfeit', seat: 2, reason: 'disconnect' }, { type: 'end', ranking: [[0], [2], [1]] }]);
    expect(ludo.result(second.state)).toEqual({ ranking: [[0], [2], [1]], reason: 'disconnect', detail: { scores: [32, 0, 0] } });
    expect(second.state).toMatchObject({ phase: 'over', die: null, out: [{ seat: 1, reason: 'timeout' }, { seat: 2, reason: 'disconnect' }] });
    expect(ludo.turn(second.state)).toBeNull();
    expect(ludo.invariants(second.state)).toEqual([]);
  });

  test('C19 : deux joueurs : le siège 1 sort pour inactivité : [[0], [1]], raison timeout (et le siège 0 qui sort donne [[1], [0]])', () => {
    const start = fab({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] });
    expect(ludo.forfeit(start, 1, 'timeout').state.result).toMatchObject({ ranking: [[0], [1]], reason: 'timeout' });
    const turnHolderLeaves = ludo.forfeit(start, 0, 'resign');
    expect(turnHolderLeaves.state.result).toMatchObject({ ranking: [[1], [0]], reason: 'resign' });
    expect(turnHolderLeaves.events).toEqual([{ type: 'forfeit', seat: 0, reason: 'resign' }, { type: 'end', ranking: [[1], [0]] }]);
    for (const reason of FORFEIT_REASONS) expect(ludo.forfeit(start, 1, reason).state.result?.reason).toBe(reason);
  });

  test('C44 : à quatre, trois sorties de suite : 4, 3, 2 puis 1 siège ; la partie ne finit qu\'au dernier', () => {
    const start = fab({ horses: [[10, -1, -1, -1], [5, -1, -1, -1], [7, -1, -1, -1], [9, -1, -1, -1]] });
    const first = ludo.forfeit(start, 3, 'resign');
    expect(first.state).toMatchObject({ turn: 0, result: null });
    const second = ludo.forfeit(deepFreeze(first.state), 0, 'timeout');
    expect(second.state).toMatchObject({ turn: 1, result: null, phase: 'roll' });
    expect(second.events).toEqual([{ type: 'forfeit', seat: 0, reason: 'timeout' }, turnTo(1)]);
    const third = ludo.forfeit(deepFreeze(second.state), 2, 'disconnect');
    expect(ludo.result(third.state)).toMatchObject({ ranking: [[1], [2], [0], [3]], reason: 'disconnect' });
  });

  test('C30 : le tour saute les sièges sortis et fait le tour des sièges : 0, 2, 3, puis de nouveau 0', () => {
    const start = fab({ horses: [[10, -1, -1, -1], [10, -1, -1, -1], [10, -1, -1, -1], [10, -1, -1, -1]] });
    let state = deepFreeze(ludo.forfeit(start, 1, 'resign').state);
    const order: number[] = [];
    for (let i = 0; i < 3; i++) {
      order.push(state.turn);
      state = play(roll(state, 2).state, 0).state;
    }
    order.push(state.turn);
    expect(order).toEqual([0, 2, 3, 0]);
  });

  test('C33 : une sortie après la fin, d\'un siège déjà sorti ou d\'un siège qui n\'existe pas ne change rien', () => {
    const start = fab({ horses: [[10, -1, -1, -1], [5, -1, -1, -1], [7, -1, -1, -1]] });
    const left = ludo.forfeit(start, 1, 'resign');
    const again = ludo.forfeit(deepFreeze(left.state), 1, 'timeout');
    expect(again).toEqual({ state: left.state, events: [] });
    for (const seat of [-1, 3, 1.5, Number.NaN]) expect(ludo.forfeit(start, seat, 'resign')).toEqual({ state: start, events: [] });

    const ended = ludo.forfeit(deepFreeze(left.state), 2, 'resign').state;
    expect(ludo.forfeit(deepFreeze(ended), 0, 'resign')).toEqual({ state: ended, events: [] });
  });
});

describe('petits chevaux : les coups refusés', () => {
  test('C20 : move en phase roll, roll en phase move, un cheval arrivé ou bloqué, le mauvais siège : { ok: false }, état inchangé ; horse 4 refusé par le schéma', () => {
    const rolling = fab({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] });
    const moving = fab({ horses: [[56, 10, -1, -1], [5, -1, -1, -1]], die: 2 });
    const blocked = fab({ horses: [[5, 8, -1, -1], [5, -1, -1, -1]], die: 3 });
    const before = JSON.stringify([rolling, moving, blocked]);

    expect(ludo.apply(rolling, 0, { type: 'move', horse: 0 }, noDice())).toEqual({ ok: false, error: 'wrong_phase' });
    expect(ludo.apply(moving, 0, { type: 'roll' }, noDice())).toEqual({ ok: false, error: 'wrong_phase' });
    expect(ludo.apply(moving, 0, { type: 'move', horse: 0 }, noDice())).toEqual({ ok: false, error: 'illegal' });
    expect(ludo.apply(blocked, 0, { type: 'move', horse: 0 }, noDice())).toEqual({ ok: false, error: 'illegal' });
    expect(ludo.apply(rolling, 1, { type: 'roll' }, noDice())).toEqual({ ok: false, error: 'not_your_turn' });
    expect(ludo.apply(moving, 1, { type: 'move', horse: 0 }, noDice())).toEqual({ ok: false, error: 'not_your_turn' });
    // Un coup qui n'est pas un coup : refusé aussi, sans lever.
    expect(ludo.apply(moving, 0, { type: 'move', horse: 4 }, noDice())).toEqual({ ok: false, error: 'illegal' });
    expect(ludo.apply(moving, 0, { type: 'move', horse: 1.5 } as never, noDice())).toEqual({ ok: false, error: 'illegal' });
    expect(ludo.apply(moving, 0, { type: 'dance' } as never, noDice())).toEqual({ ok: false, error: 'illegal' });
    expect(ludo.apply(moving, 0, null as never, noDice())).toEqual({ ok: false, error: 'illegal' });
    expect(JSON.stringify([rolling, moving, blocked])).toBe(before);

    expect(ludoMoveSchema.safeParse({ type: 'move', horse: 4 }).success).toBe(false);
  });

  test('C38 : après la fin, plus aucun coup ; un siège sorti n\'a jamais le trait', () => {
    const ended = deepFreeze(ludo.forfeit(fab({ horses: [STABLE, STABLE] }), 1, 'resign').state);
    expect(ludo.apply(ended, 0, { type: 'roll' }, noDice())).toEqual({ ok: false, error: 'game_over' });
    expect(ludo.apply(ended, 0, { type: 'move', horse: 0 }, noDice())).toEqual({ ok: false, error: 'game_over' });
    expect(ludo.legalMoves(ended, 0)).toEqual([]);

    const left = deepFreeze(ludo.forfeit(fab({ horses: [STABLE, STABLE, STABLE] }), 1, 'resign').state);
    expect(ludo.legalMoves(left, 1)).toEqual([]);
    expect(ludo.apply(left, 1, { type: 'roll' }, noDice())).toEqual({ ok: false, error: 'not_your_turn' });
  });

  test('legalMoves : rien pour un siège qui n\'a pas le trait, un lancer en phase roll, les chevaux jouables en phase move', () => {
    const rolling = fab({ horses: [[10, -1, -1, -1], [5, -1, -1, -1], STABLE] });
    expect(ludo.legalMoves(rolling, 0)).toEqual([{ type: 'roll' }]);
    expect(ludo.legalMoves(rolling, 1)).toEqual([]);
    expect(ludo.legalMoves(rolling, 2)).toEqual([]);
    expect(ludo.legalMoves(rolling, 7)).toEqual([]);
    const moving = fab({ horses: [[10, 20, 30, 56], [5, -1, -1, -1], STABLE], die: 3 });
    expect(ludo.legalMoves(moving, 0)).toEqual([{ type: 'move', horse: 0 }, { type: 'move', horse: 1 }, { type: 'move', horse: 2 }]);
  });

  test('C35 : un lancer tire un seul dé, un coup n\'en tire aucun, créer la partie non plus', () => {
    const boom = () => {
      throw new Error('aucun tirage attendu');
    };
    expect(() => ludo.create({ seats: 3, first: 1 }, boom)).not.toThrow();
    const state = fab({ horses: [[10, -1, -1, -1], STABLE], die: 4 });
    expect(ludo.apply(state, 0, { type: 'move', horse: 0 }, boom).ok).toBe(true);
    let draws = 0;
    const counting = () => {
      draws++;
      return 0.5;
    };
    expect(ludo.apply(fab({ horses: [[10, -1, -1, -1], STABLE] }), 0, { type: 'roll' }, counting).ok).toBe(true);
    expect(draws).toBe(1);
    // Le troisième 6 tire aussi son dé : un seul tirage, dans tous les cas.
    draws = 0;
    expect(ludo.apply(fab({ horses: [[10, -1, -1, -1], STABLE], sixes: 2 }), 0, { type: 'roll' }, () => (draws++, 0.99)).ok).toBe(true);
    expect(draws).toBe(1);
  });

  test('C45 : seuls les chevaux déplacés comptent comme coups : ni lancer, ni tour passé, ni sortie de siège', () => {
    let state = fab({ horses: [[10, -1, -1, -1], STABLE, STABLE] });
    expect(ludo.countedMoves(state)).toBe(0);
    state = roll(state, 6).state;
    expect(ludo.countedMoves(state)).toBe(0);
    state = play(state, 0).state;
    expect(ludo.countedMoves(state)).toBe(1);
    state = roll(state, 6).state;
    state = play(state, 1).state;
    expect(ludo.countedMoves(state)).toBe(2);
    state = deepFreeze(ludo.forfeit(state, 2, 'resign').state);
    expect(ludo.countedMoves(state)).toBe(2);
  });
});

describe('petits chevaux : les états', () => {
  test('C24 : aller-retour JSON identique ; invariants : deux chevaux sur une même case de piste, un siège sorti avec un cheval en piste', () => {
    // Un état de chaque sorte, sans clé à undefined : captured n'existe que s'il y a eu une prise.
    const captured = play(roll(fab({ horses: [[10, -1, -1, -1], [1, -1, -1, -1], STABLE, STABLE] }), 4).state, 0).state;
    const withoutCapture = play(roll(fab({ horses: [[10, -1, -1, -1], STABLE] }), 2).state, 0).state;
    const finished = play(roll(fab({ horses: [[56, 56, 56, 55], STABLE]  }), 1).state, 3).state;
    const forfeited = ludo.forfeit(fab({ horses: [[10, -1, -1, -1], STABLE, STABLE] }), 2, 'resign').state;
    const created = ludo.create({ seats: 4, first: 3 }, noDice()).state;
    for (const state of [created, captured, withoutCapture, finished, forfeited]) {
      expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
      expect(ludo.invariants(state)).toEqual([]);
    }

    const ok = fab({ horses: [[14, -1, -1, -1], [1, -1, -1, -1]] });
    expect(ludo.invariants(ok)).toEqual([]);
    // Rouge à 14 et jaune (siège 1, départ 26) à 40 : toutes deux sur la case de piste 14.
    expect(ludo.invariants({ ...ok, horses: [[14, -1, -1, -1], [40, -1, -1, -1]] })).toEqual([expect.stringMatching(/case de piste 14/)]);
    // Un siège sorti qui garde un cheval en piste (à trois joueurs : deux restent en jeu, c'est la seule violation).
    const three = fab({ horses: [[14, -1, -1, -1], [2, -1, -1, -1], STABLE] });
    expect(ludo.invariants({ ...three, out: [{ seat: 1, reason: 'resign' }] })).toEqual([expect.stringMatching(/siège 1 est sorti.*cheval/)]);
  });

  test('C37 : invariants nomme chaque violation, une phrase chacune, et ne lève jamais, même sur n\'importe quoi', () => {
    const ok = fab({ horses: [[14, -1, -1, -1], [2, -1, -1, -1], STABLE], turn: 0 });
    const defects: Array<[string, unknown, RegExp]> = [
      ['des couleurs qui ne sont pas celles de trois joueurs', { ...ok, colors: [0, 2, 1] }, /couleurs/],
      ['un siège à trois chevaux', { ...ok, horses: [[14, -1, -1], [2, -1, -1, -1], STABLE] }, /4 chevaux/],
      ['une avancée de 57', { ...ok, horses: [[57, -1, -1, -1], [2, -1, -1, -1], STABLE] }, /avancée 57/],
      ['une avancée de −2', { ...ok, horses: [[-2, -1, -1, -1], [2, -1, -1, -1], STABLE] }, /avancée -2/],
      ['deux chevaux d\'une couleur à la même avancée', { ...ok, horses: [[5, 5, -1, -1], [2, -1, -1, -1], STABLE] }, /même avancée/],
      ['deux sièges sortis identiques', { ...ok, horses: [[14, -1, -1, -1], STABLE, STABLE], out: [{ seat: 1, reason: 'resign' }, { seat: 1, reason: 'timeout' }] }, /plusieurs fois/],
      ['un siège sorti qui n\'existe pas', { ...ok, out: [{ seat: 5, reason: 'resign' }] }, /n'existe pas/],
      ['le trait à un siège sorti', { ...ok, horses: [[14, -1, -1, -1], [2, -1, -1, -1], STABLE], out: [{ seat: 2, reason: 'resign' }], turn: 2 }, /trait/],
      ['un trait hors des sièges', { ...ok, turn: 3 }, /trait/],
      ['un dé en phase roll', { ...ok, die: 3 }, /phase roll/],
      ['aucun dé en phase move', { ...ok, phase: 'move' }, /phase move/],
      ['un dé de 7', { ...ok, phase: 'move', die: 7 }, /phase move/],
      ['une phase move sans aucun coup légal', { ...ok, horses: [[56, 56, 56, 53], [2, -1, -1, -1], STABLE], phase: 'move', die: 6 }, /aucun coup/],
      ['trois 6 déjà tirés', { ...ok, sixes: 3 }, /sixes/],
      ['quatre essais', { ...ok, tries: 4 }, /tries/],
      ['une phase over sans résultat', { ...ok, phase: 'over' }, /over/],
      ['un résultat sans phase over', { ...ok, result: { ranking: [[0], [1], [2]], reason: 'finished' } }, /over/],
      ['un seul siège encore en jeu, partie en cours', { ...ok, horses: [[14, -1, -1, -1], STABLE, STABLE], out: [{ seat: 1, reason: 'resign' }, { seat: 2, reason: 'resign' }] }, /au moins deux/],
    ];
    for (const [name, state, expected] of defects) {
      const problems = ludo.invariants(state as LudoState);
      expect(problems.length, `${name} : aucune violation`).toBeGreaterThan(0);
      expect(problems.some((problem) => expected.test(problem)), `${name} : ${problems.join(' / ')}`).toBe(true);
    }
    // Du n'importe quoi ne fait pas lever : une phrase au moins.
    for (const junk of [null, undefined, 0, 'x', [], {}, { ...ok, horses: 'x' }, { ...ok, colors: null }, { ...ok, out: [null] }, { ...ok, last: 3 }, { ...ok, result: 'fini' }]) {
      expect(ludo.invariants(junk as never).length).toBeGreaterThan(0);
    }
  });
});

describe('petits chevaux : le plateau et le schéma des coups', () => {
  // Le plateau de 15 × 15 du § 16.6 : les cases de la piste commune, dans l'ordre, en (colonne, rangée) depuis le coin haut gauche.
  const range = (from: number, to: number): number[] => {
    const step = from <= to ? 1 : -1;
    return Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => from + step * i);
  };
  const TRACK: Array<[number, number]> = [
    ...range(1, 5).map((x): [number, number] => [x, 6]),
    ...range(5, 0).map((y): [number, number] => [6, y]),
    [7, 0],
    ...range(0, 5).map((y): [number, number] => [8, y]),
    ...range(9, 14).map((x): [number, number] => [x, 6]),
    [14, 7],
    ...range(14, 9).map((x): [number, number] => [x, 8]),
    ...range(9, 14).map((y): [number, number] => [8, y]),
    [7, 14],
    ...range(14, 9).map((y): [number, number] => [6, y]),
    ...range(5, 0).map((x): [number, number] => [x, 8]),
    [0, 7],
    [0, 6],
  ];
  // Les allées : cinq cases chacune, de l'entrée de l'allée vers le centre.
  const LANES: Array<Array<[number, number]>> = [
    range(1, 5).map((x): [number, number] => [x, 7]),
    range(1, 5).map((y): [number, number] => [7, y]),
    range(13, 9).map((x): [number, number] => [x, 7]),
    range(13, 9).map((y): [number, number] => [7, y]),
  ];
  const distance = (a: [number, number], b: [number, number]): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

  test('C40 : la piste du document : 52 cases différentes, chacune voisine de la suivante (quatre pas en diagonale autour du centre), les départs aux cases 0, 13, 26 et 39', () => {
    expect(TRACK).toHaveLength(LUDO_TRACK);
    expect(new Set(TRACK.map(([x, y]) => `${x},${y}`)).size).toBe(LUDO_TRACK);
    let diagonals = 0;
    for (let cell = 0; cell < LUDO_TRACK; cell++) {
      const here = TRACK[cell]!;
      const next = TRACK[(cell + 1) % LUDO_TRACK]!;
      if (distance(here, next) === 2) {
        diagonals++;
        expect(Math.abs(here[0] - next[0])).toBe(1);
      } else {
        expect(distance(here, next)).toBe(1);
      }
    }
    expect(diagonals).toBe(4);
    // Départs : rouge (1, 6), vert (8, 1), jaune (13, 8), bleu (6, 13).
    expect([0, 1, 2, 3].map((color) => TRACK[LUDO_START[color]!])).toEqual([[1, 6], [8, 1], [13, 8], [6, 13]]);
  });

  test('C47 : l\'avancée 50 de chaque couleur est à côté de l\'entrée de son allée, qui court sur 5 cases jusqu\'au centre ; la case juste avant le départ n\'est jamais visitée', () => {
    for (const color of [0, 1, 2, 3]) {
      const cells = Array.from({ length: 51 }, (_, advance) => trackCell(color, advance)!);
      expect(new Set(cells).size).toBe(51);
      expect(cells[0]).toBe(LUDO_START[color]);
      expect(cells).not.toContain((LUDO_START[color]! + LUDO_TRACK - 1) % LUDO_TRACK);
      const lane = LANES[color]!;
      expect(lane).toHaveLength(5);
      expect(distance(TRACK[cells[50]!]!, lane[0]!)).toBe(1);
      for (let i = 1; i < 5; i++) expect(distance(lane[i - 1]!, lane[i]!)).toBe(1);
      // La dernière case de l'allée touche le carré central (6 à 8, 6 à 8).
      const [x, y] = lane[4]!;
      expect(Math.min(Math.abs(x - 7), Math.abs(y - 7))).toBe(0);
      expect(Math.max(Math.abs(x - 7), Math.abs(y - 7))).toBe(2);
    }
  });

  test('C41 : la forme d\'un coup : lancer, ou jouer un cheval de 0 à 3 ; rien de plus', () => {
    expect(ludoMoveSchema.safeParse({ type: 'roll' }).success).toBe(true);
    for (const horse of [0, 1, 2, 3]) expect(ludoMoveSchema.safeParse({ type: 'move', horse }).success).toBe(true);
    for (const bad of [
      { type: 'move' },
      { type: 'move', horse: -1 },
      { type: 'move', horse: 4 },
      { type: 'move', horse: 1.5 },
      { type: 'move', horse: '1' },
      { type: 'roll', horse: 1 },
      { type: 'dance' },
      { horse: 1 },
      null,
      'roll',
    ]) {
      expect(ludoMoveSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
