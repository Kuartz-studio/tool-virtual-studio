import type { Rng } from './types';

export type { Rng };

// mulberry32 : la même graine donne la même suite. Pour les tests et les parties au hasard ; jamais en production.
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rend les valeurs données une à une, puis `then` ; sans `then`, lève une erreur (« plus de valeurs ») : un test qui tire plus que prévu échoue.
export function scriptedRng(values: readonly number[], then?: Rng): Rng {
  let next = 0;
  return () => {
    if (next < values.length) return values[next++]!;
    if (then) return then();
    throw new Error(`scriptedRng : plus de valeurs (${values.length} données, la ${values.length + 1}e est demandée)`);
  };
}

// Les valeurs qui font sortir ces dés avec rollDie : (d − 0,5) / sides. rngFromDice([6, 1]) → [0.9166…, 0.0833…].
export function rngFromDice(dice: readonly number[], sides = 6): number[] {
  return dice.map((die) => (die - 0.5) / sides);
}

// 1 + floor(rng() × sides), ramené à [1, sides]. Le seul tirage de dé des jeux.
export function rollDie(rng: Rng, sides = 6): number {
  return Math.min(sides, Math.max(1, 1 + Math.floor(rng() * sides)));
}

// Un entier de 0 à n − 1 (choix au hasard : premier joueur, coup d'une partie au hasard).
export function pickIndex(rng: Rng, n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`pickIndex : n doit être un entier d'au moins 1 (reçu ${n})`);
  return Math.min(n - 1, Math.max(0, Math.floor(rng() * n)));
}

// Enveloppe un générateur et retient ce qu'il a rendu : le journal d'une partie garde ces valeurs pour la rejouer. `take()` rend ce qui a été tiré depuis
// le dernier appel, et repart de zéro.
export function recordingRng(rng: Rng): { rng: Rng; take(): number[] } {
  let drawn: number[] = [];
  return {
    rng: () => {
      const value = rng();
      drawn.push(value);
      return value;
    },
    take: () => {
      const out = drawn;
      drawn = [];
      return out;
    },
  };
}
