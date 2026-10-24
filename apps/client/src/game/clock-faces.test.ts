import { describe, expect, test } from 'vitest';
import {
  CLOCK_COLORS,
  CLOCK_FACES,
  clockStateKey,
  colonLit,
  handAngles,
  handPixels,
  ledDigits,
  linePixels,
  paintClock,
  pendulumAngle,
  segmentsOf,
  type AnalogFace,
  type ClockTime,
} from './clock-faces';

const at = (hours: number, minutes: number, seconds = 0, ms = 0): ClockTime => ({ hours, minutes, seconds, ms });

// Les pixels qu'une horloge peint à cette heure, par couleur.
function painted(id: string, time: ClockTime): Map<string, Array<[number, number]>> {
  const byColor = new Map<string, Array<[number, number]>>();
  paintClock(CLOCK_FACES[id]!, time, (x, y, color) => {
    if (!byColor.has(color)) byColor.set(color, []);
    byColor.get(color)!.push([x, y]);
  });
  return byColor;
}

describe('les angles des aiguilles', () => {
  test('depuis midi, dans le sens des aiguilles d\'une montre', () => {
    expect(handAngles(at(3, 0))).toEqual({ hour: Math.PI / 2, minute: 0, second: 0 });
    expect(handAngles(at(12, 0)).hour).toBe(0);
    expect(handAngles(at(18, 30)).hour).toBeCloseTo((6.5 / 12) * 2 * Math.PI);
    expect(handAngles(at(18, 30)).minute).toBeCloseTo(Math.PI);
    expect(handAngles(at(9, 0, 45)).second).toBeCloseTo((3 / 2) * Math.PI);
  });

  test('l\'aiguille des heures avance avec les minutes, celle des minutes avec les secondes ; la trotteuse saute de seconde en seconde', () => {
    expect(handAngles(at(1, 30)).hour).toBeCloseTo((1.5 / 12) * 2 * Math.PI);
    expect(handAngles(at(0, 10, 30)).minute).toBeCloseTo((10.5 / 60) * 2 * Math.PI);
    expect(handAngles({ hours: 0, minutes: 0, seconds: 7, ms: 900 }).second).toBeCloseTo((7 / 60) * 2 * Math.PI);
  });
});

describe('des pixels', () => {
  test('une ligne : les deux bouts compris, sans trou', () => {
    expect(linePixels(0, 0, 3, 0)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(linePixels(2, 2, 2, -1)).toEqual([[2, 2], [2, 1], [2, 0], [2, -1]]);
    const diagonal = linePixels(0, 0, 4, 2);
    expect(diagonal[0]).toEqual([0, 0]);
    expect(diagonal.at(-1)).toEqual([4, 2]);
    for (let i = 1; i < diagonal.length; i++) {
      const [[x0, y0], [x1, y1]] = [diagonal[i - 1]!, diagonal[i]!];
      expect(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))).toBe(1);
    }
  });

  test('une aiguille de 3 h part du centre vers la droite ; épaisse de 2, elle prend la rangée du dessous', () => {
    const center = { x: 16, y: 15 };
    const hand = handPixels(center, Math.PI / 2, { length: 5, width: 2 });
    expect(new Set(hand.map(([, y]) => y))).toEqual(new Set([15, 16]));
    expect(Math.max(...hand.map(([x]) => x))).toBe(21);
    expect(Math.min(...hand.map(([x]) => x))).toBe(16);
    // Midi, épaisse de 3 : une colonne de chaque côté.
    expect(new Set(handPixels(center, 0, { length: 4, width: 3 }).map(([x]) => x))).toEqual(new Set([15, 16, 17]));
  });
});

describe('l\'horloge ronde', () => {
  const face = CLOCK_FACES['horloge-ronde'] as AnalogFace;

  test('à 3 h, l\'aiguille des heures est à droite du centre, celle des minutes en haut ; la trotteuse est rouge', () => {
    const ink = painted('horloge-ronde', at(3, 0, 30)).get(CLOCK_COLORS.ink)!;
    expect(ink.some(([x, y]) => x === face.center.x + 5 && (y === face.center.y || y === face.center.y + 1))).toBe(true);
    expect(ink.some(([x, y]) => x === face.center.x && y === face.center.y - 8)).toBe(true);
    // À 30 s, la trotteuse descend du centre.
    const red = painted('horloge-ronde', at(3, 0, 30)).get(CLOCK_COLORS.red)!;
    expect(red.some(([x, y]) => x === face.center.x && y === face.center.y + 8)).toBe(true);
  });

  test('elle change à chaque seconde, pas entre deux', () => {
    const f = CLOCK_FACES['horloge-ronde']!;
    expect(clockStateKey(f, { hours: 9, minutes: 5, seconds: 12, ms: 100 })).toBe(clockStateKey(f, { hours: 9, minutes: 5, seconds: 12, ms: 900 }));
    expect(clockStateKey(f, at(9, 5, 12))).not.toBe(clockStateKey(f, at(9, 5, 13)));
  });

  test('tout ce qu\'elle peint tient dans son image de 32 × 32', () => {
    for (const hours of [0, 3, 6, 9, 13, 23]) {
      for (const minutes of [0, 17, 45]) {
        paintClock(face, at(hours, minutes, minutes), (x, y) => {
          expect(x >= 0 && x < 32 && y >= 0 && y < 32).toBe(true);
        });
      }
    }
  });
});

