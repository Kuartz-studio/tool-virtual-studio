import { useSyncExternalStore } from 'react';

// L'heure du moment, arrondie à la minute, pour ce qui affiche une heure (la carte de l'heure locale d'une personne, la ligne du fuseau dans le menu
// « Moi ») : une seule minuterie pour tous, calée sur les minutes rondes (l'affichage passe de 18:41 à 18:42 à la seconde près), qui ne tourne que
// tant que quelque chose l'affiche. Seuls ceux qui la lisent se re-rendent. Un onglet qui revient d'arrière-plan relit l'heure tout de suite : le
// navigateur y a ralenti les minuteries, l'heure affichée aurait pris du retard.
export function createTicker(periodMs: number) {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const floor = (ms: number): number => Math.floor(ms / periodMs) * periodMs;
  let now = floor(Date.now());

  const notify = () => {
    const next = floor(Date.now());
    if (next === now) return;
    now = next;
    for (const listener of [...listeners]) listener();
  };
  // Quelques millisecondes après la minute ronde : le minuteur peut partir un rien en avance.
  const schedule = () => {
    timer = setTimeout(() => {
      notify();
      schedule();
    }, periodMs - (Date.now() % periodMs) + 5);
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') notify();
  };

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (timer === undefined) {
        now = floor(Date.now());
        schedule();
        document.addEventListener('visibilitychange', onVisibility);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
        document.removeEventListener('visibilitychange', onVisibility);
      };
    },
    // Arrêtée, l'horloge se remet à l'heure quand on la lit. React la lit deux fois par rendu : à la minute près, les deux lectures sont égales.
    read(): number {
      if (timer === undefined) now = floor(Date.now());
      return now;
    },
  };
}

const minutes = createTicker(60_000);

// L'instant présent (ms depuis 1970), arrondi à la minute : le composant se re-rend à chaque minute ronde, et seulement alors.
export function useMinute(): number {
  return useSyncExternalStore(minutes.subscribe, minutes.read);
}
