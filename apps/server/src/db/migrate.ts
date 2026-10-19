import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { PgDialect, PgSession } from 'drizzle-orm/pg-core';
import { createDb, type Db } from './client';

// Dossier des migrations générées par drizzle-kit (apps/server/drizzle) : deux niveaux au-dessus de src/db/
// quand le code tourne sous tsx, un seul niveau au-dessus de dist/ une fois compilé par tsup.
const DEFAULT_FOLDERS = [resolve(import.meta.dirname, '../../drizzle'), resolve(import.meta.dirname, '../drizzle')];

const hasJournal = (folder: string) => existsSync(join(folder, 'meta', '_journal.json'));

// Applique les migrations en attente, sur PGlite comme sur PostgreSQL. Tant que drizzle-kit n'a rien généré
// (pas de drizzle/meta/_journal.json), il n'y a rien à faire.
export async function runMigrations(db: Db, migrationsFolder = DEFAULT_FOLDERS.find(hasJournal)): Promise<void> {
  if (migrationsFolder === undefined || !hasJournal(migrationsFolder)) return;
  // Les migrateurs de drizzle-orm pour PGlite et pour node-postgres font exactement ceci ; le faire ici évite
  // de choisir un migrateur selon le pilote.
  const { dialect, session } = db as unknown as { dialect: PgDialect; session: PgSession };
  await dialect.migrate(readMigrationFiles({ migrationsFolder }), session, { migrationsFolder });
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
