import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { fr } from '../i18n/fr';
import { MusicToggle } from '../office/MusicToggle';

// La carte centrée des pages de compte (connexion, invitation, mot de passe). Son en-tête : le nom de l'appli, et à droite le bouton de la musique
// (la salle d'attente y joue dès le premier clic, et on doit pouvoir la couper sans entrer) ; puis le titre de la page.
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <header className="auth-head">
          <p className="auth-brand">{fr.common.appName}</p>
          <MusicToggle />
        </header>
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
