import { Scene } from 'phaser';
import { EventBus } from '../EventBus';

// La scène principale du modèle, remplacée par celle du bureau à la tâche 10.
export class Game extends Scene {
  camera: Phaser.Cameras.Scene2D.Camera;
  background: Phaser.GameObjects.Image;

  constructor() {
    super('Game');
  }

  create() {
    this.camera = this.cameras.main;
    this.camera.setBackgroundColor(0x00ff00);
    this.background = this.add.image(512, 384, 'background');
    this.background.setAlpha(0.5);
    EventBus.emit('current-scene-ready', this);
  }
}
