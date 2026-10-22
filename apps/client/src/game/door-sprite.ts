import { propByKey, type Zone } from '@bureau/shared';
import type { Animations, GameObjects, Scene, Textures } from 'phaser';
import { nextPhase, type DoorPhase, type DoorTarget } from './door-state';
import { snapToPixels } from './pixel-snap';
import { propTextureKey } from './prop-textures';
import { prefersReducedMotion } from './reduced-motion';

// La porte vitrée d'un bureau (le prop `door-glass-double`, 8 images de 64 × 96) : l'image 0 est la porte fermée, les images 1 à 3 son ouverture, la 4 la
// porte ouverte (ses battants de chant : on ne les voit presque pas), les images 5 à 7 sa fermeture. Posée au bas de la bande de mur qu'elle perce, sur les
// deux cases de la porte, et triée comme un meuble (par son bas) : un avatar qui passe est devant elle ou derrière.
export const DOOR_PROP = 'door-glass-double';
export const CLOSED_FRAME = 0;
export const OPEN_FRAME = 4;
export const DOOR_ANIMATIONS = {
  open: { key: 'door:open', frames: [0, 1, 2, 3, 4] },
  close: { key: 'door:close', frames: [4, 5, 6, 7, 0] },
} as const;

// Les deux animations de la porte, créées une fois au chargement (le Preloader) : elle s'ouvre, elle se ferme, une fois chacune, et s'arrête sur l'image
// finale. Une planche absente (qui n'a pas chargé) ou des animations déjà créées (la scène redémarre) : rien.
export function registerDoorAnimations(anims: Animations.AnimationManager, textures: Textures.TextureManager): void {
  const texture = propTextureKey(DOOR_PROP);
  if (!textures.exists(texture)) return;
  for (const animation of [DOOR_ANIMATIONS.open, DOOR_ANIMATIONS.close]) {
    if (anims.exists(animation.key)) continue;
    anims.create({ key: animation.key, frames: anims.generateFrameNumbers(texture, { frames: [...animation.frames] }), frameRate: propByKey(DOOR_PROP)?.fps ?? 12, repeat: 0 });
  }
}

type Listener = (open: boolean) => void;

export class DoorSprite {
  readonly sprite: GameObjects.Sprite;
  private _phase: DoorPhase;
  private _target: DoorTarget;
  private readonly listeners = new Set<Listener>();
  private destroyed = false;

  // `initial` : l'état d'arrivée de la porte, sans animation ni bruit.
  constructor(scene: Scene, door: Pick<Zone, 'x' | 'y' | 'width' | 'height'>, initial: DoorTarget = 'open') {
    const bottom = door.y + door.height;
    this.sprite = snapToPixels(scene.add.sprite(door.x, bottom, propTextureKey(DOOR_PROP), initial === 'open' ? OPEN_FRAME : CLOSED_FRAME))
      .setOrigin(0, 1)
      .setDepth(bottom)
      .setFrame(initial === 'open' ? OPEN_FRAME : CLOSED_FRAME);
    this._phase = initial;
    this._target = initial;
  }

  get phase(): DoorPhase {
    return this._phase;
  }

  get target(): DoorTarget {
    return this._target;
  }

  // La porte se met en mouvement (`open` : elle s'ouvre ; sinon elle se ferme) : le son des portes en dépend. Renvoie la fonction qui retire l'écoute.
  onMoved(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Ce que la porte veut être. Un mouvement en cours se finit d'abord (pas de demi-tour). `instant` : elle y est tout de suite, sans animation ni bruit
  // (l'état d'arrivée) ; en mouvement réduit, elle saute à l'image finale, mais le bruit est fait.
  setTarget(target: DoorTarget, { instant = false }: { instant?: boolean } = {}): void {
    if (this.destroyed) return;
    this._target = target;
    if (instant) this.snap(target, false);
    else if (prefersReducedMotion()) this.snap(target, true);
    else this.advance();
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
    this.sprite.destroy();
  }

  private snap(target: DoorTarget, notify: boolean): void {
    const wasOpen = this._phase === 'open' || this._phase === 'opening';
    this.sprite.stop();
    this._phase = target;
    this.sprite.setFrame(target === 'open' ? OPEN_FRAME : CLOSED_FRAME);
    if (notify && (target === 'open') !== wasOpen) this.emit(target === 'open');
  }

  // Lance le mouvement que demande la cible, s'il n'y en a pas déjà un en cours.
  private advance(): void {
    if (this._phase === 'closing' || this._phase === 'opening') return;
    const next = nextPhase(this._phase, this._target);
    if (next === this._phase) return;
    this._phase = next;
    const animation = next === 'opening' ? DOOR_ANIMATIONS.open : DOOR_ANIMATIONS.close;
    this.sprite.play(animation.key);
    this.sprite.once('animationcomplete', () => this.finish());
    this.emit(next === 'opening');
  }

  // Le mouvement est fini : la porte est au repos, puis repart si la cible a changé entre-temps.
  private finish(): void {
    if (this.destroyed) return;
    this._phase = nextPhase(this._phase, this._target);
    this.sprite.setFrame(this._phase === 'open' ? OPEN_FRAME : CLOSED_FRAME);
    this.advance();
  }

  private emit(open: boolean): void {
    for (const listener of [...this.listeners]) listener(open);
  }
}
