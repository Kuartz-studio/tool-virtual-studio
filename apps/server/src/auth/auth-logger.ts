import type { BetterAuthOptions } from 'better-auth';
import type { Logger } from 'pino';
import { logServerError } from '../logger';

// Les journaux de Better Auth rejoignent ceux du serveur (une ligne JSON, `source: 'better-auth'`, muets en test) au lieu de
// s'écrire en texte sur la console. Une erreur garde sa pile (clé `err`) ; les autres arguments vont dans `details`.
//
// Pas de `level` : Better Auth garde alors son seuil par défaut (warn), et ne journalise en erreur que ses vraies erreurs
// (une route qui répond 500). Avec un niveau explicite, il journaliserait aussi en erreur chaque refus ordinaire (401, 403…).
export function betterAuthLogger(logger: Logger): NonNullable<BetterAuthOptions['logger']> {
  const scoped = logger.child({ source: 'better-auth' });
  return {
    log(level, message, ...args) {
      // Better Auth passe parfois l'erreur elle-même en guise de message.
      const all: unknown[] = typeof message === 'string' ? args : [message, ...args];
      const err = all.find((arg) => arg instanceof Error);
      const details = all.filter((arg) => !(arg instanceof Error));
      const fields = { ...(err !== undefined && { err }), ...(details.length > 0 && { details }) };
      const text = typeof message === 'string' ? message : err instanceof Error ? err.message : String(message);
      if (level === 'error') logServerError(scoped, fields, text);
      else scoped[level](fields, text);
    },
  };
}
