import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
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

// Les délais du pool node-postgres : 5 s pour obtenir une connexion, 10 s pour une instruction. Sans eux, une base qui ne répond plus
// (bloquée, réseau coupé) bloquerait tout avec elle : les arrivées au bureau, l'historique du chat, les enregistrements périodiques des
// positions, l'arrêt du serveur. La requête en retard échoue (« timeout exceeded when trying to connect », « canceling statement due to
// statement timeout »), comme une base tombée.
// - statement_timeout est le délai de la base : elle annule elle-même l'instruction, et l'erreur arrive au client. C'est le délai qui
//   compte. query_timeout, côté client, laisserait l'instruction courir : pg abandonne les requêtes en attente mais pas celle qui
//   s'exécute, et Drizzle annule alors une transaction (ROLLBACK en file) et rend la connexion au pool sans erreur ; si l'instruction
//   finit plus tard, la connexion revient au pool avec sa transaction encore ouverte, et les écritures suivantes n'y sont jamais validées.
// - query_timeout (15 s) n'est donc qu'un filet, pour un réseau coupé où la base ne peut pas répondre : plus long que statement_timeout,
//   pour que l'erreur de la base passe en premier.
// - idle_in_transaction_session_timeout : la base ferme la connexion d'une transaction restée ouverte sans rien faire 30 s ; le pool
//   la jette. La seule transaction du serveur (retirer un membre) enchaîne ses instructions sans attente.
const POOL_TIMEOUTS = {
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  query_timeout: 15_000,
  idle_in_transaction_session_timeout: 30_000,
};

// La base Drizzle d'un client PGlite déjà ouvert : celui de createDb, ou, dans les tests, une copie d'une base déjà migrée.
export async function pgliteDb(client: PGlite): Promise<Db> {
  const { drizzle } = await import('drizzle-orm/pglite');
  return withDriver(drizzle(client, { schema }), 'pglite');
}

// `memory://` : PGlite en mémoire (tests, e2e). `pglite://<dossier>` : PGlite enregistré dans ce dossier,
// relatif au dossier de travail (développement local, sans Docker). Toute autre URL : pool node-postgres, avec ses délais
// (POOL_TIMEOUTS), sauf `timeouts: false` : la commande de migration, dont une étape peut être longue. PGlite n'en a pas.
// Les pilotes sont chargés à la demande, pour ne charger que celui dont on a besoin.
export async function createDb(url: string, { timeouts = true }: { timeouts?: boolean } = {}): Promise<{ db: Db; close(): Promise<void> }> {
  if (isPgliteUrl(url)) {
    const { PGlite } = await import('@electric-sql/pglite');
    let dataDir = MEMORY_PREFIX;
    if (url.startsWith(PGLITE_PREFIX)) {
      const folder = url.slice(PGLITE_PREFIX.length);
      if (folder === '') throw new Error('DATABASE_URL : pglite:// doit être suivie d\'un dossier, par exemple pglite://.data/dev');
      dataDir = resolve(folder);
      mkdirSync(dataDir, { recursive: true });   // PGlite ne crée pas les dossiers parents
    }
    const client = await PGlite.create(dataDir);
    return { db: await pgliteDb(client), close: () => client.close() };
  }

  const [{ default: pg }, { drizzle }] = await Promise.all([import('pg'), import('drizzle-orm/node-postgres')]);
  const pool = new pg.Pool({ connectionString: url, ...(timeouts ? POOL_TIMEOUTS : {}) });
  // Sans écouteur, l'erreur d'une connexion inactive (base redémarrée, réseau coupé) ferait tomber le processus.
  pool.on('error', (err) => console.error('Erreur sur une connexion inactive de la base de données :', err.message));
  return { db: withDriver(drizzle(pool, { schema }), 'pg'), close: () => pool.end() };
}
