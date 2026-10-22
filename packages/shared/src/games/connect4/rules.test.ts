import { describe, expect, test } from 'vitest';
import { deepFreeze } from '../conformance';
import { scriptedRng } from '../rng';
import { FORFEIT_REASONS, type AnyGameDefinition, type GameResult } from '../types';
import {
  CONNECT4_CELLS,
  CONNECT4_COLUMNS,
  CONNECT4_ROWS,
  alignedCells,
  cellColumn,
  cellIndex,
  cellRow,
  connect4,
  connect4MoveSchema,
  dropRow,
  isColumn,
  lastDrop,
  playColumns,
  type Connect4Event,
  type Connect4Seat,
  type Connect4State,
} from './index';

// Les règles du Puissance 4, cas par cas. C1 à C15 sont les cas du § 15.5 du document des jeux ; chacun tourne avec le siège 0 puis le siège 1 qui commence. Les cas
// suivants (C16 et après) sont ceux que l'agent du jeu ajoute : les directions et les places du dernier jeton que les quinze du document ne couvrent pas, la
// géométrie de la grille prise toute seule, les coups mal formés, et les invariants sur des états abîmés.

// Puissance 4 ne tire jamais au hasard : ce générateur n'a aucune valeur et lève s'il en est demandé une (R3).
const rng = scriptedRng([]);

const SEATS: readonly Connect4Seat[] = [0, 1];
const other = (seat: Connect4Seat): Connect4Seat => (seat === 0 ? 1 : 0);

// L'index d'une case, écrit ici à part du moteur : la convention du § 15.3 (colonne × 6 + rangée, la rangée 0 en bas) est vérifiée par ces tests, pas répétée
// d'après le code qu'ils jugent.
const at = (col: number, row: number): number => col * 6 + row;

// Une suite de colonnes, écrite comme dans le document.
const columns = (text: string): number[] => text.split(' ').map(Number);
const sorted = (cells: Iterable<number>): number[] => [...cells].sort((a, b) => a - b);

// Les séquences du § 15.5.
const C4 = columns('3 4 3 4 3 4 3');
const C5 = columns('0 0 1 1 2 2 3');
const C6 = columns('0 1 1 2 3 2 2 3 6 3 3');
const C7 = columns('6 5 5 4 3 4 4 3 0 3 3');
const C8 = columns('0 0 1 1 3 3 4 6 2');
const C9 = columns('3 0 2 0 5 0 6 2 0 4 6 1 0 2 6 0 4 1 3 5 4 3 5 2 1 5 6');
const C10 = columns('0 2 2 2 2 2 2 0 0 0 0 0 1 3 3 3 3 3 3 1 1 1 1 1 4 6 6 6 6 6 6 4 4 4 4 4 5 5 5 5 5 5');
const C11 = columns('1 2 4 6 5 2 1 0 2 5 4 0 6 5 4 1 5 2 1 6 3 4 0 4 5 2 5 4 6 2 6 3 6 0 1 1 0 0 3 3 3 3');

interface Played {
  // L'état après chaque coup ; le premier est la partie neuve, le dernier l'état final. Chacun est gelé : une fonction qui le modifierait lèverait (R1).
  states: Connect4State[];
  state: Connect4State;
  // Ce que chaque coup a provoqué (la case 0 est celle de `create`).
  eventsByStep: Connect4Event[][];
  // Ce que le dernier coup a provoqué.
  events: Connect4Event[];
}

// Une partie jouée : les colonnes à la suite, en alternant, à partir du siège `first`. Chaque coup passe par `apply` ; un coup refusé fait échouer le test.
function play(first: Connect4Seat, sequence: readonly number[]): Played {
  const created = connect4.create({ seats: 2, first }, rng);
  const states = [deepFreeze(created.state)];
  const eventsByStep = [deepFreeze(created.events)];
  for (const [index, col] of sequence.entries()) {
    const state = states[states.length - 1]!;
    const seat = connect4.turn(state);
    if (seat === null) throw new Error(`coup ${index + 1} (colonne ${col}) : la partie est déjà finie`);
    const out = connect4.apply(state, seat, { col }, rng);
    if (!out.ok) throw new Error(`coup ${index + 1} (colonne ${col}) refusé : ${out.error}`);
    states.push(deepFreeze(out.state));
    eventsByStep.push(deepFreeze(out.events));
  }
  return { states, state: states[states.length - 1]!, eventsByStep, events: eventsByStep[eventsByStep.length - 1]! };
}

const four = (winner: Connect4Seat, cells: number[]): GameResult => ({ ranking: [[winner], [other(winner)]], reason: 'four', detail: { cells } });

interface FourCase {
  first: Connect4Seat;
  sequence: readonly number[];
  // Qui gagne : celui qui a commencé, ou l'autre.
  winner: 'first' | 'second';
  // Les cases de la ligne gagnante, en (colonne, rangée), toutes lignes réunies.
  cells: ReadonlyArray<readonly [number, number]>;
  // Le dernier jeton posé, en (colonne, rangée).
  last: readonly [number, number];
}

