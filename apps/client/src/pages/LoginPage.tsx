import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { fr } from '../i18n/fr';
import { authClient } from '../lib/auth-client';
import { Alert, AuthLayout, Field, Notice } from './AuthLayout';

// Ce que les autres pages passent à /connexion dans l'état de la navigation.
export interface LoginState {
  /** La page à rouvrir après la connexion (RequireSession). */
  from?: string;
  /** Un message à afficher : le mot de passe vient d'être changé (ResetPasswordPage). */
  notice?: 'passwordChanged';
}

// Seulement un chemin de l'appli (« /… », pas « //autre-site »).
function returnPathOf(state: LoginState | null): string {
  const from = state?.from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';
}

function signInErrorMessage(error: { status: number; code?: string }): string {
  if (error.status === 429) return fr.common.errors.tooManyAttempts;
  if (error.code === 'ACCOUNT_DISABLED') return fr.login.errors.accountDisabled;
  // 400 : adresse mal formée. Better Auth répond pareil pour une adresse sans compte et pour un mauvais mot de passe.
  if (error.status === 401 || error.status === 400) return fr.login.errors.invalidCredentials;
  return fr.common.errors.unexpected;
}

// /connexion : e-mail et mot de passe. La session ouverte, retour à la page demandée (le bureau par défaut).
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LoginState | null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { error: refusal } = await authClient.signIn.email({ email: email.trim(), password });
      if (refusal) {
        setError(signInErrorMessage(refusal));
        setSubmitting(false);
        return;
      }
    } catch {
      setError(fr.common.errors.network);
      setSubmitting(false);
      return;
    }
    navigate(returnPathOf(state), { replace: true });
  }

  return (
    <AuthLayout title={fr.login.title}>
      {state?.notice === 'passwordChanged' && <Notice>{fr.login.passwordChanged}</Notice>}
      <form onSubmit={signIn} noValidate>
        <Field label={fr.login.email} type="email" name="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <Field
          label={fr.login.password}
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {error && <Alert>{error}</Alert>}
        <button type="submit" className="button" disabled={submitting || email.trim() === '' || password === ''}>
          {submitting ? fr.login.submitting : fr.login.submit}
        </button>
      </form>
      <p className="auth-links">
        <Link to="/mot-de-passe-oublie">{fr.login.forgotPassword}</Link>
      </p>
    </AuthLayout>
  );
}
