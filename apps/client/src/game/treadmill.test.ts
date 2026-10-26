import { TREADMILL_ID, WALK_SPEED_PX_PER_S, buildOfficeTiledMap, parseOfficeMap, speedOf, type ActivityState, type OfficeMap, type PlacedItem } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { layoutDecor } from './decor-layout';
import { stepAnimationScale } from './step-animation';
import { offersTreadmill, RUN_IN_PLACE_SCALE, runningAt, spinningTreadmills, stepOffSpot, treadmillKey, treadmillRun } from './treadmill';

// La grande carte : le bureau A1 est la pièce standard, dont le coin haut-gauche est la case (9, 2). Un tapis posé en (1, 2) de sa pièce a son empreinte de
// (320, 128) à (384, 192) en pixels, ses pieds sur la bande en (352, 167), et la case libre devant lui est celle de (336, 208) (packages/shared/test/treadmill.test.ts).
const map = parseOfficeMap(buildOfficeTiledMap());
const ref = (x: number, y: number, desk = 'A1') => ({ desk, x, y });
const treadmill = (x: number, y: number): PlacedItem => ({ id: TREADMILL_ID, x, y });
const sport: Pick<ActivityState, 'place'> = { place: 'gym' };
const BELT = { x: 352, y: 167 };

describe('le choix dans le menu « Moi »', () => {
  test('un mode qui conduit à la salle de sport, avec un tapis de course dans sa propre pièce : « Mon tapis de course » est proposé', () => {
    expect(offersTreadmill(sport, map, { items: [{ id: 'of-6-10', x: 0, y: 0 }, treadmill(1, 2)] })).toBe(true);
  });

  test('sans tapis de course dans sa pièce (le tapis « vue de dessus » n\'en est pas un), ou sans pièce : rien', () => {
    expect(offersTreadmill(sport, map, { items: [{ id: 'of-6-10', x: 0, y: 0 }] })).toBe(false);
    expect(offersTreadmill(sport, map, { items: [{ id: 'gy-11-8', x: 1, y: 2 }] })).toBe(false);
    expect(offersTreadmill(sport, map, undefined)).toBe(false);
  });

  test('un mode qui ne conduit pas à la salle de sport, ou une carte où elle n\'est pas une destination : rien, même avec un tapis', () => {
    const desk = { items: [treadmill(1, 2)] };
    expect(offersTreadmill({}, map, desk)).toBe(false);
    expect(offersTreadmill({ place: 'games' }, map, desk)).toBe(false);
    expect(offersTreadmill(sport, null, desk)).toBe(false);
    expect(offersTreadmill(sport, { places: [{ key: 'gym', label: 'Salle de sport', destination: false }] } as unknown as OfficeMap, desk)).toBe(false);
  });
});

describe('la course', () => {
  test('les pieds sur la bande, et l\'avatar juste devant l\'image du tapis telle que le jeu la dessine (sinon le tapis le cacherait)', () => {
    const run = treadmillRun(map, ref(1, 2))!;
    expect(run.belt).toEqual(BELT);
    // L'image du tapis : la profondeur du bas de son empreinte, le pied de la bande au-dessus.
    const [image] = layoutDecor([{ id: TREADMILL_ID, x: 9 + 1, y: 2 + 2 }]);
    expect(image!.depth).toBe(192);
    expect(run.depth).toBeGreaterThan(image!.depth);
    expect(run.belt.y).toBeLessThan(image!.depth);
    // Un tapis d'un bureau que la carte n'a pas, ou aucun : pas de course.
    expect(treadmillRun(map, ref(1, 2, 'Z9'))).toBeNull();
    expect(treadmillRun(map, null)).toBeNull();
    expect(treadmillRun(map, undefined)).toBeNull();
  });

  test('sur place, la marche vers le haut plus vive : à la cadence de la course, plus vite que la marche', () => {
    expect(RUN_IN_PLACE_SCALE).toBeGreaterThan(stepAnimationScale(WALK_SPEED_PX_PER_S));
    expect(RUN_IN_PLACE_SCALE).toBe(stepAnimationScale(speedOf(true, false)));
  });

  test('on court tant que les pieds sont sur la bande (au pixel près) ; ailleurs, ou sans course dite par le serveur, non', () => {
    const run = treadmillRun(map, ref(1, 2));
    expect(runningAt(run, BELT)).toBe(run);
    expect(runningAt(run, { x: 353, y: 166 })).toBe(run);
    expect(runningAt(run, { x: 336, y: 208 })).toBeNull();
    expect(runningAt(null, BELT)).toBeNull();
  });

  test('descendre : la case libre devant le tapis, d\'après la déco de sa pièce telle que le serveur l\'a dite, loin des autres', () => {
    const desks = [{ key: 'A1', items: [treadmill(1, 2)] }];
    expect(stepOffSpot(map, ref(1, 2), desks, [])).toEqual({ x: 336, y: 208 });
    expect(stepOffSpot(map, ref(1, 2), desks, [{ x: 336, y: 208 }])).toEqual({ x: 368, y: 208 });
    // Un meuble juste au sud du tapis : à côté de lui, jamais dans le meuble.
    expect(stepOffSpot(map, ref(1, 2), [{ key: 'A1', items: [treadmill(1, 2), { id: 'of-7-28', x: 1, y: 4 }] }], [])).toEqual({ x: 304, y: 176 });
    // Un bureau que la carte n'a pas : nulle part.
    expect(stepOffSpot(map, ref(1, 2, 'Z9'), desks, [])).toBeNull();
  });
});

describe('le tapis qui tourne', () => {
  test('la clé d\'un tapis : son bureau et sa place en dixièmes de case, quels que soient les arrondis', () => {
    expect(treadmillKey(ref(1, 2))).toBe('A1:10:20');
    expect(treadmillKey(ref(0.30000000000000004, 2.7))).toBe('A1:3:27');
  });

  test('il tourne dès que quelqu\'un y court tel qu\'on le dessine ; pas avant que son avatar soit sur la bande, plus dès qu\'il en est descendu', () => {
    const run = treadmillRun(map, ref(1, 2));
    // Le serveur la dit sur ce tapis, mais son avatar (dessiné avec du retard) est encore à sa place d'avant : il ne tourne pas encore.
    expect(spinningTreadmills([runningAt(run, { x: 500, y: 300 })])).toEqual(new Set());
    // Dessinée sur la bande : il tourne.
    expect(spinningTreadmills([runningAt(run, BELT)])).toEqual(new Set(['A1:10:20']));
    // Un pas hors du tapis : il s'arrête, sans attendre que le serveur le dise.
    expect(spinningTreadmills([runningAt(run, { x: 336, y: 208 })])).toEqual(new Set());
  });

  test('chaque tapis une fois, quel que soit le nombre de ceux qu\'on voit ; ceux où personne ne court restent fixes', () => {
    const one = treadmillRun(map, ref(1, 2));
    const other = treadmillRun(map, ref(5, 2, 'A2'));
    expect(spinningTreadmills([one, null, other, one])).toEqual(new Set(['A1:10:20', 'A2:50:20']));
    expect(spinningTreadmills([null, null])).toEqual(new Set());
  });
});
