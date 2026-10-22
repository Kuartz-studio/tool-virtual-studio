import { LUDO_STABLE, type LudoEvent } from '@bureau/shared/games/ludo';

// Le plan de l'animation d'un coup (§ 16.6 du document des jeux) : les images que le plateau montre, dans l'ordre, entre l'ancien état et le nouveau. Ce fichier ne mesure aucun temps :
// il dit ce qu'on montre et combien de temps on le garde ; les horloges sont dans use-board-motion.ts.

// Un cheval saute de case en case, 80 ms par case (sans mouvement réduit).
export const STEP_MS = 80;
// Un cheval pris revient à son écurie en 300 ms.
export const CAPTURE_MS = 300;
// Le dé roule environ 600 ms avant de s'arrêter sur la valeur du serveur, en changeant de face toutes les 80 ms.
export const DICE_ROLL_MS = 600;
export const DICE_FACE_MS = 80;

// Une image : les avancées de tous les chevaux (par siège), le temps qu'on la garde avant la suivante, et le cheval qui glisse jusqu'à sa nouvelle place au lieu d'y sauter (celui qu'on
// vient de prendre, qui rentre à l'écurie) ; les autres sautent.
export interface Frame {
  horses: number[][];
  ms: number;
  slide: { seat: number; horse: number } | null;
}

const copy = (horses: readonly (readonly number[])[]): number[][] => horses.map((row) => [...row]);

// Les images d'un lot d'événements, à partir de ce que le plateau montre. Un déplacement donne une image par case (une seule pour une sortie, qui pose le cheval sur son départ) ; une
// prise donne l'image où la victime rentre à l'écurie. Un lancer, un tour passé, le trait, la fin et une sortie de siège ne bougent aucun pion : sans déplacement, aucune image. Le
// dernier état de l'animation n'est pas une image : c'est l'état de la partie, que le plateau montre ensuite, quoi qu'il arrive.
export function planFrames(before: readonly (readonly number[])[], events: readonly LudoEvent[]): Frame[] {
  const frames: Frame[] = [];
  let horses = copy(before);
  for (const event of events) {
    if (event.type === 'move') {
      const advances = event.from === LUDO_STABLE ? [event.to] : Array.from({ length: event.to - event.from }, (_, i) => event.from + 1 + i);
      for (const advance of advances) {
        horses = copy(horses);
        horses[event.seat]![event.horse] = advance;
        frames.push({ horses, ms: STEP_MS, slide: null });
      }
    } else if (event.type === 'capture') {
      horses = copy(horses);
      horses[event.victim.seat]![event.victim.horse] = LUDO_STABLE;
      frames.push({ horses, ms: CAPTURE_MS, slide: { seat: event.victim.seat, horse: event.victim.horse } });
    }
  }
  return frames;
}
