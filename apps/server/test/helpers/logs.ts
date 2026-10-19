import { Writable } from 'node:stream';
import { pino } from 'pino';

// Un journal pino dont on garde les lignes (objets JSON), pour vérifier ce que le serveur journalise.
export function captureLogs() {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  return { logger: pino({ level: 'info' }, stream), lines };
}
