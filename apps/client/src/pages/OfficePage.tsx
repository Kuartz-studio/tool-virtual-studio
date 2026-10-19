import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { authClient } from '../lib/auth-client';
import { useSessionKeepAlive } from '../lib/session';
import { connectOffice, superviseConnection } from '../net/office-connection';
import { createOfficeSocket, type OfficeSocket } from '../net/socket';
import { useSessionUser } from '../RequireSession';
import { useOfficeStore } from '../state/office-store';
import { Alert, Notice } from './AuthLayout';

// Phaser pèse lourd, et seul le bureau s'en sert : il n'est téléchargé qu'ici, pas avec les pages de compte.
const PhaserGame = lazy(() => import('../game/PhaserGame').then((module) => ({ default: module.PhaserGame })));

// / : le bureau. La page ouvre la connexion temps réel ; au premier `init` du serveur (qui dit la carte, où l'on est et qui est là),
// le jeu démarre et occupe toute la page. Par-dessus, un bonjour et la déconnexion, provisoires (tâche 16).
export function OfficePage() {
  const user = useSessionUser();
  const navigate = useNavigate();
  const mapKey = useOfficeStore((state) => state.mapKey);
  const replaced = useOfficeStore((state) => state.replaced);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const socketRef = useRef<OfficeSocket | null>(null);

  const goToLogin = useCallback(() => navigate('/connexion', { replace: true }), [navigate]);
  const goToLoginRef = useRef(goToLogin);
  useEffect(() => {
    goToLoginRef.current = goToLogin;
  }, [goToLogin]);

  // La connexion vit avec la page : ouverte au montage (les écouteurs d'abord, puis connect()), fermée au démontage, qui vide aussi
  // l'état du bureau (un autre compte pourrait suivre).
  useEffect(() => {
    const socket = createOfficeSocket();
    socketRef.current = socket;
    const disconnectOffice = connectOffice(socket, useOfficeStore, EventBus);
    const stopSupervising = superviseConnection(socket, useOfficeStore, {
      signedOut: () => goToLoginRef.current(),
      forbidden: () => setConnectionError(fr.office.errors.forbiddenOrigin),
    });
    socket.connect();
    return () => {
      stopSupervising();
      disconnectOffice();
      socket.disconnect();
      socketRef.current = null;
      useOfficeStore.getState().reset();
    };
  }, []);

  useSessionKeepAlive(goToLogin);

  async function signOut() {
    setSigningOut(true);
    setError(null);
    // La connexion au bureau d'abord : le serveur voit partir la personne, et rien n'arrive plus à cette page.
    socketRef.current?.disconnect();
    let message: string | null = null;
    try {
      const { error: refusal } = await authClient.signOut();
      if (refusal) message = fr.common.errors.unexpected;
    } catch {
      message = fr.common.errors.network;
    }
    if (message) {
      setError(message);
      setSigningOut(false);
      // Toujours connecté : on revient au bureau.
      socketRef.current?.connect();
      return;
    }
    navigate('/connexion', { replace: true });
  }

  return (
    <main className="office">
      {mapKey !== null && (
        <Suspense fallback={null}>
          <PhaserGame mapKey={mapKey} />
        </Suspense>
      )}
      <div className="office-overlay">
        <h1>{t(fr.office.hello, { name: user.name })}</h1>
        <button type="button" className="button" onClick={signOut} disabled={signingOut}>
          {signingOut ? fr.office.signingOut : fr.office.signOut}
        </button>
        {mapKey === null && !connectionError && <p className="office-status">{fr.office.connecting}</p>}
        {replaced && <Notice>{fr.office.replaced}</Notice>}
        {connectionError && <Alert>{connectionError}</Alert>}
        {error && <Alert>{error}</Alert>}
      </div>
    </main>
  );
}
