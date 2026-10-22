import { describe, expect, test } from 'vitest';
import { deepFreeze } from '../conformance';
import { recordingRng, rngFromDice, scriptedRng, seededRng } from '../rng';
import {
  backgammon,
  backgammonStateFrom,
  diceToPlay,
  MAX_OPENING_ROLLS,
  maxPlayableSteps,
  nextSteps,
  previewSteps,
  STARTING_LAYOUT,
  type BackgammonLayout,
  type BackgammonMove,
  type BackgammonState,
  type BgStep,
} from './index';

// Ce que les cas nommés du document ne disent pas : le contrat (identité, schéma de coup, générateur), les événements, le dernier tour, le gammon et le backgammon des
// deux côtés, l'abandon, les aides de l'interface et chaque violation que `invariants` doit voir.

type Play = Extract<BackgammonMove, { type: 'play' }>;
type StepSpec = [from: number | 'bar', to: number | 'off', die: number];
const play = (...specs: StepSpec[]): Play => ({ type: 'play', steps: specs.map(([from, to, die]): BgStep => ({ from, to, die })) });
const position = (layout: BackgammonLayout): BackgammonState => deepFreeze(backgammonStateFrom(layout));
const start = (dice?: number[]): BackgammonState => position({ white: STARTING_LAYOUT, red: STARTING_LAYOUT, ...(dice ? { dice } : {}) });
const noDraw = scriptedRng([]);
const mustApply = (state: BackgammonState, seat: number, move: BackgammonMove, draws: number[] = []) => {
  const result = backgammon.apply(state, seat, move, scriptedRng(draws));
  if (!result.ok) throw new Error(`coup refusé (${result.error}) : ${JSON.stringify(move)}`);
  return result;
};

describe('backgammon : le contrat', () => {
  test('l\'identité : deux joueurs, pas de nulle par accord', () => {
    expect(backgammon).toMatchObject({ id: 'backgammon', label: 'Backgammon', minPlayers: 2, maxPlayers: 2, drawOffers: false });
    expect(backgammon.agreeDraw).toBeUndefined();
  });

  test('moveSchema : un lancer, ou un `play` de une à quatre étapes bien formées', () => {
    const accepts = (move: unknown): boolean => backgammon.moveSchema.safeParse(move).success;
    expect(accepts({ type: 'roll' })).toBe(true);
    expect(accepts(play(['bar', 20, 5]))).toBe(true);
    expect(accepts(play([3, 'off', 6]))).toBe(true);
    expect(accepts(play([24, 18, 6], [24, 18, 6], [8, 2, 6], [8, 2, 6]))).toBe(true);
    expect(accepts(play([24, 18, 6], [24, 18, 6], [8, 2, 6], [8, 2, 6], [13, 7, 6]))).toBe(false);
    expect(accepts({ type: 'play', steps: [] })).toBe(false);
    expect(accepts(play([13, 8, 0]))).toBe(false);
    expect(accepts(play([13, 8, 7]))).toBe(false);
    expect(accepts(play([13, 8, 2.5]))).toBe(false);
    expect(accepts(play([0, 8, 5]))).toBe(false);
    expect(accepts(play([25, 8, 5]))).toBe(false);
    expect(accepts(play([13, 0 as number, 5]))).toBe(false);
    expect(accepts({ type: 'play', steps: [{ from: 'off', to: 8, die: 5 }] })).toBe(false);
    expect(accepts({ type: 'play', steps: [{ from: 13, to: 'bar', die: 5 }] })).toBe(false);
    expect(accepts({ type: 'play' })).toBe(false);
    expect(accepts({ type: 'dance' })).toBe(false);
    expect(accepts(null)).toBe(false);
    expect(accepts('roll')).toBe(false);
  });

  test('turn, result et countedMoves : le trait, nul une fois finie ; un lancer et un tour passé ne sont pas des coups', () => {
    const state = start([3, 1]);
    expect(backgammon.turn(state)).toBe(0);
    expect(backgammon.result(state)).toBeNull();
    expect(backgammon.countedMoves(state)).toBe(0);
    const played = mustApply(state, 0, play([8, 5, 3], [6, 5, 1])).state;
    expect(backgammon.turn(played)).toBe(1);
    expect(backgammon.countedMoves(played)).toBe(1);
    const rolled = mustApply(played, 1, { type: 'roll' }, rngFromDice([4, 2])).state;
    expect(backgammon.turn(rolled)).toBe(1);
    expect(backgammon.countedMoves(rolled)).toBe(1);
    expect(backgammon.turn(backgammon.forfeit(rolled, 0, 'resign').state)).toBeNull();
    expect(backgammon.countedMoves(backgammon.forfeit(rolled, 0, 'resign').state)).toBe(1);
  });
});