describe('l\'horloge LED', () => {
  const face = CLOCK_FACES['horloge-led']!;

  test('les chiffres sur 24 h, le premier éteint avant 10 h', () => {
    expect(ledDigits(at(18, 42))).toEqual([1, 8, 4, 2]);
    expect(ledDigits(at(9, 5))).toEqual([null, 9, 0, 5]);
    expect(ledDigits(at(0, 0))).toEqual([null, 0, 0, 0]);
    expect(segmentsOf(8)).toBe('abcdefg');
    expect(segmentsOf(1)).toBe('bc');
    expect(segmentsOf(7)).toBe('abc');
  });

  test('les deux points clignotent : allumés la première moitié de chaque seconde', () => {
    expect(colonLit({ hours: 0, minutes: 0, seconds: 0, ms: 0 })).toBe(true);
    expect(colonLit({ hours: 0, minutes: 0, seconds: 0, ms: 499 })).toBe(true);
    expect(colonLit({ hours: 0, minutes: 0, seconds: 0, ms: 500 })).toBe(false);
    expect(clockStateKey(face, { hours: 18, minutes: 42, seconds: 3, ms: 100 })).not.toBe(clockStateKey(face, { hours: 18, minutes: 42, seconds: 3, ms: 600 }));
    // Les secondes ne s'affichent pas : rien ne change d'une seconde à l'autre, aux mêmes deux points.
    expect(clockStateKey(face, { hours: 18, minutes: 42, seconds: 3, ms: 100 })).toBe(clockStateKey(face, { hours: 18, minutes: 42, seconds: 4, ms: 100 }));
  });

  test('18:42 allume 1, 8, 4 et 2 (18 segments de 8 pixels) et les deux points', () => {
    const lit = (ms: number) => painted('horloge-led', { hours: 18, minutes: 42, seconds: 0, ms }).get(CLOCK_COLORS.ledOn)?.length ?? 0;
    expect(lit(0)).toBe((2 + 7 + 4 + 5) * 8 + 8);
    expect(lit(700)).toBe((2 + 7 + 4 + 5) * 8);
  });
});

describe('l\'horloge de gare', () => {
  test('sa trotteuse rouge porte une palette ronde, et le milieu de son moyeu est rouge', () => {
    const face = CLOCK_FACES['horloge-gare'] as AnalogFace;
    const red = painted('horloge-gare', at(10, 10, 15)).get(CLOCK_COLORS.red)!;
    // À 15 s, la trotteuse est à droite : la palette est à 15 px du centre, sur la rangée du centre.
    expect(red.some(([x, y]) => x === face.center.x + 15 && y === face.center.y)).toBe(true);
    expect(red.some(([x, y]) => x === face.center.x + 15 && y === face.center.y - 2)).toBe(true);
    expect(red.some(([x, y]) => x === face.center.x && y === face.center.y)).toBe(true);
  });
});

describe('la pendule', () => {
  const face = CLOCK_FACES['horloge-balancier'] as AnalogFace;
  const { amplitude } = face.pendulum!;

  test('le balancier bat la seconde : aux extrémités aux secondes rondes, au milieu entre deux', () => {
    expect(pendulumAngle(at(0, 0, 0), amplitude)).toBeCloseTo(amplitude);
    expect(pendulumAngle(at(0, 0, 1), amplitude)).toBeCloseTo(-amplitude);
    expect(pendulumAngle({ hours: 0, minutes: 0, seconds: 1, ms: 500 }, amplitude)).toBeCloseTo(0);
  });

  test('il se repeint à chaque pixel de sa course, et pas plus', () => {
    const keys = new Set<string>();
    for (let ms = 0; ms < 1000; ms += 10) keys.add(clockStateKey(face, { hours: 4, minutes: 20, seconds: 6, ms }));
    expect(keys.size).toBeGreaterThan(3);
    expect(keys.size).toBeLessThan(15);
  });

  test('le balancier reste dans la vitrine', () => {
    for (let ms = 0; ms < 2000; ms += 50) {
      paintClock(face, { hours: 4, minutes: 20, seconds: Math.floor(ms / 1000), ms: ms % 1000 }, (x, y, color) => {
        if (color !== CLOCK_COLORS.brassDeep && color !== CLOCK_COLORS.brassDark && color !== CLOCK_COLORS.brassLight && color !== CLOCK_COLORS.brassGlint) return;
        if (y < 28) return;   // le moyeu du cadran est en laiton aussi
        expect(x >= 10 && x <= 22 && y >= 31 && y <= 54, `${x},${y}`).toBe(true);
      });
    }
  });
});
