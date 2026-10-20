import { expect, test } from 'vitest';
import { fr, t } from './fr';

test('t remplace chaque {clé} par sa valeur, et laisse une clé sans valeur telle quelle', () => {
  expect(t('Bonjour {name}', { name: 'Léa' })).toBe('Bonjour Léa');
  expect(t('{min} à {max} caractères, {min} au moins', { min: 10, max: 128 })).toBe('10 à 128 caractères, 10 au moins');
  expect(t('Bonjour {name}', {})).toBe('Bonjour {name}');
  expect(t('Sans clé')).toBe('Sans clé');
});

test('les textes attendus par les tests de bout en bout', () => {
  expect(fr.join.errors.used).toMatch(/déjà utilisé/);
  expect(fr.join.signOutAndContinue).toBe('Se déconnecter et continuer');
  expect(fr.office.signOut).toBe('Se déconnecter');
  expect(fr.office.barLabel).toBe('Barre du bureau');
  expect(fr.office.replaced).toBe('Ouvert dans un autre onglet');
  expect(fr.office.useHere).toBe('Utiliser ici');
  expect(fr.office.people.toggle).toBe('Personnes');
  expect(fr.office.statusMenu.label).toBe('Statut');
  expect(t(fr.office.statusMenu.current, { status: fr.status.dnd })).toBe('Statut : Ne pas déranger');
  expect(fr.office.people.you).toBe('(toi)');
});

test('les statuts : Disponible, Occupé, Absent, Ne pas déranger (spec §10)', () => {
  expect(fr.status).toEqual({ available: 'Disponible', busy: 'Occupé', away: 'Absent', dnd: 'Ne pas déranger' });
});

test('le panneau Personnes compte ses lignes', () => {
  expect(t(fr.office.people.online, { count: 3 })).toBe('En ligne (3)');
  expect(t(fr.office.people.offline, { count: 0 })).toBe('Hors ligne (0)');
});