// Ce que le document attend d'une victoire : le gagnant, la ligne (dans `winLine`, dans le résultat et dans l'événement `end`), la fin au dernier jeton et
// pas avant (trois alignés, ou quatre à un jeton près, ne finissent pas la partie), puis plus aucun coup.
function expectFour({ first, sequence, winner, cells, last }: FourCase): void {
  const label = `first = ${first}`;
  const winnerSeat = winner === 'first' ? first : other(first);
  const line = sorted(cells.map(([col, row]) => at(col, row)));
  const game = play(first, sequence);

  expect(game.state.winLine, label).toStrictEqual(line);
  expect(game.state.result, label).toStrictEqual(four(winnerSeat, line));
  expect(connect4.result(game.state), label).toStrictEqual(four(winnerSeat, line));
  expect(connect4.turn(game.state), label).toBeNull();
  expect(game.events, label).toStrictEqual([
    { type: 'drop', seat: winnerSeat, col: last[0], row: last[1] },
    { type: 'end', winner: winnerSeat, cells: line },
  ]);
  expect(game.state.moves, label).toStrictEqual([...sequence]);
  expect(connect4.countedMoves(game.state), label).toBe(sequence.length);
  expect(connect4.invariants(game.state), label).toEqual([]);
  for (const cell of line) expect(game.state.cells[cell], `${label}, case ${cell}`).toBe(winnerSeat + 1);
  for (const seat of SEATS) expect(connect4.legalMoves(game.state, seat), label).toEqual([]);

  for (const [count, state] of game.states.slice(0, -1).entries()) {
    expect(state.result, `${label}, après ${count} jetons`).toBeNull();
    expect(state.winLine, `${label}, après ${count} jetons`).toStrictEqual([]);
    expect(connect4.turn(state), `${label}, après ${count} jetons`).not.toBeNull();
  }
}

