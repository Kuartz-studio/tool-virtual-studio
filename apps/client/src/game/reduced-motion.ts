// prefers-reduced-motion : la personne demande moins de mouvement (ni fondu de la nuit, ni vacillement du feu, ni glissement de la caméra).
// Relu à chaque appel : elle peut le changer pendant qu'elle joue.
let query: MediaQueryList | null | undefined;
export function prefersReducedMotion(): boolean {
  if (query === undefined) {
    query = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  }
  return query?.matches ?? false;
}
