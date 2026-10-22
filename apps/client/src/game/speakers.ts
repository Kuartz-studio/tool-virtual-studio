import type { RoomMusic } from '@bureau/shared';
import { fr } from '../i18n/fr';
import type { Interactable, Point } from './interactions';

// Les enceintes : une par pièce qui a de la musique (OfficeMap.speakers, la case où l'amplificateur se tient). Chacune est une cible de la touche E (interactions.ts) qui
// coupe ou relance la musique de sa pièce, pour tous ceux qui y sont ; l'amplificateur tourne tant que la pièce joue. Ce fichier ne dépend pas de Phaser : la scène dessine les
// amplificateurs (PropLayer).

// De combien de cases on actionne une enceinte, en ligne droite depuis les pieds : comme la machine à café.
export const SPEAKER_REACH_TILES = 2;

// L'étiquette « [E] … » se pose au-dessus de l'amplificateur, qui monte de plusieurs cases au-dessus de sa case.
const LABEL_RISE_PX = 52;

// La pièce joue-t-elle ? Tant que personne ne l'a éteinte : sans état, ou avec une ambiance réglée, oui.
export const speakerPlaying = (state: RoomMusic | undefined): boolean => state?.on !== false;

// L'enceinte `speaker` (le centre de sa case, en pixels, et la clé de sa pièce), cible de la touche E : « [E] Couper la musique » quand sa pièce joue, « [E] Lancer la musique »
// quand elle est coupée. `state` dit ce que la pièce joue maintenant (le magasin du bureau) ; actionnée, elle ne change rien d'elle-même : elle demande l'état contraire
// (`onUse`), et la musique ne change qu'à l'annonce du serveur.
export function speakerTarget(
  speaker: Point & { place: string },
  state: () => RoomMusic | undefined,
  onUse: (request: { place: string; on: boolean }) => void,
): Interactable {
  return {
    id: `speaker:${speaker.place}`,
    pos: speaker,
    reachTiles: SPEAKER_REACH_TILES,
    labelAt: { x: speaker.x, y: speaker.y - LABEL_RISE_PX },
    prompt: () => `[E] ${speakerPlaying(state()) ? fr.roomMusic.mute : fr.roomMusic.play}`,
    use: () => onUse({ place: speaker.place, on: !speakerPlaying(state()) }),
  };
}

// Les images qui contiennent cette enceinte : celles dont le rectangle (l'origine au bas à gauche : x, y et la taille affichée) a le centre de sa case. Une enceinte est posée
// sur un amplificateur ; il peut y en avoir un second tout près (un petit à côté du grand).
export function speakerSprites<T extends { x: number; y: number; displayWidth: number; displayHeight: number }>(speaker: Point, sprites: readonly T[]): T[] {
  return sprites.filter((s) => speaker.x >= s.x && speaker.x < s.x + s.displayWidth && speaker.y > s.y - s.displayHeight && speaker.y <= s.y);
}
