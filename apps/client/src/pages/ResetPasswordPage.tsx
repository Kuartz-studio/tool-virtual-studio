import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@bureau/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { fr, t } from '../i18n/fr';
import { authClient } from '../lib/auth-client';
import { Alert, AuthLayout, Field } from './AuthLayout';
import type { LoginState } from './LoginPage';

// /reinitialiser?token=… : le lien de l'e-mail « mot de passe oublié », après son passage par Better Auth. Un lien expiré ou
// déjà servi arrive ici avec ?error=INVALID_TOKEN. Changer le mot de passe ne connecte personne et ferme toutes les sessions
// du compte : la suite est la page de connexion.
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const [linkValid, setLinkValid] = useState(token !== null && token !== '' && !params.has('error'));
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (!token || password.length < PASSWORD_MIN_LENGTH) return;
    setSubmitting(true);
    setError(null);
    try {
      const { error: refusal } = await authClient.resetPassword({ newPassword: password, token });
      if (refusal) {
        if (refusal.code === 'INVALID_TOKEN') setLinkValid(false);
        else setError(refusal.status === 429 ? fr.common.errors.tooManyAttempts : fr.common.errors.unexpected);
        setSubmitting(false);
        return;
      }
    } catch {
      setError(fr.common.errors.network);
      setSubmitting(false);
      return;
    }
    const state: LoginState = { notice: 'passwordChanged' };
    navigate('/connexion', { replace: true, state });
  }

  if (!linkValid) {
    return (
      <AuthLayout title={fr.resetPassword.title}>
        <Alert>{fr.resetPassword.invalidLink}</Alert>
        <p className="auth-links">
          <Link to="/mot-de-passe-oublie">{fr.resetPassword.requestNewLink}</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={fr.resetPassword.title}>
      <p>{fr.resetPassword.intro}</p>
      <form onSubmit={changePassword} noValidate>
        <Field
          label={fr.resetPassword.password}
          hint={t(fr.common.passwordHint, { min: PASSWORD_MIN_LENGTH })}
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {error && <Alert>{error}</Alert>}
        <button type="submit" className="button" disabled={submitting || password.length < PASSWORD_MIN_LENGTH}>
          {submitting ? fr.resetPassword.submitting : fr.resetPassword.submit}
        </button>
      </form>
    </AuthLayout>
  );
}
