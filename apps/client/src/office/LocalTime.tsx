import { timezoneOrDefault } from '@bureau/shared';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { fr, t } from '../i18n/fr';
import { useMinute } from '../lib/use-clock';
import { dayPart, describeGap, formatClock, formatUtcOffset, wallTime, zoneOffsetMinutes } from '../lib/zoned-time';
import { useOfficeStore } from '../state/office-store';
import { DayPartIcon } from './icons';
import { zonePlace } from './timezones';

// L'heure qu'il est chez quelqu'un : son heure (à la minute, en direct), « demain » ou « hier » quand sa date n'est plus la nôtre, sa ville (celle de
// son fuseau horaire), le moment de sa journée (matin, après-midi, soirée, nuit : une icône et un mot) et l'écart avec la sienne (« 7 h d'avance
// sur toi », « Même heure que toi »). Pour soi : « Chez toi », sans écart. La carte ne se place pas elle-même : useLocalTimeHover la pose à côté de
// ce qu'on survole (une ligne du panneau Personnes) ; un autre panneau (une fiche de profil) peut la poser où il veut.
export interface LocalTimeInfo {
  timezone: string;
  name: string;
  // C'est soi-même.
  self?: boolean;
}

export function LocalTimeCard({ timezone, name, self = false }: LocalTimeInfo) {
  const now = useMinute();
  const mine = timezoneOrDefault(useOfficeStore((state) => state.self?.timezone));
  const zone = timezoneOrDefault(timezone);
  const time = wallTime(zone, now);
  const shift = time.day - wallTime(mine, now).day;
  const part = dayPart(time.hours);
  const { city, region } = zonePlace(zone);

  return (
    <div className="time-card" data-part={part}>
      <div className="time-card-head">
        <span className="time-card-who">{self ? fr.time.atYou : t(fr.time.at, { name })}</span>
        <span className="time-card-part">
          <DayPartIcon part={part} />
          {fr.time.parts[part]}
        </span>
      </div>
      <p className="time-card-time">
        <time>{formatClock(time)}</time>
        {shift !== 0 && <span className="time-card-day">{shift > 0 ? fr.time.tomorrow : fr.time.yesterday}</span>}
      </p>
      <p className="time-card-place">{region === null || region === city ? city : `${city}, ${region}`}</p>
      <p className="time-card-meta">
        <span>{formatUtcOffset(zoneOffsetMinutes(zone, now))}</span>
        {!self && <span>{describeGap(zone, mine, now)}</span>}
      </p>
    </div>
  );
}

// Le délai avant que la carte paraisse au survol : traverser la liste à la souris ne la fait pas clignoter. Au focus du clavier, elle vient tout de suite.
export const LOCAL_TIME_HOVER_MS = 300;
// L'écart entre la carte et ce qu'elle décrit, et la marge qu'elle garde avec les bords de la page.
const GAP = 10;
const EDGE = 12;

// Où poser la carte, en coordonnées de la page, à côté de l'ancre (sa ligne) : à sa gauche (le panneau est à droite de l'écran), centrée sur elle en
// hauteur ; à droite si la gauche manque de place ; au-dessus, sinon (un téléphone, où le panneau est une feuille en bas), ou au-dessous.
export function placeBeside(
  anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const top = Math.min(Math.max((anchor.top + anchor.bottom) / 2 - card.height / 2, EDGE), Math.max(EDGE, viewport.height - EDGE - card.height));
  if (anchor.left - GAP - card.width >= EDGE) return { left: anchor.left - GAP - card.width, top };
  if (anchor.right + GAP + card.width <= viewport.width - EDGE) return { left: anchor.right + GAP, top };
  const left = Math.min(Math.max(anchor.left, EDGE), Math.max(EDGE, viewport.width - EDGE - card.width));
  if (anchor.top - GAP - card.height >= EDGE) return { left, top: anchor.top - GAP - card.height };
  return { left, top: Math.min(anchor.bottom + GAP, Math.max(EDGE, viewport.height - EDGE - card.height)) };
}

