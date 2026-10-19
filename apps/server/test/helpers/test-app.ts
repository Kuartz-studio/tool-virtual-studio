import type { Role } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import request from 'supertest';
import { createApp } from '../../src/app';
import { createAuth } from '../../src/auth/auth';
import { createInvitationService } from '../../src/auth/invitations';
import type { Db } from '../../src/db/client';
import { user } from '../../src/db/schema';
import type { Env } from '../../src/env';
import { createMemoryMailer } from '../../src/mail/mailer';
import { createServerEvents } from '../../src/server-events';
import { createTestDb } from './test-db';
import { testEnv } from './test-env';

// Mot de passe des comptes créés par inviteAndAccept, sauf si le test en donne un autre.
export const TEST_PASSWORD = 'motdepasse1';

// L'application complète sur une base PGlite neuve : Better Auth, invitations et e-mails en mémoire.
// `env` remplace des variables de testEnv(), par exemple { AUTH_RATE_LIMIT: 'on' } pour tester la limitation des tentatives.
// `logger` remplace le journal muet des tests, pour vérifier ce que le serveur journalise (un échec d'envoi d'e-mail).
// `events` reçoit ce que les routes disent au temps réel : t.events.on('member:removed', …).
export async function createTestApp(o: { env?: Partial<Env>; logger?: Logger } = {}) {
  const env = testEnv(o.env);
  const db = await createTestDb();
  const mailer = createMemoryMailer();
  const auth = createAuth({ db, mailer, env, logger: o.logger });
  const invitations = createInvitationService(db);
  const events = createServerEvents();
  const app = createApp({ env, db, auth, invitations, mailer, events, logger: o.logger });

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
