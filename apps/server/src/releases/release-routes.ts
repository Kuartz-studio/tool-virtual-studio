import { CURRENT_RELEASE, isReleaseBehind } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/require-session';
import type { Db } from '../db/client';
import { user } from '../db/schema';

// Les nouveautés de l'appli (docs/nouveautes.md) : la fenêtre « Quoi de neuf ? » se montre au compte dont la dernière version vue (lastReleaseSeen,
// qui arrive avec la session) est plus ancienne que la version en cours (CURRENT_RELEASE, packages/shared/src/releases.ts).
//
// Montée sous /api, après express.json() : POST /api/me/release-seen, quand la personne ferme la fenêtre. Le corps est ignoré : c'est la version du
// serveur qui est enregistrée, jamais un numéro venu du client. La route est idempotente (la rappeler ne change rien), et ne fait jamais reculer
// le compte : après un retour en arrière du serveur, une version vue plus récente reste celle qu'il a. → 200 { lastReleaseSeen }.
export function releaseRoutes({ auth, db }: { auth: Auth; db: Db }): Router {
  const router = Router();

  router.post('/me/release-seen', requireSession(auth), async (_req, res) => {
    const id = res.locals.user!.id;
    const [account] = await db.select({ lastReleaseSeen: user.lastReleaseSeen }).from(user).where(eq(user.id, id));
    let lastReleaseSeen = account?.lastReleaseSeen ?? null;
    if (isReleaseBehind(lastReleaseSeen)) {
      await db.update(user).set({ lastReleaseSeen: CURRENT_RELEASE }).where(eq(user.id, id));
      lastReleaseSeen = CURRENT_RELEASE;
    }
    res.json({ lastReleaseSeen });
  });

  return router;
}
