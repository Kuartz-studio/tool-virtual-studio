import { distanceToWater, type OfficeMap, type Place } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import {
  BIRD_FIRST_S,
  BIRD_GAP_S,
  gustShape,
  MOTO_FIRST_S,
  MOTO_GAP_S,
  MOTO_PAN,
  natureAt,
  natureMix,
  NatureSchedule,
  WATER_FULL_TILES,
  WATER_PAN_MAX,
  WATER_SILENT_TILES,
  WATER_THROUGH_WALL,
  waterLevel,
  waterPan,
  WIND_FIRST_S,
  WIND_GAP_S,
  type BirdPhrase,
  type Gust,
  type MotoPass,
  type NatureEvent,
} from './nature';

const TILE = 32;
const tiles = (count: number) => count * TILE;

// Un hasard qu'on rejoue (mulberry32) : les mêmes tirages à chaque passage.
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('l\'eau : de plus en plus fort à mesure qu\'on s\'approche', () => {
  test('pleine à 1,5 case ou moins, plus rien à 9 cases ; entre les deux, elle monte à chaque pas, et naît sans à-coup au loin', () => {
    expect(waterLevel(0, TILE)).toBe(1);
    expect(waterLevel(tiles(WATER_FULL_TILES), TILE)).toBe(1);
    expect(waterLevel(tiles(WATER_SILENT_TILES), TILE)).toBe(0);
    expect(waterLevel(tiles(30), TILE)).toBe(0);
    let farther = 0;
    for (let distance = WATER_SILENT_TILES - 0.25; distance > WATER_FULL_TILES; distance -= 0.25) {
      const level = waterLevel(tiles(distance), TILE);
      expect(level).toBeGreaterThan(farther);
      farther = level;
    }
    // Au bord du silence, presque rien ; à mi-chemin, un quart (-12 dB).
    expect(waterLevel(tiles(WATER_SILENT_TILES - 0.5), TILE)).toBeLessThan(0.01);
    expect(waterLevel(tiles((WATER_FULL_TILES + WATER_SILENT_TILES) / 2), TILE)).toBeCloseTo(0.25, 5);
  });

  test('elle est du côté où elle est, de plus en plus franchement en s\'éloignant ; tout près, ou droit devant, au milieu', () => {
    expect(waterPan(tiles(4), tiles(4), TILE)).toBeCloseTo(WATER_PAN_MAX);
    expect(waterPan(-tiles(4), tiles(4), TILE)).toBeCloseTo(-WATER_PAN_MAX);
    expect(Math.abs(waterPan(tiles(1), tiles(1), TILE))).toBeLessThan(Math.abs(waterPan(tiles(3), tiles(3), TILE)));
    expect(waterPan(0, tiles(4), TILE)).toBe(0);
    expect(waterPan(0, 0, TILE)).toBe(0);
  });
});

