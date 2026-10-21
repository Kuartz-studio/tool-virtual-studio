import { ACTIVITY_ICONS } from '@bureau/shared';
import { expect, test } from 'vitest';
import { fr } from '../i18n/fr';
import { ACTIVITY_ICON_COMPONENTS, activityIconOf } from './activity-icons';

test('chaque icône que le serveur accepte a son composant, et le client n\'en dessine pas d\'autres', () => {
  expect(Object.keys(ACTIVITY_ICON_COMPONENTS)).toEqual([...ACTIVITY_ICONS]);
  for (const name of ACTIVITY_ICONS) expect(activityIconOf(name), name).toBe(ACTIVITY_ICON_COMPONENTS[name]);
});

test('chacune a son nom français, pour les lecteurs d\'écran et les infobulles', () => {
  expect(Object.keys(fr.states.icons)).toEqual([...ACTIVITY_ICONS]);
  for (const name of ACTIVITY_ICONS) expect(fr.states.icons[name].length, name).toBeGreaterThan(2);
  expect(new Set(Object.values(fr.states.icons)).size).toBe(ACTIVITY_ICONS.length);
});

test('un nom que le client ne connaît pas, ou pas de nom : pas d\'icône (le point de la couleur)', () => {
  expect(activityIconOf(undefined)).toBeNull();
  expect(activityIconOf('banane')).toBeNull();
  expect(activityIconOf('')).toBeNull();
  // Des noms de l'objet lui-même ne sont pas des icônes.
  expect(activityIconOf('toString')).toBeNull();
  expect(activityIconOf('constructor')).toBeNull();
});
