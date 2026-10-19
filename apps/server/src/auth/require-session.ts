import type { Role } from '@bureau/shared';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, RequestHandler } from 'express';
import type { Auth } from './auth';

// Le compte à qui appartient la session de la requête : requireSession et requireAdmin le posent dans res.locals.user.
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarKey: string | null;
}

declare global {
  namespace Express {
    interface Locals {
      user?: SessionUser;
    }
  }
}

// Relit le compte dans la base à chaque requête (aucun cache de cookie) : un rôle changé, une session supprimée ou un compte
// désactivé jouent sur la requête suivante. `null` quand la requête n'a pas de session valable.
async function sessionUserOf(auth: Auth, req: Request): Promise<SessionUser | null> {
  const found = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  // Retirer un membre supprime ses sessions ; si une connexion en cours en a ouvert une juste après, le compte désactivé
  // reste refusé ici. Le rôle est strict : toute valeur autre que « admin » vaut membre.
  if (!found || found.user.disabledAt) return null;
  const { id, name, email, role, avatarKey } = found.user;
  return { id, name, email, role: role === 'admin' ? 'admin' : 'member', avatarKey: avatarKey ?? null };
}

// 401 sans session valable. `Cache-Control: no-store` : ces réponses portent des données privées, qu'un navigateur ou un relais
// ne doit pas garder.
export function requireSession(auth: Auth): RequestHandler {
  return async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const user = await sessionUserOf(auth, req);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.locals.user = user;
    next();
  };
}

// 401 sans session valable, 403 pour un membre.
export function requireAdmin(auth: Auth): RequestHandler {
  return async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const user = await sessionUserOf(auth, req);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (user.role !== 'admin') {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    res.locals.user = user;
    next();
  };
}
