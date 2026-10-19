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
import { attachRealtime, loadOfficeMap, type Realtime } from './realtime/io';
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

// L'arrêt propre, sur SIGTERM (Railway, à chaque déploiement) et SIGINT (Ctrl+C). Node tourne en processus 1 dans le conteneur :
// sans écouteur, il ignorerait SIGTERM. stop() ferme les sockets (les navigateurs se reconnecteront seuls à la nouvelle version)
// et enregistre la position de chacun, puis ferme le serveur HTTP ; la base est fermée ensuite, et le processus sort avec le code 0.
// Un second signal pendant l'arrêt ne relance rien.
function stopOnSignals({ realtime, closeDb, logger }: { realtime: Realtime; closeDb: () => Promise<void>; logger: Logger }): void {
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Arrêt demandé');
    realtime
      .stop()
      .then(() => closeDb())
      .then(
        () => {
          logger.info('Serveur arrêté');
          process.exit(0);
        },
        (err: unknown) => {
          logger.error({ err }, 'Arrêt incomplet');
          if (logger.level === 'silent') console.error('Arrêt incomplet :', err);
          process.exit(1);
        },
      );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
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
    // La carte d'abord : absente ou illisible, elle arrête le démarrage avant que la base ne soit ouverte.
    const map = loadOfficeMap(env);
    const { db, close: closeDb } = await createDb(env.DATABASE_URL);
    // Une base embarquée part d'un dossier neuf ou local : on la migre au démarrage. Avec PostgreSQL, les migrations
    // passent par `node dist/migrate.js`, lancé avant le serveur.
    if (isPgliteUrl(env.DATABASE_URL)) await runMigrations(db);

    const mailer = createMailerFromEnv(env, logger);
    const auth = createAuth({ db, mailer, env, logger });
    const invitations = createInvitationService(db);
    const events = createServerEvents({ onError: (err) => logger.error({ err }, 'Un écouteur d\'événement a échoué') });

    const server = createServer(createApp({ env, db, auth, invitations, mailer, events, logger }));
    // Le temps réel partage le serveur HTTP de l'application : /socket.io, sur la même origine que le client et /api.
    const realtime = attachRealtime(server, { auth, db, map, mapKey: env.MAP_KEY, events, env, logger });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(env.PORT, () => {
        server.off('error', reject);
        resolve();
      });
    });
    // Le port réel : PORT=0 laisse le système en choisir un libre.
    logger.info({ port: (server.address() as AddressInfo).port }, 'Serveur démarré');
    stopOnSignals({ realtime, closeDb, logger });
  } catch (err) {
    logger.fatal({ err }, 'Démarrage impossible');
    // Le logger est muet avec NODE_ENV=test, mode dans lequel les tests e2e et le smoke test lancent le serveur compilé :
    // sans ceci, un port occupé ou une migration cassée feraient sortir le processus sans rien afficher.
    if (logger.level === 'silent') console.error('Démarrage impossible :', err);
    process.exit(1);
  }
}

void main();
