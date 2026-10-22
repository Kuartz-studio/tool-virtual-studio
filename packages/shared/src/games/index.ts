import * as registry from './registry';
import type { AnyGameDefinition, GameId } from './types';

export * from './types';
export * from './rng';
export * from './elo';
export * from './protocol';
export * from './arrival';

// Les jeux connus, par identifiant. Un jeu absent du registre (pas encore fusionné) n'existe pas : sa table reste fermée (« Bientôt disponible »).
export const GAMES: Partial<Record<GameId, AnyGameDefinition>> = Object.fromEntries(
  Object.values(registry as Record<string, AnyGameDefinition>).map((definition) => [definition.id, definition]),
);
