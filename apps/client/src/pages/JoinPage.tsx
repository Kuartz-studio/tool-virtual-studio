import { DISPLAY_NAME_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, displayNameSchema } from '@bureau/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { fr, t } from '../i18n/fr';
import { api, ApiError } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { useCurrentSession } from '../lib/session';
import { Alert, AuthLayout, Field } from './AuthLayout';

// L'invitation du lien : en cours de lecture, valable (avec l'adresse invitée), ou inutilisable (avec la raison).
// `retry` : la lecture a échoué sans refus (serveur injoignable ou en erreur), on peut la relancer.
// `toLogin` : le compte existe déjà, la suite est la page de connexion (ou le bureau, si ce navigateur est connecté).
type Invitation =
  | { status: 'loading' }
  | { status: 'valid'; email: string }
  | { status: 'unusable'; message: string; retry?: boolean; toLogin?: boolean };

// Les refus définitifs des routes d'invitation (lecture du lien ou création du compte) : l'invitation devient inutilisable.
// null pour tout autre échec, que errorMessageOf() décrit.
function refusalOf(err: unknown): Invitation | null {
  if (!(err instanceof ApiError)) return null;
  const unusable = (message: string, toLogin = false): Invitation => ({ status: 'unusable', message, toLogin });
  if (err.status === 404 && err.error === 'unknown') return unusable(fr.join.errors.unknown);
  if (err.status === 410 && err.error === 'used') return unusable(fr.join.errors.used, true);
  if (err.status === 410 && err.error === 'expired') return unusable(fr.join.errors.expired);
  if (err.status === 410 && err.error === 'revoked') return unusable(fr.join.errors.revoked);
  if (err.status === 409 && err.error === 'already_member') return unusable(fr.join.errors.alreadyMember, true);
  return null;
}

// Le message d'un échec qui n'est pas un refus définitif.
function errorMessageOf(err: unknown): string {
  if (!(err instanceof ApiError) || err.status === 0) return fr.common.errors.network;
  if (err.status === 400 && err.error === 'invalid') {
    return t(fr.join.errors.invalid, { maxName: DISPLAY_NAME_MAX_LENGTH, minPassword: PASSWORD_MIN_LENGTH, maxPassword: PASSWORD_MAX_LENGTH });
  }
  return fr.common.errors.unexpected;
}

// /rejoindre?token=… : la page du lien d'invitation. Elle affiche l'adresse invitée (non modifiable) et demande un nom et un
// mot de passe. Si ce navigateur est déjà connecté à un compte, il faut d'abord s'en déconnecter : créer le compte remplacerait
// la session en cours, sans que la personne l'ait voulu.
export function JoinPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const { state: session, refresh: refreshSession } = useCurrentSession();

  const [invitation, setInvitation] = useState<Invitation>({ status: 'loading' });
  // Incrémenté par « Réessayer » : relance la lecture de l'invitation.
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setInvitation({ status: 'unusable', message: fr.join.errors.missingToken });
      return;
    }
    let active = true;
    setInvitation({ status: 'loading' });
    api<{ email: string }>(`/api/invitations/${encodeURIComponent(token)}`).then(
      ({ email }) => active && setInvitation({ status: 'valid', email }),
      (err: unknown) => active && setInvitation(refusalOf(err) ?? { status: 'unusable', message: errorMessageOf(err), retry: true }),
    );
    return () => {
      active = false;
    };
  }, [token, attempt]);

  const canSubmit = displayNameSchema.safeParse(name).success && password.length >= PASSWORD_MIN_LENGTH && !submitting;

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || !token) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await api('/api/invitations/accept', { method: 'POST', body: JSON.stringify({ token, name: name.trim(), password }) });
    } catch (err) {
      // Un refus définitif remplace le formulaire par sa raison. Sinon (serveur injoignable ou en erreur), le formulaire reste
      // là : si le compte a été créé malgré tout, un nouvel envoi le dira (« déjà utilisé »).
      const refusal = refusalOf(err);
      if (refusal) setInvitation(refusal);
      else setFormError(errorMessageOf(err));
      setSubmitting(false);
      return;
    }
    // Le compte est créé et sa session ouverte (cookie posé par la réponse) : le bureau relit la session à son arrivée.
    navigate('/', { replace: true });
  }

  async function signOutAndContinue() {
    setSigningOut(true);
    setFormError(null);
    try {
      const { error } = await authClient.signOut();
      if (error) setFormError(fr.common.errors.unexpected);
      else await refreshSession();
    } catch {
      setFormError(fr.common.errors.network);
    }
    setSigningOut(false);
  }

  if (invitation.status === 'unusable') {
    return (
      <AuthLayout title={fr.join.title}>
        <Alert>{invitation.message}</Alert>
        {invitation.retry && (
          <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
            {fr.common.retry}
          </button>
        )}
        {invitation.toLogin && (
          <p className="auth-links">
            {/* Déjà connecté (lien rouvert après avoir créé son compte) : la connexion n'aurait rien à faire. */}
            {session.status === 'signedIn' ? <Link to="/">{fr.join.goToOffice}</Link> : <Link to="/connexion">{fr.join.goToLogin}</Link>}
          </p>
        )}
      </AuthLayout>
    );
  }

  if (invitation.status === 'loading' || session.status === 'loading') {
    return (
      <AuthLayout title={fr.join.title}>
        <p>{fr.common.loading}</p>
      </AuthLayout>
    );
  }

  if (session.status === 'signedIn') {
    return (
      <AuthLayout title={fr.join.title}>
        <p>{t(fr.join.signedInAs, { email: session.user.email })}</p>
        {formError && <Alert>{formError}</Alert>}
        <button type="button" className="button" onClick={signOutAndContinue} disabled={signingOut}>
          {signingOut ? fr.join.signingOut : fr.join.signOutAndContinue}
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={fr.join.title}>
      <p>{fr.join.intro}</p>
      <form onSubmit={createAccount} noValidate>
        <Field label={fr.join.email} type="email" name="email" autoComplete="username" value={invitation.email} readOnly />
        <Field
          label={fr.join.name}
          name="name"
          autoComplete="nickname"
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <Field
          label={fr.join.password}
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
        {formError && <Alert>{formError}</Alert>}
        <button type="submit" className="button" disabled={!canSubmit}>
          {submitting ? fr.join.submitting : fr.join.submit}
        </button>
      </form>
    </AuthLayout>
  );
}
