import { COFFEE_SPEED_FACTOR, SPRINT_FACTOR, WALK_SPEED_PX_PER_S } from '../constants';

// La vitesse de l'avatar, en px/s : 320 à la marche, 480 en courant (Maj), 640 sous café, 960 en courant sous café. Le client la lit pour avancer ;
// le serveur ne la lit pas : il ne connaît que la plus grande permise (NORMAL_MAX_SPEED_PX_PER_S, ou MAX_SPEED_PX_PER_S sous café).
export function speedOf(sprint: boolean, boosted: boolean): number {
  return WALK_SPEED_PX_PER_S * (sprint ? SPRINT_FACTOR : 1) * (boosted ? COFFEE_SPEED_FACTOR : 1);
}
