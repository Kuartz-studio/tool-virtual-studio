import { describe, expect, test } from 'vitest';
import { dayPart, describeGap, formatClock, formatGap, formatUtcOffset, gapMinutes, wallTime, zoneOffsetMinutes } from './zoned-time';

// Le samedi 24 octobre 2026, 16:42:07 UTC. Paris est encore à l'heure d'été (elle finit le 25 octobre à 01:00 UTC), Montréal aussi (jusqu'au 1er novembre).
const AT = Date.parse('2026-10-24T16:42:07.250Z');

describe('le décalage d\'un fuseau', () => {
  test('selon le fuseau et la saison, en minutes', () => {
    expect(zoneOffsetMinutes('Europe/Paris', AT)).toBe(120);
    expect(zoneOffsetMinutes('Europe/Paris', Date.parse('2026-12-01T12:00:00Z'))).toBe(60);
    expect(zoneOffsetMinutes('America/Montreal', AT)).toBe(-240);
    expect(zoneOffsetMinutes('Asia/Tokyo', AT)).toBe(540);
    expect(zoneOffsetMinutes('Asia/Kolkata', AT)).toBe(330);
    expect(zoneOffsetMinutes('Asia/Kathmandu', AT)).toBe(345);
    expect(zoneOffsetMinutes('UTC', AT)).toBe(0);
  });

  test('il change à la minute près au passage à l\'heure d\'hiver', () => {
    const change = Date.parse('2026-10-25T01:00:00Z');
    expect(zoneOffsetMinutes('Europe/Paris', change - 1)).toBe(120);
    expect(zoneOffsetMinutes('Europe/Paris', change)).toBe(60);
  });

  test('un fuseau inconnu de ce navigateur compte pour Paris', () => {
    expect(zoneOffsetMinutes('Mars/Olympus_Mons', AT)).toBe(120);
  });
});

describe('l\'heure d\'une horloge', () => {
  test('heures, minutes, secondes et millièmes à l\'heure du fuseau', () => {
    expect(wallTime('Europe/Paris', AT)).toMatchObject({ hours: 18, minutes: 42, seconds: 7, ms: 250 });
    expect(wallTime('America/Montreal', AT)).toMatchObject({ hours: 12, minutes: 42, seconds: 7 });
    expect(wallTime('Asia/Kolkata', AT)).toMatchObject({ hours: 22, minutes: 12 });
  });

  test('le numéro du jour dit si l\'on est déjà demain chez quelqu\'un', () => {
    const paris = wallTime('Europe/Paris', AT);
    expect(wallTime('Asia/Tokyo', AT)).toMatchObject({ hours: 1, minutes: 42 });
    expect(wallTime('Asia/Tokyo', AT).day - paris.day).toBe(1);
    expect(wallTime('Pacific/Honolulu', Date.parse('2026-10-24T05:00:00Z')).day - wallTime('Europe/Paris', Date.parse('2026-10-24T05:00:00Z')).day).toBe(-1);
  });

  test('minuit s\'écrit 00:00', () => {
    expect(formatClock(wallTime('UTC', Date.parse('2026-10-24T00:00:00Z')))).toBe('00:00');
    expect(formatClock({ hours: 8, minutes: 5 })).toBe('08:05');
  });
});

describe('les mots de l\'heure', () => {
  test('le décalage sur le temps universel, avec le vrai signe moins', () => {
    expect(formatUtcOffset(0)).toBe('UTC');
    expect(formatUtcOffset(120)).toBe('UTC+2');
    expect(formatUtcOffset(-300)).toBe('UTC−5');
    expect(formatUtcOffset(330)).toBe('UTC+5:30');
    expect(formatUtcOffset(-210)).toBe('UTC−3:30');
  });

  test('l\'écart entre deux fuseaux', () => {
    expect(formatGap(360)).toBe('6 h');
    expect(formatGap(-330)).toBe('5 h 30');
    expect(formatGap(30)).toBe('30 min');
    expect(gapMinutes('Asia/Tokyo', 'Europe/Paris', AT)).toBe(420);
    expect(describeGap('Asia/Tokyo', 'Europe/Paris', AT)).toBe('7 h d\'avance sur toi');
    expect(describeGap('America/Montreal', 'Europe/Paris', AT)).toBe('6 h de retard sur toi');
    expect(describeGap('Europe/Brussels', 'Europe/Paris', AT)).toBe('Même heure que toi');
    expect(describeGap('Asia/Kolkata', 'Europe/Paris', AT)).toBe('3 h 30 d\'avance sur toi');
  });

  test('le moment de la journée', () => {
    expect([5, 6, 11, 12, 17, 18, 21, 22, 0].map(dayPart)).toEqual(['night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night', 'night']);
  });
});
