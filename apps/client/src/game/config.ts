// D'après le modèle officiel phaserjs/template-react-ts (© 2025 Phaser Studio Inc, licence MIT : LICENSE-phaser-template.txt).
import { AUTO, Game, Scale } from 'phaser';
import { Boot } from './scenes/Boot';
import { Office, type SelfProfile } from './scenes/Office';
import { Preloader } from './scenes/Preloader';

// La configuration du jeu (https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig). Les scènes connaissent la
// carte à charger, et le bureau sait qui joue : une instance par jeu.
export function createGameConfig(parent: string, mapKey: string, self: SelfProfile): Phaser.Types.Core.GameConfig {
  return {
    type: AUTO,
    parent,
    // Le canevas remplit son parent et en suit la taille. Le zoom est celui de la caméra (zoom.ts), pas de l'échelle du jeu.
    scale: { mode: Scale.RESIZE, width: '100%', height: '100%' },
    // Pixel art : des tuiles sans lissage, posées sur des pixels entiers.
    pixelArt: true,
    roundPixels: true,
    // Le vide autour de la carte.
    backgroundColor: '#1d2030',
    // Vue de dessus : rien ne tombe.
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 } } },
    scene: [new Boot(), new Preloader(mapKey), new Office(mapKey, self)],
  };
}

export function startGame(parent: string, mapKey: string, self: SelfProfile): Game {
  return new Game(createGameConfig(parent, mapKey, self));
}
