import type { LudoEvent } from '@bureau/shared/games/ludo';
import { describe, expect, test } from 'vitest';
import { CAPTURE_MS, DICE_ROLL_MS, STEP_MS, planFrames } from './frames';

// Le plan de l'animation d'un coup : les images, dans l'ordre, que le plateau montre entre l'ancien état et le nouveau. Pur : aucune horloge ici, seulement ce qu'on montre et combien de
// temps.

const STABLE = [-1, -1, -1, -1];
const move = (seat: number, horse: number, from: number, to: number): LudoEvent => ({ type: 'move', seat, horse, from, to });

describe('les durées du § 16.6', () => {
  test('80 ms par case, 300 ms pour qu\'un cheval pris retourne à l\'écurie, 600 ms pour que le dé roule', () => {
    expect(STEP_MS).toBe(80);
    expect(CAPTURE_MS).toBe(300);
    expect(DICE_ROLL_MS).toBe(600);
  });
});

describe('planFrames : un cheval saute de case en case', () => {
  test('une sortie : une image, le cheval sur sa case de départ', () => {
    const frames = planFrames([[...STABLE], [...STABLE]], [move(0, 2, -1, 0)]);
    expect(frames).toEqual([{ horses: [[-1, -1, 0, -1], STABLE], ms: STEP_MS, slide: null }]);
  });

  test('un déplacement de trois cases : trois images, une par case, à 80 ms chacune', () => {
    const frames = planFrames([[10, -1, -1, -1], [...STABLE]], [move(0, 0, 10, 13)]);
    expect(frames.map((frame) => frame.horses[0]![0])).toEqual([11, 12, 13]);
    expect(frames.map((frame) => frame.ms)).toEqual([STEP_MS, STEP_MS, STEP_MS]);
    expect(frames.every((frame) => frame.slide === null)).toBe(true);
    // Les autres chevaux ne bougent pas.
    for (const frame of frames) expect(frame.horses[1]).toEqual(STABLE);
  });

  test('l\'entrée dans l\'allée et l\'arrivée se comptent comme les autres cases', () => {
    const frames = planFrames([[48, -1, -1, -1], [...STABLE]], [move(0, 0, 48, 53)]);
    expect(frames.map((frame) => frame.horses[0]![0])).toEqual([49, 50, 51, 52, 53]);
    const arrival = planFrames([[54, 56, -1, -1], [...STABLE]], [move(0, 0, 54, 56)]);
    expect(arrival.map((frame) => frame.horses[0]![0])).toEqual([55, 56]);
  });

  test('chaque image est un nouvel état : l\'état de départ n\'est jamais modifié', () => {
    const before = [[10, -1, -1, -1], [...STABLE]];
    const snapshot = JSON.stringify(before);
    const frames = planFrames(before, [move(0, 0, 10, 12)]);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(frames[0]!.horses).not.toBe(frames[1]!.horses);
  });
});

describe('planFrames : une prise', () => {
  test('le cheval pris retourne à l\'écurie après l\'arrivée de l\'autre, en 300 ms, en glissant', () => {
    const before = [[10, -1, -1, -1], [1, -1, -1, -1], [...STABLE], [...STABLE]];
    const events: LudoEvent[] = [move(0, 0, 10, 14), { type: 'capture', seat: 0, victim: { seat: 1, horse: 0 } }, { type: 'turn', seat: 1 }];
    const frames = planFrames(before, events);
    expect(frames.map((frame) => frame.horses[0]![0])).toEqual([11, 12, 13, 14, 14]);
    expect(frames.map((frame) => frame.ms)).toEqual([STEP_MS, STEP_MS, STEP_MS, STEP_MS, CAPTURE_MS]);
    // Jusqu'à l'arrivée, la victime est toujours sur sa case ; puis elle retourne à l'écurie, seule à glisser.
    for (const frame of frames.slice(0, 4)) expect(frame.horses[1]![0]).toBe(1);
    expect(frames[4]!.horses[1]![0]).toBe(-1);
    expect(frames.slice(0, 4).every((frame) => frame.slide === null)).toBe(true);
    expect(frames[4]!.slide).toEqual({ seat: 1, horse: 0 });
  });

  test('une sortie qui prend : le cheval posé sur le départ, puis la victime qui rentre', () => {
    const before = [[...STABLE], [39, -1, -1, -1], [...STABLE]];
    const frames = planFrames(before, [move(0, 0, -1, 0), { type: 'capture', seat: 0, victim: { seat: 1, horse: 0 } }]);
    expect(frames.map((frame) => [frame.horses[0]![0], frame.horses[1]![0]])).toEqual([[0, 39], [0, -1]]);
    expect(frames.map((frame) => frame.ms)).toEqual([STEP_MS, CAPTURE_MS]);
  });
});

describe('planFrames : ce qui ne fait pas bouger de pion', () => {
  test('un lancer, un tour passé, le trait, la fin, une sortie de siège : aucune image', () => {
    const before = [[10, -1, -1, -1], [5, -1, -1, -1]];
    const events: LudoEvent[] = [
      { type: 'dice', seat: 0, value: 4 },
      { type: 'pass', seat: 0, reason: 'no-move' },
      { type: 'turn', seat: 1 },
      { type: 'forfeit', seat: 1, reason: 'resign' },
      { type: 'end', ranking: [[0], [1]] },
    ];
    expect(planFrames(before, events)).toEqual([]);
    expect(planFrames(before, [])).toEqual([]);
  });

  test('deux coups à la suite (jamais dans une partie, mais le plan les enchaîne) : l\'un après l\'autre', () => {
    const before = [[10, 20, -1, -1], [...STABLE]];
    const frames = planFrames(before, [move(0, 0, 10, 11), move(0, 1, 20, 22)]);
    expect(frames.map((frame) => [frame.horses[0]![0], frame.horses[0]![1]])).toEqual([[11, 20], [11, 21], [11, 22]]);
  });
});
