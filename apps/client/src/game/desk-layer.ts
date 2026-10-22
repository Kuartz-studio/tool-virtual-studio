import { TILE_SIZE, deskKey, type DeskInfo, type OfficeMap, type Zone } from '@bureau/shared';
import { fr } from '../i18n/fr';
import { DoorSprite } from './door-sprite';
import { nearDoor, watchDoor, type DoorPhase, type DoorWatch } from './door-state';
import { DEPTH } from './map-layers';
import { snapToPixels } from './pixel-snap';

// Comment une porte se montre à la personne qui joue :
// - open : ouverte (ou place libre) : les battants de chant, qu'on ne voit presque pas ;
// - closed : fermée, et cet avatar n'y passe pas : un battant vitré plein, qui bloque (verrou d'un autre, état d'activité, exclusion) ;
// - locked-mine : fermée, mais cet avatar y passe (son bureau, ou il y est admis) : le battant plein aussi, mais il s'ouvre quand on s'en approche, et ne bloque pas.
export type DoorView = 'open' | 'closed' | 'locked-mine';

// La clé du bureau et l'état de sa porte pour soi : `closedForMe` liste les places où l'on n'entre pas (desk:access).
export function doorView(desk: DeskInfo | undefined, closedForMe: readonly string[], key: string): DoorView {
  if (closedForMe.includes(key)) return 'closed';
  return desk !== undefined && desk.ownerId !== null && (desk.locked || desk.closedByState) ? 'locked-mine' : 'open';
}

// Le texte posé dans la pièce : le nom du bureau, sinon celui de son propriétaire, sinon « Libre » ; précédé d'un cadenas quand la porte
// est fermée. `free` : personne n'y est (le texte est alors discret).
export function deskLabel(desk: DeskInfo | undefined): { text: string; free: boolean } {
  if (desk === undefined || desk.ownerId === null) return { text: fr.desk.free, free: true };
  const closed = desk.locked || desk.closedByState;
  return { text: `${closed ? '🔒 ' : ''}${desk.name ?? desk.ownerName ?? ''}`.trim(), free: false };
}

const LABEL_STYLE = {
  fontFamily: 'monospace',
  fontSize: '12px',
  fontStyle: 'bold',
  color: '#ffffff',
  backgroundColor: 'rgba(31, 36, 48, 0.78)',
  padding: { x: 5, y: 2 },
};
const FREE_LABEL_STYLE = { ...LABEL_STYLE, color: '#c7ccd9', backgroundColor: 'rgba(31, 36, 48, 0.45)' };

// À moins de cette distance de la porte (en pixels, des pieds de l'avatar à son centre), un clic dessus toque.
const KNOCK_REACH_PX = 3 * TILE_SIZE;
// Au plus un message « porte fermée » par porte et par ce délai (ms) : l'avatar qui bute en continue contre la porte ne le renouvelle pas.
const BLOCKED_NOTICE_MS = 3000;

interface Slot {
  key: string;
  room: Zone;
  door: Zone | null;
  label: Phaser.GameObjects.Text;
  sprite: DoorSprite | null;
  wall: Phaser.GameObjects.Zone | null;
  view: DoorView;
  ownerId: string | null;
  // Ce que la porte retient d'une image à l'autre (watchDoor), et si elle a déjà reçu l'état du bureau (la première fois, elle y est sans animation).
  watch: DoorWatch;
  shown: boolean;
}

// Une porte qui se met en mouvement, vue de la personne qui joue : de combien elle en est éloignée, pour le bruit.
export interface DoorMove {
  key: string;
  open: boolean;
  ownerId: string | null;
  distancePx: number;
}

export interface DeskLayerHooks {
  // Là où sont les pieds de l'avatar local.
  feet(): { x: number; y: number };
  // Là où sont les pieds de cette personne (la dernière position dessinée), ou null si on ne la voit pas.
  ownerAt(ownerId: string): { x: number; y: number } | null;
  // Un clic sur une porte fermée pour soi, de près : toquer.
  onKnock(key: string): void;
  // L'avatar bute contre une porte fermée pour lui (au plus une fois par BLOCKED_NOTICE_MS et par porte).
  onBlocked(key: string): void;
  // Une porte s'ouvre ou se ferme.
  onDoorMoved(move: DoorMove): void;
}

// Ce que le jeu montre des bureaux : le nom de chaque pièce, et sa porte vitrée. La porte est ouverte quand le bureau est libre ou non verrouillé ; verrouillée,
// elle s'ouvre quand on s'en approche si on y passe, ou quand le propriétaire s'en approche si c'est un autre qui regarde, et se referme peu après son départ
// (door-state.ts). Une porte fermée pour soi est un obstacle (un corps statique que l'avatar local ne traverse pas, comme le serveur le lui refuserait), sur
// lequel on clique pour toquer. Les cartes sans zone door (la carte de développement) n'ont que les noms : le serveur seul garde alors l'entrée.
export class DeskLayer {
  private readonly slots: Slot[] = [];
  private readonly lastBlocked = new Map<string, number>();