describe('backgammon : le lancer d\'ouverture', () => {
  test('chacun des trente lancers sans égalité donne le premier tour au plus haut, avec les deux dés, dans un état légal', () => {
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        if (a === b) continue;
        const { state, events } = backgammon.create({ seats: 2, first: 0 }, scriptedRng(rngFromDice([a, b])));
        expect(state).toMatchObject({ turn: a > b ? 0 : 1, phase: 'move', dice: [a, b], opening: [[a, b]] });
        expect(events).toEqual([{ type: 'opening', rolls: [[a, b]], first: a > b ? 0 : 1 }]);
        expect(backgammon.invariants(state), `ouverture ${a}-${b}`).toEqual([]);
        expect(backgammon.legalMoves(state, state.turn).length, `ouverture ${a}-${b}`).toBeGreaterThan(0);
      }
    }
  });

  test('les égalités sont relancées autant de fois qu\'il faut, deux dés à chaque fois, et rien d\'autre n\'est tiré', () => {
    const drawn = recordingRng(scriptedRng(rngFromDice([2, 2, 6, 6, 1, 1, 4, 3])));
    const { state } = backgammon.create({ seats: 2, first: 1 }, drawn.rng);
    expect(drawn.take().length).toBe(8);
    expect(state.opening).toEqual([[2, 2], [6, 6], [1, 1], [4, 3]]);
    expect(state).toMatchObject({ turn: 0, dice: [4, 3] });
    // Un seul lancer sans égalité : deux dés tirés, pas un de plus.
    const once = recordingRng(seededRng(3));
    const first = backgammon.create({ seats: 2, first: 0 }, once.rng).state;
    expect(once.take().length).toBe(2 * first.opening.length);
  });

  test('un générateur qui ne départage jamais l\'ouverture lève au lieu de tourner sans fin', () => {
    let calls = 0;
    expect(() =>
      backgammon.create({ seats: 2, first: 0 }, () => {
        calls++;
        return 0.5;
      }),
    ).toThrow(/ne se départage pas/);
    expect(calls).toBe(2 * MAX_OPENING_ROLLS);
  });

  test('le plateau d\'aperçu de la plateforme (create avec seededRng(1), avant la première partie) est une partie légale qui s\'ouvre sans relancer sans fin', () => {
    const { state } = backgammon.create({ seats: 2, first: 0 }, seededRng(1));
    expect(backgammon.invariants(state)).toEqual([]);
    expect(state.opening.length).toBeLessThan(MAX_OPENING_ROLLS);
    expect(backgammon.legalMoves(state, state.turn).length).toBeGreaterThan(0);
  });

  test('une partie à trois ou à un joueur n\'existe pas : create le dit', () => {
    expect(() => backgammon.create({ seats: 3, first: 0 }, seededRng(1))).toThrow(/à deux/);
    expect(() => backgammon.create({ seats: 1, first: 0 }, seededRng(1))).toThrow(/à deux/);
  });
});

