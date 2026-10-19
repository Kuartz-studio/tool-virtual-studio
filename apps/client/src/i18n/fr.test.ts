import { expect, test } from 'vitest';
import { fr, t } from './fr';

test('t remplace chaque {clé} par sa valeur, et laisse une clé sans valeur telle quelle', () => {
  expect(t('Bonjour {name}', { name: 'Léa' })).toBe('Bonjour Léa');
  expect(t('{min} à {max} caractères, {min} au moins', { min: 10, max: 128 })).toBe('10 à 128 caractères, 10 au moins');
  expect(t('Bonjour {name}', {})).toBe('Bonjour {name}');
  expect(t('Sans clé')).toBe('Sans clé');
});

test('les textes attendus par les tests de bout en bout', () => {
  expect(t(fr.office.hello, { name: 'Léa' })).toBe('Bonjour Léa');
  expect(fr.join.errors.used).toMatch(/déjà utilisé/);
  expect(fr.join.signOutAndContinue).toBe('Se déconnecter et continuer');
});
