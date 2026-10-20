import type { Role } from '@bureau/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authClient } from './auth-client';

// Le compte de la session, tel que l'interface s'en sert.
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

// Le rôle du compte. Better Auth le renvoie avec la session (un champ que le serveur ajoute au compte : auth/auth.ts), sans que le
// client en connaisse le type. Seul « admin » ouvre les outils d'admin ; toute autre valeur, ou son absence, vaut membre : le serveur
// lit le rôle de la même façon (require-session.ts), et c'est lui qui refuse (403) un membre qui s'adresserait quand même à /api/admin.
function roleOf(user: object): Role {
  return (user as { role?: unknown }).role === 'admin' ? 'admin' : 'member';
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedIn'; user: SessionUser }
  | { status: 'signedOut' }
  // Le serveur n'a pas répondu : on ne sait pas.
  | { status: 'error' };

// La session, lue auprès du serveur au montage du composant, puis à chaque refresh().
//
// On ne passe pas par authClient.useSession() : sa valeur est partagée et gardée en mémoire, et Better Auth ne la relit qu'un
// moment après une connexion (10 ms plus tard) ; une page ouverte juste après une connexion, ou après la création du compte
// (une route à nous, que Better Auth ne voit pas), lirait encore « pas de session ». Relire la session à chaque fois coûte une
// requête, et c'est aussi elle qui prolonge le cookie de session (30 jours) quand il le faut.
export function useCurrentSession(): { state: SessionState; refresh: () => Promise<void> } {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  // Seule la réponse à la dernière lecture compte.
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latest.current;
    let next: SessionState;
    try {
      const { data, error } = await authClient.getSession();
      if (error) next = { status: 'error' };
      else if (data) next = { status: 'signedIn', user: { id: data.user.id, name: data.user.name, email: data.user.email, role: roleOf(data.user) } };
      else next = { status: 'signedOut' };
    } catch {
      next = { status: 'error' };
    }
    if (request === latest.current) setState(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, refresh };
}

// Toutes les 12 heures, tant que le bureau est ouvert.
export const SESSION_REFRESH_INTERVAL_MS = 12 * 3600 * 1000;

// Garde la session en vie tant que la page est ouverte : on peut rester des jours au bureau sans recharger la page, et seule une
// lecture par HTTP prolonge la session (et son cookie) ; la poignée de main du temps réel ne la prolonge jamais (le serveur la lit
// sans la renouveler, faute de réponse où poser le cookie). Better Auth la prolonge quand elle a plus d'un jour : une lecture toutes
// les 12 heures suffit. Plus de session (expirée, ou fermée par une réinitialisation du mot de passe) : `signedOut`. Un serveur
// injoignable ne dit rien : on réessaiera la fois suivante.
export function useSessionKeepAlive(signedOut: () => void): void {
  const latest = useRef(signedOut);
  useEffect(() => {
    latest.current = signedOut;
  }, [signedOut]);

  useEffect(() => {
    const timer = setInterval(() => {
      authClient.getSession().then(
        ({ data, error }) => {
          if (!error && !data) latest.current();
        },
        () => {},
      );
    }, SESSION_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}
