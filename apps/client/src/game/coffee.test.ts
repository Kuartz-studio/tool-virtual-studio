import { COFFEE_REACH_TILES, TILE_SIZE } from '@bureau/shared';
import { expect, test, vi } from 'vitest';
import { fr } from '../i18n/fr';
import { coffeeTarget, MACHINE_EXCITED_MS, MACHINE_EXCITED_SCALE, machineTimeScale, secondsLeft } from './coffee';
import { Interactions } from './interactions';

const machine = { x: 37 * TILE_SIZE + 16, y: 5 * TILE_SIZE + 16 };

test('la machine est une cible de la touche E : « [E] Prendre un café », à COFFEE_REACH_TILES cases, actionnée par la touche', () => {
  const onUse = vi.fn();
  const target = coffeeTarget(machine, onUse);
  expect(target.prompt()).toBe(`[E] ${fr.coffee.take}`);
  expect(target.reachTiles).toBe(COFFEE_REACH_TILES);
  // L'étiquette se pose au-dessus de la machine, pas sur les pieds de celui qui s'y sert.
  expect(target.labelAt!.x).toBe(machine.x);
  expect(target.labelAt!.y).toBeLessThan(machine.y - 2 * TILE_SIZE);

  const interactions = new Interactions({ feet: () => machine });
  interactions.register(target);
  expect(interactions.update()).toBe(target);
  expect(interactions.use()).toBe(true);
  expect(onUse).toHaveBeenCalledTimes(1);
});

test('au-delà de COFFEE_REACH_TILES cases, la machine ne répond plus (la même règle que le serveur : withinCoffeeReach)', () => {
  const target = coffeeTarget(machine, () => undefined);
  const interactions = new Interactions();
  interactions.register(target);
  expect(interactions.update({ x: machine.x, y: machine.y + COFFEE_REACH_TILES * TILE_SIZE })).toBe(target);
  expect(interactions.update({ x: machine.x, y: machine.y + COFFEE_REACH_TILES * TILE_SIZE + 1 })).toBeNull();
});

test('deux machines sur la carte : chacune sa cible, celle de l\'autre n\'est pas la sienne', () => {
  const other = { x: machine.x + 20 * TILE_SIZE, y: machine.y };
  const a = coffeeTarget(machine, () => undefined);
  const b = coffeeTarget(other, () => undefined);
  expect(a.id).not.toBe(b.id);
});

test('secondsLeft : ce qu\'il reste de café en secondes entières, arrondi vers le haut ; 0 sans café ou une fois fini', () => {
  expect(secondsLeft(undefined, 1000)).toBe(0);
  expect(secondsLeft(31_000, 1_000)).toBe(30);
  expect(secondsLeft(31_000, 1_001)).toBe(30);
  expect(secondsLeft(31_000, 2_000)).toBe(29);
  expect(secondsLeft(31_000, 30_999)).toBe(1);
  expect(secondsLeft(31_000, 31_000)).toBe(0);
  expect(secondsLeft(31_000, 40_000)).toBe(0);
});

test('la machine s\'agite MACHINE_EXCITED_MS quand quelqu\'un se sert : son animation tourne plus vite, puis reprend son rythme', () => {
  expect(MACHINE_EXCITED_MS).toBe(1000);
  expect(MACHINE_EXCITED_SCALE).toBeGreaterThan(1);
  expect(machineTimeScale(500, 0)).toBe(1);
  expect(machineTimeScale(500, 1500)).toBe(MACHINE_EXCITED_SCALE);
  expect(machineTimeScale(1499, 1500)).toBe(MACHINE_EXCITED_SCALE);
  expect(machineTimeScale(1500, 1500)).toBe(1);
});
