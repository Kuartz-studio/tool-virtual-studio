import { pino, type Logger } from 'pino';
import type { Env } from './env';

// Journaux structurés (une ligne JSON par événement), muets pendant les tests.
export function createLogger(env: Pick<Env, 'NODE_ENV'>): Logger {
  return pino({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' });
}

// Une erreur du serveur (une requête qui échoue en 500) : dans le journal, et aussi sur la sortie d'erreur quand le journal
// est muet. Les tests e2e lancent le serveur compilé avec NODE_ENV=test : sans ceci, une erreur 500 n'y laisserait aucune trace.
export function logServerError(logger: Logger, fields: Record<string, unknown>, message: string): void {
  logger.error(fields, message);
  if (logger.level === 'silent') console.error(message, fields);
}
