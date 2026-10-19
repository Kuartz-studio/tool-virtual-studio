import type { IncomingHttpHeaders } from 'node:http';
import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import { logServerError } from '../logger';
import type { RateLimiter } from '../rate-limit';
import type { SocketData, TypedSocket } from './io';

// Les refus de la poignée de main, que le client lit dans `connect_error` (err.message). Après un refus, le client ne réessaie
// pas de lui-même.
// - unauthorized : pas de session valable (aucun cookie, session expirée ou supprimée) : retour à la page de connexion ;
// - disabled : le compte a été retiré ;
// - rate_limited : plus de SOCKET_CONNECT_RATE.max connexions par fenêtre pour ce compte ;
// - unavailable : la session n'a pas pu être lue (base de données en panne, par exemple) : réessayer plus tard.
export type SocketRefusal = 'unauthorized' | 'disabled' | 'rate_limited' | 'unavailable';

// Le compte de la poignée de main, relu en base à chaque connexion (et à chaque reprise de connexion), ou la raison du refus.
//
// `disableRefresh` : Better Auth prolonge une session de plus d'un jour quand il la lit, et ne livre le cookie prolongé que dans
// les en-têtes de sa réponse. Une poignée de main Socket.io n'a pas de réponse où le poser : la prolongation serait écrite en base
// sans que le cookie du navigateur suive (require-session.ts). On la laisse donc aux routes HTTP, qui renvoient le cookie.
async function identify(auth: Auth, limiter: RateLimiter, headers: IncomingHttpHeaders): Promise<SocketData | SocketRefusal> {
  let found;
  try {
    found = await auth.api.getSession({ headers: fromNodeHeaders(headers), query: { disableRefresh: true } });
  } catch (err) {
    // Une session disparue pendant sa lecture fait lever une 401 à Better Auth : c'est une session absente. Toute autre erreur
    // (la base est tombée) n'en est pas une : la lire comme 401 renverrait tout le monde à la page de connexion.
    if (isAPIError(err) && err.statusCode === 401) return 'unauthorized';
    throw err;
  }
  if (!found) return 'unauthorized';
  if (found.user.disabledAt) return 'disabled';
  // Par compte, jamais par adresse : un rechargement en boucle ou un client qui se reconnecte sans fin est arrêté.
  if (!limiter.take(found.user.id)) return 'rate_limited';
  const { id, name, avatarKey, role } = found.user;
  return { userId: id, name, avatarKey: avatarKey ?? null, role: role === 'admin' ? 'admin' : 'member' };
}

// Le middleware `io.use` : pose socket.data (le compte) ou refuse la connexion. Une erreur inattendue est journalisée et refuse
// la connexion (`unavailable`) sans rien faire tomber.
export function socketAuth(d: { auth: Auth; limiter: RateLimiter; logger: Logger }) {
  return (socket: TypedSocket, next: (err?: Error) => void): void => {
    identify(d.auth, d.limiter, socket.request.headers).then(
      (result) => {
        if (typeof result === 'string') {
          next(new Error(result));
          return;
        }
        socket.data = result;
        next();
      },
      (err: unknown) => {
        logServerError(d.logger, { err }, 'Session d\'une connexion temps réel illisible');
        next(new Error('unavailable' satisfies SocketRefusal));
      },
    );
  };
}