describe('backgammon : lancer, jouer et leurs événements', () => {
  test('un lancer tire exactement deux dés, dans l\'ordre, et garde le trait (le tour se joue ensuite)', () => {
    const state = start();
    const drawn = recordingRng(scriptedRng(rngFromDice([2, 5])));
    const result = backgammon.apply(state, 0, { type: 'roll' }, drawn.rng);
    expect(drawn.take().length).toBe(2);
    if (!result.ok) throw new Error(result.error);
    expect(result.events).toEqual([{ type: 'dice', seat: 0, values: [2, 5] }]);
    // Les dés ne sont pas triés : le premier tiré est le premier dé.
    expect(result.state).toMatchObject({ turn: 0, phase: 'move', dice: [2, 5], turns: 0 });
    expect(result.state.points).toEqual(state.points);
    expect(backgammon.legalMoves(result.state, 0).every((move) => move.type === 'play')).toBe(true);
    expect(backgammon.invariants(result.state)).toEqual([]);
  });

  test('un doublé reste [d, d] dans l\'état et dans l\'événement', () => {
    const result = mustApply(start(), 0, { type: 'roll' }, rngFromDice([3, 3]));
    expect(result.state.dice).toEqual([3, 3]);
    expect(result.events).toEqual([{ type: 'dice', seat: 0, values: [3, 3] }]);
    expect(diceToPlay([3, 3])).toEqual([3, 3, 3, 3]);
  });

  test('un tour joué : un événement par étape, le trait à l\'autre, les dés vidés, un coup compté et le dernier tour gardé', () => {
    const state = start([6, 1]);
    const result = mustApply(state, 0, play([13, 7, 6], [8, 7, 1]));
    expect(result.events).toEqual([
      { type: 'step', seat: 0, from: 13, to: 7, die: 6, hit: false },
      { type: 'step', seat: 0, from: 8, to: 7, die: 1, hit: false },
    ]);
    expect(result.state).toMatchObject({ turn: 1, phase: 'roll', dice: [], turns: 1 });
    expect(result.state.last).toEqual({ seat: 0, dice: [6, 1], steps: [{ from: 13, to: 7, die: 6 }, { from: 8, to: 7, die: 1 }] });
    expect(result.state.opening).toEqual(state.opening);
    expect(result.state.result).toBeNull();
    expect(backgammon.invariants(result.state)).toEqual([]);
  });

  test('un doublé joue quatre étapes, et le dernier tour garde les quatre', () => {
    const state = start([6, 6]);
    const result = mustApply(state, 0, play([24, 18, 6], [24, 18, 6], [13, 7, 6], [13, 7, 6]));
    expect(result.events.length).toBe(4);
    expect(result.state.last).toMatchObject({ seat: 0, dice: [6, 6] });
    expect(result.state.last?.steps.length).toBe(4);
    // Les deux pions du point 24 sont au point 18, les deux du point 13 au point 7.
    expect(result.state.points[17]).toBe(2);
    expect(result.state.points[6]).toBe(2);
    expect(result.state.points[23]).toBe(0);
  });

  test('le côté des Rouges : leurs points se lisent dans leur numérotation, leurs pions vont vers les grands index', () => {
    const state = position({ white: STARTING_LAYOUT, red: STARTING_LAYOUT, turn: 1, dice: [5, 3] });
    // Les Rouges jouent 8→3 et 6→3 (le point 3 des Rouges est le point 22 des Blancs, libre) : ils font leur point 3.
    const result = mustApply(state, 1, play([8, 3, 5], [6, 3, 3]));
    expect(result.events).toEqual([
      { type: 'step', seat: 1, from: 8, to: 3, die: 5, hit: false },
      { type: 'step', seat: 1, from: 6, to: 3, die: 3, hit: false },
    ]);
    expect(result.state.points[21]).toBe(-2);
    expect(result.state.points[16]).toBe(-2);
    expect(result.state.points[18]).toBe(-4);
    expect(result.state).toMatchObject({ turn: 0, phase: 'roll' });
    // Les Rouges peuvent aussi jouer 13→10 et 13→8 (dans leur numérotation) ; un dé qui n'a pas été tiré est refusé.
    expect(backgammon.apply(state, 1, play([13, 10, 3], [13, 8, 5]), noDraw).ok).toBe(true);
    expect(backgammon.apply(state, 1, play([13, 9, 4], [13, 8, 5]), noDraw).ok).toBe(false);
  });

  test('un lancer sans coup possible : `last` garde les dés lancés et aucune étape, et le coup compté ne bouge pas', () => {
    const state = position({ white: { 13: 1 }, whiteOff: 14, red: { 17: 2, 15: 2, 6: 11 }, turns: 5 });
    const { state: next } = mustApply(state, 0, { type: 'roll' }, rngFromDice([5, 3]));
    expect(next.last).toEqual({ seat: 0, dice: [5, 3], steps: [] });
    expect(next.turns).toBe(5);
    expect(backgammon.countedMoves(next)).toBe(5);
    expect(backgammon.invariants(next)).toEqual([]);
  });

  test('un coup refusé pour une raison que la plateforme peut journaliser : un code court en anglais', () => {
    const moving = start([3, 1]);
    const error = (result: ReturnType<typeof backgammon.apply>): string | undefined => (result.ok ? undefined : result.error);
    expect(error(backgammon.apply(moving, 1, play([13, 10, 3], [24, 23, 1]), noDraw))).toBe('not_your_turn');
    expect(error(backgammon.apply(moving, 0, { type: 'roll' }, noDraw))).toBe('wrong_phase');
    expect(error(backgammon.apply(start(), 0, play([13, 10, 3], [24, 23, 1]), noDraw))).toBe('wrong_phase');
    expect(error(backgammon.apply(moving, 0, play([13, 10, 3]), noDraw))).toBe('incomplete');
    expect(error(backgammon.apply(moving, 0, play([13, 10, 3], [24, 23, 1], [8, 7, 1]), noDraw))).toBe('illegal');
    expect(error(backgammon.apply(moving, 0, play([13, 9, 3], [24, 23, 1]), noDraw))).toBe('illegal');
    expect(error(backgammon.apply(moving, 0, null as never, noDraw))).toBe('illegal');
    expect(error(backgammon.apply(moving, 0, { type: 'dance' } as never, noDraw))).toBe('illegal');
    expect(error(backgammon.apply(moving, 0, { type: 'play', steps: 'x' } as never, noDraw))).toBe('illegal');
    expect(error(backgammon.apply(moving, 0, { type: 'play', steps: [null, null] } as never, noDraw))).toBe('illegal');
    const finished = backgammon.forfeit(moving, 0, 'resign').state;
    expect(error(backgammon.apply(finished, 0, { type: 'roll' }, noDraw))).toBe('game_over');
    const smaller = position({ white: { 9: 1 }, whiteOff: 14, red: { 24: 2, 6: 13 }, dice: [6, 2] });
    expect(error(backgammon.apply(smaller, 0, play([9, 7, 2]), noDraw))).toBe('larger_die');
  });
});

