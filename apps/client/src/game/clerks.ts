import { CLERK_REACH_TILES, CLERK_STAY_TILES, TILE_SIZE } from '@bureau/shared';
import { fr, t } from '../i18n/fr';
import type { Interactable, Point } from './interactions';

// Les administratrices de l'accueil (OfficeMap.clerks : la case de chacune, derrière le comptoir, et sa clé) : chacune est une cible de la touche E
// (interactions.ts), « [E] Parler à Margot », qui ouvre la conversation (le magasin : `clerk`). Ce fichier ne dépend pas de Phaser : la scène dessine les
// réceptionnistes (PropLayer) et suit la distance.

// L'étiquette « [E] … » se pose au-dessus de sa tête : la réceptionniste monte de deux cases au-dessus de sa case.
const LABEL_RISE_PX = 58;

export function clerkName(clerk: string): string {
  return fr.clerks.names[clerk as keyof typeof fr.clerks.names] ?? clerk;
}

export function clerkTarget(clerk: Point & { name: string }, onTalk: (clerk: string) => void): Interactable {
  return {
    id: `clerk:${clerk.name}`,
    pos: clerk,
    reachTiles: CLERK_REACH_TILES,
    labelAt: { x: clerk.x, y: clerk.y - LABEL_RISE_PX },
    prompt: () => t(fr.clerks.talk, { name: clerkName(clerk.name) }),
    use: () => onTalk(clerk.name),
  };
}

// La conversation avec cette administratrice tient-elle encore, les pieds de l'avatar ici ? Au-delà de CLERK_STAY_TILES cases, elle se ferme (comme le serveur refuse
// alors une mission). Une administratrice que la carte n'a pas : non.
export function stillWithClerk(clerks: ReadonlyArray<Point & { name: string }>, clerk: string, feet: Point): boolean {
  const at = clerks.find((candidate) => candidate.name === clerk);
  return at !== undefined && Math.hypot(at.x - feet.x, at.y - feet.y) <= CLERK_STAY_TILES * TILE_SIZE;
}
