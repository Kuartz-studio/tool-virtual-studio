import type { Role } from '@bureau/shared';
import { isAPIError } from 'better-auth/api';
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

// Le compte de la requête (null sans session valable) et les cookies que Better Auth a posés en lisant sa session.
interface Caller {
  user: SessionUser | null;
  cookies: string[];
}

// Relit le compte dans la base à chaque requête (aucun cookie mis en cache) : un rôle changé, une session supprimée ou un
// compte désactivé jouent sur la requête suivante.
//
// Better Auth prolonge la session (30 jours de plus) quand elle a plus d'un jour (`updateAge`) : getSession écrit la nouvelle
// échéance en base, et le cookie qui la porte n'existe que dans les en-têtes de sa réponse. Appelé sans `returnHeaders`, il les
// jetterait : la base serait prolongée et pas le cookie, que le navigateur supprimerait au 30e jour alors que la session vit
// encore. Ces cookies repartent donc dans notre réponse ; /api/auth/get-session ne les rattraperait pas, la session n'y serait
// plus due. Ce sont aussi, pour un cookie mort, ceux qui l'effacent du navigateur.
async function callerOf(auth: Auth, req: Request): Promise<Caller> {
  let read;
  try {
    read = await auth.api.getSession({ headers: fromNodeHeaders(req.headers), returnHeaders: true });
  } catch (err) {
    // La session a disparu entre sa lecture et sa prolongation (un retrait vient de la supprimer) : Better Auth lève alors une
    // 401 au lieu de répondre « aucune session ». Toute autre erreur (la base est tombée) reste une erreur : la lire comme 401
    // déconnecterait tout le monde.
    if (isAPIError(err) && err.statusCode === 401) return { user: null, cookies: [] };
    throw err;
  }
  const found = read.response;
  if (!found) return { user: null, cookies: read.headers.getSetCookie() };
  // Retirer un membre supprime ses sessions ; si une connexion en cours en a ouvert une juste après, le compte désactivé
  // reste refusé ici, sans que son cookie soit prolongé. Le rôle est strict : toute valeur autre que « admin » vaut membre.
  if (found.user.disabledAt) return { user: null, cookies: [] };
  const { id, name, email, role, avatarKey } = found.user;
  return {
    user: { id, name, email, role: role === 'admin' ? 'admin' : 'member', avatarKey: avatarKey ?? null },
    cookies: read.headers.getSetCookie(),
  };
}

// 401 sans session valable ; avec `adminOnly`, 403 pour un membre. `Cache-Control: no-store` : ces réponses portent des données
// privées, qu'un navigateur ou un relais ne doit pas garder.
function guard(auth: Auth, adminOnly: boolean): RequestHandler {
  return async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const { user, cookies } = await callerOf(auth, req);
    if (cookies.length > 0) res.append('Set-Cookie', cookies);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (adminOnly && user.role !== 'admin') {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    res.locals.user = user;
    next();
  };
}

// 401 sans session valable.
export function requireSession(auth: Auth): RequestHandler {
  return guard(auth, false);
}

// 401 sans session valable, 403 pour un membre.
export function requireAdmin(auth: Auth): RequestHandler {
  return guard(auth, true);
}
