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
  return useFeetValue(useCallback((x: number, y: number, map: OfficeMap) => placeAt(map, desks, x, y), [desks]));
}

// Est-on dans son propre bureau ? Faux sans bureau à soi, sans carte, et dans le bureau de quelqu'un d'autre.
export function useInMyDesk(): boolean {
  const desks = useOfficeStore((state) => state.desks);
  const selfId = useOfficeStore((state) => state.selfId);
  const mine = useMemo(() => selectDeskOf({ desks }, selfId)?.key ?? null, [desks, selfId]);
  return useFeetValue(useCallback((x: number, y: number, map: OfficeMap) => mine !== null && deskKeyAt(map, x, y) === mine, [mine])) ?? false;
}

// Les autres qui sont dans ce lieu (leurs dernières positions connues), dans l'ordre des noms.
export function usePeopleHere(place: string | null): PublicPlayer[] {
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
