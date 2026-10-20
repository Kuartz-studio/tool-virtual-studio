import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { EventBus } from '../game/EventBus';
import { fr } from '../i18n/fr';
import { authClient } from '../lib/auth-client';
import { useSessionKeepAlive } from '../lib/session';
import { connectOffice, superviseConnection, type ConnectionSupervisor } from '../net/office-connection';
import { createOfficeSocket, type OfficeSocket } from '../net/socket';
import { OfficeShell } from '../office/OfficeShell';
import { useSessionUser } from '../RequireSession';
import { useOfficeStore } from '../state/office-store';

// Phaser pèse lourd, et seul le bureau s'en sert : il n'est téléchargé qu'ici, pas avec les pages de compte.
const PhaserGame = lazy(() => import('../game/PhaserGame').then((module) => ({ default: module.PhaserGame })));

// La connexion de cette page : la socket, et ce qui veille sur elle.
interface Connection {
  socket: OfficeSocket;
  supervisor: ConnectionSupervisor;
}

// / : le bureau. La page ouvre la connexion temps réel ; au premier `init` du serveur (qui dit la carte, où l'on est et qui est là),
// le jeu démarre et occupe toute la page. Par-dessus, la barre du bureau, les panneaux et, si un autre onglet prend la place de celui-ci,
// l'écran « Ouvert dans un autre onglet » (OfficeShell).
export function OfficePage() {
  const user = useSessionUser();
  const navigate = useNavigate();
  const mapKey = useOfficeStore((state) => state.mapKey);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);

  const goToLogin = useCallback(() => navigate('/connexion', { replace: true }), [navigate]);
  const goToLoginRef = useRef(goToLogin);
  useEffect(() => {
    goToLoginRef.current = goToLogin;
  }, [goToLogin]);

  // La connexion vit avec la page : ouverte au montage (les écouteurs d'abord, puis connect()), fermée au démontage, qui vide aussi
  // l'état du bureau (un autre compte pourrait suivre).
  useEffect(() => {
    const socket = createOfficeSocket();
    const disconnectOffice = connectOffice(socket, useOfficeStore, EventBus);
    const supervisor = superviseConnection(socket, useOfficeStore, {
      signedOut: () => goToLoginRef.current(),
      forbidden: () => setConnectionError(fr.office.errors.forbiddenOrigin),
    });
    setConnection({ socket, supervisor });
    socket.connect();
    return () => {
      supervisor.stop();
      disconnectOffice();
      socket.disconnect();
      useOfficeStore.getState().reset();
    };
  }, []);

  useSessionKeepAlive(goToLogin);

  async function signOut() {
    setSigningOut(true);
    setError(null);
    // La connexion au bureau d'abord : le serveur voit partir la personne, et rien n'arrive plus à cette page.
    connection?.socket.disconnect();
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
      connection?.supervisor.restart();
      return;
    }
    navigate('/connexion', { replace: true });
  }

  return (
    <OfficeShell
      user={user}
      socket={connection?.socket ?? null}
      onSignOut={signOut}
      signingOut={signingOut}
      // « Utiliser ici » : le serveur remplacera l'autre onglet, et l'`init` qui suit rend la main à celui-ci.
      onUseHere={() => connection?.supervisor.restart()}
      connecting={mapKey === null && !connectionError}
      errors={[connectionError, error].filter((message) => message !== null)}
    >
      {mapKey !== null && (
        <Suspense fallback={null}>
          <PhaserGame mapKey={mapKey} />
        </Suspense>
      )}
    </OfficeShell>
  );
}
