import { REMOTE_RENDER_DELAY_MS, type ActivityState, type PublicPlayer, type Status } from '@bureau/shared';
import type { GameObjects, Input, Scene } from 'phaser';
import { animKey, avatarObjectName, avatarSpec, type AvatarSpec } from '../avatars';
import { snapToPixels } from '../pixel-snap';
import { SnapshotBuffer, type BodyFits, type Snapshot } from '../snapshot-buffer';
import { NameTag } from './NameTag';
import { addShadow, placeShadow } from './shadow';

// L'avatar d'un autre joueur : un sprite sans physique (sa position vient du serveur), son ombre et son étiquette. Les positions
// reçues (push) sont dessinées avec REMOTE_RENDER_DELAY_MS de retard, en glissant de l'une à l'autre (SnapshotBuffer) ; render() est
// appelé à chaque image. Comme l'avatar local, ses pieds sont son origine et sa profondeur est leur y.
export class RemotePlayer {
  readonly id: string;
  private snapshots: SnapshotBuffer;
  private spec: AvatarSpec;
  private readonly sprite: GameObjects.Sprite;
  private readonly shadow: GameObjects.Ellipse;
  private readonly tag: NameTag;
  // La position dessinée à la dernière image.
  private drawn: Snapshot;

  // La carte, qui borne l'extrapolation de ses positions : jamais dans un mur.
  private readonly bodyFits: BodyFits;

  // `zoom` : celui de la caméra, pour l'étiquette ; `bodyFits` : la carte (avatarBodyFits).
  constructor(scene: Scene, p: PublicPlayer, now: number, options: { zoom: number; bodyFits: BodyFits }) {
    this.id = p.id;
    this.bodyFits = options.bodyFits;
    this.snapshots = new SnapshotBuffer(undefined, this.bodyFits);
    this.spec = avatarSpec(p.avatarKey);
    this.drawn = { x: p.x, y: p.y, dir: p.dir, moving: p.moving };
    this.sprite = snapToPixels(scene.add.sprite(p.x, p.y, this.spec.key, this.spec.idle[p.dir][0]))
      .setOrigin(0.5, 1)
      .setName(avatarObjectName(p.id));
    this.shadow = addShadow(scene, p.x, p.y);
    this.tag = new NameTag(scene, p.name, p.status, options.zoom, p.activity ?? null);
    this.snapshots.push(now, this.drawn);
    this.render(now);
  }

  // Une position reçue (world:tick), datée de sa réception.
  push(at: number, s: Snapshot): void {
    this.snapshots.push(at, s);
  }

  // L'état que donne un nouvel init (reconnexion, redémarrage du serveur) : il remplace tout, sans glisser depuis l'ancien.
  reset(p: PublicPlayer, now: number): void {
    this.snapshots = new SnapshotBuffer(undefined, this.bodyFits);
    this.snapshots.push(now, { x: p.x, y: p.y, dir: p.dir, moving: p.moving });
    this.setProfile(p.name, p.avatarKey);
    this.setStatus(p.status);
    this.setActivity(p.activity ?? null);
    this.render(now);
  }

  // Retour sur l'onglet : l'avatar est tout de suite à la dernière position reçue.
  snapToLatest(): void {
    this.snapshots.snapToLatest();
  }

  setStatus(status: Status): void {
    this.tag.setStatus(status);
  }

  setActivity(activity: ActivityState | null): void {
    this.tag.setActivity(activity);
  }

  setProfile(name: string, avatarKey: string | null): void {
    this.tag.setName(name);
    const spec = avatarSpec(avatarKey);
    if (spec === this.spec) return;
    this.spec = spec;
    // L'animation de l'ancien avatar s'arrête ; render() lance celle du nouveau.
    this.sprite.stop();
    this.sprite.setTexture(spec.key, spec.idle[this.drawn.dir][0]);
  }

  setSpeaking(speaking: boolean): void {
    this.tag.setSpeaking(speaking);
  }

  // Le glisser-déposer du faux live (VITE_SIM=1) : on attrape l'avatar à la souris, `drag` suit le pointeur, `drop` le lâche, à des
  // coordonnées de la carte (pixels). L'avatar, lui, ne bouge pas : il reste là où le serveur le voit, et marche vers l'endroit lâché.
  makeDraggable(on: { drag(x: number, y: number): void; drop(x: number, y: number): void }): void {
    this.sprite.setInteractive({ draggable: true, useHandCursor: true });
    this.sprite.on('drag', (pointer: Input.Pointer) => on.drag(pointer.worldX, pointer.worldY));
    this.sprite.on('dragend', (pointer: Input.Pointer) => on.drop(pointer.worldX, pointer.worldY));
  }

  setZoom(zoom: number): void {
    this.tag.setZoom(zoom);
  }

  setVisible(visible: boolean): void {
    this.sprite.setVisible(visible);
    this.shadow.setVisible(visible);
    this.tag.setVisible(visible);
  }

  // Dessine l'avatar où il était il y a REMOTE_RENDER_DELAY_MS ; renvoie cette position.
  render(now: number): Snapshot {
    const s = this.snapshots.sample(now - REMOTE_RENDER_DELAY_MS);
    if (s) this.drawn = s;
    const { x, y, dir, moving } = this.drawn;
    this.sprite.setPosition(x, y).setDepth(y);
    // `true` : une animation déjà en cours n'est pas relancée à chaque image.
    this.sprite.play(animKey(this.spec.key, moving ? 'walk' : 'idle', dir), true);
    placeShadow(this.shadow, x, y);
    this.tag.placeAbove(x, y - this.spec.frameHeight);
    return this.drawn;
  }

  get avatarKey(): string {
    return this.spec.key;
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
    this.tag.destroy();
  }
}
