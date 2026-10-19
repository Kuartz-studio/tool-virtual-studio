import { useState } from 'react';
import { useNavigate } from 'react-router';
import { fr, t } from '../i18n/fr';
import { authClient } from '../lib/auth-client';
import { useSessionUser } from '../RequireSession';
import { Alert } from './AuthLayout';

// / : le bureau. Provisoire : un bonjour et la déconnexion, en attendant la carte (tâche 10).
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
      <h1>{t(fr.office.hello, { name: user.name })}</h1>
      <button type="button" className="button" onClick={signOut} disabled={signingOut}>
        {signingOut ? fr.office.signingOut : fr.office.signOut}
      </button>
      {error && <Alert>{error}</Alert>}
    </main>
  );
}
