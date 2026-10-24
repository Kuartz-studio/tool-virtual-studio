import { isTimezone } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { ZONES, canonicalZone, sameZone, searchZones, zoneLabel, zoneOptions, zonePlace } from './timezones';

const AT = Date.parse('2026-10-24T16:42:00Z');

describe('la liste des fuseaux', () => {
  test('des noms IANA réels, une fois chacun, avec une ville et un pays en français ; Paris en fait partie', () => {
    expect(ZONES.every((zone) => isTimezone(zone.id))).toBe(true);
    expect(new Set(ZONES.map((zone) => zone.id)).size).toBe(ZONES.length);
    expect(ZONES.every((zone) => zone.city !== '' && zone.region !== '')).toBe(true);
    expect(zonePlace('Europe/Paris')).toEqual({ city: 'Paris', region: 'France' });
    // La France d'outre-mer, et le monde francophone.
    for (const id of ['America/Guadeloupe', 'Indian/Reunion', 'Pacific/Noumea', 'America/Montreal', 'Africa/Dakar']) expect(ZONES.some((zone) => zone.id === id), id).toBe(true);
  });

  test('d\'ouest en est, puis par ville', () => {
    const options = zoneOptions(AT);
    expect(options.map((option) => option.offset)).toEqual([...options.map((option) => option.offset)].sort((a, b) => a - b));
    expect(options[0]?.city).toBe('Honolulu');
    expect(options.at(-1)?.city).toBe('Auckland');
  });

  test('un fuseau qui n\'y est pas y entre sous le nom de sa ville ; un ancien nom n\'y fait pas de doublon', () => {
    const options = zoneOptions(AT, ['America/Argentina/Salta', 'Asia/Calcutta', null, 'Mars/Olympus_Mons']);
    expect(options).toHaveLength(ZONES.length + 1);
    expect(options.find((option) => option.id === 'America/Argentina/Salta')).toMatchObject({ city: 'Salta', region: '', offset: -180 });
    expect(zoneLabel('America/Argentina/Salta')).toBe('Salta');
    expect(zoneLabel('Asia/Calcutta')).toBe('Bombay, Inde');
  });

  test('les anciens noms désignent le fuseau de la liste', () => {
    expect(canonicalZone('Asia/Calcutta')).toBe('Asia/Kolkata');
    expect(canonicalZone('Europe/Paris')).toBe('Europe/Paris');
    expect(sameZone('Europe/Kiev', 'Europe/Kyiv')).toBe(true);
    expect(sameZone('Europe/Paris', 'Europe/Brussels')).toBe(false);
  });
});

describe('la recherche', () => {
  const options = zoneOptions(AT);
  const cities = (query: string) => searchZones(options, query).map((option) => option.city);

  test('sans accents ni majuscules, sur la ville, le pays et les villes du même fuseau', () => {
    expect(cities('montreal')).toEqual(['Montréal']);
    expect(cities('REUNION')).toEqual(['Saint-Denis']);
    expect(cities('geneve')).toEqual(['Zurich']);
    expect(cities('japon')).toEqual(['Tokyo']);
    expect(cities('new york')).toEqual(['New York']);
    expect(cities('france')).toContain('Paris');
    expect(cities('france')).toContain('Nouméa');
    expect(cities('bali')).toEqual(['Denpasar (Bali)']);
    expect(cities('denpasar')).toEqual(['Denpasar (Bali)']);
    expect(cities('ubud')).toEqual(['Denpasar (Bali)']);
  });

  test('un décalage se compare au décalage entier : « utc+1 » ne trouve pas UTC+10', () => {
    expect(cities('utc+9')).toEqual(['Séoul', 'Tokyo']);
    expect(cities('+5:30')).toEqual(['Bombay']);
    expect(cities('utc-4')).toContain('Montréal');
    expect(cities('utc+1').every((city) => !['Brisbane', 'Sydney', 'Nouméa'].includes(city))).toBe(true);
  });

  test('une recherche vide rend toute la liste ; rien ne correspond : rien', () => {
    expect(searchZones(options, '  ')).toHaveLength(options.length);
    expect(cities('atlantide')).toEqual([]);
  });
});
