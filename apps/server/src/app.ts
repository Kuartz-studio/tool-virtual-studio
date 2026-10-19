import express from 'express';
import type { Db } from './db/client';
import type { Env } from './env';

// Les dépendances de l'application. Les tâches suivantes y ajoutent le mailer, l'authentification, etc.
export interface AppDeps {
  env: Env;
  db: Db;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}
