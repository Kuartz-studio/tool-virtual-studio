import { Scene } from 'phaser';

// Charge les assets du jeu, avec une barre de progression, puis lance la scène principale.
export class Preloader extends Scene {
  constructor() {
    super('Preloader');
  }

  init() {
    this.add.image(512, 384, 'background');
    // Le contour de la barre, puis la barre elle-même, qui s'allonge avec la progression du chargement.
    this.add.rectangle(512, 384, 468, 32).setStrokeStyle(1, 0xffffff);
    const bar = this.add.rectangle(512 - 230, 384, 4, 28, 0xffffff);
    this.load.on('progress', (progress: number) => {
      bar.width = 4 + 460 * progress;
    });
  }

  preload() {
    this.load.setPath('assets');
    this.load.image('logo', 'logo.png');
    this.load.image('star', 'star.png');
  }

  create() {
    this.scene.start('Game');
  }
}
