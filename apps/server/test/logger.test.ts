import { expect, test } from 'vitest';
import { createLogger } from '../src/logger';

test('journaux muets pendant les tests, actifs sinon', () => {
  expect(createLogger({ NODE_ENV: 'test' }).level).toBe('silent');
  expect(createLogger({ NODE_ENV: 'development' }).level).toBe('info');
  expect(createLogger({ NODE_ENV: 'production' }).level).toBe('info');
});