describe('backgammon : la barre et la sortie, au-delà des cas nommés', () => {
  test('R9 : un pion qui entre depuis la barre sur un pion adverse seul le frappe ; sur un point libre, non', () => {
    // Les Rouges ont un pion seul sur leur point 4, qui est le point 21 des Blancs : le dé 4 entre sur 25 − 4 = 21. Le dé 2 entre sur le point 23, libre.
    const state = position({ white: { 6: 5, 8: 3, 13: 6 }, whiteBar: 1, red: { 4: 1, 6: 14 }, dice: [4, 2] });
    const hitting = mustApply(state, 0, play(['bar', 21, 4], [13, 11, 2]));
    expect(hitting.events[0]).toEqual({ type: 'step', seat: 0, from: 'bar', to: 21, die: 4, hit: true });
    expect(hitting.state.bar).toEqual([0, 1]);
    expect(hitting.state.points[20]).toBe(1);
    const quiet = mustApply(state, 0, play(['bar', 23, 2], [13, 9, 4]));
    expect(quiet.events[0]).toEqual({ type: 'step', seat: 0, from: 'bar', to: 23, die: 2, hit: false });
    expect(quiet.state.bar).toEqual([0, 0]);
    // Le 6 de la barre (point 19) serait fermé : les Rouges y tiennent 14 pions.
    expect(backgammon.apply(position({ white: { 6: 5, 8: 3, 13: 6 }, whiteBar: 1, red: { 4: 1, 6: 14 }, dice: [6, 2] }), 0, play(['bar', 19, 6], [13, 11, 2]), noDraw).ok).toBe(false);
  });

  test('R10 : un pion frappé pendant la sortie doit entrer et rentrer à la maison avant que la sortie reprenne', () => {
    // Les Blancs sortaient : dix pions sortis, quatre dans la maison, et un pion frappé, sur la barre. Les Rouges ne tiennent aucun point de l'entrée : elle est libre.
    const state = position({ white: { 5: 2, 3: 2 }, whiteBar: 1, whiteOff: 10, red: { 13: 15 }, dice: [4, 2] });
    const found = backgammon.legalMoves(state, 0).filter((move): move is Play => move.type === 'play');
    expect(found.length).toBeGreaterThan(0);
    // Le pion de la barre entre d'abord ; pas une seule sortie pendant ce tour, même avec le dé juste (le 3 et le 5 sont là, mais un pion est dehors).
    for (const move of found) {
      expect(move.steps[0]!.from).toBe('bar');
      expect(move.steps.some((step) => step.to === 'off')).toBe(false);
    }
    expect(backgammon.apply(state, 0, play([3, 'off', 4]), noDraw).ok).toBe(false);
  });

  test('R10 : une fois tous les pions à la maison, un dé plus fort que le point le plus haut sort le pion de ce point', () => {
    // Le plus haut point est le 4 : le 6 et le 5 sortent le pion du 4, puis celui du 2.
    const state = position({ white: { 4: 1, 2: 1 }, whiteOff: 13, red: { 6: 15 }, dice: [6, 5] });
    const { state: ended } = mustApply(state, 0, play([4, 'off', 6], [2, 'off', 5]));
    expect(ended.off[0]).toBe(15);
    // Avec 3-1, le pion du 4 ne sort pas (3 < 4) : on joue 4→1 puis le dé 1 sort le pion rentré ; le pion du 2 reste.
    const smaller = position({ white: { 4: 1, 2: 1 }, whiteOff: 13, red: { 6: 15 }, dice: [3, 1] });
    expect(backgammon.legalMoves(smaller, 0).flatMap((move) => (move.type === 'play' ? move.steps : [])).some((step) => step.from === 4 && step.to === 'off')).toBe(false);
  });
});

