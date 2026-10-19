import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router';
import { fr, t } from '../i18n/fr';
import { authClient } from '../lib/auth-client';
import { useSessionUser } from '../RequireSession';
import { Alert } from './AuthLayout';

// Phaser pèse lourd, et seul le bureau s'en sert : il n'est téléchargé qu'ici, pas avec les pages de compte.
const PhaserGame = lazy(() => import('../game/PhaserGame').then((module) => ({ default: module.PhaserGame })));

// La carte du bureau. Le serveur charge la même (MAP_KEY, dev-office par défaut).
const MAP_KEY = 'dev-office';

// / : le bureau. La carte occupe toute la page ; par-dessus, un bonjour et la déconnexion, provisoires (tâche 16).
export function OfficePage() {
  const user = useSessionUser();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setSigningOut(true);
    setError(null);
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
      return;
    }
    navigate('/connexion', { replace: true });
  }

  return (
    <main className="office">
      <Suspense fallback={null}>
        {/* Le choix d'un avatar n'est pas encore dans la session (tâche 23) : l'avatar par défaut. */}
        <PhaserGame mapKey={MAP_KEY} self={{ id: user.id, avatarKey: null }} />
      </Suspense>
      <div className="office-overlay">
        <h1>{t(fr.office.hello, { name: user.name })}</h1>
        <button type="button" className="button" onClick={signOut} disabled={signingOut}>
          {signingOut ? fr.office.signingOut : fr.office.signOut}
        </button>
        {error && <Alert>{error}</Alert>}
      </div>
    </main>
  );
}
