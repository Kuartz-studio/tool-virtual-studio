import { useLayoutEffect, useState, type RefObject } from 'react';
import { DEFAULT_WIDTH } from './sizing';

// La largeur de ce conteneur, suivie quand il change (ResizeObserver) : c'est sur elle que le plateau se mesure, jamais sur la fenêtre (§ 9.5.1). Tant qu'on ne sait rien (happy-dom, un
// conteneur sans taille, un navigateur sans ResizeObserver), la largeur d'un panneau de jeu.
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = (value: number) => {
      if (value > 0) setWidth(Math.floor(value));
    };
    measure(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => measure(entries[0]?.contentRect.width ?? element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
