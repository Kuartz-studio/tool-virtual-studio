import { eq } from 'drizzle-orm';
import type { Auth } from '../auth/auth';
import { invitationContext } from '../auth/invitation-context';
import { isPgliteUrl, type Db } from '../db/client';
import { user } from '../db/schema';
import type { Env } from '../env';

// Le compte de test du faux live : un admin avec un identifiant et un mot de passe que l'on retient, pour entrer au bureau sans passer
// par une invitation. L'identifiant est une adresse (la connexion en demande une) en `.test`, un domaine réservé qui n'existe pas : aucun
// e-mail ne peut y arriver. Le mot de passe est le plus court que l'appli accepte (PASSWORD_MIN_LENGTH).
export const SIM_ACCOUNT = { email: 'admin@bureau.test', password: '1234567890', name: 'Admin' } as const;

// Seulement avec le faux live, et sur une base locale (PGlite, en mémoire ou dans un dossier) : jamais sur un PostgreSQL, où un compte au
// mot de passe connu de tous n'a rien à faire. SIM=1 est de toute façon refusée en production (env.ts).
export function wantsSimAccount(env: Pick<Env, 'SIM' | 'DATABASE_URL'>): boolean {
  return env.SIM === '1' && isPgliteUrl(env.DATABASE_URL);
}

// Crée le compte de test s'il n'existe pas (rôle admin, par le chemin de création des comptes de l'appli, comme une invitation
// acceptée). S'il existe déjà, il n'est pas touché : son mot de passe a pu être changé, et c'est le choix de la personne.
export async function ensureSimAccount({ db, auth }: { db: Db; auth: Auth }): Promise<'created' | 'exists'> {
  const [found] = await db.select({ id: user.id }).from(user).where(eq(user.email, SIM_ACCOUNT.email));
  if (found) return 'exists';
  // Le crochet de création de compte (auth.ts) n'accepte que ce contexte : le même que celui d'une invitation acceptée.
  const response = await invitationContext.run({ email: SIM_ACCOUNT.email, role: 'admin' }, () =>
    auth.api.signUpEmail({ body: { ...SIM_ACCOUNT }, asResponse: true }),
  );
  if (!response.ok) throw new Error(`Compte de test du faux live impossible à créer (${response.status}).`);
  return 'created';
}
