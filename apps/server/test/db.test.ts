import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { afterAll, expect, test } from 'vitest';
import { createDb, driverOf, isPgliteUrl } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';

const tmp = mkdtempSync(join(tmpdir(), 'bureau-db-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// Un dossier de migrations tel que drizzle-kit le génère : meta/_journal.json et un fichier .sql par migration.
function writeMigrations(name: string, migrations: string[]): string {
  const dir = join(tmp, name);
  mkdirSync(join(dir, 'meta'), { recursive: true });
  const entries = migrations.map((_, idx) => ({ idx, version: '7', when: 1_700_000_000_000 + idx, tag: `000${idx}_test`, breakpoints: true }));
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ version: '7', dialect: 'postgresql', entries }));
  migrations.forEach((statements, idx) => writeFileSync(join(dir, `000${idx}_test.sql`), statements));
  return dir;
}

test('isPgliteUrl : memory:// et pglite:// seulement', () => {
  expect(['memory://', 'pglite://.data/dev', 'pglite:///var/db'].map(isPgliteUrl)).toEqual([true, true, true]);
  expect(['postgres://u@h/db', 'postgresql://u@h/db', 'http://h'].map(isPgliteUrl)).toEqual([false, false, false]);
});

test('memory:// : une base PGlite en mémoire', async () => {
  const { db, close } = await createDb('memory://');
  expect(driverOf(db)).toBe('pglite');
  expect((await db.execute(sql`select 1 as n`)).rows).toEqual([{ n: 1 }]);
  await close();
});

test('pglite://<dossier> : crée le dossier, et les données survivent à la fermeture', async () => {
  const url = `pglite://${join(tmp, 'a', 'b', 'dev')}`;   // les dossiers parents n'existent pas encore
  const first = await createDb(url);
  await first.db.execute(sql`create table note (id int primary key)`);
  await first.db.execute(sql`insert into note values (1)`);
  await first.close();

  const second = await createDb(url);
  expect((await second.db.execute(sql`select id from note`)).rows).toEqual([{ id: 1 }]);
  await second.close();
});

test('pglite:// sans dossier → erreur explicite', async () => {
  await expect(createDb('pglite://')).rejects.toThrow(/dossier/);
});

test('toute autre URL : pool node-postgres', async () => {
  const { db, close } = await createDb('postgres://bureau:bureau@127.0.0.1:1/bureau');   // rien n'écoute sur le port 1
  expect(driverOf(db)).toBe('pg');
  await expect(db.execute(sql`select 1`)).rejects.toThrow(/select 1/);
  await close();
});

test('runMigrations applique les migrations dans l\'ordre, une seule fois', async () => {
  const folder = writeMigrations('migrations', [
    'CREATE TABLE "probe" ("id" integer PRIMARY KEY NOT NULL);',
    'INSERT INTO "probe" ("id") VALUES (7);',
  ]);
  const { db, close } = await createDb('memory://');
  await runMigrations(db, folder);
  await runMigrations(db, folder);   // rejouer la première migration échouerait : la table existe déjà
  expect((await db.execute(sql`select id from probe`)).rows).toEqual([{ id: 7 }]);
  await close();
});

test('runMigrations ne fait rien sans migration générée', async () => {
  const empty = join(tmp, 'vide');
  mkdirSync(empty);
  const { db, close } = await createDb('memory://');
  await runMigrations(db, empty);
  await runMigrations(db, join(tmp, 'inexistant'));
  expect((await db.execute(sql`select count(*)::int as n from information_schema.tables where table_schema = 'drizzle'`)).rows).toEqual([{ n: 0 }]);
  await close();
});

test('runMigrations passe par le migrateur de node-postgres pour une base PostgreSQL', async () => {
  const folder = writeMigrations('migrations-pg', ['CREATE TABLE "probe" ("id" integer PRIMARY KEY NOT NULL);']);
  const { db, close } = await createDb('postgres://bureau:bureau@127.0.0.1:1/bureau');   // rien n'écoute sur le port 1
  await expect(runMigrations(db, folder)).rejects.toThrow(/Failed query/);   // le migrateur a bien essayé de se connecter
  await close();
});

test('runMigrations refuse une base qui ne vient pas de createDb', async () => {
  const folder = writeMigrations('migrations-orpheline', ['CREATE TABLE "probe" ("id" integer PRIMARY KEY NOT NULL);']);
  await expect(runMigrations(drizzlePglite.mock(), folder)).rejects.toThrow(/createDb/);
});
