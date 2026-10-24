import { DEFAULT_TIMEZONE } from '@bureau/shared';
import { useCallback, useEffect, useState } from 'react';
import { EventBus } from '../game/EventBus';
import { listenOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { FloatingTimeCard, LOCAL_TIME_HOVER_MS, placeAbove } from './LocalTime';

// La carte de l'heure locale au survol d'un avatar, dans le jeu : le jeu dit quel avatar la souris survole (`avatar:hover`, avec le haut de sa tête en
// pixels de la page) ; la carte paraît au-dessus de la tête après le même délai qu'au survol d'une ligne du panneau Personnes, et part dès que la souris
// quitte l'avatar. Le fuseau et le nom sont ceux que le magasin connaît (le temps réel les tient à jour). Au doigt, pas de survol : pas de carte.
export function AvatarTimeCard() {
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const stop = listenOnBus(EventBus, 'avatar:hover', (next) => {
      clearTimeout(pending);
      if (next === null) setHover(null);
      else pending = setTimeout(() => setHover(next), LOCAL_TIME_HOVER_MS);
    });
    return () => {
      clearTimeout(pending);
      stop();
    };
  }, []);

  const player = useOfficeStore((state) => (hover ? state.players[hover.id] : undefined));
  // Le menu d'une personne ouvert (un clic droit) : la carte s'efface, pour ne pas le couvrir.
  const menuOpen = useOfficeStore((state) => state.personMenu !== null);
  const place = useCallback((card: { width: number; height: number }, viewport: { width: number; height: number }) => (hover ? placeAbove(hover, card, viewport) : null), [hover]);
  const hide = useCallback(() => setHover(null), []);
  if (!hover || !player || menuOpen) return null;
  return <FloatingTimeCard info={{ timezone: player.timezone ?? DEFAULT_TIMEZONE, name: player.name }} place={place} onGone={hide} />;
}
