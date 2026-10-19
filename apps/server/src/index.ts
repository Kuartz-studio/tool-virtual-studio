import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from 'pino';
import { createApp } from './app';
import { createAuth } from './auth/auth';
import { createInvitationService } from './auth/invitations';
import { createDb, isPgliteUrl } from './db/client';
import { runMigrations } from './db/migrate';
import { loadEnv, type Env } from './env';
import { createLogger } from './logger';
import { createMemoryMailer, createResendMailer, type Mailer } from './mail/mailer';
import { createServerEvents } from './server-events';

// Resend en production. Avec MAILER=memory rien ne part : en développement, l'objet et le lien de chaque e-mail
// s'affichent dans le journal, pour pouvoir suivre une invitation ou une réinitialisation sans boîte mail.
function createMailerFromEnv(env: Env, logger: Logger): Mailer {
  if (env.MAILER === 'resend') {
    // loadEnv exige RESEND_API_KEY et MAIL_FROM avec MAILER=resend.
    return createResendMailer({ apiKey: env.RESEND_API_KEY!, from: env.MAIL_FROM! });
  }
  if (env.NODE_ENV !== 'development') return createMemoryMailer();
  return createMemoryMailer({
    onSend: (mail) => logger.info({ to: mail.to, subject: mail.subject, link: mail.link }, 'E-mail non envoyé (MAILER=memory)'),
  });
}

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

    const mailer = createMailerFromEnv(env, logger);
    const auth = createAuth({ db, mailer, env, logger });
    const invitations = createInvitationService(db);
    const events = createServerEvents({ onError: (err) => logger.error({ err }, 'Un écouteur d\'événement a échoué') });

    const server = createServer(createApp({ env, db, auth, invitations, mailer, events, logger }));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(env.PORT, () => {
        server.off('error', reject);
        resolve();
      });
    });
    // Le port réel : PORT=0 laisse le système en choisir un libre.
    logger.info({ port: (server.address() as AddressInfo).port }, 'Serveur démarré');
  } catch (err) {
    logger.fatal({ err }, 'Démarrage impossible');
    // Le logger est muet avec NODE_ENV=test, mode dans lequel les tests e2e et le smoke test lancent le serveur compilé :
    // sans ceci, un port occupé ou une migration cassée feraient sortir le processus sans rien afficher.
    if (logger.level === 'silent') console.error('Démarrage impossible :', err);
    process.exit(1);
  }
}

void main();