describe('dedans, dehors, le jour, le soir, la nuit', () => {
  const pond = { distance: tiles(1), dx: -tiles(1) };

  test('dehors le jour : les oiseaux, le vent, l\'eau à l\'air libre ; pas d\'insectes', () => {
    expect(natureMix({ outside: true, lights: 'on', water: pond }, TILE)).toMatchObject({ outside: true, birds: 1, insects: 0, wind: 1, water: { open: 1, wall: 0 } });
  });

  test('le soir (lumière tamisée) : deux fois moins d\'oiseaux, et déjà les insectes, à 40 % ; la nuit (éteinte) : les insectes, plus d\'oiseaux', () => {
    expect(natureMix({ outside: true, lights: 'dim', water: null }, TILE)).toMatchObject({ birds: 0.5, insects: 0.4, wind: 1 });
    expect(natureMix({ outside: true, lights: 'off', water: null }, TILE)).toMatchObject({ birds: 0, insects: 1, wind: 1 });
  });

  test('dedans, à toute heure : rien du dehors, et l\'eau à travers le mur, au tiers de son niveau ; sans eau, rien', () => {
    for (const lights of ['on', 'dim', 'off'] as const) {
      expect(natureMix({ outside: false, lights, water: pond }, TILE)).toMatchObject({ birds: 0, insects: 0, wind: 0, water: { open: 0, wall: WATER_THROUGH_WALL } });
    }
    expect(natureMix({ outside: false, lights: 'on', water: null }, TILE).water).toEqual({ open: 0, wall: 0, pan: 0 });
  });

  test('sur une carte : le jardin (dehors) avec son bassin, le hall à côté (dedans) ; la distance est celle de distanceToWater', () => {
    const place = (key: string, kind: Place['kind'], x: number): Place => ({
      key,
      label: key,
      kind,
      rects: [{ x: tiles(x), y: 0, width: tiles(10), height: tiles(10) }],
      scene: 'lobby',
      music: false,
      destination: false,
    });
    const map = { tileSize: TILE, zones: [], places: [place('garden', 'outside', 0), place('hall', 'room', 10)], waters: [{ x: tiles(1), y: tiles(2), width: tiles(2), height: tiles(2) }] } as unknown as OfficeMap;

    // À une case à droite du bassin, dans le jardin : l'eau pleine, à gauche ; les oiseaux.
    const garden = natureAt(map, tiles(4), tiles(3), 'on');
    expect(garden).toMatchObject({ outside: true, birds: 1, water: { open: 1, wall: 0 } });
    expect(garden.water.pan).toBeLessThan(0);
    // Dans le hall, à 7 cases et demie : l'eau, faible, à travers le mur ; pas d'oiseaux.
    const hall = natureAt(map, tiles(10.5), tiles(3), 'on');
    expect(hall).toMatchObject({ outside: false, birds: 0, water: { open: 0 } });
    expect(hall.water.wall).toBeCloseTo(waterLevel(distanceToWater(map, tiles(10.5), tiles(3))!, TILE) * WATER_THROUGH_WALL, 6);
    expect(hall.water.wall).toBeGreaterThan(0);
  });
});

