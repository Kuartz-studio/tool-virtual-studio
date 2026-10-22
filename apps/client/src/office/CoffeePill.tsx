import { useEffect, useState } from 'react';
import { secondsLeft } from '../game/coffee';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { CoffeeIcon } from './icons';

// Le rythme auquel la pastille relit l'heure : assez serré pour que le chiffre change à la seconde, sans minuteur par seconde exacte.
const REFRESH_MS = 250;

// La pastille du café, sous la puce du lieu : « 28 s », ce qu'il reste de son propre café (celui des autres n'y est pas). Elle n'existe que pendant le café :
// à la dernière seconde elle disparaît, comme quand le serveur dit le café fini. Elle ne parle pas aux lecteurs d'écran à chaque seconde : son nom accessible
// dit le temps qu'il reste, sans zone vive.
export function CoffeePill() {
  const until = useOfficeStore((state) => (state.selfId === null ? undefined : state.coffee[state.selfId]));
  const [now, setNow] = useState(() => performance.now());

  // Tant qu'il reste du café, l'heure est relue ; le minuteur s'arrête de lui-même à l'échéance, ou si le café change (un autre remet le compte à zéro).
  useEffect(() => {
    if (until === undefined) return;
    setNow(performance.now());
    const timer = setInterval(() => {
      const current = performance.now();
      setNow(current);
      if (current >= until) clearInterval(timer);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [until]);

  const seconds = secondsLeft(until, now);
  if (seconds === 0) return null;
  return (
    <div className="coffee-pill" role="group" aria-label={t(fr.coffee.pill, { seconds })}>
      <CoffeeIcon />
      <span aria-hidden="true">{t(fr.coffee.left, { seconds })}</span>
    </div>
  );
}
