import type { GameId } from '@bureau/shared';
import { useEffect, useState } from 'react';
import { loadGameModule, type GameModule } from './game-ui';

// Où en est le module d'un jeu : en chargement, prêt (ses règles et son interface), absent (« Bientôt disponible » : le registre ne l'a pas) ou impossible à charger.
export type GameModuleState = { status: 'loading' } | { status: 'soon' } | { status: 'failed' } | { status: 'ready'; module: GameModule };

// Charge le module de ce jeu à l'ouverture de sa table (le chargement est paresseux : l'interface d'un jeu est un fichier à part du build). Sans jeu (`null`), rien n'est chargé.
export function useGameModule(game: GameId | null): GameModuleState {
  const [loaded, setLoaded] = useState<{ game: GameId; state: GameModuleState } | null>(null);

  useEffect(() => {
    if (game === null) return;
    let current = true;
    loadGameModule(game).then(
      (module) => current && setLoaded({ game, state: module ? { status: 'ready', module } : { status: 'soon' } }),
      () => current && setLoaded({ game, state: { status: 'failed' } }),
    );
    return () => {
      current = false;
    };
  }, [game]);

  return game === null || loaded?.game !== game ? { status: 'loading' } : loaded.state;
}