describe('le calendrier des oiseaux et du vent', () => {
  // Ce qui part, d'une heure à l'autre (ms), en interrogeant le calendrier comme le lecteur (tous les quarts de seconde).
  function run(schedule: NatureSchedule, from: number, to: number, mix: { birds: number; wind: number; moto: number }): Array<{ at: number; event: NatureEvent }> {
    const out: Array<{ at: number; event: NatureEvent }> = [];
    for (let at = from; at <= to; at += 250) for (const event of schedule.due(at, mix)) out.push({ at, event });
    return out;
  }
  const phrases = (events: Array<{ at: number; event: NatureEvent }>) => events.filter((e): e is { at: number; event: BirdPhrase } => e.event.kind === 'phrase');
  const gusts = (events: Array<{ at: number; event: NatureEvent }>) => events.filter((e): e is { at: number; event: Gust } => e.event.kind === 'gust');
  const gaps = (times: number[]) => times.slice(1).map((at, i) => at - times[i]!);
  const motos = (events: Array<{ at: number; event: NatureEvent }>) => events.filter((e): e is { at: number; event: MotoPass } => e.event.kind === 'moto');

  test('dehors le jour : une première phrase peu après la sortie, puis une toutes les 1,8 à 7 s, au hasard ; jamais deux fois la même de suite', () => {
    const sung = phrases(run(new NatureSchedule(seeded(7), 12, 8.6), 0, 10 * 60_000, { birds: 1, wind: 0, moto: 0 }));
    expect(sung[0]!.at).toBeGreaterThanOrEqual(BIRD_FIRST_S.min * 1000);
    expect(sung[0]!.at).toBeLessThanOrEqual(BIRD_FIRST_S.max * 1000 + 250);
    const between = gaps(sung.map((s) => s.at));
    expect(Math.min(...between)).toBeGreaterThanOrEqual(BIRD_GAP_S.min * 1000);
    expect(Math.max(...between)).toBeLessThanOrEqual(BIRD_GAP_S.max * 1000 + 250);
    // Pas un métronome : les écarts varient vraiment.
    expect(Math.max(...between) - Math.min(...between)).toBeGreaterThan(3000);
    const order = sung.map((s) => s.event.phrase);
    expect(new Set(order).size).toBe(12);
    for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
    for (const { event } of sung) {
      expect(event.rate).toBeGreaterThanOrEqual(0.94);
      expect(event.rate).toBeLessThanOrEqual(1.06);
      expect(Math.abs(event.pan)).toBeLessThanOrEqual(0.75);
    }
  });

  test('le soir, deux fois moins d\'oiseaux ; la nuit ou dedans, aucun ; et au retour, ça repart du début, sans rattraper ce qu\'on a manqué', () => {
    const day = phrases(run(new NatureSchedule(seeded(11), 12, 8.6), 0, 20 * 60_000, { birds: 1, wind: 0, moto: 0 })).length;
    const evening = phrases(run(new NatureSchedule(seeded(11), 12, 8.6), 0, 20 * 60_000, { birds: 0.5, wind: 0, moto: 0 })).length;
    expect(evening / day).toBeGreaterThan(0.4);
    expect(evening / day).toBeLessThan(0.6);

    const schedule = new NatureSchedule(seeded(3), 12, 8.6);
    run(schedule, 0, 30_000, { birds: 1, wind: 1, moto: 0 });
    expect(run(schedule, 30_250, 120_000, { birds: 0, wind: 0, moto: 0 })).toEqual([]);
    // De retour dehors après une longue absence : une seule phrase d'abord, peu après, pas une rafale.
    const back = run(schedule, 600_000, 603_000, { birds: 1, wind: 1, moto: 0 });
    expect(phrases(back)).toHaveLength(1);
    expect(phrases(back)[0]!.at - 600_000).toBeLessThanOrEqual(BIRD_FIRST_S.max * 1000 + 250);
  });

  test('le vent : un coup de temps en temps (le premier assez tôt, puis toutes les 25 à 70 s), qui tient dans son fichier, monte, passe et retombe', () => {
    const blown = gusts(run(new NatureSchedule(seeded(5), 12, 8.6), 0, 60 * 60_000, { birds: 0, wind: 1, moto: 0 }));
    expect(blown[0]!.at).toBeGreaterThanOrEqual(WIND_FIRST_S.min * 1000);
    expect(blown[0]!.at).toBeLessThanOrEqual(WIND_FIRST_S.max * 1000 + 250);
    const between = gaps(blown.map((g) => g.at));
    expect(Math.min(...between)).toBeGreaterThanOrEqual(WIND_GAP_S.min * 1000);
    expect(Math.max(...between)).toBeLessThanOrEqual(WIND_GAP_S.max * 1000 + 250);
    for (const { event } of blown) {
      expect(event.offset + event.seconds * event.rate).toBeLessThanOrEqual(8.6);
      expect(event.attack + event.release).toBeLessThanOrEqual(event.seconds);
      expect(Math.abs(event.panTo)).toBeLessThanOrEqual(0.85);
      const shape = gustShape(event);
      expect(shape[0]).toBe(0);
      expect(shape.at(-1)).toBeCloseTo(0, 6);
      expect(Math.max(...shape)).toBeCloseTo(1, 1);
    }
  });

  test('la moto : dehors, un passage peu après être sorti, puis toutes les deux minutes et demie à trois et demie, d\'un côté à l\'autre ; dedans, jamais', () => {
    const passes = motos(run(new NatureSchedule(seeded(9), 12, 8.6), 0, 60 * 60_000, { birds: 0, wind: 0, moto: 1 }));
    expect(passes[0]!.at).toBeGreaterThanOrEqual(MOTO_FIRST_S.min * 1000);
    expect(passes[0]!.at).toBeLessThanOrEqual(MOTO_FIRST_S.max * 1000 + 250);
    const between = gaps(passes.map((p) => p.at));
    expect(Math.min(...between)).toBeGreaterThanOrEqual(MOTO_GAP_S.min * 1000);
    expect(Math.max(...between)).toBeLessThanOrEqual(MOTO_GAP_S.max * 1000 + 250);
    for (const { event } of passes) expect([event.panFrom, event.panTo].map(Math.abs)).toEqual([MOTO_PAN, MOTO_PAN]);
    expect(new Set(passes.map((p) => p.event.panFrom)).size).toBe(2);
    expect(natureMix({ outside: true, lights: 'off', water: null }, TILE).moto).toBe(1);
    expect(natureMix({ outside: false, lights: 'on', water: null }, TILE).moto).toBe(0);
    const schedule = new NatureSchedule(seeded(9), 12, 8.6);
    expect(motos(run(schedule, 0, 30 * 60_000, { birds: 0, wind: 0, moto: 0 }))).toEqual([]);
  });
});
