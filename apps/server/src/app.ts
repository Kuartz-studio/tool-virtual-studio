import { toNodeHandler } from 'better-auth/node';
import express from 'express';
import type { Logger } from 'pino';
import { adminRoutes } from './admin/admin-routes';
import type { Auth } from './auth/auth';
import { invitationRoutes } from './auth/invitation-routes';
import type { InvitationService } from './auth/invitations';
import type { Db } from './db/client';
import type { Env } from './env';
import { createLogger } from './logger';
import type { Mailer } from './mail/mailer';
import { memberRoutes } from './members/member-routes';
import type { ServerEvents } from './server-events';

// Les dépendances de l'application. Les tâches suivantes y ajoutent ce qui leur manque.
export interface AppDeps {
  env: Env;
  db: Db;
  auth: Auth;
  invitations: InvitationService;
  mailer: Mailer;
  /** Ce que les routes disent au temps réel : membre retiré, profil modifié. */
  events: ServerEvents;
  /** Reçoit les échecs d'envoi d'e-mail des routes admin. Par défaut, le journal de createLogger(env). */
  logger?: Logger;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  const logger = deps.logger ?? createLogger(deps.env);

  // Better Auth lit lui-même le corps de ses requêtes : son gestionnaire passe avant express.json().
  app.all('/api/auth/{*any}', toNodeHandler(deps.auth));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/invitations', invitationRoutes(deps));
  app.use('/api/admin', adminRoutes({ ...deps, logger }));
  app.use('/api', memberRoutes(deps));

  return app;
}
