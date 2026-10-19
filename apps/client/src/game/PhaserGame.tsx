// D'après le modèle officiel phaserjs/template-react-ts (© 2025 Phaser Studio Inc, licence MIT : LICENSE-phaser-template.txt).
import { forwardRef, useEffect, useLayoutEffect, useRef } from 'react';
import { EventBus } from './EventBus';
import StartGame from './main';

export interface IRefPhaserGame {
  game: Phaser.Game | null;
  scene: Phaser.Scene | null;
}

interface IProps {
  currentActiveScene?: (sceneInstance: Phaser.Scene) => void;
}

// Le pont entre React et Phaser : crée le jeu dans #game-container, et expose le jeu et la scène active par la ref.
// Pas encore monté : le bureau provisoire (OfficePage) n'affiche pas la carte avant la tâche 10.
export const PhaserGame = forwardRef<IRefPhaserGame, IProps>(function PhaserGame({ currentActiveScene }, ref) {
  const game = useRef<Phaser.Game | null>(null);

  useLayoutEffect(() => {
    if (game.current === null) {
      game.current = StartGame('game-container');
      if (typeof ref === 'function') ref({ game: game.current, scene: null });
      else if (ref) ref.current = { game: game.current, scene: null };
    }
    return () => {
      game.current?.destroy(true);
      game.current = null;
    };
  }, [ref]);

  useEffect(() => {
    EventBus.on('current-scene-ready', (sceneInstance: Phaser.Scene) => {
      currentActiveScene?.(sceneInstance);
      if (typeof ref === 'function') ref({ game: game.current, scene: sceneInstance });
      else if (ref) ref.current = { game: game.current, scene: sceneInstance };
    });
    return () => {
      EventBus.removeListener('current-scene-ready');
    };
  }, [currentActiveScene, ref]);

  return <div id="game-container"></div>;
});
