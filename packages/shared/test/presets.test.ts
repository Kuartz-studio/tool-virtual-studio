import { describe, expect, test } from 'vitest';
import {
  ACTIVITY_ICONS,
  NORMAL_COLOR,
  PRESET_MODES,
  activityInputSchema,
  buildOfficeTiledMap,
  isPresetId,
  parseOfficeMap,
  placeByKey,
  presetById,
} from '../src';

const map = parseOfficeMap(buildOfficeTiledMap());
const byId = (id: string) => PRESET_MODES.find((mode) => mode.id === id)!;

describe('les modes tout prêts', () => {
  test('Concentration ferme la porte seulement : on entend et on est entendu, rien ne bouge', () => {
    expect(byId('preset:focus')).toMatchObject({ label: 'Concentration', color: '#6d28d9', icon: 'headphones', allowEntry: false, hear: true, heard: true });
    expect(byId('preset:focus')).not.toHaveProperty('place');
  });

  test('Sport coupe les deux sens (on n\'entend ni n\'est entendu) et vise la salle de sport', () => {
    expect(byId('preset:sport')).toMatchObject({ label: 'Sport', color: '#f97316', icon: 'dumbbell', allowEntry: true, hear: false, heard: false, place: 'gym' });
  });

  test('« Normal » n\'est pas un mode : c\'est l\'absence de mode, une tuile verte', () => {
    expect(NORMAL_COLOR).toBe('#22c55e');
    expect(PRESET_MODES.map((mode) => mode.label)).not.toContain('Normal');
  });

  test('les identifiants sont uniques, préfixés `preset:`, et ne ressemblent pas à ceux des modes qu\'on crée (des uuid)', () => {
    const ids = PRESET_MODES.map((mode) => mode.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith('preset:')).toBe(true);
      expect(isPresetId(id)).toBe(true);
    }
    expect(isPresetId('1d3b2f9e-0000-4000-8000-000000000000')).toBe(false);
    expect(isPresetId('presets')).toBe(false);
  });

  test('presetById : le mode de cet identifiant, ou rien', () => {
    expect(presetById('preset:sport')).toBe(byId('preset:sport'));
    expect(presetById('preset:inconnu')).toBeUndefined();
    expect(presetById('')).toBeUndefined();
  });

  test('chacun est une demande de mode valable (nom, couleur, icône de la liste, trois interrupteurs) : on peut le copier en mode perso tel quel', () => {
    for (const { id: _id, ...input } of PRESET_MODES) {
      const parsed = activityInputSchema.safeParse(input);
      expect(parsed.success, input.label).toBe(true);
      expect(ACTIVITY_ICONS).toContain(input.icon);
    }
  });

  test('l\'emplacement de Sport est une destination de la grande carte', () => {
    for (const mode of PRESET_MODES) {
      if (mode.place === undefined) continue;
      expect(placeByKey(map, mode.place)?.destination, mode.id).toBe(true);
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
