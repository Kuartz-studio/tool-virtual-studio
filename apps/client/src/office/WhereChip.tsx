import type { PublicPlayer } from '@bureau/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { listenOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { PlaceIcon } from './icons';
import { AvatarPortrait } from './ui/AvatarPortrait';
import { placeAt } from './where';

// Combien de portraits la puce montre : au-delà, « +N ».
const PORTRAITS = 3;
// Les positions des autres changent dix fois par seconde sans prévenir React (le magasin les tient à part) : la puce les relit deux fois par
// seconde, comme le panneau Mon bureau.
const REFRESH_MS = 500;

// Le nom du lieu où l'on est, d'après les pieds de l'avatar local : ceux de l'arrivée, puis ceux que le jeu envoie en marchant (`local:move`).
// Ne redessine que quand le nom change.
function usePlace(): string | null {
  const map = useOfficeStore((state) => state.officeMap);
  const desks = useOfficeStore((state) => state.desks);
  const feet = useRef<{ x: number; y: number } | null>(null);
  const [place, setPlace] = useState<string | null>(null);

  useEffect(() => {
    if (map === null) {
      feet.current = null;
      setPlace(null);
      return;
    }
    const start = feet.current ?? useOfficeStore.getState().self ?? map.spawn;
    feet.current = { x: start.x, y: start.y };
    setPlace(placeAt(map, desks, start.x, start.y));
    return listenOnBus(EventBus, 'local:move', (move) => {
      feet.current = { x: move.x, y: move.y };
      setPlace(placeAt(map, desks, move.x, move.y));
    });
  }, [map, desks]);

  return place;
}

// Les autres qui sont dans ce lieu (leurs dernières positions connues), dans l'ordre des noms.
function usePeopleHere(place: string | null): PublicPlayer[] {
  const map = useOfficeStore((state) => state.officeMap);
  const desks = useOfficeStore((state) => state.desks);
  const players = useOfficeStore((state) => state.players);
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    if (map === null || place === null) {
      setIds([]);
      return;
    }
    const refresh = () => {
      const { positions } = useOfficeStore.getState();
      const here = Object.values(players)
        .filter((player) => {
          const at = positions.get(player.id) ?? player;
          return placeAt(map, desks, at.x, at.y) === place;
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
        .map((player) => player.id);
      setIds((known) => (known.length === here.length && known.every((id, index) => id === here[index]) ? known : here));
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [map, desks, players, place]);

  return useMemo(() => ids.flatMap((id) => (players[id] ? [players[id]] : [])), [ids, players]);
}

// La puce en haut à gauche : le nom du lieu où l'on est, et jusqu'à trois portraits de ceux qui y sont, puis « +N ». Sans carte (le jeu n'est
// pas encore là), rien.
export function WhereChip() {
  const place = usePlace();
  const here = usePeopleHere(place);
  if (place === null) return null;
  const extra = here.length - PORTRAITS;
  return (
    <div className="dock dock-where" role="group" aria-label={fr.office.where.label}>
      <PlaceIcon />
      <span className="where-name">{place}</span>
      {here.length > 0 && (
        <span className="where-stack">
          {here.slice(0, PORTRAITS).map((player) => (
            <AvatarPortrait key={player.id} avatarKey={player.avatarKey} name={player.name} size={22} />
          ))}
          {extra > 0 && (
            <em className="where-more" aria-hidden="true">
              +{extra}
            </em>
          )}
          <span className="visually-hidden">{here.length === 1 ? fr.office.where.onePerson : t(fr.office.where.manyPeople, { count: here.length })}</span>
        </span>
      )}
    </div>
  );
}
