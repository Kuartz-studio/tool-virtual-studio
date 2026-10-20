import { Writable } from 'node:stream';
import { createLogger } from '../../src/logger';

// Un journal comme celui de production (createLogger : niveau info, erreurs sans les paramètres des requêtes) dont on garde les lignes
// (objets JSON), pour vérifier ce que le serveur journalise.
export function captureLogs() {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  return { logger: createLogger({ NODE_ENV: 'production' }, stream), lines };
}