describe('backgammon : le gammon et le backgammon, des deux côtés', () => {
  // Le gagnant sort son dernier pion (le point 2, dé 2-2) ; ce que le perdant a sur le plateau change le résultat. Les positions du perdant sont écrites dans sa propre
  // numérotation : son point 19 est le point 6 du gagnant, son point 18 le point 7, son point 24 le point 1.
  const cases: Array<{ name: string; camp: Record<number, number>; bar?: number; off?: number; kind: string }> = [
    { name: 'rien de sorti, rien près de la maison du gagnant : gammon', camp: { 6: 15 }, kind: 'gammon' },
    { name: 'un pion sorti : victoire simple, même avec un pion dans la maison du gagnant', camp: { 24: 1, 6: 13 }, off: 1, kind: 'simple' },
    { name: 'un pion sur la barre, rien de sorti : backgammon', camp: { 6: 14 }, bar: 1, kind: 'backgammon' },
    { name: 'un pion sur le point 6 du gagnant (le dernier point de sa maison) : backgammon', camp: { 19: 1, 6: 14 }, kind: 'backgammon' },
    { name: 'un pion sur le point 1 du gagnant (le premier point de sa maison) : backgammon', camp: { 24: 1, 6: 14 }, kind: 'backgammon' },
    { name: 'un pion sur le point 7 du gagnant (juste hors de sa maison) : gammon', camp: { 18: 1, 6: 14 }, kind: 'gammon' },
  ];
  for (const winner of [0, 1] as const) {
    for (const { name, camp, bar = 0, off = 0, kind } of cases) {
      test(`${winner === 0 ? 'les Blancs' : 'les Rouges'} sortent leur dernier pion, le perdant a ${name}`, () => {
        // Le camp du perdant est écrit dans sa propre numérotation, quel qu'il soit.
        const layout: BackgammonLayout = winner === 0
          ? { white: { 2: 1 }, whiteOff: 14, red: camp, redBar: bar, redOff: off, turn: 0, dice: [2, 2] }
          : { red: { 2: 1 }, redOff: 14, white: camp, whiteBar: bar, whiteOff: off, turn: 1, dice: [2, 2] };
        const state = position(layout);
        const { state: ended, events } = mustApply(state, winner, play([2, 'off', 2]));
        expect(backgammon.result(ended)).toEqual({ ranking: [[winner], [1 - winner]], reason: 'bearoff', detail: { kind } });
        expect(events.at(-1)).toEqual({ type: 'end', winner, kind });
        expect(ended.off[winner]).toBe(15);
        expect(backgammon.invariants(ended)).toEqual([]);
      });
    }
  }
});

describe('backgammon : l\'abandon', () => {
  test('en phase `roll`, en phase `move`, avec un pion sur la barre : toujours défaite simple, jamais un gammon', () => {
    for (const state of [start(), start([4, 2]), position({ white: { 6: 14 }, whiteBar: 1, red: { 6: 15 } })]) {
      for (const seat of [0, 1]) {
        const { state: ended, events } = backgammon.forfeit(state, seat, 'disconnect');
        expect(backgammon.result(ended)).toEqual({ ranking: [[1 - seat], [seat]], reason: 'disconnect', detail: { kind: 'simple' } });
        expect(events).toEqual([{ type: 'forfeit', seat, reason: 'disconnect' }]);
        expect(ended.phase).toBe('over');
        expect(ended.points).toEqual(state.points);
        expect(backgammon.legalMoves(ended, 0)).toEqual([]);
        expect(backgammon.legalMoves(ended, 1)).toEqual([]);
        expect(backgammon.invariants(ended)).toEqual([]);
      }
    }
  });

  test('une partie déjà finie, ou un siège qui n\'existe pas : rien ne change, aucun événement', () => {
    const ended = backgammon.forfeit(start(), 0, 'resign').state;
    const again = backgammon.forfeit(ended, 1, 'timeout');
    expect(again.state).toBe(ended);
    expect(again.events).toEqual([]);
    const unknown = backgammon.forfeit(start(), 2, 'resign');
    expect(unknown.state).toEqual(start());
    expect(unknown.events).toEqual([]);
  });
});

