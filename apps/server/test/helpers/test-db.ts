import { createDb, type Db } from '../../src/db/client';
import { runMigrations } from '../../src/db/migrate';

// Une base PGlite neuve, en mémoire, avec les migrations appliquées.
export async function createTestDb(): Promise<Db> {
  const { db } = await createDb('memory://');
  await runMigrations(db);
  return db;
}
