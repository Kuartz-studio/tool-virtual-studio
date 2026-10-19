import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { fr, t } from '../i18n/fr';
import { authClient } from '../lib/auth-client';
import { Alert, AuthLayout, Field, Notice } from './AuthLayout';

// /mot-de-passe-oublie : demande le lien de réinitialisation. Le lien de l'e-mail passe par Better Auth, qui renvoie vers
// /reinitialiser?token=… de cette origine. La réponse est la même qu'un compte existe ou non : la page ne le dit pas.
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function requestLink(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    setSubmitting(true);
    setError(null);
    try {
      const { error: refusal } = await authClient.requestPasswordReset({ email: address, redirectTo: `${window.location.origin}/reinitialiser` });
      if (refusal) setError(refusal.status === 429 ? fr.common.errors.tooManyAttempts : fr.common.errors.unexpected);
      else setSentTo(address);
    } catch {
      setError(fr.common.errors.network);
    }
    setSubmitting(false);
  }

  return (
    <AuthLayout title={fr.forgotPassword.title}>
      {sentTo !== null ? (
        <Notice>{t(fr.forgotPassword.sent, { email: sentTo })}</Notice>
      ) : (
        <>
          <p>{fr.forgotPassword.intro}</p>
          <form onSubmit={requestLink} noValidate>
            <Field
              label={fr.forgotPassword.email}
              type="email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            {error && <Alert>{error}</Alert>}
            <button type="submit" className="button" disabled={submitting || email.trim() === ''}>
              {submitting ? fr.forgotPassword.submitting : fr.forgotPassword.submit}
            </button>
          </form>
        </>
      )}
      <p className="auth-links">
        <Link to="/connexion">{fr.forgotPassword.backToLogin}</Link>
      </p>
    </AuthLayout>
  );
}
