import { createServer } from 'node:http';
import { createApp } from './app';
import { createDb, isPgliteUrl } from './db/client';
import { runMigrations } from './db/migrate';
import { loadEnv, type Env } from './env';
import { createLogger } from './logger';

async function main(): Promise<void> {
  let env: Env;
  try {
    env = loadEnv();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  const logger = createLogger(env);

  try {
    const { db } = await createDb(env.DATABASE_URL);
    // Une base embarquée part d'un dossier neuf ou local : on la migre au démarrage. Avec PostgreSQL, les migrations
    // passent par `node dist/migrate.js`, lancé avant le serveur.
    if (isPgliteUrl(env.DATABASE_URL)) await runMigrations(db);

    const server = createServer(createApp({ env, db }));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(env.PORT, () => {
        server.off('error', reject);
        resolve();
      });
    });
    logger.info({ port: env.PORT }, 'Serveur démarré');
  } catch (err) {
    logger.fatal({ err }, 'Démarrage impossible');
    process.exit(1);
  }
}

void main();
