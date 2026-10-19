import { onTestFinished } from 'vitest';
import { createDb, type Db } from '../../src/db/client';
import { runMigrations } from '../../src/db/migrate';

// Une base PGlite neuve, en mémoire, avec les migrations appliquées.
// Créée pendant un test (ou dans son beforeEach), elle est fermée à la fin de ce test : chaque base ouverte garde
// environ 80 Mo, et un fichier qui en crée une par test finirait sinon par occuper plusieurs Go. Créée dans un
// beforeAll (onTestFinished refuse alors de s'inscrire), elle reste ouverte jusqu'à la fin du fichier.
export async function createTestDb(): Promise<Db> {
  const { db, close } = await createDb('memory://');
  try {
    onTestFinished(() => close());
  } catch {
    // Hors d'un test : la base sert à tout le fichier.
  }
  await runMigrations(db);
  return db;
}
