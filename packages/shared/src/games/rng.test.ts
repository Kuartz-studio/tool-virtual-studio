import { describe, expect, test } from 'vitest';
import { pickIndex, recordingRng, rngFromDice, rollDie, scriptedRng, seededRng } from './rng';

describe('seededRng', () => {
  test('la même graine donne la même suite ; une autre graine, une autre', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const c = seededRng(43);
    const suiteA = Array.from({ length: 20 }, () => a());
    expect(Array.from({ length: 20 }, () => b())).toEqual(suiteA);
    expect(Array.from({ length: 20 }, () => c())).not.toEqual(suiteA);
  });

  test('des nombres dans [0, 1), qui ne se répètent pas à la suite', () => {
    const rng = seededRng(7);
    let previous = -1;
    for (let i = 0; i < 2000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(value).not.toBe(previous);
      previous = value;
    }
  });

  test('assez uniforme : chaque face d\'un dé sort entre 14 % et 19 % du temps sur 6 000 tirages', () => {
    const rng = seededRng(2026);
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6000; i++) counts[rollDie(rng) - 1]!++;
    for (const count of counts) {
      expect(count / 6000).toBeGreaterThan(0.14);
      expect(count / 6000).toBeLessThan(0.19);
    }
  });
});

describe('scriptedRng', () => {
  test('rend les valeurs données une à une', () => {
    const rng = scriptedRng([0.1, 0.5, 0.9]);
    expect([rng(), rng(), rng()]).toEqual([0.1, 0.5, 0.9]);
  });

  test('sans `then`, une valeur de trop lève : un test qui tire plus que prévu échoue', () => {
    const rng = scriptedRng([0.5]);
    rng();
    expect(() => rng()).toThrow(/plus de valeurs/);
  });

  test('avec `then`, il prend le relais après la dernière valeur', () => {
    const rng = scriptedRng([0.25], () => 0.75);
    expect([rng(), rng(), rng()]).toEqual([0.25, 0.75, 0.75]);
  });
});

describe('rngFromDice', () => {
  test('rngFromDice([6, 1]) vaut [(6 − 0,5) / 6, (1 − 0,5) / 6]', () => {
    const [six, one] = rngFromDice([6, 1]);
    expect(six).toBeCloseTo(0.916666, 5);
    expect(one).toBeCloseTo(0.083333, 5);
  });

  test('chaque face de 1 à 6 refait le même dé avec rollDie', () => {
    for (const die of [1, 2, 3, 4, 5, 6]) {
      expect(rollDie(scriptedRng(rngFromDice([die])))).toBe(die);
    }
  });

  test('un dé à d faces : rngFromDice(dice, sides) pour rollDie(rng, sides)', () => {
    for (const die of [1, 7, 12]) expect(rollDie(scriptedRng(rngFromDice([die], 12)), 12)).toBe(die);
  });
});

describe('rollDie', () => {
  test('0 donne 1, et tout près de 1 donne 6', () => {
    expect(rollDie(() => 0)).toBe(1);
    expect(rollDie(() => 0.9999999)).toBe(6);
  });

  test('un générateur qui sort de [0, 1) reste ramené à [1, sides]', () => {
    expect(rollDie(() => 1)).toBe(6);
    expect(rollDie(() => -0.4)).toBe(1);
  });
});

describe('pickIndex', () => {
  test('un entier de 0 à n − 1', () => {
    expect(pickIndex(() => 0, 4)).toBe(0);
    expect(pickIndex(() => 0.5, 4)).toBe(2);
    expect(pickIndex(() => 0.9999999, 4)).toBe(3);
    expect(pickIndex(() => 1, 4)).toBe(3);
  });

  test('n doit être un entier d\'au moins 1', () => {
    expect(() => pickIndex(() => 0.5, 0)).toThrow(RangeError);
    expect(() => pickIndex(() => 0.5, 2.5)).toThrow(RangeError);
    expect(pickIndex(() => 0.7, 1)).toBe(0);
  });
});

describe('recordingRng', () => {
  test('rend les mêmes valeurs que le générateur enveloppé, et en garde la liste', () => {
    const recording = recordingRng(scriptedRng([0.1, 0.2, 0.3]));
    expect([recording.rng(), recording.rng()]).toEqual([0.1, 0.2]);
    expect(recording.take()).toEqual([0.1, 0.2]);
  });

  test('take() repart de zéro : il ne rend que ce qui a été tiré depuis le dernier appel', () => {
    const recording = recordingRng(scriptedRng([0.1, 0.2, 0.3]));
    recording.rng();
    expect(recording.take()).toEqual([0.1]);
    expect(recording.take()).toEqual([]);
    recording.rng();
    recording.rng();
    expect(recording.take()).toEqual([0.2, 0.3]);
  });
});
