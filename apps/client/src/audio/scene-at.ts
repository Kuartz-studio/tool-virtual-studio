import { placeAt, zoneAt, type OfficeMap } from '@bureau/shared';
import type { SceneId } from './catalog';

// L'ambiance que demande un endroit du bureau : celle que la carte donne à son lieu (la propriété `scene` de la zone `place`, packages/shared/src/map).
// C'est un choix de décor, qui se règle dans la carte (map/office.ts) :
//   - les bureaux et la salle de réunion : « focus », du chill pour travailler ;
//   - la salle de conférence : « drift », étrange et planant ; la salle de sport et l'octogone : « quest » ; la salle de jeu : « dusk » ;
//   - le café et la détente (la piscine, le salon, le coin musique) : « sunny » ;
//   - partout ailleurs, la place, l'accueil et les rues : « lobby », la salle d'attente.
// Hors du bureau (la connexion, l'écran d'entrée, le jeu qui charge), c'est aussi « lobby ».
export const OUTSIDE_SCENE: SceneId = 'lobby';

// Où l'on est pour le son : l'ambiance par défaut de l'endroit où sont les pieds (x, y), en pixels (sceneAt), et la clé de la pièce dont on y règle la musique : le lieu de
// la carte qui contient le point (le plus petit : le café dans la place), s'il a une enceinte, un bureau compris (`desk:A1`) ; sinon null (la rue, la place,
// un mur : leur ambiance par défaut joue toujours). La musique elle-même, réglée par ceux qui sont dans la pièce, est au magasin du bureau (selectWantedScene).
export function soundAt(map: OfficeMap | null, x: number, y: number): { scene: SceneId; key: string | null } {
  const scene = sceneAt(map, x, y);
  if (map === null) return { scene, key: null };
  const place = placeAt(map, x, y);
  return { scene, key: place !== null && place.music ? place.key : null };
}

// L'ambiance de l'endroit où sont les pieds (x, y), en pixels. Une carte qui ne déclare aucun lieu (celle des tests) n'a que la concentration, partout ;
// un point hors de tout lieu (un mur) est dans la salle d'attente.
export function sceneAt(map: OfficeMap | null, x: number, y: number): SceneId {
  if (map === null) return OUTSIDE_SCENE;
  if (zoneAt(map, x, y, ['desk']) !== null) return 'focus';
  if (map.places.length === 0) return 'focus';
  return placeAt(map, x, y)?.scene ?? OUTSIDE_SCENE;
}
