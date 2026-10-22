import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { fr } from '../../i18n/fr';
import { CloseIcon } from '../icons';
import { IconButton } from './IconButton';

// Le panneau latéral : un en-tête (le titre, et « Fermer »), puis un corps qui défile. Le panneau ne se place pas lui-même : c'est la coque
// du bureau (OfficeShell, `.office-side`) qui le pose à droite, ou en feuille en bas sur un téléphone.
// Le focus va au titre à l'ouverture (le lecteur d'écran l'annonce, et Tab entre dans le panneau), sauf si le contenu a déjà pris le focus
// (le champ d'un message) ; Échap ferme, sauf pendant une composition (clavier à touches mortes, méthode de saisie) : il l'annule.
// `className` s'ajoute à celle du panneau, pour qui veut un corps à lui (le chat : sa liste défile, son champ reste en bas). `actions` : des boutons de plus, dans l'en-tête, avant
// « Fermer » (les règles d'un jeu).
export function Drawer({ title, onClose, id, className, actions, children }: { title: string; onClose(): void; id?: string; className?: string; actions?: ReactNode; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!panel.current?.contains(document.activeElement)) heading.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <aside ref={panel} id={id} className={className ? `drawer ${className}` : 'drawer'} aria-label={title} onKeyDown={onKeyDown}>
      <header className="drawer-header">
        <h2 ref={heading} tabIndex={-1}>
          {title}
        </h2>
        {actions}
        <IconButton label={fr.ui.close} small tip="bottom" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </header>
      <div className="drawer-body">{children}</div>
    </aside>
  );
}
