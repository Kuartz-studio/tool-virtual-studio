import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { createDb, driverOf, type Db } from './client';
import type * as schema from './schema';

// Dossier des migrations générées par drizzle-kit (apps/server/drizzle) : deux niveaux au-dessus de src/db/
// quand le code tourne sous tsx, un seul niveau au-dessus de dist/ une fois compilé par tsup.
const DEFAULT_FOLDERS = [resolve(import.meta.dirname, '../../drizzle'), resolve(import.meta.dirname, '../drizzle')];

const journalOf = (folder: string) => join(folder, 'meta', '_journal.json');
const hasJournal = (folder: string) => existsSync(journalOf(folder));

// Applique les migrations en attente avec le migrateur de Drizzle qui correspond au pilote de createDb.
// Tant que drizzle-kit n'a rien généré (pas de drizzle/meta/_journal.json), il n'y a rien à faire.
export async function runMigrations(db: Db, migrationsFolder = DEFAULT_FOLDERS.find(hasJournal)): Promise<void> {
  if (migrationsFolder === undefined || !hasJournal(migrationsFolder)) return;
  const config = { migrationsFolder };
  switch (driverOf(db)) {
    case 'pglite': {
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      return migrate(db as PgliteDatabase<typeof schema>, config);
    }
    case 'pg': {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      return migrate(db as NodePgDatabase<typeof schema>, config);
    }
    default:
      throw new Error('runMigrations : la base de données doit avoir été créée par createDb.');
  }
}

// La commande `node dist/migrate.js` : renvoie son code de sortie. Contrairement à runMigrations, elle échoue quand elle
// ne trouve aucune migration : un déploiement livré sans le dossier drizzle/ ne doit pas passer pour réussi.
export async function migrateCommand(url: string | undefined, folders: string[] = DEFAULT_FOLDERS): Promise<number> {
  if (!url) {
    console.error('DATABASE_URL est obligatoire pour appliquer les migrations.');
    return 1;
  }
  const folder = folders.find(hasJournal);
  if (folder === undefined) {
    console.error(
      `Aucune migration trouvée (journal absent : ${folders.map(journalOf).join(', ')}). Rien n'a été appliqué.\n` +
        'Le dossier apps/server/drizzle, généré par « pnpm --filter @bureau/server db:generate », doit accompagner le serveur.',
    );
    return 1;
  }
  // Sa propre base, sans les délais de l'application : une migration peut être longue.
  const { db, close } = await createDb(url, { timeouts: false });
  try {
    await runMigrations(db, folder);
    console.log('Migrations à jour.');
  } finally {
    await close();
  }
  return 0;
}

// `node dist/migrate.js` (ou `tsx src/db/migrate.ts`) s'exécute directement. On reconnaît ce cas au nom du script
// lancé, car après tsup ce module peut se retrouver recopié dans d'autres fichiers de dist/ (index.js notamment).
if (/[\\/]migrate\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  migrateCommand(process.env.DATABASE_URL).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}
