import type { OfficeMap, PublicPlayer } from '@bureau/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EventBus } from '../game/EventBus';
import { listenOnBus } from '../net/office-connection';
import { selectDeskOf, useOfficeStore } from '../state/office-store';
import { deskKeyAt, placeAt } from './where';

// Les positions des autres changent dix fois par seconde sans prévenir React (le magasin les tient à part) : ceux qui lisent où sont les
// autres (la puce du lieu, le filtre « Ici » de Personnes) les relisent deux fois par seconde.
const REFRESH_MS = 500;

// Ce que l'on sait de l'endroit où sont les pieds de l'avatar local : `read` les prend (en pixels) et rend ce qui intéresse l'appelant (le nom du
// lieu, la clé du bureau…). Les pieds sont ceux de l'arrivée, puis ceux que le jeu envoie en marchant (`local:move`) ; sans carte (le jeu n'est
// pas encore là), null. `read` doit être stable (useCallback) : quand il change, la valeur est relue aux derniers pieds connus. Le composant
// ne se redessine que quand la valeur change : `read` rend une valeur simple (un nom, un booléen), pas un objet.
export function useFeetValue<T>(read: (x: number, y: number, map: OfficeMap) => T): T | null {
  const map = useOfficeStore((state) => state.officeMap);
  const feet = useRef<{ x: number; y: number } | null>(null);
  const [value, setValue] = useState<T | null>(null);

  useEffect(() => {
    if (map === null) {
      feet.current = null;
      setValue(null);
      return;
    }
    const start = feet.current ?? useOfficeStore.getState().self ?? map.spawn;
    feet.current = { x: start.x, y: start.y };
    setValue(read(start.x, start.y, map));
    return listenOnBus(EventBus, 'local:move', (move) => {
      feet.current = { x: move.x, y: move.y };
      setValue(read(move.x, move.y, map));
    });
  }, [map, read]);

  return value;
}

// Le nom du lieu où l'on est (placeAt, où que l'on regarde : la puce, Personnes). null sans carte.
export function usePlace(): string | null {
  const desks = useOfficeStore((state) => state.desks);
  const mapKey = useOfficeStore((state) => state.mapKey);
  return useFeetValue(useCallback((x: number, y: number, map: OfficeMap) => placeAt(map, mapKey, desks, x, y), [desks, mapKey]));
}

// Est-on dans son propre bureau ? Faux sans bureau à soi, sans carte, et dans le bureau de quelqu'un d'autre.
export function useInMyDesk(): boolean {
  const desks = useOfficeStore((state) => state.desks);
  const selfId = useOfficeStore((state) => state.selfId);
  const mine = useMemo(() => selectDeskOf({ desks }, selfId)?.key ?? null, [desks, selfId]);
  return useFeetValue(useCallback((x: number, y: number, map: OfficeMap) => mine !== null && deskKeyAt(map, x, y) === mine, [mine])) ?? false;
}

const NO_PLACES: ReadonlyMap<string, string> = new Map();

// Où est chacun des autres : le nom de son lieu (placeAt), d'après sa dernière position connue, par identifiant. Relu deux fois par seconde (les
// positions ne préviennent pas React) ; ne redessine que quand un lieu change. Sans carte, personne n'a de lieu.
export function usePlaces(): ReadonlyMap<string, string> {
  const map = useOfficeStore((state) => state.officeMap);
  const mapKey = useOfficeStore((state) => state.mapKey);
  const desks = useOfficeStore((state) => state.desks);
  const players = useOfficeStore((state) => state.players);
  const [places, setPlaces] = useState(NO_PLACES);

  useEffect(() => {
    if (map === null) {
      setPlaces(NO_PLACES);
      return;
    }
    const refresh = () => {
      const { positions } = useOfficeStore.getState();
      const next = new Map<string, string>();
      for (const player of Object.values(players)) {
        const at = positions.get(player.id) ?? player;
        const place = placeAt(map, mapKey, desks, at.x, at.y);
        if (place !== null) next.set(player.id, place);
      }
      setPlaces((known) => (known.size === next.size && [...next].every(([id, place]) => known.get(id) === place) ? known : next));
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [map, mapKey, desks, players]);

  return places;
}

// Les autres qui sont dans ce lieu (leurs dernières positions connues), dans l'ordre des noms.
export function usePeopleHere(place: string | null): PublicPlayer[] {
  const players = useOfficeStore((state) => state.players);
  const places = usePlaces();
  return useMemo(
    () =>
      place === null
        ? []
        : Object.values(players)
            .filter((player) => places.get(player.id) === place)
            .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    [players, places, place],
  );
}