describe('backgammon : les aides de l\'interface', () => {
  test('maxPlayableSteps : le nombre de dés qu\'il faut jouer (R7), 0 hors de la phase `move`', () => {
    expect(maxPlayableSteps(start([3, 1]))).toBe(2);
    expect(maxPlayableSteps(start([6, 6]))).toBe(4);
    expect(maxPlayableSteps(position({ white: { 13: 1 }, whiteOff: 14, red: { 22: 2, 6: 13 }, dice: [5, 5] }))).toBe(1);
    expect(maxPlayableSteps(position({ white: { 9: 1 }, whiteOff: 14, red: { 24: 2, 6: 13 }, dice: [6, 2] }))).toBe(1);
    expect(maxPlayableSteps(position({ white: { 13: 1 }, whiteOff: 14, red: { 13: 15 }, dice: [5, 5] }))).toBe(3);
    expect(maxPlayableSteps(start())).toBe(0);
    expect(maxPlayableSteps(backgammon.forfeit(start([3, 1]), 0, 'resign').state)).toBe(0);
  });

  test('diceToPlay : deux dés du plus grand au plus petit, quatre fois le même pour un doublé, rien sans dés', () => {
    expect(diceToPlay([2, 5])).toEqual([5, 2]);
    expect(diceToPlay([5, 2])).toEqual([5, 2]);
    expect(diceToPlay([4, 4])).toEqual([4, 4, 4, 4]);
    expect(diceToPlay([])).toEqual([]);
    expect(diceToPlay([1, 2, 3])).toEqual([]);
  });

  test('nextSteps : rien hors de la phase `move`, rien après un début de tour illégal ou un tour complet, et le plus grand dé quand un seul se joue', () => {
    expect(nextSteps(start(), [])).toEqual([]);
    expect(nextSteps(backgammon.forfeit(start([3, 1]), 0, 'resign').state, [])).toEqual([]);
    const state = start([3, 1]);
    // Un dé qui n'a pas été tiré, le même dé deux fois, un tour déjà complet.
    expect(nextSteps(state, [{ from: 13, to: 9, die: 4 }])).toEqual([]);
    expect(nextSteps(state, [{ from: 13, to: 10, die: 3 }, { from: 13, to: 10, die: 3 }])).toEqual([]);
    expect(nextSteps(state, [{ from: 13, to: 10, die: 3 }, { from: 24, to: 23, die: 1 }])).toEqual([]);
    const smaller = position({ white: { 9: 1 }, whiteOff: 14, red: { 24: 2, 6: 13 }, dice: [6, 2] });
    expect(nextSteps(smaller, [])).toEqual([{ from: 9, to: 3, die: 6 }]);
  });

  test('nextSteps : à chaque étape, les arrivées d\'un pion qui laissent finir le tour ; un doublé les rend à chaque pas', () => {
    const state = position({ white: { 13: 1 }, whiteOff: 14, red: { 6: 15 }, dice: [5, 5] });
    expect(nextSteps(state, [])).toEqual([{ from: 13, to: 8, die: 5 }]);
    expect(nextSteps(state, [{ from: 13, to: 8, die: 5 }])).toEqual([{ from: 8, to: 3, die: 5 }]);
    expect(nextSteps(state, [{ from: 13, to: 8, die: 5 }, { from: 8, to: 3, die: 5 }])).toEqual([{ from: 3, to: 'off', die: 5 }]);
    expect(nextSteps(state, [{ from: 13, to: 8, die: 5 }, { from: 8, to: 3, die: 5 }, { from: 3, to: 'off', die: 5 }])).toEqual([]);
  });

  test('previewSteps : la position après des étapes légales, null si l\'une ne l\'est pas, sans toucher à l\'état', () => {
    const state = start([6, 1]);
    const preview = previewSteps(state, [{ from: 13, to: 7, die: 6 }, { from: 8, to: 7, die: 1 }])!;
    expect(preview.points[6]).toBe(2);
    expect(preview.points[12]).toBe(4);
    expect(preview.points[7]).toBe(2);
    expect(previewSteps(state, [])).toEqual({ points: state.points, bar: state.bar, off: state.off });
    expect(previewSteps(state, [{ from: 13, to: 7, die: 5 }])).toBeNull();
    expect(previewSteps(state, [{ from: 13, to: 7, die: 6 }, { from: 13, to: 7, die: 6 }])).toBeNull();
    expect(previewSteps(state, [{ from: 24, to: 18, die: 6 }, { from: 18, to: 17, die: 1 }])).toBeNull();
    expect(previewSteps(start(), [{ from: 13, to: 7, die: 6 }])).toBeNull();
    expect(state.points[6]).toBe(0);
    // Une partie finie garde les dés de son dernier tour, mais ils sont déjà joués : rien n'est à prévisualiser.
    const over = backgammon.forfeit(state, 1, 'resign').state;
    expect(over.dice).toEqual([6, 1]);
    expect(previewSteps(over, [{ from: 13, to: 7, die: 6 }])).toBeNull();
    expect(previewSteps(over, [])).toEqual({ points: state.points, bar: state.bar, off: state.off });
  });

  test('previewSteps rend la barre et les sorties : un pion frappé part sur la barre, un pion sorti compte', () => {
    const hit = previewSteps(position({ white: { 13: 15 }, red: { 17: 1, 6: 14 }, dice: [5, 1] }), [{ from: 13, to: 8, die: 5 }])!;
    expect(hit.bar).toEqual([0, 1]);
    const out = previewSteps(position({ white: { 3: 1 }, whiteOff: 14, red: { 6: 15 }, dice: [3, 1] }), [{ from: 3, to: 'off', die: 3 }])!;
    expect(out.off).toEqual([15, 0]);
  });
});

