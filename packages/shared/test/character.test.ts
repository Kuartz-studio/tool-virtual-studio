import { describe, expect, test } from 'vitest';
import { CHARACTER_PARTS, CHARACTER_SHEET, defaultAvatarKey, formatCharacter, formatPremade, isAvatarKey, parseAvatarKey, randomCharacter } from '../src';

describe('les clés d\'avatar', () => {
  test('un personnage assemblé s\'écrit et se relit', () => {
    const key = formatCharacter({ body: 3, eyes: 2, outfit: { style: 1, color: 4 }, hair: { style: 5, color: 3 }, accessory: null });
    expect(key).toBe('c.3.2.1-4.5-3.0');
    expect(parseAvatarKey(key)).toEqual({ kind: 'built', build: { body: 3, eyes: 2, outfit: { style: 1, color: 4 }, hair: { style: 5, color: 3 }, accessory: null } });
  });

  test('un personnage prêt à l\'emploi : p.NN, de 1 au nombre de personnages du pack', () => {
    expect(formatPremade(7)).toBe('p.07');
    expect(parseAvatarKey('p.07')).toEqual({ kind: 'premade', number: 7 });
    expect(isAvatarKey(formatPremade(CHARACTER_PARTS.premade))).toBe(true);
    expect(isAvatarKey(formatPremade(CHARACTER_PARTS.premade + 1))).toBe(false);
    expect(isAvatarKey('p.00')).toBe(false);
  });

  test('une clé hors de ce que le pack contient est refusée', () => {
    expect(isAvatarKey(`c.${CHARACTER_PARTS.bodies + 1}.1.1-1.0.0`)).toBe(false);
    expect(isAvatarKey(`c.1.${CHARACTER_PARTS.eyes + 1}.1-1.0.0`)).toBe(false);
    expect(isAvatarKey('c.1.1.1-99.0.0')).toBe(false);
    expect(isAvatarKey('c.1.1.0.0.0')).toBe(false);   // une tenue est obligatoire
    expect(isAvatarKey('c.1.1.1-1.99-1.0')).toBe(false);
    expect(isAvatarKey('c.1.1.1-1.0.99-1')).toBe(false);
    expect(isAvatarKey('')).toBe(false);
    expect(isAvatarKey('dev-red')).toBe(false);
    expect(isAvatarKey('c.1.1.1-1.0.0; drop table')).toBe(false);
  });

  test('un avatar au hasard est toujours valable', () => {
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 200; i++) expect(isAvatarKey(formatCharacter(randomCharacter(random)))).toBe(true);
  });

  test('sans choix, un personnage prêt à l\'emploi, toujours le même pour la même personne', () => {
    expect(isAvatarKey(defaultAvatarKey('user-123'))).toBe(true);
    expect(defaultAvatarKey('user-123')).toBe(defaultAvatarKey('user-123'));
    const keys = new Set(Array.from({ length: 40 }, (_, i) => defaultAvatarKey(`user-${i}`)));
    expect(keys.size).toBeGreaterThan(5);
  });

  test('la planche : 24 images de 32 × 64 par ligne, 6 par direction', () => {
    expect(CHARACTER_SHEET.columns).toBe(CHARACTER_SHEET.directions.length * CHARACTER_SHEET.framesPerDirection);
    expect([CHARACTER_SHEET.frameWidth, CHARACTER_SHEET.frameHeight]).toEqual([32, 64]);
  });
});
