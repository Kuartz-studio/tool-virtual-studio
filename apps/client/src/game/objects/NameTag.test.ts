import { expect, test } from 'vitest';
import { displayName, NAME_MAX_LENGTH } from './NameTag';

test('un nom de 20 caractères au plus est affiché tel quel', () => {
  expect(NAME_MAX_LENGTH).toBe(20);
  expect(displayName('Léa')).toBe('Léa');
  expect(displayName('Marie-Hélène Durand')).toBe('Marie-Hélène Durand');
  expect(displayName('a'.repeat(20))).toBe('a'.repeat(20));
});

test('au-delà, les 20 premiers caractères puis « … »', () => {
  expect(displayName('a'.repeat(21))).toBe(`${'a'.repeat(20)}…`);
  expect(displayName('Jean-Christophe Delacroix-Martin')).toBe('Jean-Christophe Dela…');
});

test('les caractères se comptent comme on les voit : une lettre accentuée décomposée ou un emoji en est un seul', () => {
  const decomposed = 'é'.repeat(25);   // « é » écrit avec un accent combinant
  expect(displayName(decomposed)).toBe(`${'é'.repeat(20)}…`);
  const family = '👩‍👩‍👧';   // un seul emoji, fait de cinq points de code
  expect(displayName(family.repeat(20))).toBe(family.repeat(20));
  expect(displayName(family.repeat(21))).toBe(`${family.repeat(20)}…`);
});

test('pas d\'espace avant « … »', () => {
  expect(displayName(`${'a'.repeat(19)} bcd`)).toBe(`${'a'.repeat(19)}…`);
});
