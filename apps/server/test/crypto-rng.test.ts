import { pickIndex, rollDie } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { cryptoRng } from '../src/games/crypto-rng';

describe('cryptoRng : le hasard des vraies parties, tiré côté serveur', () => {
  test('des nombres dans [0, 1), qui ne sont pas tous les mêmes', () => {
    const values = Array.from({ length: 2000 }, () => cryptoRng());
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(new Set(values).size).toBeGreaterThan(1990);
  });

  test('un dé tiré avec rollDie sort chaque face de 1 à 6, à peu près autant de fois (6 000 tirages : entre 14 % et 19 % chacune)', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6000; i++) counts[rollDie(cryptoRng) - 1]!++;
    for (const count of counts) {
      expect(count / 6000).toBeGreaterThan(0.14);
      expect(count / 6000).toBeLessThan(0.19);
    }
  });

  test('le premier joueur tiré avec pickIndex : les deux sièges sortent', () => {
    const firsts = new Set(Array.from({ length: 200 }, () => pickIndex(cryptoRng, 2)));
    expect([...firsts].sort()).toEqual([0, 1]);
  });
});
