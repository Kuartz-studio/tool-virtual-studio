import { resolve } from 'node:path';
import { z } from 'zod';
import { isPgliteUrl } from './db/client';

// Cartes Tiled du client. Le même chemin vaut depuis apps/server/src (tsx) et depuis apps/server/dist (tsup).
const DEFAULT_MAPS_DIR = resolve(import.meta.dirname, '../../client/public/assets/maps');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production'], { error: 'doit valoir development, test ou production' }).default('development'),
    PORT: z.coerce.number({ error: 'doit être un numéro de port (entier de 0 à 65535)' }).int().min(0).max(65535).default(3000),
    // Sans barre finale : les liens sont construits avec `${APP_URL}/chemin`.
    APP_URL: z
      .url({ protocol: /^https?$/, error: 'obligatoire, une URL http(s) comme https://bureau.exemple.fr' })
      .transform((url) => url.replace(/\/+$/, '')),
    DATABASE_URL: z.string({ error: 'obligatoire' }),
    BETTER_AUTH_SECRET: z.string({ error: 'obligatoire (32 caractères minimum)' }).min(32, '32 caractères minimum'),
    MAILER: z.enum(['resend', 'memory'], { error: 'doit valoir resend ou memory' }).default('memory'),
    RESEND_API_KEY: z.string().optional(),
    MAIL_FROM: z.string().optional(),
    // Sans les trois variables LiveKit, l'audio et la vidéo sont désactivés.
    LIVEKIT_URL: z.string().optional(),
    LIVEKIT_API_KEY: z.string().optional(),
    LIVEKIT_API_SECRET: z.string().optional(),
    MAP_KEY: z.string().default('dev-office'),
    MAPS_DIR: z.string().default(DEFAULT_MAPS_DIR),
    CLIENT_DIST_DIR: z.string().optional(),
    E2E: z.literal('1', { error: 'doit valoir 1 ou être absente' }).optional(),
    AUTH_RATE_LIMIT: z.enum(['on', 'off'], { error: 'doit valoir on ou off' }).default('on'),
  })
  .check((ctx) => {
    const env = ctx.value;
    const refuse = (name: string, message: string) => ctx.issues.push({ code: 'custom', input: env, path: [name], message });
    if (env.NODE_ENV === 'production') {
      if (isPgliteUrl(env.DATABASE_URL)) refuse('DATABASE_URL', 'memory:// et pglite:// sont refusées en production : utiliser une base PostgreSQL');
      if (env.MAILER !== 'resend') refuse('MAILER', 'doit valoir resend en production');
    }
    if (env.MAILER === 'resend') {
      if (!env.RESEND_API_KEY) refuse('RESEND_API_KEY', 'obligatoire avec MAILER=resend');
      if (!env.MAIL_FROM) refuse('MAIL_FROM', 'obligatoire avec MAILER=resend');
    }
  });

export type Env = z.infer<typeof envSchema>;

// Une variable vide (`PORT=` dans un fichier .env, par exemple) vaut une variable absente.
function withoutBlanks(src: Record<string, string | undefined>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(src)) {
    if (value !== undefined && value.trim() !== '') kept[name] = value;
  }
  return kept;
}

export function loadEnv(src: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(withoutBlanks(src));
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join('.')} : ${issue.message}`);
    throw new Error(`Configuration invalide :\n${problems.join('\n')}`);
  }
  return result.data;
}
