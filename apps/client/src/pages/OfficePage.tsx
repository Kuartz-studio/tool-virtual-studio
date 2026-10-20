import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { EventBus } from '../game/EventBus';
import { fr } from '../i18n/fr';
import { authClient } from '../lib/auth-client';
import { useSessionKeepAlive } from '../lib/session';
import { createMediaClient } from '../media/create-media-client';
import type { MediaClient, MediaPrefs } from '../media/media-client';
import { useMedia } from '../media/use-media';
import { connectOffice, superviseConnection, type ConnectionSupervisor } from '../net/office-connection';
import { createOfficeSocket, type OfficeSocket } from '../net/socket';
import { DeviceCheck } from '../office/DeviceCheck';
import { OfficeShell } from '../office/OfficeShell';
import { useSessionUser } from '../RequireSession';
import { useOfficeStore } from '../state/office-store';

// Phaser pèse lourd, et seul le bureau s'en sert : il n'est téléchargé qu'ici, pas avec les pages de compte. L'écran d'entrée en lance
// le téléchargement, pour que le jeu démarre sans attendre après « Entrer ».
const loadPhaserGame = () => import('../game/PhaserGame');
const PhaserGame = lazy(() => loadPhaserGame().then((module) => ({ default: module.PhaserGame })));

// La connexion de cette page : la socket, et ce qui veille sur elle.
interface Connection {
  socket: OfficeSocket;
  supervisor: ConnectionSupervisor;
}

// Les deux états de la page : l'écran d'entrée (precheck), puis le bureau (inside), avec son client média.
type Phase = { step: 'precheck' } | { step: 'inside'; media: MediaClient };

// / : le bureau. La page ouvre la connexion temps réel dès son arrivée, puis passe par deux états :
// - precheck : l'écran d'entrée (DeviceCheck), où la personne vérifie son micro et sa caméra. Derrière lui, le serveur répond (`init`,
//   consignes audio/vidéo, que la connexion retient) ; rien n'est encore joué, et rien n'est demandé aux périphériques que l'aperçu ;
// - inside : après « Entrer », le bureau. Le jeu démarre et occupe toute la page ; l'audio et la vidéo suivent les consignes du serveur
//   (useMedia, qui rejoue celle reçue pendant l'écran d'entrée) ; par-dessus, les vignettes, la barre de commandes, les panneaux, et
//   si un autre onglet prend la place de celui-ci, l'écran « Ouvert dans un autre onglet » (OfficeShell).
export function OfficePage() {
  const user = useSessionUser();
  const navigate = useNavigate();
  const mapKey = useOfficeStore((state) => state.mapKey);
  // Arrivé une fois (self, du premier init), mais la connexion n'est plus prête : elle est tombée.
  const lost = useOfficeStore((state) => state.self !== null && !state.ready && !state.replaced);
  const [phase, setPhase] = useState<Phase>({ step: 'precheck' });
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

  useEffect(() => {
    // Un échec ici n'empêche rien : React.lazy le retentera au démarrage du jeu.
    loadPhaserGame().catch(() => {});
  }, []);

  useSessionKeepAlive(goToLogin);

  // « Entrer » : le client média, avec les préférences de l'écran d'entrée. Ce clic est le geste qui permet au navigateur de jouer le
  // son des autres : startAudio part dedans.
  function enter(prefs: MediaPrefs) {
    const media = createMediaClient(prefs);
    void media.startAudio();
    setPhase({ step: 'inside', media });
  }

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

  if (phase.step === 'precheck') return <DeviceCheck onEnter={enter} />;

  return (
    <Inside
      media={phase.media}
      socket={connection?.socket ?? null}
      user={user}
      onSignOut={signOut}
      signingOut={signingOut}
      // « Utiliser ici » : le serveur remplacera l'autre onglet, et l'`init` qui suit rend la main à celui-ci. « Reconnecter » : une
      // nouvelle connexion, à laquelle le serveur redit la consigne audio/vidéo, avec un jeton neuf.
      onUseHere={() => connection?.supervisor.restart()}
      onReconnect={() => connection?.supervisor.restart()}
      connecting={mapKey === null && !connectionError}
      reconnecting={lost && !signingOut && !connectionError}
      errors={[connectionError, error].filter((message) => message !== null)}
    >
      {mapKey !== null && (
        <Suspense fallback={null}>
          <PhaserGame mapKey={mapKey} />
        </Suspense>
      )}
    </Inside>
  );
}

type InsideProps = Omit<Parameters<typeof OfficeShell>[0], 'media'> & { media: MediaClient };

// Le bureau, une fois entré : l'audio et la vidéo suivent la connexion (useMedia), sous l'interface du bureau.
function Inside({ media, socket, ...shell }: InsideProps) {
  const snapshot = useMedia(media, socket);
  return <OfficeShell {...shell} socket={socket} media={{ client: media, snapshot }} />;
}
