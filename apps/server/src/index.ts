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
import { createMemoryMailer, createNoneMailer, createResendMailer, type Mailer } from './mail/mailer';
import { attachRealtime, loadOfficeMap, type Realtime } from './realtime/io';
import { createServerEvents } from './server-events';
import { SIM_ACCOUNT, ensureSimAccount, wantsSimAccount } from './sim/sim-account';
import { createSimHost } from './sim/sim-host';

// Resend ou, sans e-mail, none en production. Avec MAILER=none, rien ne part et rien n'est journalisé : l'admin copie les liens
// depuis l'appli. Avec MAILER=memory rien ne part non plus : en développement, l'objet et le lien de chaque e-mail s'affichent
// dans le journal, pour pouvoir suivre une invitation ou une réinitialisation sans boîte mail.
function createMailerFromEnv(env: Env, logger: Logger): Mailer {
  if (env.MAILER === 'resend') {
    // loadEnv exige RESEND_API_KEY et MAIL_FROM avec MAILER=resend.
    return createResendMailer({ apiKey: env.RESEND_API_KEY!, from: env.MAIL_FROM! });
  }
  if (env.MAILER === 'none') return createNoneMailer();
  if (env.NODE_ENV !== 'development') return createMemoryMailer();
  return createMemoryMailer({
    onSend: (mail) => logger.info({ to: mail.to, subject: mail.subject, link: mail.link }, 'E-mail non envoyé (MAILER=memory)'),
  });
}

// L'arrêt propre, sur SIGTERM (Railway, à chaque déploiement) et SIGINT (Ctrl+C). Node tourne en processus 1 dans le conteneur :
// sans écouteur, il ignorerait SIGTERM. stop() enregistre la position de chacun, puis ferme les sockets (les navigateurs se
// reconnecteront seuls à la nouvelle version, et y liront cette position) et le serveur HTTP ; la base est fermée ensuite, et le
// processus sort avec le code 0. Un second signal pendant l'arrêt ne relance rien.
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
    const events = createServerEvents({ onError: (err) => logger.error({ err }, 'Un écouteur d\'événement a échoué') });
    const auth = createAuth({ db, mailer, env, logger, events });
    const invitations = createInvitationService(db);
    // Le faux live (SIM=1, base locale) : un compte de test, pour entrer sans invitation. Son identifiant est dans le journal.
    if (wantsSimAccount(env)) {
      const outcome = await ensureSimAccount({ db, auth });
      logger.info(`Faux live : compte de test ${SIM_ACCOUNT.email} / ${SIM_ACCOUNT.password} (${outcome === 'created' ? 'créé' : 'déjà là'})`);
    }

    // Le faux live (SIM=1) : ses routes sont dans l'application, ses personnes fictives dans le temps réel.
    const sim = env.SIM === '1' ? createSimHost(env) : undefined;

    const server = createServer(createApp({ env, db, auth, invitations, mailer, events, logger, sim }));
    // Le temps réel partage le serveur HTTP de l'application : /socket.io, sur la même origine que le client et /api.
    const realtime = attachRealtime(server, { auth, db, map, mapKey: env.MAP_KEY, events, env, logger, sim });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      const listening = () => {
        server.off('error', reject);
        resolve();
      };
      if (env.LISTEN_HOST) server.listen(env.PORT, env.LISTEN_HOST, listening);
      else server.listen(env.PORT, listening);
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
