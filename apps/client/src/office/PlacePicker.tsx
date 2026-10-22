import type { OfficeMap } from '@bureau/shared';
import type { KeyboardEvent } from 'react';

// Les pièces où un mode peut conduire (les destinations de la carte : la salle de sport, la salle de jeu), sur une mini-carte : toutes les pièces de la carte en fond, et les
// destinations en boutons. Un clic en choisit une, un clic sur celle qui est choisie la retire (sans emplacement, on ne bouge pas) ; Entrée et Espace font de même. Sans carte
// (le jeu n'est pas là), ou sur une carte sans destination (celle des tests), il n'y a rien à choisir : le sélecteur n'est pas là non plus.
export interface PlacePickerProps {
  map: OfficeMap | null;
  // La clé de l'emplacement choisi, ou undefined (aucun).
  value: string | undefined;
  onChange(place: string | undefined): void;
}

export function PlacePicker({ map, value, onChange }: PlacePickerProps) {
  if (map === null) return null;
  const destinations = map.places.filter((place) => place.destination);
  if (destinations.length === 0) return null;
  const width = map.widthTiles * map.tileSize;
  const height = map.heightTiles * map.tileSize;
  const toggle = (key: string) => onChange(value === key ? undefined : key);
  const onKey = (event: KeyboardEvent<SVGGElement>, key: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle(key);
  };

  return (
    <svg className="place-picker" viewBox={`0 0 ${width} ${height}`} role="group" preserveAspectRatio="xMidYMid meet">
      {map.places
        .filter((place) => !place.destination)
        .map((place) => place.rects.map((rect, index) => <rect key={`${place.key}:${index}`} className="place-room" x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={24} />))}
      {destinations.map((place) =>
        place.rects.map((rect, index) => (
          <g
            key={`${place.key}:${index}`}
            className="place-destination"
            role="button"
            tabIndex={0}
            aria-label={place.label}
            aria-pressed={value === place.key}
            onClick={() => toggle(place.key)}
            onKeyDown={(event) => onKey(event, place.key)}
          >
            <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={24} />
            <text x={rect.x + rect.width / 2} y={rect.y + rect.height / 2} textAnchor="middle" dominantBaseline="middle">
              {place.label}
            </text>
          </g>
        )),
      )}
    </svg>
  );
}
