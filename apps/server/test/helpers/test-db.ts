import { PGlite } from '@electric-sql/pglite';
import { onTestFinished } from 'vitest';
import { pgliteDb, type Db } from '../../src/db/client';
import { runMigrations } from '../../src/db/migrate';

// Les fichiers d'une base PGlite tout juste migrée, que chaque test recharge dans une base neuve. Démarrer PGlite sur une
// base vide coûte environ 0,5 s (quatre fois plus sur la machine de la CI GitHub), recharger ces fichiers 0,1 s. Préparés
// une fois par fichier de test (Vitest recharge les modules à chaque fichier) ; la base qui a servi à les préparer est fermée.
let migrated: Promise<Blob> | undefined;

async function migratedDataDir(): Promise<Blob> {
  const client = await PGlite.create('memory://');
  try {
    await runMigrations(await pgliteDb(client));
    return await client.dumpDataDir('none');
  } finally {
    await client.close();
  }
}

// Une base PGlite neuve, en mémoire, avec les migrations appliquées.
// Créée pendant un test (ou dans son beforeEach), elle est fermée à la fin de ce test : chaque base ouverte garde
// environ 80 Mo, et un fichier qui en crée une par test finirait sinon par occuper plusieurs Go. Créée dans un
// beforeAll (onTestFinished refuse alors de s'inscrire), elle reste ouverte jusqu'à la fin du fichier.
export async function createTestDb(): Promise<Db> {
  migrated ??= migratedDataDir();
  const client = await PGlite.create({ loadDataDir: await migrated });
  try {
    onTestFinished(() => client.close());
  } catch {
    // Hors d'un test : la base sert à tout le fichier.
  }
  return pgliteDb(client);
}
