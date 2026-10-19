import { toNodeHandler } from 'better-auth/node';
import express from 'express';
import type { Auth } from './auth/auth';
import { invitationRoutes } from './auth/invitation-routes';
import type { InvitationService } from './auth/invitations';
import type { Db } from './db/client';
import type { Env } from './env';

// Les dépendances de l'application. Les tâches suivantes y ajoutent le mailer, les événements, etc.
export interface AppDeps {
  env: Env;
  db: Db;
  auth: Auth;
  invitations: InvitationService;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();

  // Better Auth lit lui-même le corps de ses requêtes : son gestionnaire passe avant express.json().
  app.all('/api/auth/{*any}', toNodeHandler(deps.auth));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/invitations', invitationRoutes(deps));

  return app;
}
