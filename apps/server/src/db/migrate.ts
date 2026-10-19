import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { createDb, driverOf, type Db } from './client';

// Dossier des migrations générées par drizzle-kit (apps/server/drizzle) : deux niveaux au-dessus de src/db/
// quand le code tourne sous tsx, un seul niveau au-dessus de dist/ une fois compilé par tsup.
const DEFAULT_FOLDERS = [resolve(import.meta.dirname, '../../drizzle'), resolve(import.meta.dirname, '../drizzle')];

const hasJournal = (folder: string) => existsSync(join(folder, 'meta', '_journal.json'));

// Applique les migrations en attente avec le migrateur de Drizzle qui correspond au pilote de createDb.
// Tant que drizzle-kit n'a rien généré (pas de drizzle/meta/_journal.json), il n'y a rien à faire.
export async function runMigrations(db: Db, migrationsFolder = DEFAULT_FOLDERS.find(hasJournal)): Promise<void> {
  if (migrationsFolder === undefined || !hasJournal(migrationsFolder)) return;
  const config = { migrationsFolder };
  switch (driverOf(db)) {
    case 'pglite': {
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      return migrate(db as PgliteDatabase, config);
    }
    case 'pg': {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      return migrate(db as NodePgDatabase, config);
    }
    default:
      throw new Error('runMigrations : la base de données doit avoir été créée par createDb.');
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL est obligatoire pour appliquer les migrations.');
    process.exit(1);
  }
  const { db, close } = await createDb(url);
  try {
    await runMigrations(db);
    console.log('Migrations à jour.');
  } finally {
    await close();
  }
}

// `node dist/migrate.js` (ou `tsx src/db/migrate.ts`) s'exécute directement. On reconnaît ce cas au nom du script
// lancé, car après tsup ce module peut se retrouver recopié dans d'autres fichiers de dist/ (index.js notamment).
if (/[\\/]migrate\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
