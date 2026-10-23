import { describe, expect, test } from 'vitest';
import { ACTIVITY_ICONS, DEFAULT_MODES, activityInputSchema, buildOfficeTiledMap, parseOfficeMap, placeByKey } from '../src';

const map = parseOfficeMap(buildOfficeTiledMap());
const byLabel = (label: string) => DEFAULT_MODES.find((mode) => mode.label === label)!;

describe('les modes par défaut', () => {
  test('Manger, Sport, Concentration, dans cet ordre ; « Disponible » n\'en est pas un (c\'est l\'absence de mode)', () => {
    expect(DEFAULT_MODES.map((mode) => mode.label)).toEqual(['Manger', 'Sport', 'Concentration']);
  });

  test('Concentration ferme la porte seulement : on entend et on est entendu, rien ne bouge', () => {
    expect(byLabel('Concentration')).toMatchObject({ color: '#6d28d9', icon: 'headphones', allowEntry: false, hear: true, heard: true });
    expect(byLabel('Concentration')).not.toHaveProperty('place');
  });

  test('Sport coupe les deux sens (on n\'entend ni n\'est entendu) et vise la salle de sport', () => {
    expect(byLabel('Sport')).toMatchObject({ color: '#f97316', icon: 'dumbbell', allowEntry: true, hear: false, heard: false, place: 'gym' });
  });

  test('Manger coupe les deux sens, sans fermer la porte ni bouger', () => {
    expect(byLabel('Manger')).toMatchObject({ icon: 'utensils', allowEntry: true, hear: false, heard: false });
    expect(byLabel('Manger')).not.toHaveProperty('place');
  });

  test('chacun est une demande de mode valable (nom, couleur, icône de la liste, trois interrupteurs) : la route le prendrait tel quel', () => {
    for (const input of DEFAULT_MODES) {
      expect(activityInputSchema.safeParse(input).success, input.label).toBe(true);
      expect(ACTIVITY_ICONS).toContain(input.icon);
    }
  });

  test('leurs couleurs ne sont pas celles des statuts : on ne les confond pas avec Occupé, Absent ou Ne pas déranger', () => {
    for (const { color } of DEFAULT_MODES) expect(['#22c55e', '#f59e0b', '#9ca3af', '#ef4444']).not.toContain(color);
  });

  test('l\'emplacement de Sport est une destination de la grande carte', () => {
    for (const mode of DEFAULT_MODES) {
      if (mode.place === undefined) continue;
      expect(placeByKey(map, mode.place)?.destination, mode.label).toBe(true);
    }
  });
});

describe('le champ « emplacement » d\'un mode', () => {
  const base = { label: 'Muscu', color: '#f97316', allowEntry: true, hear: false, heard: false };

  test('une clé de lieu facultative, de 1 à 64 caractères', () => {
    expect(activityInputSchema.safeParse(base).success).toBe(true);
    expect(activityInputSchema.safeParse({ ...base, place: 'gym' }).success).toBe(true);
    expect(activityInputSchema.safeParse({ ...base, place: '' }).success).toBe(false);
    expect(activityInputSchema.safeParse({ ...base, place: 'x'.repeat(65) }).success).toBe(false);
    expect(activityInputSchema.safeParse({ ...base, place: 3 }).success).toBe(false);
  });

  test('trois icônes de plus : une coche, des vagues, une manette', () => {
    expect(ACTIVITY_ICONS).toEqual(expect.arrayContaining(['check', 'waves', 'gamepad-2']));
    expect(activityInputSchema.safeParse({ ...base, icon: 'gamepad-2' }).success).toBe(true);
  });
});
