// Les liens de mot de passe que le mailer « none » ne peut pas envoyer : il les garde ici, le temps que la route de l'admin
// (POST /api/admin/members/:id/reset-link) les reprenne. Le lien porte un jeton qui ouvre le compte : la réserve est en mémoire
// seulement (rien en base, rien dans le journal), un lien n'y reste que 10 minutes, et il en sort dès qu'on le prend.
export const RESET_LINK_TTL_MS = 10 * 60 * 1000;
// Une borne pour que la mémoire ne grossisse jamais, même si personne ne reprend les liens : au-delà, le plus ancien part.
export const MAX_RESET_LINKS = 50;

export interface ResetLinkStore {
  /** Garde ce lien pour cette adresse (casse ignorée), à la place du précédent. */
  put(to: string, link: string): void;
  /** Rend le lien de cette adresse, s'il est là et pas expiré, et l'oublie. */
  take(to: string): string | undefined;
  /** Oublie le lien de cette adresse. */
  discard(to: string): void;
  /** Comme take(), en attendant jusqu'à `timeoutMs` qu'un lien arrive ; null passé ce délai. */
  wait(to: string, timeoutMs: number): Promise<string | null>;
  /** Le nombre d'adresses dont un lien est gardé (expirés écartés). */
  readonly size: number;
}

// `now` fixe l'heure (ms) : les tests s'en servent pour vieillir un lien.
export function createResetLinkStore(o: { now?: () => number; ttlMs?: number; maxEntries?: number } = {}): ResetLinkStore {
  const now = o.now ?? Date.now;
  const ttlMs = o.ttlMs ?? RESET_LINK_TTL_MS;
  const maxEntries = o.maxEntries ?? MAX_RESET_LINKS;
  // Du plus ancien au plus récent : remplacer une adresse la réinsère à la fin.
  const entries = new Map<string, { link: string; expiresAt: number }>();
  // Ceux qui attendent le lien d'une adresse : ils se réveillent quand il arrive.
  const waiting = new Map<string, Set<() => void>>();

  const keyOf = (to: string) => to.trim().toLowerCase();

  function sweep(): void {
    const t = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= t) entries.delete(key);
    }
  }

  function take(to: string): string | undefined {
    sweep();
    const key = keyOf(to);
    const entry = entries.get(key);
    entries.delete(key);
    return entry?.link;
  }

  return {
    put(to, link) {
      sweep();
      const key = keyOf(to);
      entries.delete(key);
      entries.set(key, { link, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
      for (const wake of [...(waiting.get(key) ?? [])]) wake();
    },

    take,

    discard(to) {
      entries.delete(keyOf(to));
    },

    wait(to, timeoutMs) {
      const ready = take(to);
      if (ready !== undefined) return Promise.resolve(ready);
      return new Promise((resolve) => {
        const key = keyOf(to);
        const done = (link: string | null) => {
          clearTimeout(timer);
          const wakes = waiting.get(key);
          wakes?.delete(wake);
          if (wakes?.size === 0) waiting.delete(key);
          resolve(link);
        };
        const wake = () => {
          const link = take(key);
          if (link !== undefined) done(link);
        };
        const timer = setTimeout(() => done(null), timeoutMs);
        waiting.set(key, (waiting.get(key) ?? new Set()).add(wake));
      });
    },

    get size() {
      sweep();
      return entries.size;
    },
  };
}
