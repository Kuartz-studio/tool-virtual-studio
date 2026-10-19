// Un limiteur de débit à fenêtre fixe, par clé : au plus `max` prises par fenêtre de `windowMs`. La fenêtre d'une clé s'ouvre à sa
// première prise ; à sa fin, la clé repart de zéro. La clé est un identifiant de compte, jamais une adresse IP : derrière le proxy
// de Railway, req.ip n'est pas une adresse fiable (auth.ts).
//
// `now` est une horloge en ms, monotone par défaut (performance.now) : une heure système qui recule ne rouvre pas de fenêtre.
export interface RateLimiter {
  /** true si la prise est accordée (elle compte alors dans la fenêtre), false si la limite est atteinte. */
  take(key: string): boolean;
}

export function createRateLimiter(o: { max: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = o.now ?? (() => performance.now());
  const windows = new Map<string, { start: number; count: number }>();
  let lastSweep = now();

  // Oublie les fenêtres finies, au plus une fois par fenêtre : la mémoire ne garde que les clés vues récemment.
  function sweep(t: number): void {
    if (t - lastSweep < o.windowMs) return;
    lastSweep = t;
    for (const [key, window] of windows) {
      if (t - window.start >= o.windowMs) windows.delete(key);
    }
  }

  return {
    take(key) {
      const t = now();
      sweep(t);
      const window = windows.get(key);
      if (!window || t - window.start >= o.windowMs) {
        windows.set(key, { start: t, count: 1 });
        return o.max >= 1;
      }
      if (window.count >= o.max) return false;
      window.count += 1;
      return true;
    },
  };
}
