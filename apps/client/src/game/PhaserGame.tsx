// D'après le modèle officiel phaserjs/template-react-ts (© 2025 Phaser Studio Inc, licence MIT : LICENSE-phaser-template.txt).
import { forwardRef, useEffect, useLayoutEffect, useRef } from 'react';
import { startGame } from './config';
import { EventBus } from './EventBus';

export interface IRefPhaserGame {
  game: Phaser.Game | null;
  scene: Phaser.Scene | null;
}

interface IProps {
  // La carte du bureau (celle de l'init du serveur) : le jeu charge /assets/maps/<mapKey>.json.
  mapKey: string;
  currentActiveScene?: (sceneInstance: Phaser.Scene) => void;
}

// Le pont entre React et Phaser : crée le jeu dans #game-container (que le style étend à la page), et expose le jeu et la scène
// active par la ref. Un autre mapKey recrée le jeu. Qui joue, où, et qui est là, le bureau le lit au magasin à sa création, puis
// suit le bus : le jeu n'a pas d'autre propriété.
export const PhaserGame = forwardRef<IRefPhaserGame, IProps>(function PhaserGame({ mapKey, currentActiveScene }, ref) {
  const game = useRef<Phaser.Game | null>(null);

  useLayoutEffect(() => {
    if (game.current === null) {
      game.current = startGame('game-container', mapKey);
      if (typeof ref === 'function') ref({ game: game.current, scene: null });
      else if (ref) ref.current = { game: game.current, scene: null };
    }
    return () => {
      game.current?.destroy(true);
      game.current = null;
    };
  }, [ref, mapKey]);

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
