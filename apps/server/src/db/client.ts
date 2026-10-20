import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Assume } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

// Le résultat de `execute` n'a pas la même forme avec PGlite et avec node-postgres, mais les deux donnent des `rows`.
interface Rows<TRow> {
  rows: TRow[];
}
interface RowsResultHKT extends PgQueryResultHKT {
  type: Rows<Assume<this['row'], Record<string, unknown>>>;
}

// Base Drizzle commune à PGlite et à node-postgres, avec le schéma complet (db.query.user, etc.).
export type Db = PgDatabase<RowsResultHKT, typeof schema>;

// Le pilote avec lequel createDb a créé une base : runMigrations en déduit le migrateur de Drizzle à utiliser.
export type DbDriver = 'pglite' | 'pg';
const drivers = new WeakMap<Db, DbDriver>();

export function driverOf(db: Db): DbDriver | undefined {
  return drivers.get(db);
}

function withDriver(db: Db, driver: DbDriver): Db {
  drivers.set(db, driver);
  return db;
}

const MEMORY_PREFIX = 'memory://';
const PGLITE_PREFIX = 'pglite://';

// `memory://` et `pglite://<dossier>` désignent une base PGlite embarquée, sans serveur PostgreSQL.
export function isPgliteUrl(url: string): boolean {
  return url.startsWith(MEMORY_PREFIX) || url.startsWith(PGLITE_PREFIX);
}

// Les délais du pool node-postgres : 5 s pour obtenir une connexion, 10 s pour la réponse d'une requête. Sans eux, une base qui ne
// répond plus (bloquée, réseau coupé) bloquerait tout avec elle : les arrivées au bureau, l'historique du chat, les enregistrements
// périodiques des positions, l'arrêt du serveur. La requête en retard échoue (« timeout exceeded when trying to connect », « Query
// read timeout »), comme une base tombée.
const POOL_TIMEOUTS = { connectionTimeoutMillis: 5_000, query_timeout: 10_000 };

// `memory://` : PGlite en mémoire (tests, e2e). `pglite://<dossier>` : PGlite enregistré dans ce dossier,
// relatif au dossier de travail (développement local, sans Docker). Toute autre URL : pool node-postgres, avec ses délais
// (POOL_TIMEOUTS), sauf `timeouts: false` : la commande de migration, dont une étape peut être longue. PGlite n'en a pas.
// Les pilotes sont chargés à la demande, pour ne charger que celui dont on a besoin.
export async function createDb(url: string, { timeouts = true }: { timeouts?: boolean } = {}): Promise<{ db: Db; close(): Promise<void> }> {
  if (isPgliteUrl(url)) {
    const [{ PGlite }, { drizzle }] = await Promise.all([import('@electric-sql/pglite'), import('drizzle-orm/pglite')]);
    let dataDir = MEMORY_PREFIX;
    if (url.startsWith(PGLITE_PREFIX)) {
      const folder = url.slice(PGLITE_PREFIX.length);
      if (folder === '') throw new Error('DATABASE_URL : pglite:// doit être suivie d\'un dossier, par exemple pglite://.data/dev');
      dataDir = resolve(folder);
      mkdirSync(dataDir, { recursive: true });   // PGlite ne crée pas les dossiers parents
    }
    const client = await PGlite.create(dataDir);
    return { db: withDriver(drizzle(client, { schema }), 'pglite'), close: () => client.close() };
  }

  const [{ default: pg }, { drizzle }] = await Promise.all([import('pg'), import('drizzle-orm/node-postgres')]);
  const pool = new pg.Pool({ connectionString: url, ...(timeouts ? POOL_TIMEOUTS : {}) });
  // Sans écouteur, l'erreur d'une connexion inactive (base redémarrée, réseau coupé) ferait tomber le processus.
  pool.on('error', (err) => console.error('Erreur sur une connexion inactive de la base de données :', err.message));
  return { db: withDriver(drizzle(pool, { schema }), 'pg'), close: () => pool.end() };
}
