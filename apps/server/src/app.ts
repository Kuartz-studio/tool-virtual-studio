import type { PublicConfig } from '@bureau/shared';
import { toNodeHandler } from 'better-auth/node';
import express from 'express';
import type { Logger } from 'pino';
import { activityRoutes } from './activity/activity-routes';
import { createActivityService, type ActivityService } from './activity/activity-service';
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
import { progressRoutes } from './progress/progress-routes';
import { ProgressService } from './progress/progress-service';
import { releaseRoutes } from './releases/release-routes';
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
  /** Les états d'activité des personnes. Par défaut, ceux de la base. */
  activities?: ActivityService;
  /** Les clés des destinations de la carte (destinationKeys) : un mode ne peut conduire qu'à l'une d'elles. Par défaut, aucune. */
  destinations?: ReadonlySet<string>;
  /** Le faux live (SIM=1) : ses routes sont sous /api/sim. Absent en production. */
  sim?: SimHost;
  /** La progression de chacun (tâches, missions, XP, boutique). Par défaut, celle de la base ; le serveur donne la même instance au temps réel. */
  progress?: ProgressService;
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
  app.use(
    '/api',
    activityRoutes({ auth: deps.auth, events: deps.events, activities: deps.activities ?? createActivityService(deps.db), destinations: deps.destinations ?? new Set<string>() }),
  );
  app.use('/api', progressRoutes({ auth: deps.auth, events: deps.events, progress: deps.progress ?? new ProgressService(deps.db) }));
  app.use('/api', releaseRoutes({ auth: deps.auth, db: deps.db }));
  // Une adresse inconnue sous /api répond en JSON, avant le client : jamais sa page HTML.
  app.use('/api', notFound);

  // Le client compilé, en production et en e2e. En développement, c'est Vite qui le sert (apps/client/vite.config.ts).
  if (deps.env.CLIENT_DIST_DIR) app.use(clientFiles(deps.env.CLIENT_DIST_DIR));

  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
