import {
  DECOR_STEPS,
  GYM_PLACE_KEY,
  STEP_OFF_APART_PX,
  speedOf,
  treadmillBelt,
  treadmillFootprint,
  treadmillStepOff,
  treadmillsIn,
  type ActivityState,
  type DeskInfo,
  type OfficeMap,
  type Point,
  type TreadmillRef,
} from '@bureau/shared';
import { stepAnimationScale } from './step-animation';

// Le tapis de course, côté client (packages/shared/src/decor/treadmill.ts dit où l'on court et où l'on descend). Ce fichier n'importe pas Phaser :
// - le menu « Moi » propose de prendre un mode sur son tapis (offersTreadmill) ;
// - on court sur place, la marche vers le haut à la cadence de la course (RUN_IN_PLACE_SCALE), devant le tapis (treadmillRun : où, et à quelle profondeur),
//   tant que ses pieds sont sur la bande (runningAt) ;
// - une touche de déplacement fait descendre à la case libre devant le tapis (stepOffSpot), celle que le serveur choisirait ;
// - le tapis sous qui court tourne (spinningTreadmills, treadmillKey) : la planche animée du pack recouvre l'image du décor, TREADMILL_SHEET_OFFSET_Y plus bas.

// La cadence des pas de qui court sur son tapis : celle de la course (Maj), plus vive que la marche.
export const RUN_IN_PLACE_SCALE = stepAnimationScale(speedOf(true, false));

// L'image du décor est la première de la planche animée, plus bas de 14 px dans sa case : posée 14 px plus bas que l'image, la planche la recouvre exactement.
export const TREADMILL_SHEET_OFFSET_Y = 14;

// Le menu propose-t-il de prendre ce mode sur son tapis de course ? Quand il conduit à la salle de sport (une destination de cette carte) et que la pièce de
// la personne (`desk` : sa place, s'il en a une) a au moins un tapis.
export function offersTreadmill(mode: Pick<ActivityState, 'place'>, map: Pick<OfficeMap, 'places'> | null, desk: Pick<DeskInfo, 'items'> | undefined): boolean {
  if (mode.place !== GYM_PLACE_KEY || !map?.places.some((place) => place.key === GYM_PLACE_KEY && place.destination)) return false;
  return desk !== undefined && treadmillsIn(desk.items).length > 0;
}

// La clé d'un tapis : son bureau et sa place, au dixième près (les places de la déco le sont toujours ; un nombre à virgule mal arrondi n'y change rien).
export const treadmillKey = (ref: TreadmillRef): string => `${ref.desk}:${Math.round(ref.x * DECOR_STEPS)}:${Math.round(ref.y * DECOR_STEPS)}`;

// Une course telle que le jeu la dessine : le tapis, les pieds sur sa bande, et la profondeur de l'avatar, juste devant le tapis (l'image d'un meuble a pour
// profondeur le bas de son empreinte, et les pieds sont plus haut, sur la bande : sans cela, le tapis le cacherait) ; son ombre, juste derrière lui, reste devant
// le tapis. null : un tapis d'un bureau que cette carte n'a pas.
export interface TreadmillRun {
  ref: TreadmillRef;
  belt: Point;
  depth: number;
}

export function treadmillRun(map: OfficeMap, ref: TreadmillRef | null | undefined): TreadmillRun | null {
  if (!ref) return null;
  const belt = treadmillBelt(map, ref);
  const footprint = treadmillFootprint(map, ref);
  return belt && footprint ? { ref, belt, depth: footprint.bottom + 2 } : null;
}

// Ces pieds (dessinés) sont-ils sur la bande ?
export const onBelt = (feet: Point, run: TreadmillRun): boolean => Math.abs(feet.x - run.belt.x) <= 1 && Math.abs(feet.y - run.belt.y) <= 1;

// La course qu'on dessine : celle que le serveur dit (`run`), tant que les pieds sont sur la bande ; null sinon. Un autre avatar ne court qu'une fois dessiné là :
// avant (son saut, avec son retard), il marche encore. Descendu (un pas, un saut ailleurs), on ne court plus, sans attendre que le serveur le dise.
export const runningAt = (run: TreadmillRun | null, feet: Point): TreadmillRun | null => (run !== null && onBelt(feet, run) ? run : null);

// Où descendre de ce tapis : la case libre devant lui, d'après la déco de sa pièce telle que le serveur l'a dite (`desks`) et loin des autres (`others` : leurs
// pieds), comme le serveur la choisit (treadmillStepOff) ; null : aucune (le bureau n'est pas sur la carte).
export function stepOffSpot(map: OfficeMap, ref: TreadmillRef, desks: readonly Pick<DeskInfo, 'key' | 'items'>[], others: readonly Point[]): Point | null {
  const items = desks.find((desk) => desk.key === ref.desk)?.items ?? [];
  return treadmillStepOff(map, ref, items, others, STEP_OFF_APART_PX);
}

// Les tapis qui tournent : ceux où quelqu'un court tel qu'on le voit (soi, et les autres une fois sur la bande), chacun une fois.
export function spinningTreadmills(runs: ReadonlyArray<TreadmillRun | null>): Set<string> {
  return new Set(runs.flatMap((run) => (run ? [treadmillKey(run.ref)] : [])));
}
