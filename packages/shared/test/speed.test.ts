import { describe, expect, test } from 'vitest';
import { COFFEE_SPEED_FACTOR, MAX_SPEED_PX_PER_S, NORMAL_MAX_SPEED_PX_PER_S, SPRINT_FACTOR, WALK_SPEED_PX_PER_S, speedOf } from '../src';

// Avant la mise à jour : la marche faisait 160 px/s, Maj la triplait (480). Maintenant la marche double, Maj garde sa vitesse d'hier, et le
// café vaut quatre fois la marche d'hier.
const OLD_WALK = 160;

describe("la vitesse de l'avatar", () => {
  test('speedOf rend 320 à la marche, 480 en courant, 640 sous café et 960 en courant sous café', () => {
    expect(speedOf(false, false)).toBe(320);
    expect(speedOf(true, false)).toBe(480);
    expect(speedOf(false, true)).toBe(640);
    expect(speedOf(true, true)).toBe(960);
  });

  test("la marche est deux fois celle d'hier, la course garde sa vitesse d'hier, le café vaut quatre fois la marche d'hier", () => {
    expect(WALK_SPEED_PX_PER_S).toBe(2 * OLD_WALK);
    expect(speedOf(true, false)).toBe(3 * OLD_WALK);
    expect(speedOf(false, true)).toBe(4 * OLD_WALK);
  });

  test("le café dépasse la course sans café (sinon Maj le rendrait inutile)", () => {
    expect(speedOf(false, true)).toBeGreaterThan(speedOf(true, false));
  });

  test("la limite du serveur sans café est celle d'hier (480 px/s), avec le café elle double", () => {
    expect(NORMAL_MAX_SPEED_PX_PER_S).toBe(480);
    expect(MAX_SPEED_PX_PER_S).toBe(960);
    expect(NORMAL_MAX_SPEED_PX_PER_S).toBe(WALK_SPEED_PX_PER_S * SPRINT_FACTOR);
    expect(MAX_SPEED_PX_PER_S).toBe(NORMAL_MAX_SPEED_PX_PER_S * COFFEE_SPEED_FACTOR);
  });

  test("aucune vitesse que le client s'accorde ne dépasse la limite que le serveur lui accorde", () => {
    expect(speedOf(false, false)).toBeLessThanOrEqual(NORMAL_MAX_SPEED_PX_PER_S);
    expect(speedOf(true, false)).toBeLessThanOrEqual(NORMAL_MAX_SPEED_PX_PER_S);
    expect(speedOf(false, true)).toBeLessThanOrEqual(MAX_SPEED_PX_PER_S);
    expect(speedOf(true, true)).toBeLessThanOrEqual(MAX_SPEED_PX_PER_S);
  });
});
