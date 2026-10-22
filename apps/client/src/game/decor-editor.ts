import { DESK_ROOMS, TILE_SIZE, decorItem, footprintOf, type DeskRoomSpec, type Zone } from '@bureau/shared';
import type { GameObjects, Input } from 'phaser';
import { anchorFor, planPlace } from '../office/decor-draft';
import { useOfficeStore, type DecorEditor as DecorEditorState } from '../state/office-store';
import type { DecorLayer } from './decor-layer';
import { drawnAt } from './decor-layout';
import { decorTextureKey } from './decor-textures';
import { DEPTH } from './map-layers';
import { snapToPixels } from './pixel-snap';

// La déco de son bureau, dans le jeu : tant que l'éditeur est ouvert (le magasin), la pièce montre le brouillon, une grille la quadrille, et
// l'élément tenu suit le pointeur, vert quand on peut le poser là et rouge sinon. Un clic le pose (ou, sans rien en main, reprend l'élément
// sous le pointeur) ; un clic droit jette ce qu'on tient, ou l'élément sous le pointeur. Avec la gomme (le panneau), l'élément sous le pointeur
// s'entoure de rouge et un clic l'efface. Poser sur un élément de la même sorte le remplace, après confirmation (le fantôme est alors orange) ;
// tant que la fenêtre de confirmation est ouverte, la pièce ne répond plus. Les gestes passent par le magasin, que le panneau (DecorPanel)
// pilote aussi : il n'y a qu'un brouillon.
const GRID = { color: 0xffffff, alpha: 0.28 };
const OK = 0x59d38c;
const REPLACE = 0xf2b24c;
const REFUSED = 0xf26b6b;
// Ce que le fantôme dit de l'endroit visé : posable, posable en remplaçant, refusé.
type Verdict = 'ok' | 'replace' | 'refused';
const VERDICT_COLOR: Record<Verdict, number> = { ok: OK, replace: REPLACE, refused: REFUSED };
const VERDICT_TINT: Record<Verdict, number> = { ok: 0xffffff, replace: 0xffd9a0, refused: 0xff8a8a };

export interface DecorEditorHooks {
  // L'éditeur s'ouvre sur cette pièce (le jeu y amène la caméra) ; il se ferme (la caméra reprend l'avatar).
  onOpen(room: Zone): void;
  onClose(): void;
}

export class DecorEditorView {
  private editor: DecorEditorState | null = null;
  private room: Zone | null = null;
  // La pièce (taille et porte) du bureau qu'on décore : la pose et la grille la suivent.
  private spec: DeskRoomSpec = DESK_ROOMS.standard;
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
    // La gomme : un curseur qui le dit.
    this.scene.input.setDefaultCursor(next.tool === 'erase' ? 'crosshair' : '');
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
    this.spec = this.layer.specOf(editor.deskKey) ?? DESK_ROOMS.standard;
    this.grid = this.scene.add.graphics().setDepth(DEPTH.dessus - 2);
    this.grid.lineStyle(1, GRID.color, GRID.alpha);
    for (let i = 0; i <= this.spec.width; i++) this.grid.lineBetween(room.x + i * TILE_SIZE, room.y, room.x + i * TILE_SIZE, room.y + room.height);
    for (let j = 0; j <= this.spec.height; j++) this.grid.lineBetween(room.x, room.y + j * TILE_SIZE, room.x + room.width, room.y + j * TILE_SIZE);
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
    this.scene.input.setDefaultCursor('');
    if (notify) this.hooks.onClose();
  }

  // La case de la pièce sous le pointeur, ou null hors de la pièce.
  private cellAt(pointer: Input.Pointer): { x: number; y: number } | null {
    const room = this.room;
    if (!room) return null;
    const [x, y] = [Math.floor((pointer.worldX - room.x) / TILE_SIZE), Math.floor((pointer.worldY - room.y) / TILE_SIZE)];
    return x >= 0 && y >= 0 && x < this.spec.width && y < this.spec.height ? { x, y } : null;
  }

  // Où l'élément tenu se poserait si on cliquait, et ce que cela donnerait : posé, posé en remplaçant, ou refusé.
  private target(pointer: Input.Pointer): { x: number; y: number; verdict: Verdict } | null {
    const editor = this.editor;
    const cell = this.cellAt(pointer);
    if (!editor || editor.held === null || !cell) return null;
    const at = anchorFor(editor.held, cell, this.spec);
    if (!at) return null;
    const plan = planPlace(editor.draft, editor.held, at, this.spec);
    return { ...at, verdict: plan.kind === 'place' ? 'ok' : plan.kind === 'replace' ? 'replace' : 'refused' };
  }

  private onMove = (pointer: Input.Pointer): void => {
    this.drawGhost(this.target(pointer), pointer);
  };

  // Recalcule le fantôme depuis le pointeur actuel (l'élément tenu ou le brouillon viennent de changer).
  private refreshGhost(): void {
    this.drawGhost(this.target(this.scene.input.activePointer));
  }

  // La gomme : entoure en rouge l'élément que le clic effacerait (rien sous le pointeur, rien d'entouré).
  private drawEraser(pointer: Input.Pointer): void {
    const editor = this.editor;
    const room = this.room;
    if (!editor || !room) return;
    const hit = editor.tool === 'erase' ? drawnAt(this.layer.drawnIn(editor.deskKey), pointer.worldX, pointer.worldY) : -1;
    const placed = hit === -1 ? undefined : editor.draft.items[hit];
    const item = placed && decorItem(placed.id);
    if (!placed || !item) return;
    const f = footprintOf(item, placed);
    this.outline?.lineStyle(2, REFUSED, 1).strokeRect(room.x + f.x * TILE_SIZE, room.y + f.y * TILE_SIZE, f.w * TILE_SIZE, f.h * TILE_SIZE);
  }

  private drawGhost(target: { x: number; y: number; verdict: Verdict } | null, pointer: Input.Pointer = this.scene.input.activePointer): void {
    const editor = this.editor;
    const room = this.room;
    this.outline?.clear();
    this.drawEraser(pointer);
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
    this.ghost.setVisible(true).setPosition(left, footBottom).setTint(VERDICT_TINT[target.verdict]);
    // Le rectangle de l'empreinte (une case de large pour le mur) : ce que l'élément prendra vraiment.
    const color = VERDICT_COLOR[target.verdict];
    const footRows = item.kind === 'wall' ? 1 : item.claim;
    this.outline?.lineStyle(2, color, 1).strokeRect(left, room.y + (item.kind === 'wall' ? 0 : target.y) * TILE_SIZE, item.w * TILE_SIZE, footRows * TILE_SIZE);
  }

  private onDown = (pointer: Input.Pointer): void => {
    const editor = this.editor;
    // La fenêtre « voulez-vous vraiment le remplacer ? » est ouverte : la pièce attend la réponse.
    if (!editor || !this.room || editor.replace !== null) return;
    const cell = this.cellAt(pointer);
    const store = useOfficeStore.getState();
    const hit = drawnAt(this.layer.drawnIn(editor.deskKey), pointer.worldX, pointer.worldY);
    if (editor.tool === 'erase') {
      // La gomme : l'élément sous le pointeur disparaît (un clic droit aussi, comme toujours), rien d'autre.
      if (hit !== -1) store.removeDecorItem(hit);
      return;
    }
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
