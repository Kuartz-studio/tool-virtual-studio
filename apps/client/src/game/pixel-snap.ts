import type { GameObjects } from 'phaser';

// Fait tomber l'objet sur les pixels de l'écran, au moment de l'affichage.
//
// Phaser 4 n'arrondit un objet (mode `safeAuto`, celui par défaut) que si la caméra n'est pas zoomée. Or le jeu est au zoom ×2 sur
// un grand écran, et la caméra, qui suit l'avatar, se pose sur des demi-pixels : un objet à cheval sur deux pixels de l'écran
// aurait alors, d'une image à l'autre, des pixels de 1, 2 ou 3 px de large. Le mode `full` arrondit toujours les coins de l'objet ;
// ses pixels gardent tous la même taille (les deux coins d'un côté bougent de la même fraction). La position de l'objet, elle,
// reste exacte : seul l'affichage est arrondi.
//
// À appliquer à tout ce que le monde dessine avec une texture : les calques de la carte, les textes, les avatars.
export function snapToPixels<T extends GameObjects.GameObject>(object: T): T {
  return object.setVertexRoundMode('full');
}
