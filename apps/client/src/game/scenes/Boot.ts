import { Scene } from 'phaser';

// Charge ce dont la scène de chargement a besoin pour s'afficher, puis lui passe la main.
export class Boot extends Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    this.load.image('background', 'assets/bg.png');
  }

  create() {
    this.scene.start('Preloader');
  }
}
