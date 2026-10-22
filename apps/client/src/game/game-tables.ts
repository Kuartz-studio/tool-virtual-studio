import { GAME_TABLE_REACH_TILES, TILE_SIZE, type GameTable, type Rect } from '@bureau/shared';
import { fr, t } from '../i18n/fr';
import type { Interactable } from './interactions';

// Les tables de jeu, côté jeu : chacune est une cible de la touche E (interactions.ts) qui ouvre son panneau, et la caméra s'y centre quand il est ouvert. Ce fichier ne dépend pas de
// Phaser : la scène pose la zone cliquable sur la table, et lui demande où regarder.

// Ce que la personne et la table sont l'une pour l'autre, au moment de lire l'étiquette : assise à la table, ou non ; une partie y est en cours, ou non.
export interface TableState {
  seated: boolean;
  playing: boolean;
}

// L'étiquette « [E] … » se pose au-dessus de la table, un peu plus haut que la chaise du haut.
const LABEL_RISE_PX = TILE_SIZE;

// La table d'un jeu, cible de la touche E : « [E] Échecs : jouer », ou « regarder la partie » quand une partie y est en cours et qu'on n'y est pas assis. La portée se compte
// depuis le bord de la table (GAME_TABLE_REACH_TILES cases), non depuis son centre : une table fait trois cases de large, et ses chaises sont à une case et demie de son centre.
// Actionnée, elle ne change rien d'elle-même : elle demande l'ouverture du panneau (onUse).
export function gameTableTarget(table: GameTable, state: () => TableState, onUse: () => void): Interactable {
  const pos = { x: table.rect.x + table.rect.width / 2, y: table.rect.y + table.rect.height / 2 };
  return {
    id: `game:${table.game}`,
    pos,
    reachTiles: GAME_TABLE_REACH_TILES + Math.max(table.rect.width, table.rect.height) / 2 / TILE_SIZE,
    labelAt: { x: pos.x, y: table.rect.y - LABEL_RISE_PX },
    prompt: () => {
      const { seated, playing } = state();
      return t(fr.games.prompt, { game: fr.games.names[table.game], action: playing && !seated ? fr.games.watch : fr.games.play });
    },
    use: onUse,
  };
}

// La largeur que le panneau d'un jeu prend à droite de l'écran (440 px, plus la marge), et la largeur sous laquelle il devient une feuille en bas (720 px, comme le CSS).
export const GAME_PANEL_WIDTH_PX = 456;
const SHEET_BREAKPOINT_PX = 720;
// Sous cette largeur, la feuille couvre 70 % de la hauteur : la table se pose dans les 30 % du haut, soit 35 % de la hauteur au-dessus du centre de l'écran.
const SHEET_SHIFT = 0.35;

// Le point de la carte où la caméra se centre pour montrer cette table dans la partie de l'écran que le panneau laisse libre, à ce zoom : sur un grand écran, la table est à gauche
// du panneau (le centre se décale vers la droite de la moitié du panneau) ; sur un téléphone, elle est dans le haut (le centre descend).
export function tableFocus(rect: Rect, zoom: number, canvas: { width: number; height: number }): [x: number, y: number] {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  if (canvas.width < SHEET_BREAKPOINT_PX) return [x, y + (SHEET_SHIFT * canvas.height) / zoom];
  return [x + GAME_PANEL_WIDTH_PX / 2 / zoom, y];
}
