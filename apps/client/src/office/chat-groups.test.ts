import type { ChatMessage } from '@bureau/shared';
import { expect, test } from 'vitest';
import { GROUP_WINDOW_MS, groupMessages } from './chat-groups';

const START = Date.parse('2026-10-20T10:00:00.000Z');
const at = (ms: number) => new Date(START + ms).toISOString();
const say = (id: string, userId: string, ms: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  channel: 'all',
  userId,
  name: userId,
  text: id,
  sentAt: at(ms),
  ...over,
});
const firsts = (messages: ChatMessage[]) => groupMessages(messages).map((row) => row.first);

test('une fenêtre de 3 minutes', () => {
  expect(GROUP_WINDOW_MS).toBe(180_000);
});

test('rien à grouper : une liste vide', () => {
  expect(groupMessages([])).toEqual([]);
});

test('le premier message ouvre un groupe ; les suivants du même auteur, à moins de 3 minutes l\'un de l\'autre, en sont la suite', () => {
  expect(firsts([say('a', 'bob', 0), say('b', 'bob', 60_000), say('c', 'bob', 150_000)])).toEqual([true, false, false]);
});

test('chaque ligne garde son message, dans l\'ordre', () => {
  const messages = [say('a', 'bob', 0), say('b', 'zoe', 1000)];
  expect(groupMessages(messages).map((row) => row.message)).toEqual(messages);
});

test('un autre auteur ouvre un groupe, même une seconde après ; et l\'ancien en rouvre un quand il reprend la parole', () => {
  expect(firsts([say('a', 'bob', 0), say('b', 'zoe', 1000), say('c', 'bob', 2000), say('d', 'bob', 3000)])).toEqual([true, true, true, false]);
});

test('plus de 3 minutes après le message d\'avant : un nouveau groupe ; exactement 3 minutes, non', () => {
  expect(firsts([say('a', 'bob', 0), say('b', 'bob', GROUP_WINDOW_MS)])).toEqual([true, false]);
  expect(firsts([say('a', 'bob', 0), say('b', 'bob', GROUP_WINDOW_MS + 1)])).toEqual([true, true]);
});

test('le délai se compte d\'un message au suivant, non du début du groupe : une conversation suivie reste un seul groupe', () => {
  // 0 s, 2 min 50, 5 min 30 : le dernier est à 2 min 40 du précédent.
  expect(firsts([say('a', 'bob', 0), say('b', 'bob', 170_000), say('c', 'bob', 330_000)])).toEqual([true, false, false]);
});

test('une date illisible, ou à rebours, n\'est la suite de rien', () => {
  expect(firsts([say('a', 'bob', 0), say('b', 'bob', 1000, { sentAt: 'hier' })])).toEqual([true, true]);
  expect(firsts([say('a', 'bob', 5000), say('b', 'bob', 1000)])).toEqual([true, true]);
});
