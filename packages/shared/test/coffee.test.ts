import { describe, expect, test } from 'vitest';
import { COFFEE_DURATION_MS, COFFEE_RATE_MS, COFFEE_REACH_TILES, TILE_SIZE, buildOfficeTiledMap, parseOfficeMap, withinCoffeeReach } from '../src';

describe('le café', () => {
  test('un café dure 30 secondes, se prend à 2 cases de la machine, et pas plus d\'une fois toutes les 2 secondes', () => {
    expect(COFFEE_DURATION_MS).toBe(30_000);
    expect(COFFEE_REACH_TILES).toBe(2);
    expect(COFFEE_RATE_MS).toBe(2_000);
  });

  const machine = { x: 37 * TILE_SIZE + 16, y: 5 * TILE_SIZE + 16 };

  test('withinCoffeeReach : à COFFEE_REACH_TILES cases ou moins du centre de la case de service, en ligne droite', () => {
    expect(withinCoffeeReach(machine, [machine])).toBe(true);
    expect(withinCoffeeReach({ x: machine.x + COFFEE_REACH_TILES * TILE_SIZE, y: machine.y }, [machine])).toBe(true);
    expect(withinCoffeeReach({ x: machine.x + COFFEE_REACH_TILES * TILE_SIZE + 1, y: machine.y }, [machine])).toBe(false);
    // En ligne droite : 1,5 case en travers et 1,5 en hauteur font 2,12 cases.
    expect(withinCoffeeReach({ x: machine.x + 1.5 * TILE_SIZE, y: machine.y + 1.5 * TILE_SIZE }, [machine])).toBe(false);
  });

  test('plusieurs machines : la plus proche compte ; aucune machine (la petite carte) : jamais à portée ; une position illisible non plus', () => {
    const other = { x: 60 * TILE_SIZE, y: 20 * TILE_SIZE };
    expect(withinCoffeeReach(other, [machine, other])).toBe(true);
    expect(withinCoffeeReach(other, [])).toBe(false);
    expect(withinCoffeeReach({ x: Number.NaN, y: 0 }, [machine])).toBe(false);
  });

  test('sur la grande carte : on le prend au café, pas à l\'accueil où l\'on apparaît', () => {
    const map = parseOfficeMap(buildOfficeTiledMap());
    expect(map.coffees).toHaveLength(1);
    expect(withinCoffeeReach(map.coffees[0]!, map.coffees)).toBe(true);
    expect(withinCoffeeReach(map.spawn, map.coffees)).toBe(false);
  });
});
