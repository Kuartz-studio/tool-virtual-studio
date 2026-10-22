// La cadence de l'animation des pas (six images par direction, le même dessin à toute vitesse) suit la vitesse de l'avatar, mais moins vite qu'elle :
// à 160 px/s (la marche d'avant la mise à jour) le dessin joue à sa cadence ; à 480 px/s (la course) il joue RUN_ANIMATION_SCALE fois plus vite, sans
// aller à trois fois la cadence ; au-delà (la marche d'aujourd'hui, le café), en proportion. Jamais plus lente que le dessin.
export const RUN_ANIMATION_SCALE = 1.7;
const DRAWN_SPEED_PX_PER_S = 160;
const RUN_SPEED_PX_PER_S = 480;

export function stepAnimationScale(speed: number): number {
  return Math.max(1, 1 + ((speed - DRAWN_SPEED_PX_PER_S) / (RUN_SPEED_PX_PER_S - DRAWN_SPEED_PX_PER_S)) * (RUN_ANIMATION_SCALE - 1));
}
