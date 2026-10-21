import { DESK_ROOM, TILE_SIZE, decorItem, type Zone } from '@bureau/shared';
import type { GameObjects, Input } from 'phaser';
import { anchorFor, tryPlace } from '../office/decor-draft';
import { useOfficeStore, type DecorEditor as DecorEditorState } from '../state/office-store';
import type { DecorLayer } from './decor-layer';
import { drawnAt } from './decor-layout';
import { decorTextureKey } from './decor-textures';
import { DEPTH } from './map-layers';
import { snapToPixels } from './pixel-snap';

// La déco de son bureau, dans le jeu : tant que l'éditeur est ouvert (le magasin), la pièce montre le brouillon, une grille la quadrille, et
// l'élément tenu suit le pointeur, vert quand on peut le poser là et rouge sinon. Un clic le pose (ou, sans rien en main, reprend l'élément
// sous le pointeur) ; un clic droit jette ce qu'on tient, ou l'élément sous le pointeur. Les gestes passent par le magasin, que le panneau
// (DecorPanel) pilote aussi : il n'y a qu'un brouillon.
const GRID = { color: 0xffffff, alpha: 0.28 };
const OK = 0x59d38c;
const REFUSED = 0xf26b6b;

export interface DecorEditorHooks {
  // L'éditeur s'ouvre sur cette pièce (le jeu y amène la caméra) ; il se ferme (la caméra reprend l'avatar).
  onOpen(room: Zone): void;
  onClose(): void;
}

export class DecorEditorView {
  private editor: DecorEditorState | null = null;
  private room: Zone | null = null;
  private grid: GameObjects.Graphics | null = null;
  private outline: GameObjects.Graphics | null = null;
  private ghost: GameObjects.Image | null = null;
  private ghostFor: string | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: DecorLayer,
    private readonly hooks: DecorEditorHooks,
  ) {
    scene.input.on('pointermove', this.onMove, this);
    scene.input.on('pointerdown', this.onDown, this);
  }

  // Le magasin a changé : l'éditeur s'ouvre, change ou se ferme.
  sync(next: DecorEditorState | null): void {
    const previous = this.editor;
    this.editor = next;
    if (!next) {
      if (previous) this.close(previous.deskKey);
      return;
    }
    if (!previous || previous.deskKey !== next.deskKey) this.open(next);
    this.layer.preview(next.deskKey, next.draft);
    this.refreshGhost();
  }

  destroy(): void {
    this.scene.input.off('pointermove', this.onMove, this);
    this.scene.input.off('pointerdown', this.onDown, this);
    // La scène s'arrête : la caméra n'est plus à remettre sur l'avatar.
    if (this.editor) this.close(this.editor.deskKey, false);
    this.editor = null;
  }

  private open(editor: DecorEditorState): void {
    const room = this.layer.zoneOf(editor.deskKey);
    if (!room) return;
    this.room = room;
    this.grid = this.scene.add.graphics().setDepth(DEPTH.dessus - 2);
    this.grid.lineStyle(1, GRID.color, GRID.alpha);
    for (let i = 0; i <= DESK_ROOM.width; i++) this.grid.lineBetween(room.x + i * TILE_SIZE, room.y, room.x + i * TILE_SIZE, room.y + room.height);
    for (let j = 0; j <= DESK_ROOM.height; j++) this.grid.lineBetween(room.x, room.y + j * TILE_SIZE, room.x + room.width, room.y + j * TILE_SIZE);
    this.outline = this.scene.add.graphics().setDepth(DEPTH.dessus - 2);
    this.hooks.onOpen(room);
  }

  private close(key: string, notify = true): void {
    this.layer.preview(key, null);
    this.grid?.destroy();
    this.outline?.destroy();
    this.ghost?.destroy();
    this.grid = this.outline = this.ghost = null;
    this.ghostFor = null;
    this.room = null;
    if (notify) this.hooks.onClose();
  }

  // La case de la pièce sous le pointeur, ou null hors de la pièce.
  private cellAt(pointer: Input.Pointer): { x: number; y: number } | null {
    const room = this.room;
    if (!room) return null;
    const [x, y] = [Math.floor((pointer.worldX - room.x) / TILE_SIZE), Math.floor((pointer.worldY - room.y) / TILE_SIZE)];
    return x >= 0 && y >= 0 && x < DESK_ROOM.width && y < DESK_ROOM.height ? { x, y } : null;
  }

  // Où l'élément tenu se poserait si on cliquait, et si la pièce resterait valable.
  private target(pointer: Input.Pointer): { x: number; y: number; ok: boolean } | null {
    const editor = this.editor;
    const cell = this.cellAt(pointer);
    if (!editor || editor.held === null || !cell) return null;
    const at = anchorFor(editor.held, cell);
    return at ? { ...at, ok: tryPlace(editor.draft, editor.held, at).ok } : null;
  }

  private onMove = (pointer: Input.Pointer): void => {
    this.drawGhost(this.target(pointer));
  };

  // Recalcule le fantôme depuis le pointeur actuel (l'élément tenu ou le brouillon viennent de changer).
  private refreshGhost(): void {
    this.drawGhost(this.target(this.scene.input.activePointer));
  }

  private drawGhost(target: { x: number; y: number; ok: boolean } | null): void {
    const editor = this.editor;
    const room = this.room;
    this.outline?.clear();
    if (!editor || !room || !target || editor.held === null) {
      this.ghost?.setVisible(false);
      return;
    }
    const item = decorItem(editor.held);
    if (!item) return;
    if (!this.ghost || this.ghostFor !== item.id) {
      this.ghost?.destroy();
      this.ghost = snapToPixels(this.scene.add.image(0, 0, decorTextureKey(item.cat), item.id).setOrigin(0, 1).setAlpha(0.7).setDepth(DEPTH.dessus - 1));
      this.ghostFor = item.id;
    }
    const left = room.x + target.x * TILE_SIZE;
    const footBottom = room.y + (item.kind === 'wall' ? 0 : target.y + item.claim) * TILE_SIZE;
    this.ghost.setVisible(true).setPosition(left, footBottom).setTint(target.ok ? 0xffffff : 0xff8a8a);
    // Le rectangle de l'empreinte (une case de large pour le mur) : ce que l'élément prendra vraiment.
    const color = target.ok ? OK : REFUSED;
    const footRows = item.kind === 'wall' ? 1 : item.claim;
    this.outline?.lineStyle(2, color, 1).strokeRect(left, room.y + (item.kind === 'wall' ? 0 : target.y) * TILE_SIZE, item.w * TILE_SIZE, footRows * TILE_SIZE);
  }

  private onDown = (pointer: Input.Pointer): void => {
    const editor = this.editor;
    if (!editor || !this.room) return;
    const cell = this.cellAt(pointer);
    const store = useOfficeStore.getState();
    const hit = drawnAt(this.layer.drawnIn(editor.deskKey), pointer.worldX, pointer.worldY);
    if (pointer.rightButtonDown()) {
      // Jeter ce qu'on tient, sinon l'élément sous le pointeur.
      if (editor.held !== null) store.holdDecorItem(null);
      else if (hit !== -1) store.removeDecorItem(hit);
      return;
    }
    if (editor.held !== null) {
      if (cell) store.placeHeld(cell);
      return;
    }
    if (hit !== -1) store.pickDecorItem(hit);
  };
}
