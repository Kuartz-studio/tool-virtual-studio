import { describe, expect, test } from 'vitest';
import { DEFAULT_TIMEZONE, TIMEZONE_MAX_LENGTH, isTimezone, timezoneOrDefault, timezoneSchema } from '../src';

describe('les fuseaux horaires', () => {
  test('tout le monde est à l\'heure de Paris par défaut', () => {
    expect(DEFAULT_TIMEZONE).toBe('Europe/Paris');
    expect(isTimezone(DEFAULT_TIMEZONE)).toBe(true);
  });

  test('isTimezone : les noms IANA que le moteur connaît, anciens noms compris', () => {
    for (const name of ['Europe/Paris', 'America/Montreal', 'America/Argentina/Buenos_Aires', 'Asia/Kolkata', 'Asia/Calcutta', 'Europe/Kyiv', 'UTC', 'Etc/GMT+5', 'America/Port-au-Prince']) {
      expect(isTimezone(name), name).toBe(true);
    }
  });

  test('isTimezone : ni un décalage fixe, ni un nom inventé, ni une ville seule, ni un chemin', () => {
    for (const name of ['', ' ', 'Paris', 'Europe/Pariss', 'Mars/Olympus_Mons', '+01:00', '-05:00', 'UTC+2', 'Europe/../Paris', '/Europe/Paris', 'Europe//Paris', 'Europe Paris', 'x'.repeat(TIMEZONE_MAX_LENGTH + 1)]) {
      expect(isTimezone(name), JSON.stringify(name)).toBe(false);
    }
  });

  test('timezoneSchema : un nom IANA réel, sans les espaces autour, gardé tel qu\'il est écrit', () => {
    expect(timezoneSchema.parse('  Asia/Tokyo ')).toBe('Asia/Tokyo');
    // Node l'appelle Asia/Calcutta : le nom envoyé reste celui du client, que sa liste reconnaît.
    expect(timezoneSchema.parse('Asia/Kolkata')).toBe('Asia/Kolkata');
    for (const value of ['', 'Paris', '+01:00', 42, null, undefined, ['Europe/Paris']]) {
      expect(timezoneSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  test('timezoneOrDefault : le fuseau s\'il est connu, l\'heure de Paris sinon', () => {
    expect(timezoneOrDefault('Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(timezoneOrDefault(undefined)).toBe('Europe/Paris');
    expect(timezoneOrDefault(null)).toBe('Europe/Paris');
    expect(timezoneOrDefault('')).toBe('Europe/Paris');
    expect(timezoneOrDefault('Mars/Olympus_Mons')).toBe('Europe/Paris');
  });
});
