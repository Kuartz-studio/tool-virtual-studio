import { useCallback, useEffect, useRef, useState } from 'react';
import { authClient } from './auth-client';

// Le compte de la session, tel que l'interface s'en sert.
export interface SessionUser {
  id: string;
  name: string;
  email: string;
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
      else if (data) next = { status: 'signedIn', user: { id: data.user.id, name: data.user.name, email: data.user.email } };
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