  constructor(
    private readonly scene: Phaser.Scene,
    map: OfficeMap,
    private readonly hooks: DeskLayerHooks,
  ) {
    const doors = new Map(map.zones.filter((zone) => zone.type === 'door').map((door) => [door.name, door] as const));
    for (const room of map.zones.filter((zone) => zone.type === 'desk')) {
      const key = deskKey(room);
      const door = doors.get(key) ?? null;
      // Le nom en haut de la pièce, devant les meubles (qui se trient par leur bas) : on le lit où qu'ils soient.
      const label = snapToPixels(scene.add.text(room.x + room.width / 2, room.y + 14, '', LABEL_STYLE).setOrigin(0.5)).setDepth(DEPTH.dessus - 1);
      const slot: Slot = { key, room, door, label, sprite: null, wall: null, view: 'open', ownerId: null, watch: { near: false, closeAt: null }, shown: false };
      if (door) {
        slot.sprite = new DoorSprite(scene, door, 'open');
        slot.sprite.onMoved((open) => this.hooks.onDoorMoved({ key, open, ownerId: slot.ownerId, distancePx: this.distanceTo(door) }));
      }
      this.slots.push(slot);
    }
  }

  // L'avatar local est connu : les portes peuvent le bloquer, et on clique dessus pour toquer.
  collideWith(player: Phaser.GameObjects.GameObject): void {
    for (const slot of this.slots) {
      const door = slot.door;
      if (!door || !slot.sprite) continue;
      const [cx, cy] = [door.x + door.width / 2, door.y + door.height / 2];
      slot.sprite.sprite.setInteractive({ useHandCursor: true });
      slot.sprite.sprite.on('pointerdown', () => {
        if (slot.view !== 'closed') return;
        const feet = this.hooks.feet();
        if (Math.hypot(feet.x - cx, feet.y - cy) <= KNOCK_REACH_PX) this.hooks.onKnock(slot.key);
        else this.hooks.onBlocked(slot.key);
      });
      slot.wall = this.scene.add.zone(cx, cy, door.width, door.height);
      this.scene.physics.add.existing(slot.wall, true);
      (slot.wall.body as Phaser.Physics.Arcade.StaticBody).enable = false;
      this.scene.physics.add.collider(player, slot.wall, () => this.blocked(slot.key));
    }
  }

  // Les places et les portes fermées pour soi ont changé : les noms se réécrivent, les portes se mettent à leur état (en s'ouvrant ou se fermant, sauf la première
  // fois : on arrive dans un bureau dont les portes sont déjà comme elles sont).
  update(desks: readonly DeskInfo[], closedForMe: readonly string[]): void {
    const byKey = new Map(desks.map((desk) => [desk.key, desk] as const));
    const now = this.scene.time.now;
    for (const slot of this.slots) {
      const desk = byKey.get(slot.key);
      const { text, free } = deskLabel(desk);
      slot.label.setText(text).setStyle(free ? FREE_LABEL_STYLE : LABEL_STYLE);
      slot.view = doorView(desk, closedForMe, slot.key);
      slot.ownerId = desk?.ownerId ?? null;
      const body = slot.wall?.body as Phaser.Physics.Arcade.StaticBody | undefined;
      if (body) body.enable = slot.view === 'closed';
      if (slot.sprite) {
        // Un bureau qu'on vient de verrouiller se ferme sans attendre : aucune fermeture en attente d'un départ.
        const next = this.watchOf(slot, now);
        slot.sprite.setTarget(next.target, { instant: !slot.shown });
        slot.watch = next.watch;
      }
      slot.shown = true;
    }
  }

  // La phase de chaque porte, par clé de place (pour les tests de bout en bout).
  phases(): Record<string, DoorPhase> {
    return Object.fromEntries(this.slots.flatMap((slot) => (slot.sprite ? [[slot.key, slot.sprite.phase] as const] : [])));
  }

  // À chaque image : les portes s'ouvrent devant qui s'en approche et se referment derrière lui.
  tick(): void {
    const now = this.scene.time.now;
    for (const slot of this.slots) {
      if (!slot.sprite || !slot.shown) continue;
      const next = this.watchOf(slot, now);
      slot.sprite.setTarget(next.target);
      slot.watch = next.watch;
    }
  }

  destroy(): void {
    for (const slot of this.slots) {
      slot.label.destroy();
      slot.sprite?.destroy();
      slot.wall?.destroy();
    }
    this.slots.length = 0;
    this.lastBlocked.clear();
  }

  private watchOf(slot: Slot, now: number) {
    const door = slot.door!;
    const selfNear = nearDoor(this.hooks.feet(), door);
    const ownerNear = slot.ownerId !== null && nearDoor(this.hooks.ownerAt(slot.ownerId), door);
    return watchDoor(slot.watch, { view: slot.view, selfNear, ownerNear }, now);
  }

  private distanceTo(door: Zone): number {
    const feet = this.hooks.feet();
    return Math.hypot(feet.x - (door.x + door.width / 2), feet.y - (door.y + door.height / 2));
  }

  private blocked(key: string): void {
    const now = this.scene.time.now;
    const last = this.lastBlocked.get(key);
    if (last !== undefined && now - last < BLOCKED_NOTICE_MS) return;
    this.lastBlocked.set(key, now);
    this.hooks.onBlocked(key);
  }
}
