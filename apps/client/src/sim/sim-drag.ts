import type { GameObjects, Scene } from 'phaser';
import { DEPTH } from '../game/map-layers';
import type { RemotePlayer } from '../game/objects/RemotePlayer';
import { simApi } from './sim-api';

// Une personne fictive est arrivée quand elle est à moins de ce nombre de pixels de son point d'arrêt, à l'arrêt.
const ARRIVED_PX = 4;

// Le glisser-déposer du faux live (VITE_SIM=1), dans la scène du bureau : on attrape une personne fictive à la souris et on la lâche
// où elle doit marcher. Un rond suit la souris ; au lâcher, le serveur la fait marcher (elle ne se téléporte pas), et un marqueur reste
// à l'endroit où elle s'arrêtera : le serveur dit le point exact (une case bloquante, un mur : la plus proche qu'elle peut atteindre).
// Le marqueur disparaît à l'arrivée (arrived, appelé à chaque image avec la position dessinée).
export class SimDrag {
  private ghost: GameObjects.Arc | undefined;
  private readonly targets = new Map<string, { x: number; y: number; marker: GameObjects.Arc }>();

  constructor(private readonly scene: Scene) {}

  // Rend cette personne fictive attrapable.
  attach(remote: RemotePlayer): void {
    remote.makeDraggable({
      drag: (x, y) => {
        this.ghost ??= this.scene.add.circle(0, 0, 7, 0xffffff, 0.3).setStrokeStyle(1, 0xffffff).setDepth(DEPTH.nameTags);
        this.ghost.setPosition(x, y).setVisible(true);
      },
      drop: (x, y) => {
        this.ghost?.setVisible(false);
        // Le marqueur est là tout de suite, au point lâché ; la réponse du serveur le recale au point d'arrêt.
        this.setTarget(remote.id, x, y);
        simApi.moveBot(remote.id, x, y).then(
          ({ target }) => this.setTarget(remote.id, target.x, target.y),
          () => this.clear(remote.id),
        );
      },
    });
  }

  // La personne fictive est à (x, y) à cette image, en marche ou non : si elle est arrivée, son marqueur part.
  arrived(id: string, drawn: { x: number; y: number; moving: boolean }): void {
    const target = this.targets.get(id);
    if (target && !drawn.moving && Math.hypot(drawn.x - target.x, drawn.y - target.y) < ARRIVED_PX) this.clear(id);
  }

  clear(id: string): void {
    this.targets.get(id)?.marker.destroy();
    this.targets.delete(id);
  }

  private setTarget(id: string, x: number, y: number): void {
    const existing = this.targets.get(id);
    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.marker.setPosition(x, y);
      return;
    }
    const marker = this.scene.add.circle(x, y, 5, 0xffffff, 0.2).setStrokeStyle(1, 0xffffff).setDepth(DEPTH.nameTags);
    this.targets.set(id, { x, y, marker });
  }
}
