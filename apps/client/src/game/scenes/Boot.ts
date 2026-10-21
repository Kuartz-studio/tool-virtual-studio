import { Scene } from 'phaser';
import { AvatarLibrary } from '../avatars';
import { AVATARS_REGISTRY_KEY } from '../objects/avatar-skin';

// La première scène. La barre de chargement du Preloader n'est faite que de rectangles : il n'y a rien à charger avant elle. Boot crée les avatars
// du jeu (de quoi assembler les personnages, avatars.ts), que toutes les scènes retrouvent dans le registre, et lui passe la main.
export class Boot extends Scene {
  constructor() {
    super('Boot');
  }

  create() {
    this.registry.set(AVATARS_REGISTRY_KEY, new AvatarLibrary(this.textures, this.anims));
    this.scene.start('Preloader');
  }
}
