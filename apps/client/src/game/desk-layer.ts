import { TILE_SIZE, deskKey, type DeskInfo, type OfficeMap, type Zone } from '@bureau/shared';
import { fr } from '../i18n/fr';
import { DEPTH } from './map-layers';
import { snapToPixels } from './pixel-snap';

// Comment une porte se montre à la personne qui joue :
// - open : ouverte (ou place libre) : rien à voir ;
// - closed : fermée, et cet avatar n'y passe pas : un battant plein, qui bloque (verrou d'un autre, état d'activité, exclusion) ;
// - locked-mine : fermée, mais cet avatar y passe (son bureau, ou il y est admis) : un trait clair, qui ne bloque pas.
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

// Les couleurs des portes : un battant plein, ou un trait clair.
const DOOR_COLORS = { closed: { color: 0xb45309, alpha: 0.95 }, 'locked-mine': { color: 0xf59e0b, alpha: 0.55 } } as const;
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
  panel: Phaser.GameObjects.Rectangle | null;
  wall: Phaser.GameObjects.Zone | null;
  view: DoorView;
}

export interface DeskLayerHooks {
  // Là où sont les pieds de l'avatar local.
  feet(): { x: number; y: number };
  // Un clic sur une porte fermée pour soi, de près : toquer.
  onKnock(key: string): void;
  // L'avatar bute contre une porte fermée pour lui (au plus une fois par BLOCKED_NOTICE_MS et par porte).
  onBlocked(key: string): void;
}

// Ce que le jeu montre des bureaux : le nom de chaque pièce, et sa porte. Une porte fermée pour soi est un obstacle (un corps statique
// que l'avatar local ne traverse pas, comme le serveur le lui refuserait), sur lequel on clique pour toquer. Les cartes sans zone door
// (la carte de développement) n'ont que les noms : le serveur seul garde alors l'entrée.
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
      this.slots.push({ key, room, door, label, panel: null, wall: null, view: 'open' });
    }
  }

  // L'avatar local est connu : les portes peuvent le bloquer.
  collideWith(player: Phaser.GameObjects.GameObject): void {
    for (const slot of this.slots) {
      const door = slot.door;
      if (!door) continue;
      const [cx, cy] = [door.x + door.width / 2, door.y + door.height / 2];
      slot.panel = snapToPixels(this.scene.add.rectangle(cx, cy, door.width, door.height, 0xb45309, 0)).setDepth(DEPTH.meublesBas + 0.4);
      slot.panel.setInteractive({ useHandCursor: true });
      slot.panel.on('pointerdown', () => {
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

  // Les places et les portes fermées pour soi ont changé : les noms et les portes se redessinent.
  update(desks: readonly DeskInfo[], closedForMe: readonly string[]): void {
    const byKey = new Map(desks.map((desk) => [desk.key, desk] as const));
    for (const slot of this.slots) {
      const desk = byKey.get(slot.key);
      const { text, free } = deskLabel(desk);
      slot.label.setText(text).setStyle(free ? FREE_LABEL_STYLE : LABEL_STYLE);
      slot.view = doorView(desk, closedForMe, slot.key);
      if (slot.panel) {
        if (slot.view === 'open') slot.panel.setAlpha(0);
        else slot.panel.setAlpha(1).setFillStyle(DOOR_COLORS[slot.view].color, DOOR_COLORS[slot.view].alpha);
      }
      const body = slot.wall?.body as Phaser.Physics.Arcade.StaticBody | undefined;
      if (body) body.enable = slot.view === 'closed';
    }
  }

  destroy(): void {
    for (const slot of this.slots) {
      slot.label.destroy();
      slot.panel?.destroy();
      slot.wall?.destroy();
    }
    this.slots.length = 0;
    this.lastBlocked.clear();
  }

  private blocked(key: string): void {
    const now = this.scene.time.now;
    const last = this.lastBlocked.get(key);
    if (last !== undefined && now - last < BLOCKED_NOTICE_MS) return;
    this.lastBlocked.set(key, now);
    this.hooks.onBlocked(key);
  }
}
