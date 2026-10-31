import { describe, expect, test } from 'vitest';
import { BIRD_PHRASE_S } from '../../src/audio/nature';
import { BIRD_PHRASES, birdsong } from './birdsong';
import { nightInsects } from './night-insects';
import { POND_SECONDS, pond } from './pond';
import { crossfadeLoop, peakOf, SAMPLE_RATE, withLoopMargins } from './synth';

// L'écart typique d'un échantillon au suivant (moyenne quadratique) : un raccord sans saut n'est pas plus grand.
function stepRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 1; i < samples.length; i++) sum += (samples[i]! - samples[i - 1]!) ** 2;
  return Math.sqrt(sum / (samples.length - 1));
}

describe('les boucles', () => {
  test('les insectes de la nuit : la fin de la boucle enchaîne sur son début comme un échantillon sur le suivant ; la même graine, le même son', () => {
    const loop = nightInsects(1931, 4);
    expect(loop).toHaveLength(4 * SAMPLE_RATE);
    expect(Math.abs(loop[0]! - loop.at(-1)!)).toBeLessThan(2 * stepRms(loop));
    expect(peakOf(loop)).toBeLessThan(1);
    expect(nightInsects(1931, 4)).toEqual(loop);
  });

  test('le bassin : une boucle sans raccord, toujours la même ; un clapotis qui retombe entre deux vagues, pas un filet d\'eau qui coule sans fin', () => {
    const loop = pond();
    expect(loop).toHaveLength(Math.round(POND_SECONDS * SAMPLE_RATE));
    expect(Math.abs(loop[0]! - loop.at(-1)!)).toBeLessThan(2 * stepRms(loop));
    expect(peakOf(loop)).toBeLessThan(1);
    expect(pond()).toEqual(loop);
    // Le niveau par dixième de seconde : les vagues ressortent nettement (les 10 % les plus forts, au moins 2,5 fois le niveau du milieu). Un filet d'eau
    // continu, comme le ruissellement du pack, reste près de son niveau (1,7 fois).
    const tenth = SAMPLE_RATE / 10;
    const levels = Array.from({ length: Math.floor(loop.length / tenth) }, (_, k) => Math.sqrt(loop.slice(k * tenth, (k + 1) * tenth).reduce((sum, v) => sum + v * v, 0) / tenth)).sort((a, b) => a - b);
    const at = (share: number) => levels[Math.floor(share * (levels.length - 1))]!;
    expect(at(0.9)).toBeGreaterThan(2.5 * at(0.5));
  });

  test('une boucle tirée d\'un son plus long : son début devient ce qui suivait la période, le reste est le son lui-même', () => {
    const rising = Float32Array.from({ length: 12 }, (_, i) => i);
    const loop = crossfadeLoop(rising, 8);
    expect(loop).toHaveLength(8);
    expect(loop[0]).toBeCloseTo(rising[8]!, 0);
    expect([...loop.slice(4)]).toEqual([4, 5, 6, 7]);
  });

  test('rangée avec ses marges : la fin de la période devant, son début derrière', () => {
    const period = Float32Array.from({ length: 6 }, (_, i) => i);
    expect([...withLoopMargins(period, 2)]).toEqual([4, 5, 0, 1, 2, 3, 4, 5, 0, 1]);
  });
});

test('le chant des oiseaux : une phrase par case, qui commence après un rien de silence et s\'éteint avant la fin de sa case', () => {
  const bank = birdsong();
  const slot = BIRD_PHRASE_S * SAMPLE_RATE;
  expect(bank).toHaveLength(BIRD_PHRASES * slot);
  for (let k = 0; k < BIRD_PHRASES; k++) {
    const phrase = bank.subarray(k * slot, (k + 1) * slot);
    expect(peakOf(phrase.subarray(0, Math.round(0.05 * SAMPLE_RATE))), `début de la case ${k}`).toBeLessThan(1e-3);
    expect(peakOf(phrase.subarray(slot - Math.round(0.02 * SAMPLE_RATE))), `fin de la case ${k}`).toBeLessThan(1e-3);
    expect(peakOf(phrase), `case ${k}`).toBeGreaterThan(0.1);
  }
});
