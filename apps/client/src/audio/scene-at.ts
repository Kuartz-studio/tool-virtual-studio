import { GRAND_HALL, LOUNGE, LOUNGE_MUSIC_X, LOUNGE_TERRACE_WIDTH, MEETING_ROOM, PLAZA, zoneAt, type OfficeMap } from '@bureau/shared';
import type { SceneId } from './catalog';

// L'ambiance que demande un endroit du bureau. C'est un choix de décor, à régler ici :
//   - les bureaux et la salle de réunion : « focus », du chill pour travailler ;
//   - la grande salle : « drift », étrange et planant ;
//   - la zone détente, d'ouest en est : la terrasse de la piscine en « sunny », le salon en « dusk », le coin musique en « quest » ;
//   - la place centrale (le café) : « sunny » ;
//   - partout ailleurs, le couloir et l'accueil : « lobby », la salle d'attente.
// Hors du bureau (la connexion, l'écran d'entrée, le jeu qui charge), c'est aussi « lobby ».
export const OUTSIDE_SCENE: SceneId = 'lobby';

interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Cette case est-elle dans ce rectangle (en cases) ?
const inside = (area: Area, tx: number, ty: number): boolean => tx >= area.x && tx < area.x + area.w && ty >= area.y && ty < area.y + area.h;

// L'ambiance de l'endroit où sont les pieds (x, y), en pixels. Seule la grande carte (`office`) a ses ambiances par endroit ; une autre carte
// (celle des tests) n'a que la concentration, partout.
export function sceneAt(map: OfficeMap | null, mapKey: string | null, x: number, y: number): SceneId {
  if (map === null) return OUTSIDE_SCENE;
  if (zoneAt(map, x, y, ['desk']) !== null) return 'focus';
  if (mapKey !== 'office') return 'focus';

  const tx = Math.floor(x / map.tileSize);
  const ty = Math.floor(y / map.tileSize);
  if (inside(MEETING_ROOM, tx, ty)) return 'focus';
  if (inside(GRAND_HALL, tx, ty)) return 'drift';
  if (inside(LOUNGE, tx, ty)) {
    if (tx < LOUNGE.x + LOUNGE_TERRACE_WIDTH) return 'sunny';
    return tx < LOUNGE_MUSIC_X ? 'dusk' : 'quest';
  }
  if (inside(PLAZA, tx, ty)) return 'sunny';
  return OUTSIDE_SCENE;
}