// Où poser la carte au-dessus d'un point (le haut de la tête d'un avatar, en pixels de la page) : centrée sur lui, gardée dans la page.
export function placeAbove(point: { x: number; y: number }, card: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number } {
  return {
    left: Math.min(Math.max(point.x - card.width / 2, EDGE), Math.max(EDGE, viewport.width - EDGE - card.width)),
    top: Math.min(Math.max(point.y - GAP - card.height, EDGE), Math.max(EDGE, viewport.height - EDGE - card.height)),
  };
}

type Placer = (card: { width: number; height: number }, viewport: { width: number; height: number }) => { left: number; top: number } | null;

// La carte posée à la page (position fixe), là où `place` la veut : mesurée d'abord, cachée le temps de la mesure ; replacée quand la page change de
// taille ou que la liste défile. Elle ne prend jamais la souris. `place` qui ne trouve plus où la poser (null : l'ancre a disparu, la personne est
// passée d'une liste à l'autre) l'emporte.
export function FloatingTimeCard({ id, info, place, onGone }: { id?: string; info: LocalTimeInfo; place: Placer; onGone(): void }) {
  const element = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    const replace = () => {
      const { clientWidth, clientHeight } = document.documentElement;
      const card = element.current;
      const at = place({ width: card?.offsetWidth ?? 0, height: card?.offsetHeight ?? 0 }, { width: clientWidth, height: clientHeight });
      if (at === null) onGone();
      else setStyle(at);
    };
    replace();
    window.addEventListener('resize', replace);
    // `true` : le défilement de la liste (un élément, pas la page) arrive aussi.
    window.addEventListener('scroll', replace, true);
    return () => {
      window.removeEventListener('resize', replace);
      window.removeEventListener('scroll', replace, true);
    };
  }, [place, onGone]);

  return (
    <div ref={element} id={id} role="tooltip" className="time-card-float" style={style}>
      <LocalTimeCard {...info} />
    </div>
  );
}

// La carte de l'heure locale au survol, ou au focus du clavier, de ce qu'on lui confie : `bind(id)` donne à un élément (une ligne) ce qu'il faut pour
// cela (il devient focalisable, et sa carte le décrit pour les lecteurs d'écran) ; `card` est la carte du moment, à poser une fois dans le panneau.
// `lookup` dit, à chaque rendu, le fuseau et le nom de la personne `id` : la carte suit un fuseau qui change sous le pointeur. Échap la ferme sans
// fermer le panneau ; le pointeur qui sort, ou le focus qui part, aussi.
export function useLocalTimeHover(lookup: (id: string) => LocalTimeInfo | undefined) {
  const [target, setTarget] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cardId = useId();

  const cancel = () => {
    clearTimeout(pending.current);
    pending.current = undefined;
  };
  useEffect(() => cancel, []);
  const hide = useCallback(() => setTarget(null), []);

  const bind = (id: string) => ({
    tabIndex: 0,
    'aria-describedby': target?.id === id ? cardId : undefined,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      // Au doigt, pas de survol : un appui donne le focus, qui montre la carte.
      if (event.pointerType === 'touch') return;
      const anchor = event.currentTarget;
      cancel();
      pending.current = setTimeout(() => setTarget({ id, anchor }), LOCAL_TIME_HOVER_MS);
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      cancel();
      const anchor = event.currentTarget;
      setTarget((shown) => (shown?.id === id && document.activeElement !== anchor ? null : shown));
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      cancel();
      setTarget({ id, anchor: event.currentTarget });
    },
    onBlur: () => {
      cancel();
      setTarget((shown) => (shown?.id === id ? null : shown));
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Escape' || target?.id !== id) return;
      event.preventDefault();
      event.stopPropagation();
      setTarget(null);
    },
  });

  const anchor = target?.anchor ?? null;
  const place = useCallback<Placer>((card, viewport) => (anchor?.isConnected ? placeBeside(anchor.getBoundingClientRect(), card, viewport) : null), [anchor]);
  const info = target ? lookup(target.id) : undefined;
  const card = target && info ? <FloatingTimeCard id={cardId} info={info} place={place} onGone={hide} /> : null;
  return { bind, card };
}
