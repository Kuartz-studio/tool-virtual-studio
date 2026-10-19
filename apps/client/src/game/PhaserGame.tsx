// D'après le modèle officiel phaserjs/template-react-ts (© 2025 Phaser Studio Inc, licence MIT : LICENSE-phaser-template.txt).
import { forwardRef, useEffect, useLayoutEffect, useRef } from 'react';
import { startGame } from './config';
import { EventBus } from './EventBus';
import type { SelfProfile } from './scenes/Office';

export interface IRefPhaserGame {
  game: Phaser.Game | null;
  scene: Phaser.Scene | null;
}

interface IProps {
  // La carte du bureau : le jeu charge /assets/maps/<mapKey>.json.
  mapKey: string;
  // Qui joue : le jeu en a besoin à sa création (l'avatar apparaît), pas après.
  self: SelfProfile;
  currentActiveScene?: (sceneInstance: Phaser.Scene) => void;
}

// Le pont entre React et Phaser : crée le jeu dans #game-container (que le style étend à la page), et expose le jeu et la scène
// active par la ref. Un autre mapKey recrée le jeu ; un autre `self`, non : il ne se lit qu'à la création, et recréer le jeu
// ramènerait l'avatar à l'apparition.
export const PhaserGame = forwardRef<IRefPhaserGame, IProps>(function PhaserGame({ mapKey, self, currentActiveScene }, ref) {
  const game = useRef<Phaser.Game | null>(null);
  const selfAtStart = useRef(self);

  useLayoutEffect(() => {
    if (game.current === null) {
      game.current = startGame('game-container', mapKey, selfAtStart.current);
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
