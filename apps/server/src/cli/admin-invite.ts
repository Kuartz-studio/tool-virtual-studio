import { INVITATION_TTL_MS } from '@bureau/shared';
import { emailSchema, inviteAdmin } from '../admin/invite-admin';
import { createInvitationService } from '../auth/invitations';
import { createDb, isPgliteUrl } from '../db/client';
import { runMigrations } from '../db/migrate';
import { loadEnv, type Env } from '../env';
import { createMemoryMailer, createResendMailer, type Mailer } from '../mail/mailer';

const USAGE = 'Usage : pnpm --filter @bureau/server admin:invite <adresse e-mail>';

function createMailerFromEnv(env: Env): Mailer {
  // loadEnv exige RESEND_API_KEY et MAIL_FROM avec MAILER=resend.
  return env.MAILER === 'resend' ? createResendMailer({ apiKey: env.RESEND_API_KEY!, from: env.MAIL_FROM! }) : createMemoryMailer();
}

// La commande `pnpm --filter @bureau/server admin:invite <adresse>` : crée une invitation admin pour cette adresse, l'envoie par
// e-mail et affiche le lien. C'est ainsi que naît le premier admin, avant qu'un panneau d'administration soit accessible.
// Renvoie le code de sortie : 0 si l'invitation est créée et envoyée, 1 sinon, avec un message en français sur stderr.
export async function adminInviteCommand(args: string[], source: Record<string, string | undefined> = process.env): Promise<number> {
  if (args.length !== 1) {
    console.error(USAGE);
    return 1;
  }
  const email = emailSchema.safeParse(args[0]);
  if (!email.success) {
    console.error(`« ${args[0]} » n'est pas une adresse e-mail valide.\n${USAGE}`);
    return 1;
  }

  let env: Env;
  try {
    env = loadEnv(source);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }
  if (env.DATABASE_URL.startsWith('memory://')) {
    console.error('DATABASE_URL=memory:// désigne une base qui disparaît à la fin de la commande : l\'invitation serait perdue.\nUtiliser pglite://<dossier> ou l\'URL d\'une base PostgreSQL.');
    return 1;
  }
  if (isPgliteUrl(env.DATABASE_URL)) {
    // PGlite n'accepte qu'un processus par dossier : le serveur de développement et cette commande, ouverts ensemble sur le
    // même dossier, écraseraient les écritures l'un de l'autre.
    console.error(
      'Attention : DATABASE_URL désigne une base PGlite locale. Arrêter le serveur de développement avant de lancer cette commande :\n' +
        'deux processus sur le même dossier PGlite perdent des écritures.',
    );
  }

  let close: (() => Promise<void>) | undefined;
  try {
    const database = await createDb(env.DATABASE_URL);
    close = database.close;
    // Un dossier PGlite neuf n'a pas encore de tables (le serveur les crée à son démarrage) ; avec PostgreSQL, les migrations
    // sont appliquées par `node dist/migrate.js` avant le serveur.
    if (isPgliteUrl(env.DATABASE_URL)) await runMigrations(database.db);

    const { link } = await inviteAdmin(email.data, { invitations: createInvitationService(database.db), mailer: createMailerFromEnv(env), env });
    const days = Math.round(INVITATION_TTL_MS / (24 * 3600 * 1000));
    console.log(`Invitation admin créée pour ${email.data}, valable ${days} jours.`);
    console.log(
      env.MAILER === 'resend'
        ? `E-mail envoyé à ${email.data}.`
        : 'Aucun e-mail envoyé (MAILER=memory) : transmettre le lien ci-dessous à la personne.',
    );
    console.log(`Lien : ${link}`);
    return 0;
  } catch (err) {
    console.error(`Invitation impossible : ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await close?.();
  }
}

// `tsx src/cli/admin-invite.ts` ou `node dist/cli/admin-invite.js` s'exécutent directement. On reconnaît ce cas au nom du script
// lancé : importé par un test, ce module ne lance rien.
if (/[\\/]admin-invite\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  adminInviteCommand(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}
