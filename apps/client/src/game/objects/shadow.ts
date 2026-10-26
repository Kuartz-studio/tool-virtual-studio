import type { GameObjects, Scene } from 'phaser';

// L'ombre portée d'un avatar : une ellipse noire de 18 × 6 px à 25 % d'opacité, centrée sous ses pieds. Le joueur local
// (LocalPlayer) et les autres (RemotePlayer, tâche 15) ont la même.
export const SHADOW = { width: 18, height: 6, color: 0x000000, alpha: 0.25 } as const;

// Elle est dessinée juste derrière l'avatar : une profondeur de moins que ses pieds (la profondeur d'un avatar est le y de ses
// pieds), donc devant le sol et derrière lui, et triée comme lui par rapport aux meubles.
export function addShadow(scene: Scene, x: number, y: number): GameObjects.Ellipse {
  return scene.add.ellipse(x, y, SHADOW.width, SHADOW.height, SHADOW.color, SHADOW.alpha).setDepth(y - 1);
}

// Suit l'avatar dont les pieds sont maintenant en (x, y). `depth` : celle de l'avatar, quand ce n'est pas le y de ses pieds (sur son tapis de course, il est
// devant le tapis).
export function placeShadow(shadow: GameObjects.Ellipse, x: number, y: number, depth: number = y): void {
  shadow.setPosition(x, y).setDepth(depth - 1);
}
