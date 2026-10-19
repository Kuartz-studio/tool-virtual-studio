// D'après le modèle officiel phaserjs/template-react-ts (© 2025 Phaser Studio Inc, licence MIT : LICENSE-phaser-template.txt).
import { AUTO, Game } from 'phaser';
import { Boot } from './scenes/Boot';
import { Game as MainGame } from './scenes/Game';
import { Preloader } from './scenes/Preloader';

// La configuration du jeu (https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig). Les scènes du modèle
// restent en attendant celles du bureau (tâche 10).
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  width: 1024,
  height: 768,
  parent: 'game-container',
  backgroundColor: '#028af8',
  scene: [Boot, Preloader, MainGame],
};

export default function StartGame(parent: string): Game {
  return new Game({ ...config, parent });
}
