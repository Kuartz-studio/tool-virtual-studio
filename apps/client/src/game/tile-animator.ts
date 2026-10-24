import { frameAt, tileAnimation, type TileAnimation } from '@bureau/shared';
import type { Tilemaps } from 'phaser';
import { prefersReducedMotion } from './reduced-motion';

// Les sols et les murs qui bougent, dans les pièces des bureaux seulement. DecorLayer dit, à chaque repeinte, quelle tuile de base il pose sur chaque case
// (place) ; à chaque image (tick), une case dont la tuile a une animation (decor/tile-animations.ts) montre l'image de cet instant, à l'heure du mur : tout le
// monde voit le même reflet au même moment. Les espaces communs, qui ont les mêmes tuiles, restent calmes : personne ne les inscrit ici. Qui demande moins de
// mouvement voit les tuiles de base.
interface Cell {
  tile: Tilemaps.Tile;
  animation: TileAnimation;
  x: number;
  y: number;
  shown: number;
}

export class TileAnimator {
  private readonly cells = new Map<string, Cell>();

  // Cette case du calque montre maintenant cette tuile de base : elle bouge si la tuile a une animation, et ne bouge plus sinon.
  place(layer: Tilemaps.TilemapLayer, x: number, y: number, gid: number): void {
    const key = `${layer.layer.name}:${x},${y}`;
    const animation = tileAnimation(gid);
    const tile = animation && layer.getTileAt(x, y);
    if (!animation || !tile) {
      this.cells.delete(key);
      return;
    }
    this.cells.set(key, { tile, animation, x, y, shown: gid });
  }

  // Combien de cases bougent (pour les tests).
  get size(): number {
    return this.cells.size;
  }

  // À chaque image : chaque case animée montre l'image de cet instant (`now` : Date.now()), et seulement si elle change.
  tick(now: number): void {
    const still = prefersReducedMotion();
    for (const cell of this.cells.values()) {
      const gid = still ? cell.animation.gid : frameAt(cell.animation, now, cell.x, cell.y);
      if (gid === cell.shown) continue;
      cell.tile.index = gid;
      cell.shown = gid;
    }
  }

  destroy(): void {
    this.cells.clear();
  }
}
