import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';

export type IconButtonTone = 'default' | 'danger' | 'accent';

export interface IconButtonProps
  extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'className' | 'title' | 'aria-label' | 'aria-pressed' | 'aria-describedby'> {
  // Le nom du bouton, pour les lecteurs d'écran, et son infobulle : le même texte (un bouton sans texte n'a que lui).
  label: string;
  // La touche du clavier qui fait la même chose, écrite en <kbd> dans l'infobulle.
  shortcut?: string;
  // Une phrase de plus dans l'infobulle (pourquoi le bouton est inactif, ce qu'il fait), que les lecteurs d'écran lisent comme sa description.
  hint?: string;
  // Un bouton bascule : dit s'il est enfoncé (aria-pressed). Sans `pressed`, ce n'est pas une bascule. La teinte, elle, se choisit avec `tone`.
  pressed?: boolean;
  // La teinte : rouge (micro coupé), accent (partage en cours, panneau ouvert se voit aussi par aria-expanded).
  tone?: IconButtonTone;
  // Une pastille de notification (les messages non lus). Décorative : le nom du bouton dit déjà ce qu'il faut.
  badge?: ReactNode;
  // Un petit compteur discret, en bas à droite (les gens en ligne). Décoratif lui aussi.
  count?: ReactNode;
  // Où s'ouvre l'infobulle : au-dessus (les boutons du bas), ou au-dessous (ceux du haut d'un panneau).
  tip?: 'top' | 'bottom';
  // Un petit bouton (la croix d'un panneau).
  small?: boolean;
  className?: string;
  // L'icône (office/icons).
  children: ReactNode;
}

// Un bouton à icône seule, nu : l'icône, et rien d'autre à l'écran. Il porte son nom (`aria-label`) et une infobulle qui dit la même chose,
// dessinée par le CSS (styles.css, `.icon-tip`) : au survol, et au focus du clavier. Elle n'est pas le `title` du navigateur, qui s'y
// superposerait, et elle est cachée aux lecteurs d'écran (le nom est déjà lu).
export function IconButton({ label, shortcut, hint, pressed, tone = 'default', badge, count, tip = 'top', small = false, className, children, ...rest }: IconButtonProps) {
  const hintId = useId();
  const classes = ['icon-btn', tone !== 'default' && `is-${tone}`, small && 'is-small', className].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      {...rest}
      className={classes}
      aria-label={label}
      aria-pressed={pressed}
      aria-describedby={hint ? hintId : undefined}
      data-tip={label}
      data-tip-side={tip === 'bottom' ? 'bottom' : undefined}
    >
      {children}
      {count !== undefined && count !== null && (
        <span className="icon-count" aria-hidden="true">
          {count}
        </span>
      )}
      {badge !== undefined && badge !== null && badge !== false && (
        <span className="icon-badge" aria-hidden="true">
          {badge}
        </span>
      )}
      <span className="icon-tip" aria-hidden="true">
        {label}
        {shortcut && <kbd>{shortcut}</kbd>}
        {hint && <small id={hintId}>{hint}</small>}
      </span>
    </button>
  );
}