describe('backgammon : invariants', () => {
  const ok = start([3, 1]);
  const problems = (patch: Record<string, unknown>): string[] => backgammon.invariants({ ...ok, ...patch } as BackgammonState);

  test('un état légal n\'a aucune violation : le départ, un tour lancé, un tour joué, une partie finie', () => {
    expect(backgammon.invariants(ok)).toEqual([]);
    expect(backgammon.invariants(start())).toEqual([]);
    expect(backgammon.invariants(mustApply(ok, 0, play([8, 5, 3], [6, 5, 1])).state)).toEqual([]);
    expect(backgammon.invariants(backgammon.forfeit(ok, 1, 'timeout').state)).toEqual([]);
  });

  test('chaque violation donne une phrase qui dit laquelle', () => {
    const wrong = (patch: Record<string, unknown>, pattern: RegExp): void => {
      const found = problems(patch);
      expect(found.length, JSON.stringify(patch)).toBeGreaterThan(0);
      expect(found.join(' ; '), JSON.stringify(patch)).toMatch(pattern);
    };
    wrong({ points: ok.points.slice(0, 23) }, /points/);
    wrong({ points: ok.points.map((count, index) => (index === 3 ? 1.5 : count)) }, /points/);
    wrong({ points: ok.points.map((count, index) => (index === 3 ? -0 : count)) }, /points/);
    wrong({ points: ok.points.map((count, index) => (index === 5 ? 6 : count)) }, /siège 0 a 16 pions/);
    wrong({ points: ok.points.map((count, index) => (index === 0 ? -1 : count)) }, /siège 1 a 14 pions/);
    wrong({ bar: [0, -1] }, /bar/);
    wrong({ bar: [0] }, /bar/);
    wrong({ off: [16, 0] }, /off/);
    wrong({ turn: 2 }, /turn/);
    wrong({ phase: 'waiting' }, /phase/);
    wrong({ phase: 'roll' }, /phase roll/);
    wrong({ dice: [] }, /phase move/);
    wrong({ dice: [3, 7] }, /dice/);
    wrong({ dice: [3] }, /dice/);
    wrong({ phase: 'over' }, /résultat/);
    wrong({ result: { ranking: [[0], [1]], reason: 'bearoff' } }, /résultat/);
    wrong({ phase: 'over', result: { ranking: [[0]], reason: 'bearoff' } }, /classement/);
    wrong({ opening: [] }, /opening/);
    wrong({ opening: [[3, 3]] }, /égalité/);
    wrong({ opening: [[3, 9]] }, /opening/);
    wrong({ turns: -1 }, /turns/);
    wrong({ turns: 1.5 }, /turns/);
    wrong({ last: {} }, /last/);
    wrong({ last: { seat: 2, dice: [], steps: [] } }, /last/);
    wrong({ result: 'fini' }, /result/);
  });

  test('quinze pions sortis sans partie finie, et une phase `move` sans aucun coup possible, sont des violations', () => {
    const allOff = backgammonStateFrom({ white: {}, whiteOff: 15, red: { 6: 15 }, dice: [3, 1] });
    expect(backgammon.invariants(allOff).join(' ; ')).toMatch(/15 pions/);
    const stuck = backgammonStateFrom({ white: { 13: 1 }, whiteOff: 14, red: { 17: 2, 15: 2, 6: 11 }, dice: [5, 3] });
    expect(backgammon.invariants(stuck).join(' ; ')).toMatch(/aucun coup possible/);
    // Le même plateau en phase `roll` est légal : le lancer passera le tour.
    expect(backgammon.invariants(backgammonStateFrom({ white: { 13: 1 }, whiteOff: 14, red: { 17: 2, 15: 2, 6: 11 } }))).toEqual([]);
  });

  test('un état qui n\'est pas un objet : une phrase, sans lever', () => {
    for (const raw of [null, undefined, 3, 'x', [], true]) {
      expect(backgammon.invariants(raw as never).length).toBe(1);
    }
  });

  test('un état sans aucun de ses champs : toutes les formes fausses sont dites, sans lever', () => {
    const found = backgammon.invariants({} as never);
    expect(found.length).toBeGreaterThanOrEqual(7);
  });
});

