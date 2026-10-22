import { COFFEE_REACH_TILES, TILE_SIZE } from '@bureau/shared';
import { fr } from '../i18n/fr';
import type { Interactable, Point } from './interactions';

// Le café, côté jeu : la machine du bar est une cible de la touche E (interactions.ts), qui s'agite un instant quand quelqu'un se sert. Ce fichier ne
// dépend pas de Phaser : la scène dessine la machine (PropLayer), la tasse (SteamCup) et les nuages de poussière (DustTrail).

// Quand quelqu'un se sert, l'animation de la machine tourne plus vite pendant ce temps (MACHINE_EXCITED_MS), de ce facteur.
export const MACHINE_EXCITED_MS = 1000;
export const MACHINE_EXCITED_SCALE = 3;

// La vitesse de l'animation de la machine à cet instant : accélérée jusqu'à `excitedUntil` (ms, horloge du jeu), normale ensuite.
export const machineTimeScale = (now: number, excitedUntil: number): number => (now < excitedUntil ? MACHINE_EXCITED_SCALE : 1);

// Ce qu'il reste d'un café en secondes entières, arrondies vers le haut (« 30 s » tout au début, « 1 s » jusqu'à la fin) ; 0 sans café ou une fois fini.
// `until` : son échéance, `now` : l'heure, sur la même horloge (celle de la page).
export const secondsLeft = (until: number | undefined, now: number): number => (until === undefined ? 0 : Math.max(0, Math.ceil((until - now) / 1000)));

// L'étiquette « [E] … » se pose au-dessus de la machine (qui monte à 2 cases au-dessus de la case où l'on se sert), pas sur la tête de qui s'y sert.
const LABEL_RISE_PX = 3 * TILE_SIZE;

// La machine à café dont la case de service est en `pos` (OfficeMap.coffees, le centre de la case, en pixels), cible de la touche E : « [E] Prendre un café »,
// à COFFEE_REACH_TILES cases au plus (la règle du serveur : withinCoffeeReach). Actionnée, elle ne change rien d'elle-même : elle demande (onUse), et le
// café ne commence qu'à l'annonce du serveur.
export function coffeeTarget(pos: Point, onUse: () => void): Interactable {
  return {
    id: `coffee:${pos.x},${pos.y}`,
    pos,
    reachTiles: COFFEE_REACH_TILES,
    labelAt: { x: pos.x, y: pos.y - LABEL_RISE_PX },
    prompt: () => `[E] ${fr.coffee.take}`,
    use: onUse,
  };
}
