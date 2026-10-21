import type { PublicConfig } from '@bureau/shared';
import { toNodeHandler } from 'better-auth/node';
import express from 'express';
import type { Logger } from 'pino';
import { adminRoutes } from './admin/admin-routes';
import type { Auth } from './auth/auth';
import { invitationRoutes } from './auth/invitation-routes';
import type { InvitationService } from './auth/invitations';
import { clientFiles } from './client-files';
import type { Db } from './db/client';
import type { Env } from './env';
import { errorHandler, notFound } from './http-errors';
import { createLogger } from './logger';
import type { Mailer } from './mail/mailer';
import { memberRoutes } from './members/member-routes';
import type { ServerEvents } from './server-events';
import type { SimHost } from './sim/sim-host';
import { simRoutes } from './sim/sim-routes';
import { testRoutes } from './testing/test-routes';

// Les dépendances de l'application. Les tâches suivantes y ajoutent ce qui leur manque.
export interface AppDeps {
  env: Env;
  db: Db;
  auth: Auth;
  invitations: InvitationService;
  mailer: Mailer;
  /** Ce que les routes disent au temps réel : membre retiré, profil modifié. */
  events: ServerEvents;
  /** Reçoit les échecs d'envoi d'e-mail des routes admin et les erreurs des requêtes. Par défaut, le journal de createLogger(env). */
  logger?: Logger;
  /** Le faux live (SIM=1) : ses routes sont sous /api/sim. Absent en production. */
  sim?: SimHost;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  const logger = deps.logger ?? createLogger(deps.env);

  // En production, le proxy de Railway se tient devant le serveur : on lui fait confiance, à lui seul (un saut), pour le
  // protocole et l'hôte d'origine (X-Forwarded-Proto, X-Forwarded-Host) et pour req.ip. La limitation des tentatives de Better
  // Auth ne passe pas par req.ip : elle lit son propre en-tête, réglé dans auth/auth.ts.
  app.set('trust proxy', 1);

  // Better Auth lit lui-même le corps de ses requêtes : son gestionnaire passe avant express.json().
  app.all('/api/auth/{*any}', toNodeHandler(deps.auth));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  // Ce que la page doit savoir avant toute session (celle de mot de passe oublié, par exemple) : comment les liens parviennent aux
  // gens. Sans authentification, et rien d'autre dans la réponse. Avant les routes qui exigent une session.
  app.get('/api/config', (_req, res) => {
    const config: PublicConfig = { mail: deps.env.MAILER };
    res.set('Cache-Control', 'no-store').json(config);
  });
  app.use('/api/invitations', invitationRoutes(deps));
  app.use('/api/admin', adminRoutes({ ...deps, logger }));
  if (deps.env.E2E === '1') app.use('/api/test', testRoutes(deps));
  if (deps.sim) app.use('/api/sim', simRoutes({ auth: deps.auth, sim: deps.sim }));
  app.use('/api', memberRoutes(deps));
  // Une adresse inconnue sous /api répond en JSON, avant le client : jamais sa page HTML.
  app.use('/api', notFound);

  // Le client compilé, en production et en e2e. En développement, c'est Vite qui le sert (apps/client/vite.config.ts).
  if (deps.env.CLIENT_DIST_DIR) app.use(clientFiles(deps.env.CLIENT_DIST_DIR));

  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
