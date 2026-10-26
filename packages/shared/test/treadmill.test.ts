import { describe, expect, test } from 'vitest';
import {
  GYM_PLACE_KEY,
  TREADMILL_ID,
  buildOfficeTiledMap,
  decorItem,
  hasTreadmillAt,
  onTreadmill,
  parseOfficeMap,
  placeByKey,
  propByKey,
  sameTreadmill,
  treadmillBelt,
  treadmillFootprint,
  treadmillStepOff,
  treadmillsIn,
  type PlacedItem,
} from '../src';

// La grande carte : le bureau A1 est la pièce standard (9 × 7 cases, porte au sud), de la case (9, 2) à la case (17, 8). Un tapis posé en (1, 2) de sa pièce
// couvre les cases (10, 4) à (11, 5) ; la rangée juste au sud est la 6.
const map = parseOfficeMap(buildOfficeTiledMap());
const ref = (x: number, y: number, desk = 'A1') => ({ desk, x, y });
const treadmill = (x: number, y: number): PlacedItem => ({ id: TREADMILL_ID, x, y });

test('le tapis de course est celui du décor dont le pack a l\'animation : 2 × 3 cases, ses deux rangées du bas au sol, solide ; la planche a ses dimensions', () => {
  expect(decorItem(TREADMILL_ID)).toMatchObject({ name: 'Tapis de course', cat: 'sport', kind: 'object', w: 2, h: 3, claim: 2, solid: true });
  expect(propByKey('treadmill')).toMatchObject({ frameWidth: 64, frameHeight: 96, frames: 12, loop: true });
  // La destination qui le propose est bien une destination de la carte.
  expect(placeByKey(map, GYM_PLACE_KEY)?.destination).toBe(true);
});

describe('où l\'on court', () => {
  test('les pieds sur la bande : au milieu de sa largeur, 25 px au-dessus du bas de l\'empreinte, en pixels entiers', () => {
    expect(treadmillFootprint(map, ref(1, 2))).toEqual({ left: 320, top: 128, right: 384, bottom: 192 });
    expect(treadmillBelt(map, ref(1, 2))).toEqual({ x: 352, y: 167 });
    // Posé au dixième, chaque bord tombe sur le pixel le plus proche, comme le jeu le dessine.
    expect(treadmillBelt(map, ref(1.5, 2))).toEqual({ x: 368, y: 167 });
    expect(treadmillBelt(map, ref(0.3, 2.7))).toEqual({ x: 330, y: 189 });
    expect(treadmillBelt(map, ref(1, 2, 'Z9'))).toBeNull();
  });

  test('sur le tapis : dans l\'une des cases qu\'il bloque, même d\'un dixième', () => {
    expect(onTreadmill(map, ref(1, 2), { x: 352, y: 167 })).toBe(true);
    expect(onTreadmill(map, ref(1, 2), { x: 321, y: 129 })).toBe(true);
    expect(onTreadmill(map, ref(1, 2), { x: 336, y: 208 })).toBe(false);
    expect(onTreadmill(map, ref(1, 2), { x: 400, y: 167 })).toBe(false);
    // Posé en 1,5, il touche aussi la colonne de droite.
    expect(onTreadmill(map, ref(1.5, 2), { x: 400, y: 167 })).toBe(true);
    expect(onTreadmill(map, ref(1, 2, 'Z9'), { x: 352, y: 167 })).toBe(false);
  });

  test('les tapis d\'une pièce, dans l\'ordre de sa déco ; une place se compare au dixième près', () => {
    const items: PlacedItem[] = [{ id: 'of-6-10', x: 0, y: 0 }, treadmill(5, 2), treadmill(1, 2), { id: 'gy-11-8', x: 5, y: 4 }];
    expect(treadmillsIn(items)).toEqual([treadmill(5, 2), treadmill(1, 2)]);
    expect(hasTreadmillAt(items, { x: 1, y: 2 })).toBe(true);
    expect(hasTreadmillAt([treadmill(0.30000000000000004, 2)], { x: 0.3, y: 2 })).toBe(true);
    expect(hasTreadmillAt(items, { x: 5, y: 4 })).toBe(false);   // le tapis « vue de dessus » n'en est pas un
    expect(sameTreadmill(ref(1, 2), ref(1, 2))).toBe(true);
    expect(sameTreadmill(ref(1, 2), ref(1, 2, 'A2'))).toBe(false);
    expect(sameTreadmill(ref(1, 2), ref(1.1, 2))).toBe(false);
  });
});

describe('où l\'on descend', () => {
  test('la rangée juste au sud, sous le tapis : la case la plus proche de ses pieds (à égalité, la plus à gauche), puis sa voisine si quelqu\'un y est', () => {
    expect(treadmillStepOff(map, ref(1, 2), [treadmill(1, 2)])).toEqual({ x: 336, y: 208 });
    expect(treadmillStepOff(map, ref(1, 2), [treadmill(1, 2)], [{ x: 336, y: 208 }], 28)).toEqual({ x: 368, y: 208 });
    // Posé au dixième (sur trois colonnes), la case sous le milieu de sa bande.
    expect(treadmillStepOff(map, ref(1.5, 2), [treadmill(1.5, 2)])).toEqual({ x: 368, y: 208 });
  });

  test('la rangée du sud prise ou meublée : à côté, la rangée de la bande d\'abord ; puis le reste de la pièce', () => {
    const taken = [{ x: 336, y: 208 }, { x: 368, y: 208 }];
    expect(treadmillStepOff(map, ref(1, 2), [treadmill(1, 2)], taken, 28)).toEqual({ x: 304, y: 176 });
    // Un bureau de trois cases juste au sud du tapis : de même, jamais dans le meuble.
    const desk: PlacedItem = { id: 'of-7-28', x: 1, y: 4 };
    expect(treadmillStepOff(map, ref(1, 2), [treadmill(1, 2), desk])).toEqual({ x: 304, y: 176 });
    // Tout le tour du tapis occupé : la case libre la plus proche, plus loin.
    const around = [{ x: 304, y: 144 }, { x: 304, y: 176 }, { x: 304, y: 208 }, { x: 400, y: 144 }, { x: 400, y: 176 }, { x: 400, y: 208 }, ...taken];
    const further = treadmillStepOff(map, ref(1, 2), [treadmill(1, 2)], around, 28)!;
    expect(around.every((other) => Math.hypot(other.x - further.x, other.y - further.y) >= 28)).toBe(true);
    expect(onTreadmill(map, ref(1, 2), further)).toBe(false);
  });

  test('un tapis contre le mur du bas (sa rangée du sud est hors de la pièce) : à côté, sur la rangée de la bande', () => {
    expect(treadmillStepOff(map, ref(0, 5), [treadmill(0, 5)])).toEqual({ x: 368, y: 272 });
  });

  test('le tapis retiré (la déco ne l\'a plus) : on descend devant sa place d\'avant ; une pièce pleine de monde : près de quelqu\'un plutôt que dans le meuble', () => {
    expect(treadmillStepOff(map, ref(1, 2), [])).toEqual({ x: 336, y: 208 });
    const everyone = Array.from({ length: 7 * 9 }, (_, i) => ({ x: (9 + (i % 9)) * 32 + 16, y: (2 + Math.floor(i / 9)) * 32 + 16 }));
    expect(treadmillStepOff(map, ref(1, 2), [treadmill(1, 2)], everyone, 28)).toEqual({ x: 336, y: 208 });
    expect(treadmillStepOff(map, ref(1, 2, 'Z9'), [])).toBeNull();
  });
});
