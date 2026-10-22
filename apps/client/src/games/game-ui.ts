import { GAMES, type AnyGameDefinition, type GameId } from '@bureau/shared';
import type { AnyGameUi } from './types';

// Le module d'un jeu, côté client : ses règles (le registre partagé : `GAMES`) et son interface (`games/<jeu>/index.tsx`, chargée à la demande : chaque jeu, sa feuille de
// style comprise, est un fichier à part du build, que le navigateur ne lit qu'à l'ouverture de sa table).
export interface GameModule {
  def: AnyGameDefinition;
  ui: AnyGameUi;
}

const interfaces = import.meta.glob<{ default: AnyGameUi }>('./*/index.tsx');

// Le module de ce jeu, ou null s'il n'y est pas (ses règles ne sont pas au registre, ou il n'a pas d'interface) : sa table reste fermée (« Bientôt disponible »). Une interface qui
// ne se charge pas (le réseau, un fichier absent) rejette : l'appelant le dit.
export async function loadGameModule(game: GameId): Promise<GameModule | null> {
  const def = GAMES[game];
  const load = interfaces[`./${game}/index.tsx`];
  if (!def || !load) return null;
  const { default: ui } = await load();
  return { def, ui };
}
