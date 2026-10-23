import { describe, expect, test } from 'vitest';
import { formatLastSeen } from './last-seen';

const NOW = Date.parse('2026-10-23T14:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => formatLastSeen(NOW - ms, NOW);

describe('formatLastSeen', () => {
  test('moins d\'une minute, ou une heure du serveur en avance : « À l\'instant »', () => {
    expect(ago(0)).toBe('À l\'instant');
    expect(ago(59_999)).toBe('À l\'instant');
    expect(ago(-5 * MIN)).toBe('À l\'instant');
  });

  test('en minutes puis en heures, arrondies vers le bas', () => {
    expect(ago(MIN)).toBe('Il y a 1 min');
    expect(ago(26 * MIN + 59_000)).toBe('Il y a 26 min');
    expect(ago(HOUR - 1)).toBe('Il y a 59 min');
    expect(ago(HOUR)).toBe('Il y a 1 h');
    expect(ago(3 * HOUR + 59 * MIN)).toBe('Il y a 3 h');
    expect(ago(DAY - 1)).toBe('Il y a 23 h');
  });

  test('en jours, en semaines, en mois, en années, au singulier comme au pluriel', () => {
    expect(ago(DAY)).toBe('Il y a 1 jour');
    expect(ago(5 * DAY)).toBe('Il y a 5 jours');
    expect(ago(7 * DAY)).toBe('Il y a 1 semaine');
    expect(ago(29 * DAY)).toBe('Il y a 4 semaines');
    expect(ago(30 * DAY)).toBe('Il y a 1 mois');
    expect(ago(364 * DAY)).toBe('Il y a 12 mois');
    expect(ago(365 * DAY)).toBe('Il y a 1 an');
    expect(ago(3 * 365 * DAY)).toBe('Il y a 3 ans');
  });
});
