import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, SESSION_TTL_S } from '@bureau/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import type { Db } from '../db/client';
import * as schema from '../db/schema';
import type { Env } from '../env';
import type { Mailer } from '../mail/mailer';
import { invitationContext } from './invitation-context';

// Better Auth : comptes par e-mail et mot de passe, sessions en cookie, limitation des tentatives en base.
// auth.cli.ts construit son instance avec cette même fonction : la CLI de Better Auth en déduit src/db/auth-schema.ts.
// `mailer` servira aux e-mails de réinitialisation du mot de passe.
export function createAuth({ db, env }: { db: Db; mailer: Mailer; env: Env }) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    basePath: '/api/auth',
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    // `autoSignIn: true` et l'absence de `requireEmailVerification` comptent pour le verrou des invitations : avec
    // `autoSignIn: false` ou `requireEmailVerification: true`, /sign-up/email transforme le 403 du crochet
    // user.create.before en une réponse 200 générique (sans créer de compte, ni ouvrir de session).
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      autoSignIn: true,
    },
    session: { expiresIn: SESSION_TTL_S, updateAge: 86400 },
    user: {
      // `input: false` : aucun de ces champs ne peut venir du client (Better Auth refuse ou remplace une valeur envoyée).
      additionalFields: {
        role: { type: 'string', required: true, defaultValue: 'member', input: false },
        avatarKey: { type: 'string', required: false, input: false },
        lastX: { type: 'number', required: false, input: false },
        lastY: { type: 'number', required: false, input: false },
        lastDir: { type: 'string', required: false, input: false },
        disabledAt: { type: 'date', required: false, input: false },
      },
    },
    trustedOrigins: [env.APP_URL],
    advanced: { useSecureCookies: env.NODE_ENV === 'production' },
    rateLimit: { enabled: env.AUTH_RATE_LIMIT === 'on', storage: 'database' },
    databaseHooks: {
      user: {
        create: {
          // Le verrou des invitations : toute création de compte passe par ce crochet, quelle que soit la route de
          // Better Auth qui la demande. Elle n'est acceptée que dans le contexte ouvert par la route d'acceptation, après
          // vérification du jeton, et seulement pour l'adresse de l'invitation. Le compte reçoit alors le rôle de
          // l'invitation, et son adresse est vérifiée : le lien reçu par e-mail le prouve.
          before: async (user) => {
            const invitation = invitationContext.getStore();
            if (!invitation || invitation.email.toLowerCase() !== user.email.toLowerCase()) {
              throw new APIError('FORBIDDEN', { code: 'INVITATION_REQUIRED', message: 'Un compte ne peut être créé que sur invitation.' });
            }
            return { data: { ...user, emailVerified: true, role: invitation.role } };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
