import { describe, expect, test } from 'vitest';
import { CURRENT_RELEASE, compareReleases, isReleaseBehind, isReleaseVersion } from '../src';

describe('les versions de l\'appli', () => {
  test('la version en cours est bien formée (MAJEUR.MINEUR, le mineur sur deux chiffres)', () => {
    expect(isReleaseVersion(CURRENT_RELEASE)).toBe(true);
    for (const value of ['1.00', '1.09', '1.10', '2.00', '10.42', '0.01']) expect(isReleaseVersion(value), value).toBe(true);
    for (const value of ['1', '1.0', '1.000', '01.00', 'v1.00', ' 1.00', '1.00 ', '1,00', '', null, undefined, 1, ['1.00']]) {
      expect(isReleaseVersion(value), JSON.stringify(value)).toBe(false);
    }
  });

  test('compareReleases compare les nombres, pas les textes', () => {
    expect(compareReleases('1.00', '1.00')).toBe(0);
    expect(compareReleases('1.00', '1.01')).toBeLessThan(0);
    expect(compareReleases('1.09', '1.10')).toBeLessThan(0);
    expect(compareReleases('1.99', '2.00')).toBeLessThan(0);
    // L'ordre des textes mettrait « 10.00 » avant « 9.99 ».
    expect(compareReleases('10.00', '9.99')).toBeGreaterThan(0);
    expect(['1.10', '2.00', '1.02', '1.00', '1.09'].sort(compareReleases)).toEqual(['1.00', '1.02', '1.09', '1.10', '2.00']);
    expect(() => compareReleases('1.0', '1.00')).toThrow(/mal formé/);
  });

  test('isReleaseBehind : rien vu (ou une valeur abîmée), ou une version plus ancienne ; jamais une version égale ou plus récente', () => {
    expect(isReleaseBehind(null, '1.00')).toBe(true);
    expect(isReleaseBehind(undefined, '1.00')).toBe(true);
    expect(isReleaseBehind('n\'importe quoi', '1.00')).toBe(true);
    expect(isReleaseBehind('1.00', '1.01')).toBe(true);
    expect(isReleaseBehind('1.09', '1.10')).toBe(true);
    expect(isReleaseBehind('1.00', '1.00')).toBe(false);
    expect(isReleaseBehind('1.02', '1.01')).toBe(false);
    expect(isReleaseBehind(CURRENT_RELEASE)).toBe(false);
  });
});