describe('Puissance 4 : l\'identité du jeu', () => {
  test('deux joueurs, pas de nulle par accord, le nom français ; un coup est une colonne de 0 à 6', () => {
    expect(connect4).toMatchObject({ id: 'connect4', label: 'Puissance 4', minPlayers: 2, maxPlayers: 2, drawOffers: false });
    expect(connect4.agreeDraw).toBeUndefined();
    expect(connect4.moveSchema).toBe(connect4MoveSchema);
    for (let col = 0; col < 7; col++) expect(connect4MoveSchema.safeParse({ col }).success, `colonne ${col}`).toBe(true);
    for (const bad of [{ col: -1 }, { col: 7 }, { col: 2.5 }, { col: '3' }, { col: Number.NaN }, { col: Infinity }, { col: null }, {}, null, 3, 'x', []]) {
      expect(connect4MoveSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  test('se range au registre sans conversion (le contrat est écrit en méthodes), et refuse une partie qui n\'est pas à deux', () => {
    const registered: AnyGameDefinition = connect4;
    expect(registered.id).toBe('connect4');
    for (const seats of [0, 1, 3, 4]) expect(() => connect4.create({ seats, first: 0 }, rng), `${seats} sièges`).toThrow(/deux/);
    for (const first of [2, -1, 0.5]) expect(() => connect4.create({ seats: 2, first }, rng), `first = ${first}`).toThrow(/commence/);
  });
});

describe('Puissance 4 : les cas du § 15.5', () => {
  test('C1 : une partie neuve est une grille vide, le trait est à `first`, les sept colonnes sont jouables', () => {
    for (const first of SEATS) {
      const label = `first = ${first}`;
      const { state, events } = connect4.create({ seats: 2, first }, rng);
      expect(state, label).toStrictEqual({ cells: Array.from({ length: 42 }, () => 0), first, moves: [], winLine: [], result: null });
      expect(events, label).toStrictEqual([]);
      expect(connect4.turn(state), label).toBe(first);
      expect(connect4.legalMoves(state, first), label).toStrictEqual([0, 1, 2, 3, 4, 5, 6].map((col) => ({ col })));
      expect(connect4.legalMoves(state, other(first)), label).toStrictEqual([]);
      expect(connect4.result(state), label).toBeNull();
      expect(connect4.countedMoves(state), label).toBe(0);
      expect(connect4.invariants(state), label).toEqual([]);
    }
  });

  test('C2 : un jeton lâché en colonne 3 tombe en rangée 0 ; le suivant dans la même colonne, en rangée 1', () => {
    for (const first of SEATS) {
      const label = `first = ${first}`;
      const one = play(first, [3]);
      expect(one.state.cells[at(3, 0)], label).toBe(first + 1);
      expect(one.state.cells.filter((cell) => cell !== 0), label).toHaveLength(1);
      expect(one.events, label).toStrictEqual([{ type: 'drop', seat: first, col: 3, row: 0 }]);
      expect(one.state.moves, label).toStrictEqual([3]);
      expect(connect4.turn(one.state), label).toBe(other(first));
      expect(connect4.countedMoves(one.state), label).toBe(1);

      const two = play(first, [3, 3]);
      expect(two.state.cells[at(3, 0)], label).toBe(first + 1);
      expect(two.state.cells[at(3, 1)], label).toBe(other(first) + 1);
      expect(two.state.cells.filter((cell) => cell !== 0), label).toHaveLength(2);
      expect(two.events, label).toStrictEqual([{ type: 'drop', seat: other(first), col: 3, row: 1 }]);
      expect(connect4.turn(two.state), label).toBe(first);

      // Les colonnes du bord tombent aussi au fond.
      const edges = play(first, [0, 6]);
      expect(edges.state.cells[at(0, 0)], label).toBe(first + 1);
      expect(edges.state.cells[at(6, 0)], label).toBe(other(first) + 1);
    }
  });

  test('C3 : une colonne pleine (six jetons) refuse le septième ; legalMoves ne la propose plus', () => {
    for (const first of SEATS) {
      const label = `first = ${first}`;
      const full = play(first, [0, 0, 0, 0, 0, 0]);
      for (let row = 0; row < 6; row++) expect(full.state.cells[at(0, row)], `${label}, rangée ${row}`).toBe((row % 2 === 0 ? first : other(first)) + 1);
      expect(full.events, label).toStrictEqual([{ type: 'drop', seat: other(first), col: 0, row: 5 }]);
      const seat = connect4.turn(full.state)!;
      expect(seat, label).toBe(first);
      expect(connect4.apply(full.state, seat, { col: 0 }, rng), label).toStrictEqual({ ok: false, error: 'illegal' });
      expect(connect4.legalMoves(full.state, seat), label).toStrictEqual([1, 2, 3, 4, 5, 6].map((col) => ({ col })));
      // Les autres colonnes restent jouables.
      expect(connect4.apply(full.state, seat, { col: 1 }, rng).ok, label).toBe(true);
    }
  });

  test('C4 : quatre jetons l\'un sur l\'autre gagnent au 7e jeton (verticale de (3,0) à (3,3))', () => {
    for (const first of SEATS) {
      expectFour({ first, sequence: C4, winner: 'first', cells: [[3, 0], [3, 1], [3, 2], [3, 3]], last: [3, 3] });
    }
  });

  test('C5 : quatre jetons côte à côte gagnent au 7e jeton (horizontale de (0,0) à (3,0))', () => {
    for (const first of SEATS) {
      expectFour({ first, sequence: C5, winner: 'first', cells: [[0, 0], [1, 0], [2, 0], [3, 0]], last: [3, 0] });
    }
  });

  test('C6 : la diagonale montante (0,0) (1,1) (2,2) (3,3) gagne au 11e jeton', () => {
    for (const first of SEATS) {
      expectFour({ first, sequence: C6, winner: 'first', cells: [[0, 0], [1, 1], [2, 2], [3, 3]], last: [3, 3] });
    }
  });

  test('C7 : la diagonale descendante (6,0) (5,1) (4,2) (3,3) gagne au 11e jeton', () => {
    for (const first of SEATS) {
      expectFour({ first, sequence: C7, winner: 'first', cells: [[6, 0], [5, 1], [4, 2], [3, 3]], last: [3, 3] });
    }
  });

  test('C8 : un jeton qui relie deux paires fait une ligne de cinq, et `winLine` a les cinq cases (au 9e jeton)', () => {
    for (const first of SEATS) {
      expectFour({ first, sequence: C8, winner: 'first', cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], last: [2, 0] });
      expect(play(first, C8).state.winLine).toHaveLength(5);
    }
  });

  test('C9 : un jeton qui achève deux lignes à la fois réunit leurs sept cases (la verticale (6,0)-(6,3) et la diagonale (3,0)-(6,3), au 27e jeton)', () => {
    for (const first of SEATS) {
      const cells = [[6, 0], [6, 1], [6, 2], [6, 3], [3, 0], [4, 1], [5, 2]] as const;
      expectFour({ first, sequence: C9, winner: 'first', cells, last: [6, 3] });
      expect(play(first, C9).state.winLine, `first = ${first}`).toStrictEqual([at(3, 0), at(4, 1), at(5, 2), at(6, 0), at(6, 1), at(6, 2), at(6, 3)]);
    }
  });

  test('C10 : la grille pleine sans alignement est nulle (`full`), au 42e jeton et pas avant', () => {
    for (const first of SEATS) {
      const label = `first = ${first}`;
      const game = play(first, C10);
      expect(game.state.cells.every((cell) => cell !== 0), label).toBe(true);
      expect(game.state.result, label).toStrictEqual({ ranking: [[0, 1]], reason: 'full' });
      expect(game.state.winLine, label).toStrictEqual([]);
      expect(connect4.turn(game.state), label).toBeNull();
      expect(game.events, label).toStrictEqual([
        { type: 'drop', seat: other(first), col: 5, row: 5 },
        { type: 'end', winner: null, cells: [] },
      ]);
      expect(connect4.countedMoves(game.state), label).toBe(42);
      expect(connect4.invariants(game.state), label).toEqual([]);
      for (const seat of SEATS) expect(connect4.legalMoves(game.state, seat), label).toEqual([]);
      // Avant le 42e jeton, la partie est en cours : une seule case est libre, et c'est à l'autre de la jouer.
      const before = game.states[41]!;
      expect(before.result, label).toBeNull();
      expect(connect4.turn(before), label).toBe(other(first));
      expect(connect4.legalMoves(before, other(first)), label).toStrictEqual([{ col: 5 }]);
    }
  });

  test('C11 : le 42e jeton peut gagner : l\'alignement est cherché avant la nulle (victoire du second joueur, rangée du haut)', () => {
    for (const first of SEATS) {
      const cells = [[0, 5], [1, 5], [2, 5], [3, 5], [4, 5]] as const;
      expectFour({ first, sequence: C11, winner: 'second', cells, last: [3, 5] });
      const state = play(first, C11).state;
      expect(state.cells.every((cell) => cell !== 0), `first = ${first}`).toBe(true);
      expect(state.result?.reason, `first = ${first}`).toBe('four');
    }
  });

  test('C12 : une fois la partie gagnée, plus aucun coup n\'est accepté, par personne', () => {
    for (const first of SEATS) {
      const won = play(first, C4).state;
      for (const seat of SEATS) {
        expect(connect4.legalMoves(won, seat), `first = ${first}, siège ${seat}`).toStrictEqual([]);
        for (let col = 0; col < 7; col++) {
          expect(connect4.apply(won, seat, { col }, rng), `first = ${first}, siège ${seat}, colonne ${col}`).toStrictEqual({ ok: false, error: 'wrong_phase' });
        }
      }
    }
  });

  test('C13 : un coup du siège qui n\'a pas le trait est refusé, et l\'état ne change pas', () => {
    for (const first of SEATS) {
      const label = `first = ${first}`;
      const start = play(first, []).state;
      expect(connect4.apply(start, other(first), { col: 3 }, rng), label).toStrictEqual({ ok: false, error: 'not_your_turn' });
      expect(connect4.legalMoves(start, other(first)), label).toStrictEqual([]);
      // Celui qui vient de jouer ne rejoue pas ; un siège qui n'existe pas non plus.
      const one = play(first, [3]).state;
      expect(connect4.apply(one, first, { col: 4 }, rng), label).toStrictEqual({ ok: false, error: 'not_your_turn' });
      for (const seat of [2, -1, 0.5, Number.NaN]) {
        expect(connect4.apply(one, seat, { col: 4 }, rng), `${label}, siège ${seat}`).toStrictEqual({ ok: false, error: 'not_your_turn' });
        expect(connect4.legalMoves(one, seat), `${label}, siège ${seat}`).toStrictEqual([]);
      }
      expect(one.moves, label).toStrictEqual([3]);
    }
  });

  test('C14 : un abandon, un délai ou un départ donne la partie à l\'autre, avec la raison de la plateforme', () => {
    for (const first of SEATS) {
      for (const seat of SEATS) {
        for (const reason of FORFEIT_REASONS) {
          const label = `first = ${first}, siège ${seat}, ${reason}`;
          const running = play(first, columns('3 4')).state;
          const out = connect4.forfeit(running, seat, reason);
          expect(out.state.result, label).toStrictEqual({ ranking: [[other(seat)], [seat]], reason });
          expect(out.events, label).toStrictEqual([{ type: 'forfeit', seat, reason }]);
          expect(connect4.result(out.state), label).toStrictEqual(out.state.result);
          expect(connect4.turn(out.state), label).toBeNull();
          expect(connect4.invariants(out.state), label).toEqual([]);
          for (const to of SEATS) {
            expect(connect4.legalMoves(out.state, to), label).toStrictEqual([]);
            expect(connect4.apply(out.state, to, { col: 0 }, rng).ok, label).toBe(false);
          }
          // La grille et les coups sont ceux du moment ; l'état d'avant n'a pas bougé.
          expect(out.state.cells, label).toStrictEqual(running.cells);
          expect(out.state.moves, label).toStrictEqual(running.moves);
          expect(running.result, label).toBeNull();
        }
      }
      // Sur une partie neuve aussi (la plateforme peut faire sortir quelqu'un avant le premier jeton) ; jamais deux fois, jamais après la fin, jamais un inconnu.
      const label = `first = ${first}`;
      const fresh = play(first, []).state;
      expect(connect4.forfeit(fresh, first, 'resign').state.result, label).toStrictEqual({ ranking: [[other(first)], [first]], reason: 'resign' });
      const ended = connect4.forfeit(fresh, 0, 'timeout').state;
      expect(connect4.forfeit(ended, 1, 'resign'), label).toStrictEqual({ state: ended, events: [] });
      const won = play(first, C4).state;
      expect(connect4.forfeit(won, 0, 'resign'), label).toStrictEqual({ state: won, events: [] });
      expect(connect4.forfeit(fresh, 2, 'resign'), label).toStrictEqual({ state: fresh, events: [] });
    }
  });

  test('C15 : l\'état et les événements survivent à un aller-retour par JSON ; les invariants listent un trou ou trop de jetons d\'une couleur', () => {
    for (const first of SEATS) {
      const label = `first = ${first}`;
      const roundTrip = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
      const resigned = connect4.forfeit(play(first, columns('3 3 4')).state, 0, 'disconnect');
      for (const game of [play(first, []), play(first, columns('3 3 4')), play(first, C4), play(first, C9), play(first, C10), play(first, C11)]) {
        for (const state of game.states) expect(roundTrip(state), label).toStrictEqual(state);
        for (const events of game.eventsByStep) expect(roundTrip(events), label).toStrictEqual(events);
      }
      expect(roundTrip(resigned.state), label).toStrictEqual(resigned.state);
      expect(roundTrip(resigned.events), label).toStrictEqual(resigned.events);

      const mid = play(first, columns('3 4 3 4 3')).state;
      expect(connect4.invariants(mid), label).toEqual([]);
      // Un trou : le jeton du fond d'une colonne a disparu, celui qui était dessus flotte.
      const hole = { ...mid, cells: mid.cells.map((cell, index) => (index === at(3, 0) ? 0 : cell)) };
      expect(connect4.invariants(hole).some((problem) => /flotte/.test(problem)), label).toBe(true);
      // Trop de jetons d'une couleur : un de plus pour le siège qui commence fait deux d'avance, ce qui ne peut pas arriver.
      const heavy = { ...mid, cells: mid.cells.map((cell, index) => (index === at(0, 0) ? first + 1 : cell)) };
      expect(connect4.invariants(heavy).some((problem) => /jetons/.test(problem)), label).toBe(true);
    }
  });
});

describe('Puissance 4 : cas ajoutés par l\'agent du jeu (la place du dernier jeton, les directions, les pièges)', () => {
  test('C16 : un jeton posé au bout gauche d\'une ligne l\'achève (horizontale (1,0)-(4,0)), et trois alignés de l\'adversaire ne finissent rien', () => {
    for (const first of SEATS) {
      expectFour({ first, sequence: columns('3 3 4 4 2 2 1'), winner: 'first', cells: [[1, 0], [2, 0], [3, 0], [4, 0]], last: [1, 0] });
    }
  });

  test('C17 : un jeton posé au milieu d\'une ligne l\'achève (horizontales (2,0)-(5,0) par la case (4,0), et (0,0)-(3,0) par la case (2,0))', () => {
    for (const first of SEATS) {
      expectFour({ first, sequence: columns('2 0 3 2 5 1 4'), winner: 'first', cells: [[2, 0], [3, 0], [4, 0], [5, 0]], last: [4, 0] });
      expectFour({ first, sequence: columns('0 6 1 6 3 6 2'), winner: 'first', cells: [[0, 0], [1, 0], [2, 0], [3, 0]], last: [2, 0] });
    }
  });

  test('C18 : une diagonale montante achevée par sa case la plus basse, (0,0), gagne au 11e jeton', () => {
    for (const first of SEATS) {
      expectFour({ first, sequence: columns('1 3 3 3 3 2 1 2 2 2 0'), winner: 'first', cells: [[0, 0], [1, 1], [2, 2], [3, 3]], last: [0, 0] });
    }
  });

  test('C19 : une diagonale montante achevée par une case du milieu, (2,2), gagne au 10e jeton (le second joueur)', () => {
    for (const first of SEATS) {
      expectFour({ first, sequence: columns('1 3 3 1 3 3 2 0 2 2'), winner: 'second', cells: [[0, 0], [1, 1], [2, 2], [3, 3]], last: [2, 2] });
    }
  });

  test('C20 : une diagonale descendante achevée par sa case la plus basse, (5,0), gagne au 11e jeton', () => {
    for (const first of SEATS) {
      expectFour({ first, sequence: columns('3 4 4 3 2 2 3 2 2 4 5'), winner: 'first', cells: [[2, 3], [3, 2], [4, 1], [5, 0]], last: [5, 0] });
    }
  });

  test('C21 : une diagonale descendante achevée par une case du milieu, (3,2), gagne au 10e jeton (le second joueur)', () => {
    for (const first of SEATS) {
      expectFour({ first, sequence: columns('4 3 2 5 2 4 2 2 3 3'), winner: 'second', cells: [[2, 3], [3, 2], [4, 1], [5, 0]], last: [3, 2] });
    }
  });

  test('C22 : trois jetons alignés ne gagnent pas, dans aucune des quatre directions : la partie continue', () => {
    for (const first of SEATS) {
      for (const [name, sequence] of [['verticale', C4], ['horizontale', C5], ['diagonale montante', C6], ['diagonale descendante', C7]] as const) {
        const label = `first = ${first}, ${name}`;
        const state = play(first, sequence.slice(0, -1)).state;
        expect(state.result, label).toBeNull();
        expect(state.winLine, label).toStrictEqual([]);
        expect(connect4.turn(state), label).toBe(first);
        expect(connect4.legalMoves(state, first).length, label).toBeGreaterThan(0);
      }
    }
  });

  test('C23 : un jeton adverse au milieu coupe la ligne : quatre jetons dans la même rangée, mais pas côte à côte, ne gagnent pas', () => {
    for (const first of SEATS) {
      const label = `first = ${first}`;
      const game = play(first, columns('0 2 1 5 3 6 4'));
      // La rangée du bas : le siège `first` en 0, 1, 3 et 4 ; l'autre en 2, 5 et 6.
      const mine = first + 1;
      const theirs = other(first) + 1;
      expect([0, 1, 2, 3, 4, 5, 6].map((col) => game.state.cells[at(col, 0)]), label).toStrictEqual([mine, mine, theirs, mine, mine, theirs, theirs]);
      expect(game.state.result, label).toBeNull();
      expect(game.state.winLine, label).toStrictEqual([]);
      expect(connect4.turn(game.state), label).toBe(other(first));
    }
  });

  test('C24 : le trait se déduit de `first` et du nombre de jetons posés, et l\'état n\'a aucun champ de plus qui puisse diverger', () => {
    for (const first of SEATS) {
      const game = play(first, C10);
      for (const [count, state] of game.states.slice(0, -1).entries()) {
        expect(connect4.turn(state), `first = ${first}, après ${count} jetons`).toBe(count % 2 === 0 ? first : other(first));
        expect(Object.keys(state).sort(), `first = ${first}, après ${count} jetons`).toStrictEqual(['cells', 'first', 'moves', 'result', 'winLine']);
      }
    }
  });

  test('C25 : legalMoves et apply s\'accordent, colonne par colonne, à chaque pas des parties du document', () => {
    for (const first of SEATS) {
      for (const sequence of [C9, C10, C11]) {
        for (const [count, state] of play(first, sequence).states.entries()) {
          const seat = connect4.turn(state);
          if (seat === null) continue;
          const legal = connect4.legalMoves(state, seat).map((move) => move.col);
          for (const col of [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0.5, 3.5]) {
            expect(connect4.apply(state, seat, { col }, rng).ok, `first = ${first}, après ${count} jetons, colonne ${col}`).toBe(legal.includes(col));
          }
        }
      }
    }
  });

  test('C26 : un coup mal formé (hors grille, fractionnaire, pas un nombre, pas un objet) est refusé sans rien lever', () => {
    const bad: unknown[] = [
      { col: -1 }, { col: 7 }, { col: 1.5 }, { col: Number.NaN }, { col: Infinity }, { col: -Infinity }, { col: '3' }, { col: null }, { col: undefined }, { col: [3] },
      { column: 3 }, {}, [], null, undefined, 3, '3', true,
    ];
    for (const first of SEATS) {
      const state = play(first, columns('3 4')).state;
      for (const [index, move] of bad.entries()) {
        expect(connect4.apply(state, first, move as never, rng), `first = ${first}, coup mal formé n° ${index}`).toStrictEqual({ ok: false, error: 'illegal' });
      }
    }
  });

  test('C27 : apply ne modifie pas son état, ne tire rien au hasard, et le même coup donne toujours le même résultat', () => {
    for (const first of SEATS) {
      const state = play(first, columns('3 4 3')).state;
      const before = JSON.stringify(state);
      const a = connect4.apply(state, other(first), { col: 4 }, rng);
      const b = connect4.apply(state, other(first), { col: 4 }, rng);
      expect(a, `first = ${first}`).toStrictEqual(b);
      expect(a.ok, `first = ${first}`).toBe(true);
      expect(JSON.stringify(state), `first = ${first}`).toBe(before);
      // Un coup refusé ne laisse rien non plus.
      expect(connect4.apply(state, other(first), { col: 9 }, rng).ok, `first = ${first}`).toBe(false);
      expect(JSON.stringify(state), `first = ${first}`).toBe(before);
    }
  });
});

// Les 69 lignes de quatre cases d'une grille de 7 × 6 (24 horizontales, 21 verticales, 12 diagonales montantes, 12 descendantes), énumérées ici sans rien emprunter
// au moteur.
function allLines(): number[][] {
  const lines: number[][] = [];
  for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
    for (let col = 0; col < 7; col++) {
      for (let row = 0; row < 6; row++) {
        const endCol = col + 3 * dc;
        const endRow = row + 3 * dr;
        if (endCol < 0 || endCol > 6 || endRow < 0 || endRow > 5) continue;
        lines.push([0, 1, 2, 3].map((step) => at(col + step * dc, row + step * dr)));
      }
    }
  }
  return lines;
}

// Une grille de 42 cases où seules les cases données ont un jeton.
function boardWith(indexes: Iterable<number>, piece = 1): number[] {
  const cells = Array.from({ length: 42 }, () => 0);
  for (const index of indexes) cells[index] = piece;
  return cells;
}

describe('Puissance 4 : la grille toute seule (la recherche des alignements autour d\'un jeton)', () => {
  test('C28 : les 69 lignes de quatre sont toutes vues, depuis chacune de leurs quatre cases', () => {
    const lines = allLines();
    expect(lines).toHaveLength(69);
    for (const line of lines) {
      for (const last of line) expect(alignedCells(boardWith(line), last), `ligne ${line.join(',')} vue depuis ${last}`).toStrictEqual(sorted(line));
    }
  });

  test('C29 : une ligne dont une case est vide ou tenue par l\'adversaire n\'aligne rien, et une case vide n\'aligne rien', () => {
    for (const line of allLines()) {
      for (const gap of line) {
        for (const value of [0, 2]) {
          const cells = boardWith(line);
          cells[gap] = value;
          for (const last of line) {
            expect(alignedCells(cells, last), `ligne ${line.join(',')}, case ${gap} à ${value}, vue depuis ${last}`).toStrictEqual([]);
          }
        }
      }
    }
  });

  test('C30 : une ligne de 5, 6 ou 7 compte en entier, et plusieurs lignes à la fois s\'additionnent (cases triées, sans doublon)', () => {
    // Une rangée entière : sept jetons, les sept cases depuis n'importe lequel.
    const row = [0, 1, 2, 3, 4, 5, 6].map((col) => at(col, 2));
    for (const last of row) expect(alignedCells(boardWith(row), last), `rangée vue depuis ${last}`).toStrictEqual(sorted(row));
    // Une colonne entière : six jetons.
    const column = [0, 1, 2, 3, 4, 5].map((r) => at(4, r));
    for (const last of column) expect(alignedCells(boardWith(column), last), `colonne vue depuis ${last}`).toStrictEqual(sorted(column));
    // Un L : la verticale (0,0)-(0,3) et l'horizontale (0,0)-(3,0) se rejoignent au coin ; vu depuis le coin, sept cases.
    const corner = [...[0, 1, 2, 3].map((r) => at(0, r)), ...[1, 2, 3].map((col) => at(col, 0))];
    expect(alignedCells(boardWith(corner), at(0, 0))).toStrictEqual(sorted(corner));
    // Une étoile : les quatre lignes qui passent par (3,3), de 7, 6, 6 et 6 cases, soit vingt-deux cases en tout.
    const star = new Set([
      ...[0, 1, 2, 3, 4, 5, 6].map((col) => at(col, 3)),
      ...[0, 1, 2, 3, 4, 5].map((r) => at(3, r)),
      ...[0, 1, 2, 3, 4, 5].map((k) => at(k, k)),
      ...[0, 1, 2, 3, 4, 5].map((k) => at(1 + k, 5 - k)),
    ]);
    expect(star.size).toBe(22);
    expect(alignedCells(boardWith(star), at(3, 3))).toStrictEqual(sorted(star));
    // Deux jetons adverses de part et d'autre du centre coupent l'horizontale : il reste les trois autres lignes, et seulement les cases du joueur.
    const cut = boardWith(star);
    cut[at(2, 3)] = 2;
    cut[at(4, 3)] = 2;
    expect(alignedCells(cut, at(3, 3))).toStrictEqual(sorted([...star].filter((index) => index === at(3, 3) || index % 6 !== 3)));
  });

  test('C31 : une ligne ne déborde jamais du haut d\'une colonne sur le bas de la suivante, ni en vertical ni en diagonale', () => {
    // Dans le tableau des cases, la rangée 5 d'une colonne est suivie de la rangée 0 de la colonne d'après : ce n'est pas un voisin sur la grille.
    const vertical = [at(0, 4), at(0, 5), at(1, 0), at(1, 1)];
    // Une diagonale montante qui sortirait par le haut : (0,3) (1,4) (2,5), puis, dans le tableau, le bas de la colonne 4.
    const rising = [at(0, 3), at(1, 4), at(2, 5), at(4, 0)];
    // Une diagonale descendante qui sortirait par le bas : (3,0), puis, dans le tableau, le haut de la colonne 3 et la suite en escalier.
    const falling = [at(3, 0), at(3, 5), at(4, 4), at(5, 3)];
    for (const [name, line] of [['verticale', vertical], ['montante', rising], ['descendante', falling]] as const) {
      for (const last of line) expect(alignedCells(boardWith(line), last), `${name} vue depuis ${last}`).toStrictEqual([]);
    }
  });
});

describe('Puissance 4 : les invariants', () => {
  // Les états de départ des cas abîmés, construits à la demande (et une seule fois).
  let memo: { mid: Connect4State; won: Connect4State; drawn: Connect4State } | undefined;
  const states = () => (memo ??= { mid: play(0, columns('3 4 3 4 3')).state, won: play(0, C4).state, drawn: play(0, C10).state });
  const set = (state: Connect4State, changes: Record<string, unknown>): Connect4State => ({ ...state, ...changes }) as Connect4State;
  const withCell = (state: Connect4State, index: number, value: number): Connect4State =>
    set(state, { cells: state.cells.map((cell, i) => (i === index ? value : cell)) });

  test('toute partie jouée, à chaque pas, n\'a aucune violation : neuve, en cours, gagnée, nulle, abandonnée', () => {
    for (const first of SEATS) {
      for (const sequence of [[], C4, C5, C6, C7, C8, C9, C10, C11]) {
        for (const [count, state] of play(first, sequence).states.entries()) expect(connect4.invariants(state), `first = ${first}, après ${count} jetons`).toEqual([]);
      }
      for (const state of play(first, columns('3 4 3 4')).states) {
        for (const seat of SEATS) {
          for (const reason of FORFEIT_REASONS) expect(connect4.invariants(connect4.forfeit(state, seat, reason).state), `first = ${first}, ${reason}`).toEqual([]);
        }
      }
    }
  });

  const damaged: Array<[string, () => Connect4State, RegExp]> = [
    ['une grille de 41 cases', () => set(states().mid, { cells: states().mid.cells.slice(0, 41) }), /41 cases/],
    ['une grille de 43 cases', () => set(states().mid, { cells: [...states().mid.cells, 0] }), /43 cases/],
    ['une case qui vaut 3', () => withCell(states().mid, at(6, 0), 3), /vaut 3/],
    ['une case qui vaut -1', () => withCell(states().mid, at(6, 0), -1), /vaut -1/],
    ['une case qui vaut 1,5', () => withCell(states().mid, at(6, 0), 1.5), /vaut 1.5/],
    ['un siège de départ qui vaut 2', () => set(states().mid, { first: 2 }), /commence/],
    ['une colonne jouée qui n\'existe pas', () => set(states().mid, { moves: [...states().mid.moves.slice(0, -1), 9] }), /colonne 9, qui n'existe pas/],
    ['une colonne jouée fractionnaire', () => set(states().mid, { moves: [...states().mid.moves.slice(0, -1), 1.5] }), /colonne 1.5, qui n'existe pas/],
    ['un jeton qui flotte', () => withCell(states().mid, at(3, 0), 0), /flotte/],
    // Un seul jeton au-dessus du trou (la colonne 3 de `states().mid` en a deux) : il faut le voir aussi.
    ['un seul jeton qui flotte', () => withCell(set(states().mid, { cells: play(0, columns('3 3')).state.cells, moves: [3, 3] }), at(3, 0), 0), /flotte/],
    ['un jeton de trop pour le premier joueur', () => withCell(states().mid, at(0, 0), 1), /jetons/],
    // Trois jetons contre deux au départ : un seul jeton de plus pour le second les rendrait égaux (légal) ; il en faut deux pour qu'il en ait plus que l'autre.
    ['deux jetons de trop pour le second joueur', () => withCell(withCell(states().mid, at(0, 0), 2), at(1, 0), 2), /jetons/],
    ['des coups qui ne redonnent pas la grille (l\'ordre change les couleurs)', () => set(states().mid, { moves: [4, 3, 3, 4, 3] }), /redonne/],
    ['des coups qui jouent dans une colonne déjà pleine', () => set(states().mid, { moves: [0, 0, 0, 0, 0, 0, 0] }), /pleine/],
    ['une ligne gagnante annoncée sans alignement', () => set(states().mid, { winLine: [at(3, 0), at(3, 1), at(3, 2), at(3, 3)] }), /winLine/],
    ['une partie gagnée sans résultat', () => set(states().won, { result: null }), /résultat/],
    ['une partie gagnée sans winLine', () => set(states().won, { winLine: [] }), /winLine/],
    ['une partie gagnée avec une winLine incomplète', () => set(states().won, { winLine: states().won.winLine.slice(1) }), /winLine/],
    ['une partie gagnée donnée au perdant', () => set(states().won, { result: four(1, states().won.winLine) }), /résultat/],
    ['une partie gagnée avec une autre raison', () => set(states().won, { result: { ranking: [[0], [1]], reason: 'resign' } }), /résultat/],
    ['une partie gagnée dont le détail n\'est pas la winLine', () => set(states().won, { result: four(0, [1, 2, 3, 4]) }), /résultat/],
    ['une grille pleine sans résultat', () => set(states().drawn, { result: null }), /résultat/],
    ['une grille pleine déclarée gagnée', () => set(states().drawn, { result: four(0, [0, 1, 2, 3]) }), /résultat/],
    ['une grille pleine dont le classement sépare les sièges', () => set(states().drawn, { result: { ranking: [[0], [1]], reason: 'full' } }), /résultat/],
    ['une nulle par grille pleine sur une grille qui ne l\'est pas', () => set(states().mid, { result: { ranking: [[0, 1]], reason: 'full' } }), /résultat/],
    ['un résultat à la raison inconnue', () => set(states().mid, { result: { ranking: [[0], [1]], reason: 'checkmate' } }), /résultat/],
    ['un abandon dont le classement est une nulle', () => set(states().mid, { result: { ranking: [[0, 1]], reason: 'resign' } }), /résultat/],
    ['un abandon qui oublie un siège', () => set(states().mid, { result: { ranking: [[0]], reason: 'timeout' } }), /résultat/],
    ['un résultat qui n\'est ni nul ni un objet', () => set(states().mid, { result: 'fini' }), /résultat/],
    ['une winLine qui n\'est pas une liste', () => set(states().mid, { winLine: 'x' }), /winLine/],
    ['une liste de coups qui n\'est pas une liste', () => set(states().mid, { moves: null }), /coups/],
  ];

  test.each(damaged)('un état abîmé est signalé : %s', (_name, build, expected) => {
    const problems = connect4.invariants(build());
    expect(problems.some((problem) => expected.test(problem)), `violations : ${JSON.stringify(problems)}`).toBe(true);
  });

  test('une ligne de quatre qui n\'a pas fini la partie est signalée (un alignement ancien reste sur la grille)', () => {
    // La partie C4 est gagnée par le siège 0 ; un coup de plus a été ajouté à la main, ailleurs, comme si la partie avait continué.
    const { won } = states();
    const continued = set(won, { moves: [...won.moves, 0], cells: won.cells.map((cell, index) => (index === at(0, 0) ? 2 : cell)), result: null, winLine: [] });
    const problems = connect4.invariants(continued);
    expect(problems.some((problem) => /ligne de quatre/.test(problem)), `violations : ${JSON.stringify(problems)}`).toBe(true);
  });

  test('un état qui n\'a pas la forme d\'un état est signalé, jamais une exception (debug:game envoie n\'importe quoi)', () => {
    for (const garbage of [undefined, null, 0, 42, 'x', true, [], {}, { cells: 'abc' }, { cells: [], first: 0, moves: [], winLine: [], result: null }]) {
      let problems: string[] = [];
      expect(() => {
        problems = connect4.invariants(garbage as never);
      }, JSON.stringify(garbage)).not.toThrow();
      expect(problems.length, JSON.stringify(garbage)).toBeGreaterThan(0);
    }
  });
});

describe('Puissance 4 : les aides de la grille pour l\'interface et les tests', () => {
  test('la grille : 7 colonnes de 6 rangées, 42 cases ; l\'index d\'une case est colonne × 6 + rangée, et on en retrouve la colonne et la rangée', () => {
    expect([CONNECT4_COLUMNS, CONNECT4_ROWS, CONNECT4_CELLS]).toStrictEqual([7, 6, 42]);
    for (let col = 0; col < 7; col++) {
      for (let row = 0; row < 6; row++) {
        expect(cellIndex(col, row)).toBe(at(col, row));
        expect(cellColumn(at(col, row))).toBe(col);
        expect(cellRow(at(col, row))).toBe(row);
      }
    }
  });

  test('isColumn : seuls les entiers de 0 à 6 sont des colonnes (un coup qui vient du réseau peut contenir n\'importe quoi)', () => {
    for (let col = 0; col < 7; col++) expect(isColumn(col), `colonne ${col}`).toBe(true);
    for (const value of [-1, 7, 8, 100, 0.5, 3.5, 6.999, Number.NaN, Infinity, -Infinity, '3', '', null, undefined, [3], { col: 3 }, true]) {
      expect(isColumn(value), String(JSON.stringify(value) ?? value)).toBe(false);
    }
  });

  test('dropRow : la rangée où tombe un jeton (la plus basse libre), −1 pour une colonne pleine ou qui n\'existe pas', () => {
    const cells = play(0, columns('3 3 3 0 0 0')).state.cells;
    expect(dropRow(cells, 3)).toBe(3);
    expect(dropRow(cells, 0)).toBe(3);
    expect(dropRow(cells, 1)).toBe(0);
    expect(dropRow(play(0, [0, 0, 0, 0, 0]).state.cells, 0)).toBe(5);
    expect(dropRow(play(0, [0, 0, 0, 0, 0, 0]).state.cells, 0)).toBe(-1);
    for (const col of [-1, 7, 1.5, Number.NaN, Infinity]) expect(dropRow(cells, col), `colonne ${col}`).toBe(-1);
  });

  test('lastDrop : le dernier jeton posé (siège, colonne, rangée), nul pour une partie neuve, et d\'accord avec l\'événement de chaque coup', () => {
    for (const first of SEATS) {
      expect(lastDrop(play(first, []).state), `first = ${first}`).toBeNull();
      for (const sequence of [C9, C10, C11]) {
        const game = play(first, sequence);
        for (const [count, state] of game.states.entries()) {
          if (count === 0) continue;
          const drop = game.eventsByStep[count]!.find((event) => event.type === 'drop');
          expect(drop, `first = ${first}, jeton ${count}`).toBeDefined();
          if (drop?.type !== 'drop') continue;
          expect(lastDrop(state), `first = ${first}, jeton ${count}`).toStrictEqual({ seat: drop.seat, col: drop.col, row: drop.row });
        }
      }
      expect(lastDrop(play(first, [0, 0, 0, 0, 0, 0]).state), `first = ${first}`).toStrictEqual({ seat: other(first), col: 0, row: 5 });
    }
  });

  test('playColumns : rejoue des colonnes à partir de `first` et rend l\'état, comme apply le ferait ; un coup refusé lève', () => {
    for (const first of SEATS) {
      for (const sequence of [[], columns('3 4 3'), C4, C9, C10, C11]) expect(playColumns(first, sequence), `first = ${first}`).toStrictEqual(play(first, sequence).state);
      expect(() => playColumns(first, [0, 0, 0, 0, 0, 0, 0]), `first = ${first}`).toThrow(/coup 7/);
      expect(() => playColumns(first, [...C4, 0]), `first = ${first}`).toThrow(/coup 8/);
    }
  });
});
