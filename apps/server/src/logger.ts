import { pino, type Logger } from 'pino';
import type { Env } from './env';

// Journaux structurés (une ligne JSON par événement), muets pendant les tests.
export function createLogger(env: Pick<Env, 'NODE_ENV'>): Logger {
  return pino({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' });
}
