import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, SESSION_TTL_S } from '@bureau/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../db/client';
import * as schema from '../db/schema';
import type { Env } from '../env';
import { createLogger } from '../logger';
import type { Mailer } from '../mail/mailer';
import { betterAuthLogger } from './auth-logger';
import { invitationContext } from './invitation-context';

// Better Auth : comptes par e-mail et mot de passe, sessions en cookie, limitation des tentatives en base.
// auth.cli.ts construit son instance avec cette même fonction : la CLI de Better Auth en déduit src/db/auth-schema.ts.
// `mailer` envoie les e-mails de réinitialisation du mot de passe ; `logger` reçoit leurs échecs d'envoi et les journaux de
// Better Auth.
export function createAuth({ db, mailer, env, logger = createLogger(env) }: { db: Db; mailer: Mailer; env: Env; logger?: Logger }) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    basePath: '/api/auth',
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    logger: betterAuthLogger(logger),
    // `autoSignIn: true` et l'absence de `requireEmailVerification` comptent pour le verrou des invitations : avec
    // `autoSignIn: false` ou `requireEmailVerification: true`, /sign-up/email transforme le 403 du crochet
    // user.create.before en une réponse 200 générique (sans créer de compte, ni ouvrir de session).
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      autoSignIn: true,
      // Mot de passe oublié : le lien de l'e-mail est valable une heure, et réinitialiser le mot de passe ferme toutes les
      // sessions ouvertes du compte (une session volée ne survit pas au changement de mot de passe).
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      // L'envoi part en arrière-plan : on ne l'attend pas. Better Auth attend la promesse qu'on lui rend, et l'appel à
      // Resend (une requête réseau) rendrait la réponse bien plus lente pour une adresse qui a un compte que pour une
      // adresse inconnue : ce délai dirait quelles adresses ont un compte. La réponse est 200 dans tous les cas. Un échec
      // d'envoi est journalisé ici (sans l'adresse ni le lien, dont le jeton ouvre le compte) ; le `.catch` évite aussi
      // tout rejet non géré. Si le processus s'arrête pendant l'envoi, l'e-mail est perdu : la personne redemande un lien.
      sendResetPassword: async ({ user, url }) => {
        void mailer.sendPasswordReset({ to: user.email, link: url }).catch((err: unknown) => {
          logger.error({ err, userId: user.id }, 'Envoi de l\'e-mail de réinitialisation impossible');
        });
      },
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
    // Les routes de Better Auth qui changent le profil ou le compte répondent 404. PATCH /api/me est le seul chemin pour changer
    // son nom et son avatar : /update-user accepte n'importe quel nom (un nom de 41 caractères passe), sans displayNameSchema ni
    // la liste des avatars. Le changement d'adresse et la suppression de compte n'existent pas en V1 (désactivés par défaut :
    // on ferme aussi la route, pour qu'une option activée plus tard ne l'ouvre pas sans que quelqu'un le décide).
    disabledPaths: ['/update-user', '/change-email', '/delete-user'],
    advanced: {
      useSecureCookies: env.NODE_ENV === 'production',
      // L'adresse du client, clé de la limitation des tentatives. Railway documente X-Real-IP comme l'adresse du client, et son
      // support confirme que le proxy public l'écrase à chaque requête (forum Railway, octobre 2026). X-Forwarded-For n'est pas
      // lu : l'appelant peut y mettre l'adresse de son choix. Better Auth 1.7 n'accepte qu'un en-tête à une seule valeur : avec
      // plusieurs adresses (un X-Real-IP envoyé en double, par exemple), la requête tombe dans le seau commun des requêtes sans
      // adresse, et non dans un seau que l'appelant aurait choisi. Hors production, une requête sans adresse compte pour 127.0.0.1.
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
    },
    rateLimit: {
      enabled: env.AUTH_RATE_LIMIT === 'on',
      storage: 'database',
      // Par adresse IP et par route : 3 connexions par 10 s, 3 demandes de réinitialisation par minute. Ce sont aussi les
      // règles par défaut de Better Auth 1.7 ; on les écrit pour ne pas dépendre d'un défaut qui pourrait changer.
      customRules: {
        '/sign-in/email': { window: 10, max: 3 },
        '/request-password-reset': { window: 60, max: 3 },
      },
    },
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
      session: {
        create: {
          // Un compte désactivé (disabledAt renseigné) n'ouvre plus de session, même avec le bon mot de passe. Les sessions
          // déjà ouvertes ne passent pas par ici : c'est à la désactivation de les supprimer.
          before: async (session) => {
            const [account] = await db.select({ disabledAt: schema.user.disabledAt }).from(schema.user).where(eq(schema.user.id, session.userId));
            if (account?.disabledAt) throw new APIError('FORBIDDEN', { code: 'ACCOUNT_DISABLED', message: 'Ce compte est désactivé.' });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
