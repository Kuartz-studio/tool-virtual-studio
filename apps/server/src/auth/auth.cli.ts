import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import type { Env } from '../env';
import type { Mailer } from '../mail/mailer';
import { createAuth } from './auth';

// Instance réservée à la CLI de Better Auth, qui en déduit les tables de src/db/auth-schema.ts. Depuis apps/server,
// avec la version de la CLI égale à celle de better-auth :
//   npx auth@1.7.11 generate --config src/auth/auth.cli.ts --output src/db/auth-schema.ts --yes
// puis `pnpm --filter @bureau/server db:generate` pour la migration. La CLI est publiée sous le nom « auth » :
// le paquet @better-auth/cli n'est plus maintenu (sa dernière version, 1.4.21, ne suit pas Better Auth 1.7).
// La configuration est celle du serveur, puisqu'elle vient de createAuth ; seuls la base (sans connexion), le mailer et
// l'environnement sont factices. AUTH_RATE_LIMIT n'y change rien : la table rateLimit dépend de `storage: 'database'`.
const env: Env = {
  NODE_ENV: 'development',
  PORT: 4000,
  APP_URL: 'http://localhost:4000',
  DATABASE_URL: 'memory://',
  BETTER_AUTH_SECRET: 'secret-factice-pour-generer-le-schema-0123456789',
  MAILER: 'memory',
  MAP_KEY: 'dev-office',
  MAPS_DIR: '',
  SIM_AUDIO_DIR: '',
  AUTH_RATE_LIMIT: 'on',
};
const mailer: Mailer = { sendInvitation: async () => {}, sendPasswordReset: async () => {} };

export const auth = createAuth({ db: drizzle.mock({ schema }), mailer, env });
