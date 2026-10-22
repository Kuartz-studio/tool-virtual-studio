import { destinationKeys, type Role } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import request from 'supertest';
import { createApp } from '../../src/app';
import { createAuth } from '../../src/auth/auth';
import { createInvitationService } from '../../src/auth/invitations';
import type { Db } from '../../src/db/client';
import { user } from '../../src/db/schema';
import type { Env } from '../../src/env';
import { loadOfficeMap } from '../../src/realtime/io';
import { createMemoryMailer, createNoneMailer, type Mailer } from '../../src/mail/mailer';
import { createServerEvents } from '../../src/server-events';
import type { SimHost } from '../../src/sim/sim-host';
import { createTestDb } from './test-db';
import { testEnv } from './test-env';

// Mot de passe des comptes créés par inviteAndAccept, sauf si le test en donne un autre.
export const TEST_PASSWORD = 'motdepasse1';

interface TestAppOptions {
  env?: Partial<Env>;
  logger?: Logger;
  /** Le faux live (SIM=1) : ses routes /api/sim sont montées. */
  sim?: SimHost;
}

// L'application complète sur une base PGlite neuve : Better Auth, invitations et e-mails en mémoire.
// `env` remplace des variables de testEnv(), par exemple { AUTH_RATE_LIMIT: 'on' } pour tester la limitation des tentatives.
// `logger` remplace le journal muet des tests, pour vérifier ce que le serveur journalise (un échec d'envoi d'e-mail).
// `events` reçoit ce que les routes (et Better Auth) disent au temps réel : t.events.on('member:removed', …).
export function createTestApp(o: TestAppOptions = {}) {
  return buildTestApp(createMemoryMailer(), testEnv(o.env), o.logger, o.sim);
}

// La même application sans e-mail : MAILER=none, et son mailer, dont `resetLinks` est la réserve des liens de mot de passe.
export function createNoneTestApp(o: TestAppOptions = {}) {
  return buildTestApp(createNoneMailer(), testEnv({ ...o.env, MAILER: 'none' }), o.logger, o.sim);
}

async function buildTestApp<M extends Mailer>(mailer: M, env: Env, logger: Logger | undefined, sim?: SimHost) {
  const db = await createTestDb();
  const events = createServerEvents();
  const auth = createAuth({ db, mailer, env, logger, events });
  const invitations = createInvitationService(db);
  // Les destinations de la carte de l'environnement (la grande carte en a, celle de développement n'en a pas) : un mode ne conduit qu'à l'une d'elles.
  const app = createApp({ env, db, auth, invitations, mailer, events, logger, sim, destinations: new Set(destinationKeys(loadOfficeMap(env))) });

  // Invite `email`, accepte l'invitation par la vraie route, et renvoie l'id du compte créé avec son cookie de session,
  // prêt pour `.set('Cookie', cookie)`. Par défaut : rôle membre, nom tiré de l'adresse, mot de passe TEST_PASSWORD.
  async function inviteAndAccept(email: string, opts: { role?: Role; name?: string; password?: string } = {}): Promise<{ cookie: string; userId: string }> {
    const { token } = await invitations.create({ email, role: opts.role ?? 'member', invitedBy: null });
    const res = await request(app)
      .post('/api/invitations/accept')
      .send({ token, name: opts.name ?? email.split('@')[0], password: opts.password ?? TEST_PASSWORD });
    if (res.status !== 201) throw new Error(`inviteAndAccept(${email}) : ${res.status} ${JSON.stringify(res.body)}`);
    const cookie = (res.get('Set-Cookie') ?? []).map((setCookie) => setCookie.split(';')[0]).join('; ');
    const created = await findUserByEmail(db, email);
    if (!created) throw new Error(`inviteAndAccept(${email}) : aucun compte créé`);
    return { cookie, userId: created.id };
  }

  return { app, db, env, auth, mailer, invitations, events, inviteAndAccept };
}

export function countUsers(db: Db): Promise<number> {
  return db.$count(user);
}

// Le compte de cette adresse (les comptes enregistrent les adresses en minuscules), ou undefined.
export async function findUserByEmail(db: Db, email: string) {
  const [found] = await db.select().from(user).where(eq(user.email, email.toLowerCase()));
  return found;
}
