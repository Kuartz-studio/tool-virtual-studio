import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { fr } from '../i18n/fr';

// La carte centrée des pages de compte (connexion, invitation, mot de passe).
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <p className="auth-brand">{fr.common.appName}</p>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

// Un champ de formulaire avec son libellé. L'aide éventuelle est hors du libellé (le nom accessible reste le libellé seul),
// et liée au champ par aria-describedby.
export function Field({ label, hint, ...input }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = `${id}-aide`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-describedby={hint ? hintId : undefined} {...input} />
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
    </div>
  );
}

// Un message d'erreur, lu par les lecteurs d'écran dès qu'il apparaît.
export function Alert({ children }: { children: ReactNode }) {
  return (
    <p className="alert" role="alert">
      {children}
    </p>
  );
}

// Un message de réussite ou d'information.
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="notice" role="status">
      {children}
    </p>
  );
}
