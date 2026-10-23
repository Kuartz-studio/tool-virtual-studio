import { Input, type Scene } from 'phaser';

// Au-delà de ce déplacement (en pixels de l'écran) depuis l'appui, un appui devient un glissement : en deçà, c'est un clic, qui garde son rôle.
export const DRAG_THRESHOLD_PX = 5;

export interface CameraDragHandlers {
  // Peut-on faire glisser la carte maintenant ? (Non quand l'éditeur de déco ou une table de jeu tient la caméra.)
  canDrag(): boolean;
  // Le glissement commence : la caméra ne suit plus l'avatar.
  onStart(): void;
  // La carte a glissé de (dx, dy) pixels de l'écran depuis l'appel précédent.
  onDrag(dx: number, dy: number): void;
  // Un double-clic sur la carte.
  onDoubleClick(): void;
}

// Faire glisser la carte à la souris (bouton gauche, ou un doigt), et la recentrer d'un double-clic. Un appui sur un objet qu'on actionne (une table, la machine
// à café, une personne fictive qu'on déplace…) ne fait pas glisser la carte : l'objet le garde. Pendant le glissement, le curseur est une main fermée.
// Renvoie la fonction qui débranche.
export function bindCameraDrag(scene: Scene, handlers: CameraDragHandlers): () => void {
  const canvas = scene.game.canvas;
  // L'appui en cours : le pointeur, son dernier point, et s'il a déjà dépassé le seuil (un glissement).
  let press: { id: number; startX: number; startY: number; x: number; y: number; dragging: boolean } | null = null;

  const onDown = (pointer: Input.Pointer, over: unknown[]) => {
    if (press !== null || over.length > 0 || !pointer.leftButtonDown() || !handlers.canDrag()) return;
    press = { id: pointer.id, startX: pointer.x, startY: pointer.y, x: pointer.x, y: pointer.y, dragging: false };
  };

  const onMove = (pointer: Input.Pointer) => {
    if (press === null || pointer.id !== press.id) return;
    if (!pointer.isDown || !handlers.canDrag()) return end(pointer);
    if (!press.dragging) {
      if (Math.hypot(pointer.x - press.startX, pointer.y - press.startY) < DRAG_THRESHOLD_PX) return;
      press.dragging = true;
      canvas.style.cursor = 'grabbing';
      handlers.onStart();
    }
    handlers.onDrag(pointer.x - press.x, pointer.y - press.y);
    press.x = pointer.x;
    press.y = pointer.y;
  };

  const end = (pointer: Input.Pointer) => {
    if (press === null || pointer.id !== press.id) return;
    if (press.dragging) canvas.style.cursor = '';
    press = null;
  };

  const onDoubleClick = (event: MouseEvent) => {
    if (event.button !== 0) return;
    handlers.onDoubleClick();
  };

  scene.input.on(Input.Events.POINTER_DOWN, onDown);
  scene.input.on(Input.Events.POINTER_MOVE, onMove);
  scene.input.on(Input.Events.POINTER_UP, end);
  scene.input.on(Input.Events.POINTER_UP_OUTSIDE, end);
  canvas.addEventListener('dblclick', onDoubleClick);
  return () => {
    scene.input.off(Input.Events.POINTER_DOWN, onDown);
    scene.input.off(Input.Events.POINTER_MOVE, onMove);
    scene.input.off(Input.Events.POINTER_UP, end);
    scene.input.off(Input.Events.POINTER_UP_OUTSIDE, end);
    canvas.removeEventListener('dblclick', onDoubleClick);
    if (press?.dragging) canvas.style.cursor = '';
    press = null;
  };
}
