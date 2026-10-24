import { describe, expect, test, vi } from 'vitest';
import { clerkName, clerkTarget, stillWithClerk } from './clerks';

const MARGOT = { x: 39 * 32 + 16, y: 17 * 32 + 16, name: 'margot' };
const INES = { x: 40 * 32 + 16, y: 17 * 32 + 16, name: 'ines' };

describe('les administratrices', () => {
  test('leur prénom, et la cible de la touche E : « [E] Parler à Inès », qui ouvre la conversation', () => {
    expect(clerkName('ines')).toBe('Inès');
    const talk = vi.fn();
    const target = clerkTarget(INES, talk);
    expect(target.prompt()).toBe('[E] Parler à Inès');
    expect(target.reachTiles).toBe(2);
    target.use();
    expect(talk).toHaveBeenCalledWith('ines');
  });

  test('la conversation tient jusqu\'à 4 cases du comptoir ; au-delà, ou une administratrice inconnue, non', () => {
    expect(stillWithClerk([MARGOT, INES], 'ines', { x: INES.x, y: INES.y + 4 * 32 })).toBe(true);
    expect(stillWithClerk([MARGOT, INES], 'ines', { x: INES.x, y: INES.y + 5 * 32 })).toBe(false);
    expect(stillWithClerk([MARGOT, INES], 'lucie', { x: INES.x, y: INES.y })).toBe(false);
  });
});
