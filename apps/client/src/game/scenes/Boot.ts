import { Scene } from 'phaser';

// La première scène. La barre de chargement du Preloader n'est faite que de rectangles : il n'y a rien à charger avant elle,
// et Boot lui passe la main tout de suite.
export class Boot extends Scene {
  constructor() {
    super('Boot');
  }

  create() {
    this.scene.start('Preloader');
  }
}
