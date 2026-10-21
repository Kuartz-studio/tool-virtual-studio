import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { fr } from '../../i18n/fr';
import { CloseIcon } from '../icons';
import { IconButton } from './IconButton';

// Le panneau latéral : un en-tête (le titre, et « Fermer »), puis un corps qui défile. Le panneau ne se place pas lui-même : c'est la coque
// du bureau (OfficeShell, `.office-side`) qui le pose à droite, ou en feuille en bas sur un téléphone.
// Le focus va au titre à l'ouverture (le lecteur d'écran l'annonce, et Tab entre dans le panneau), sauf si le contenu a déjà pris le focus
// (le champ d'un message) ; Échap ferme.
export function Drawer({ title, onClose, id, children }: { title: string; onClose(): void; id?: string; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!panel.current?.contains(document.activeElement)) heading.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <aside ref={panel} id={id} className="drawer" aria-label={title} onKeyDown={onKeyDown}>
      <header className="drawer-header">
        <h2 ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <IconButton label={fr.ui.close} small tip="bottom" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </header>
      <div className="drawer-body">{children}</div>
    </aside>
  );
}