describe('backgammon : fabriquer une position (backgammonStateFrom)', () => {
  test('une position impossible fait échouer tout de suite : mauvais compte, point partagé, point ou dés qui n\'existent pas', () => {
    expect(() => backgammonStateFrom({ white: { 13: 14 }, red: { 6: 15 } })).toThrow(/14 pions au lieu de 15/);
    expect(() => backgammonStateFrom({ white: { 13: 15 }, red: { 6: 15 }, redBar: 1 })).toThrow(/16 pions/);
    // Le point 12 des Rouges est le point 13 des Blancs.
    expect(() => backgammonStateFrom({ white: { 13: 15 }, red: { 12: 15 } })).toThrow(/déjà pris/);
    expect(() => backgammonStateFrom({ white: { 0: 15 }, red: { 6: 15 } })).toThrow(/n'existe pas/);
    expect(() => backgammonStateFrom({ white: { 25: 15 }, red: { 6: 15 } })).toThrow(/n'existe pas/);
    expect(() => backgammonStateFrom({ white: { 13: 15 }, red: { 6: 15 }, dice: [3] })).toThrow(/dés/);
    expect(() => backgammonStateFrom({ white: { 13: 15 }, red: { 6: 15 }, dice: [3, 7] })).toThrow(/dés/);
    expect(() => backgammonStateFrom({ white: { 13: -1, 6: 16 }, red: { 6: 15 } })).toThrow(/pions sur le point/);
  });

  test('avec des dés la phase est `move`, sans dés elle est `roll` ; le trait et les coups comptés se règlent', () => {
    expect(backgammonStateFrom({ white: STARTING_LAYOUT, red: STARTING_LAYOUT })).toMatchObject({ phase: 'roll', dice: [], turn: 0, turns: 0, last: null, result: null });
    expect(backgammonStateFrom({ white: STARTING_LAYOUT, red: STARTING_LAYOUT, dice: [4, 4], turn: 1, turns: 9 })).toMatchObject({ phase: 'move', dice: [4, 4], turn: 1, turns: 9 });
  });

  test('la position de départ fabriquée est celle que create pose', () => {
    const made = backgammonStateFrom({ white: STARTING_LAYOUT, red: STARTING_LAYOUT });
    const created = backgammon.create({ seats: 2, first: 0 }, scriptedRng(rngFromDice([3, 1]))).state;
    expect(made.points).toEqual(created.points);
    expect(made.bar).toEqual(created.bar);
    expect(made.off).toEqual(created.off);
  });
});
