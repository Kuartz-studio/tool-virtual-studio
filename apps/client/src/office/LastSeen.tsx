import { useSyncExternalStore } from 'react';
import { fr } from '../i18n/fr';
import { formatLastSeen, formatSeenDate, MINUTE_MS } from './last-seen';

// L'horloge des « Il y a … » : une seule minuterie pour tous les libellés affichés, qui ne tourne que tant qu'il y en a un. Chaque
// minute, seuls les libellés se re-rendent : ni le panneau qui les montre, ni le reste de l'appli.
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(() => {
    now = Date.now();
    for (const notify of listeners) notify();
  }, MINUTE_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearInterval(timer);
    timer = undefined;
  };
}

// Arrêtée, l'horloge se remet à l'heure quand on la lit : un panneau rouvert une heure plus tard ne dit pas « À l'instant ». React la
// lit deux fois par rendu et compare les deux lectures : à moins d'une seconde d'écart, elles rendent la même valeur. Dans les deux sens :
// une horloge remise à l'heure en arrière compte aussi.
function readNow(): number {
  if (timer === undefined && Math.abs(Date.now() - now) >= 1000) now = Date.now();
  return now;
}

// La même horloge pour un autre compte à rebours (le panneau Admin : « Expire dans 5 h », puis « Expirée ») : l'heure du moment, remise à
// jour chaque minute, avec la même minuterie que les « Il y a … ».
export function useMinuteClock(): number {
  return useSyncExternalStore(subscribe, readNow);
}

// La dernière connexion d'un membre (`at`, en millisecondes) : « Il y a 3 h », la date entière au survol. Les lecteurs d'écran
// entendent « Dernière connexion : il y a 3 h ».
export function LastSeen({ at }: { at: number }) {
  const current = useMinuteClock();
  return (
    <span>
      <span className="visually-hidden">{fr.office.people.lastSeen} </span>
      <time dateTime={new Date(at).toISOString()} title={formatSeenDate(at)}>
        {formatLastSeen(at, current)}
      </time>
    </span>
  );
}
