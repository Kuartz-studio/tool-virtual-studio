import { useEffect, useLayoutEffect, useRef, useState, type AriaRole, type CSSProperties, type ReactNode, type RefObject } from 'react';

// L'écart entre l'ancre et la fenêtre qui s'ouvre au-dessus d'elle.
const GAP = 10;

export interface PopoverProps {
  open: boolean;
  onClose(): void;
  // Ce qui l'ouvre (le bouton) : la fenêtre se pose au-dessus, et Échap lui rend le focus. Un clic sur l'ancre n'est pas un clic dehors :
  // c'est elle qui ouvre et ferme (sans cela, le clic qui ferme rouvrirait aussitôt).
  anchorRef: RefObject<HTMLElement | null>;
  // Au-dessus de l'ancre, alignée sur son bord gauche ou sur son bord droit.
  placement?: 'top-start' | 'top-end';
  // Son nom, pour les lecteurs d'écran.
  label: string;
  // Son rôle (menu, dialog…) : c'est l'appelant qui sait ce qu'il met dedans.
  role?: AriaRole;
  id?: string;
  children: ReactNode;
}

// Où poser la fenêtre : au-dessus de l'ancre, en coordonnées de la page (la couche d'interface est fixe : rien ne défile). Remesurée quand la
// fenêtre change de taille, ou que l'ancre en change (un dock qui passe sur une autre ligne).
function useAnchoredStyle(open: boolean, anchorRef: RefObject<HTMLElement | null>, placement: 'top-start' | 'top-end'): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!open || !anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const { clientHeight, clientWidth } = document.documentElement;
      const bottom = clientHeight - rect.top + GAP;
      setStyle(placement === 'top-end' ? { bottom, right: clientWidth - rect.right } : { bottom, left: rect.left });
    };
    place();
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(anchor);
    return () => {
      window.removeEventListener('resize', place);
      observer?.disconnect();
    };
  }, [open, anchorRef, placement]);
  return style;
}

// Une fenêtre qui s'ouvre au-dessus d'un bouton : un menu, un petit choix. Elle se ferme avec Échap (le focus revient à l'ancre) et par un clic
// ailleurs (le focus va là où la personne a cliqué). Ce qu'elle contient, et la façon d'y naviguer au clavier, sont à l'appelant.
export function Popover({ open, onClose, anchorRef, placement = 'top-start', label, role, id, children }: PopoverProps) {
  const element = useRef<HTMLDivElement>(null);
  const style = useAnchoredStyle(open, anchorRef, placement);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (element.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      anchorRef.current?.focus();
      onClose();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return (
    <div ref={element} id={id} role={role} aria-label={label} className="popover" data-placement={placement} style={style}>
      {children}
    </div>
  );
}
