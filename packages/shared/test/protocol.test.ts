import { expect, test } from 'vitest';
import { moveSchema, chatSendSchema, statusSchema, displayNameSchema, isAvatarKey } from '../src';

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
test('avatars', () => { expect(isAvatarKey('dev-red')).toBe(true); expect(isAvatarKey('nope')).toBe(false); });
