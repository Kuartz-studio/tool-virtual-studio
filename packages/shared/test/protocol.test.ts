import { describe, expect, test } from 'vitest';
import { ACTIVITY_ICONS, activityInputSchema, moveSchema, chatSendSchema, statusSchema, displayNameSchema, isAvatarKey, lightsSetSchema, LIGHTS_RATE_MS, LIGHT_SWITCH_REACH_TILES } from '../src';

test('move : entiers et direction connue', () => {
  expect(moveSchema.safeParse({ x: 10, y: 20, dir: 'down', moving: true }).success).toBe(true);
  expect(moveSchema.safeParse({ x: 10.5, y: 20, dir: 'down', moving: true }).success).toBe(false);
  expect(moveSchema.safeParse({ x: 10, y: 20, dir: 'north', moving: true }).success).toBe(false);
});
test('chat : espaces coupés, 1 à 500 caractères', () => {
  expect(chatSendSchema.parse({ channel: 'all', text: '  salut ' }).text).toBe('salut');
  expect(chatSendSchema.safeParse({ channel: 'all', text: '   ' }).success).toBe(false);
  expect(chatSendSchema.safeParse({ channel: 'all', text: 'a'.repeat(501) }).success).toBe(false);
});
test('statuts', () => expect(statusSchema.options).toEqual(['available', 'busy', 'away', 'dnd']));
test('nom affiché : 1 à 40 caractères', () => {
  expect(displayNameSchema.safeParse('Léa').success).toBe(true);
  expect(displayNameSchema.safeParse('a'.repeat(41)).success).toBe(false);
});
test('avatars : personnage prêt à l\'emploi, personnage assemblé, ou rien', () => {
  expect(isAvatarKey('p.01')).toBe(true);
  expect(isAvatarKey('p.20')).toBe(true);
  expect(isAvatarKey('p.21')).toBe(false);
  expect(isAvatarKey('c.3.2.1-1.1-1.0')).toBe(true);
  expect(isAvatarKey('c.3.2.1-1.0.0')).toBe(true);
  expect(isAvatarKey('c.3.2.1-99.0.0')).toBe(false);
  expect(isAvatarKey('dev-red')).toBe(false);
  expect(isAvatarKey('nope')).toBe(false);
});
test('lumière : lights:set demande un état (un booléen), rien d\'autre', () => {
  expect(lightsSetSchema.safeParse({ on: false }).success).toBe(true);
  expect(lightsSetSchema.safeParse({ on: true }).success).toBe(true);
  expect(lightsSetSchema.safeParse({ on: 'non' }).success).toBe(false);
  expect(lightsSetSchema.safeParse({ on: 0 }).success).toBe(false);
  expect(lightsSetSchema.safeParse({}).success).toBe(false);
  expect(lightsSetSchema.safeParse(null).success).toBe(false);
  expect(lightsSetSchema.parse({ on: false, by: 'moi' })).toEqual({ on: false });   // l'auteur est celui du serveur : un champ en trop est écarté
});
test('lumière : un changement par personne et par 800 ms, un interrupteur à 3 cases', () => {
  expect(LIGHTS_RATE_MS).toBe(800);
  expect(LIGHT_SWITCH_REACH_TILES).toBe(3);
});

// Les états d'activité (« modes » : Concentration, Réunion, Pause…) : un nom, une couleur, trois interrupteurs, et une icône qui est facultative.
describe('états d\'activité : l\'icône', () => {
  const base = { label: 'Pause', color: '#F59E0B', allowEntry: true, hear: true, heard: true };

  test('douze icônes, dans cet ordre (c\'est celui de la grille du formulaire)', () => {
    expect(ACTIVITY_ICONS).toEqual(['headphones', 'users', 'coffee', 'utensils', 'phone', 'pen-tool', 'code', 'book-open', 'moon', 'plane', 'dumbbell', 'music']);
  });

  test('le schéma accepte chacune d\'elles, et refuse un nom qui n\'en est pas une', () => {
    expect(activityInputSchema.parse({ ...base, icon: 'coffee' })).toMatchObject({ label: 'Pause', color: '#f59e0b', icon: 'coffee' });
    for (const icon of ACTIVITY_ICONS) expect(activityInputSchema.safeParse({ ...base, icon }).success, icon).toBe(true);
    for (const icon of ['banane', '', 'Coffee', 'coffee ', 'heart', null, 3, {}]) expect(activityInputSchema.safeParse({ ...base, icon }).success, String(icon)).toBe(false);
  });

  test('l\'icône est facultative : sans elle, l\'état est le même qu\'avant, et le champ n\'apparaît pas', () => {
    const parsed = activityInputSchema.parse(base);
    expect(parsed).toEqual({ label: 'Pause', color: '#f59e0b', allowEntry: true, hear: true, heard: true });
    expect('icon' in parsed).toBe(false);
  });
});
