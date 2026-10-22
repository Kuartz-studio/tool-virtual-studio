import type { GameObjects, Scene } from 'phaser';
import type { Interactable } from '../interactions';
import { DEPTH } from '../map-layers';
import { snapToPixels } from '../pixel-snap';
import { TAG_BACKGROUND, TAG_PAD_X, TAG_PAD_Y, TAG_TEXT_STYLE } from './NameTag';

// L'étiquette « [E] … » : une seule pour tout le jeu, posée au-dessus de la cible que le gestionnaire (interactions.ts) retient. C'est une pastille
// comme celle des noms, devant tout. Ce fichier n'importe de Phaser que des types : la scène lui donne de quoi dessiner.
const BACKGROUND = `rgba(${(TAG_BACKGROUND.color >> 16) & 255}, ${(TAG_BACKGROUND.color >> 8) & 255}, ${TAG_BACKGROUND.color & 255}, ${TAG_BACKGROUND.alpha})`;
const PROMPT_STYLE = { ...TAG_TEXT_STYLE, backgroundColor: BACKGROUND, padding: { x: TAG_PAD_X, y: TAG_PAD_Y } };

export class InteractionPrompt {
  private readonly label: GameObjects.Text;
  private shown = '';

  constructor(scene: Scene) {
    this.label = snapToPixels(scene.add.text(0, 0, '', { ...PROMPT_STYLE, resolution: 1 }).setOrigin(0.5, 1))
      .setDepth(DEPTH.nameTags)
      .setVisible(false);
  }

  // La cible courante (celle que rend Interactions.update), ou null : l'étiquette dit ce que la touche fera, ou disparaît. À appeler à chaque
  // image : le texte d'une même cible peut changer (« Éteindre », puis « Allumer »). Un texte inchangé ne redessine rien.
  show(target: Interactable | null): void {
    const text = target?.prompt() ?? null;
    if (target === null || text === null) {
      this.label.setVisible(false);
      return;
    }
    const at = target.labelAt ?? target.pos;
    this.label.setPosition(at.x, at.y);
    if (text !== this.shown) {
      this.shown = text;
      this.label.setText(text);
    }
    this.label.setVisible(true);
  }

  // Le zoom de la caméra a changé : le texte est redessiné à la nouvelle taille (jamais en dessous de 1, comme celui des noms).
  setZoom(zoom: number): void {
    this.label.setResolution(Math.max(1, zoom));
  }

  destroy(): void {
    this.label.destroy();
  }
}
