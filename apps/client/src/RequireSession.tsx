import { createContext, useContext, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { fr } from './i18n/fr';
import { useCurrentSession, type SessionUser } from './lib/session';
import type { LoginState } from './pages/LoginPage';

const SessionUserContext = createContext<SessionUser | null>(null);

// Le compte connecté, pour les pages placées sous <RequireSession>.
export function useSessionUser(): SessionUser {
  const user = useContext(SessionUserContext);
  if (!user) throw new Error('useSessionUser() s\'utilise sous <RequireSession>.');
  return user;
}

// Les pages réservées aux comptes connectés. La session est relue auprès du serveur à chaque arrivée : sans session valable,
// direction /connexion, qui ramènera ici après la connexion. Serveur injoignable : un message, sans déconnecter personne.
export function RequireSession({ children }: { children: ReactNode }) {
  const { state, refresh } = useCurrentSession();
  const location = useLocation();
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    await refresh();
    setRetrying(false);
  }

  switch (state.status) {
    case 'loading':
      return <p className="page-message">{fr.common.loading}</p>;
    case 'error':
      return (
        <div className="page-message">
          <p role="alert">{fr.common.errors.network}</p>
          <button type="button" className="button" onClick={retry} disabled={retrying}>
            {fr.common.retry}
          </button>
        </div>
      );
    case 'signedOut': {
      const loginState: LoginState = { from: location.pathname + location.search };
      return <Navigate to="/connexion" replace state={loginState} />;
    }
    case 'signedIn':
      return <SessionUserContext.Provider value={state.user}>{children}</SessionUserContext.Provider>;
  }
}
