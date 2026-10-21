import { useEffect, useLayoutEffect, useRef, useState, type AriaRole, type CSSProperties, type ReactNode, type RefObject } from 'react';

// L'écart entre l'ancre et la fenêtre qui s'ouvre au-dessus d'elle.
const GAP = 14;
// Centrée sur son ancre, la fenêtre garde au moins cet écart avec les bords de la page.
const EDGE = 16;

export type PopoverPlacement = 'top-start' | 'top-end' | 'top';

export interface PopoverProps {
  open: boolean;
  onClose(): void;
  // Ce qui l'ouvre (le bouton) : la fenêtre se pose au-dessus, et Échap lui rend le focus. Un clic sur l'ancre n'est pas un clic dehors :
  // c'est elle qui ouvre et ferme (sans cela, le clic qui ferme rouvrirait aussitôt).
  anchorRef: RefObject<HTMLElement | null>;
  // Au-dessus de l'ancre, alignée sur son bord gauche (`top-start`) ou sur son bord droit (`top-end`), ou centrée sur elle (`top`, que les
  // bords de la page retiennent : sur un écran étroit, elle reste dans la page).
  placement?: PopoverPlacement;
  // Son nom, pour les lecteurs d'écran.
  label: string;
  // Son rôle (menu, dialog…) : c'est l'appelant qui sait ce qu'il met dedans.
  role?: AriaRole;
  id?: string;
  children: ReactNode;
}

// Où poser la fenêtre, au-dessus de l'ancre, en coordonnées de la page : le bord du bas, et le bord gauche, ou droit, ou le milieu (que le CSS
// ramène à la moitié de la largeur de la fenêtre : `translate`) quand elle est centrée, et que ses bords gardent loin de ceux de la page.
export function placeOver(
  rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'width'>,
  viewport: { width: number; height: number },
  placement: PopoverPlacement,
  popoverWidth: number,
): CSSProperties {
  const bottom = viewport.height - rect.top + GAP;
  if (placement === 'top-end') return { bottom, right: viewport.width - rect.right };
  if (placement === 'top') {
    const half = popoverWidth / 2;
    return { bottom, left: Math.min(Math.max(rect.left + rect.width / 2, EDGE + half), viewport.width - EDGE - half) };
  }
  return { bottom, left: rect.left };
}

// Où poser la fenêtre : au-dessus de l'ancre, en coordonnées de la page (la couche d'interface est fixe : rien ne défile). Remesurée quand la
// fenêtre change de taille, ou que l'ancre en change (un dock qui passe sur une autre ligne).
function useAnchoredStyle(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popoverRef: RefObject<HTMLElement | null>,
  placement: PopoverPlacement,
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!open || !anchor) return;
    const place = () => {
      const { clientHeight, clientWidth } = document.documentElement;
      setStyle(placeOver(anchor.getBoundingClientRect(), { width: clientWidth, height: clientHeight }, placement, popoverRef.current?.offsetWidth ?? 0));
    };
    place();
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(anchor);
    return () => {
      window.removeEventListener('resize', place);
      observer?.disconnect();
    };
  }, [open, anchorRef, popoverRef, placement]);
  return style;
}

// Une fenêtre qui s'ouvre au-dessus d'un bouton : un menu, un petit choix. Elle se ferme avec Échap (le focus revient à l'ancre) et par un clic
// ailleurs (le focus va là où la personne a cliqué). Ce qu'elle contient, et la façon d'y naviguer au clavier, sont à l'appelant.
export function Popover({ open, onClose, anchorRef, placement = 'top-start', label, role, id, children }: PopoverProps) {
  const element = useRef<HTMLDivElement>(null);
  const style = useAnchoredStyle(open, anchorRef, element, placement);

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
