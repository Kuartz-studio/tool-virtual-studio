import {
  DEFAULT_DESK_DECOR,
  DESK_ROOM,
  OFFICE_DESK_SLOTS,
  TILE_SIZE,
  decorItem,
  deskKey,
  floorTheme,
  wallTheme,
  type DeskDecor,
  type DeskInfo,
  type OfficeDeskSlot,
  type OfficeMap,
  type Zone,
} from '@bureau/shared';
import type { GameObjects, Tilemaps } from 'phaser';
import { decorTextureKey } from './decor-textures';
import { layoutDecor, type Drawn, type PlacedAt } from './decor-layout';
import { snapToPixels } from './pixel-snap';

// Ce que le jeu dessine des éléments posés : les meubles de la carte (calque `objets`), et dans chaque bureau le sol, les murs et les éléments
// de son occupant (DeskInfo : le poste de travail par défaut tant qu'il n'a rien réglé). Un bureau est redessiné quand son réglage change ;
// l'éditeur (DecorEditor) peut lui substituer un brouillon (`preview`). Les meubles solides d'un bureau sont des obstacles pour l'avatar local,
// comme ceux de la carte (le serveur, lui, ne connaît que les cases de la carte : un meuble de bureau n'arrête que celui qui le voit).

interface Room {
  key: string;
  zone: Zone;
  slot: OfficeDeskSlot | null;
  signature: string;
  sprites: GameObjects.Image[];
  bodies: GameObjects.Zone[];
  colliders: Phaser.Physics.Arcade.Collider[];
  drawn: Drawn[];
}

// Les images des éléments posés (celles de la carte ne changent pas : elles sont dessinées une fois).
function drawAll(scene: Phaser.Scene, drawn: readonly Drawn[]): GameObjects.Image[] {
  return drawn.map(({ item, left, bottom, depth }) =>
    snapToPixels(scene.add.image(left, bottom, decorTextureKey(item.cat), item.id).setOrigin(0, 1).setDepth(depth)),
  );
}

export class DecorLayer {
  private readonly rooms = new Map<string, Room>();
  private readonly previews = new Map<string, DeskDecor>();
  private readonly staticSprites: GameObjects.Image[];
  private player: Phaser.GameObjects.GameObject | null = null;
  private desks: readonly DeskInfo[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    tilemap: Tilemaps.Tilemap,
    private readonly layers: { sol: Tilemaps.TilemapLayer | null; murs: Tilemaps.TilemapLayer | null },
    map: OfficeMap,
  ) {
    // Les meubles de la carte : le nom de chaque objet est la clé de l'élément, sa position le coin haut-gauche de son empreinte.
    const objects = tilemap.getObjectLayer('objets')?.objects ?? [];
    const placed: PlacedAt[] = objects.flatMap((object) =>
      object.name && decorItem(object.name) ? [{ id: object.name, x: Math.round((object.x ?? 0) / TILE_SIZE), y: Math.round((object.y ?? 0) / TILE_SIZE) }] : [],
    );
    this.staticSprites = drawAll(scene, layoutDecor(placed));

    // Les pièces de bureau de la taille des pièces du jeu : une carte aux bureaux d'une autre taille (la carte de développement) n'a pas de déco.
    for (const zone of map.zones.filter((z) => z.type === 'desk')) {
      const [width, height] = [zone.width / TILE_SIZE, zone.height / TILE_SIZE];
      if (width !== DESK_ROOM.width || height !== DESK_ROOM.height) continue;
      const key = deskKey(zone);
      this.rooms.set(key, { key, zone, slot: OFFICE_DESK_SLOTS.find((s) => s.key === key) ?? null, signature: '', sprites: [], bodies: [], colliders: [], drawn: [] });
    }
  }

  // Les bureaux ont changé (init, `desk:changed`) : ceux dont le réglage a changé se redessinent.
  setDesks(desks: readonly DeskInfo[]): void {
    this.desks = desks;
    for (const room of this.rooms.values()) this.refresh(room);
  }

  // L'éditeur montre ce brouillon à la place du réglage du serveur ; null : retour au réglage du serveur.
  preview(key: string, decor: DeskDecor | null): void {
    if (decor) this.previews.set(key, decor);
    else this.previews.delete(key);
    const room = this.rooms.get(key);
    if (room) this.refresh(room);
  }

  // L'avatar local est connu : les meubles solides des bureaux le bloquent.
  collideWith(player: Phaser.GameObjects.GameObject): void {
    this.player = player;
    for (const room of this.rooms.values()) this.addColliders(room);
  }

  // Les images dessinées de ce bureau (pour attraper un élément à la souris), dans l'ordre où elles sont posées.
  drawnIn(key: string): readonly Drawn[] {
    return this.rooms.get(key)?.drawn ?? [];
  }

  zoneOf(key: string): Zone | undefined {
    return this.rooms.get(key)?.zone;
  }

  destroy(): void {
    for (const sprite of this.staticSprites) sprite.destroy();
    for (const room of this.rooms.values()) this.clear(room);
    this.rooms.clear();
    this.previews.clear();
  }

  private decorOf(room: Room): DeskDecor {
    const preview = this.previews.get(room.key);
    if (preview) return preview;
    const desk = this.desks.find((d) => d.key === room.key);
    return desk ? { floor: desk.floor, wall: desk.wall, items: desk.items } : DEFAULT_DESK_DECOR;
  }

  private refresh(room: Room): void {
    const decor = this.decorOf(room);
    const signature = JSON.stringify([decor.floor, decor.wall, decor.items]);
    if (signature === room.signature) return;
    room.signature = signature;
    this.repaint(room, decor);
    this.clear(room);
    const [roomX, roomY] = [Math.round(room.zone.x / TILE_SIZE), Math.round(room.zone.y / TILE_SIZE)];
    room.drawn = layoutDecor(decor.items.map((item) => ({ id: item.id, x: roomX + item.x, y: roomY + item.y })));
    room.sprites = drawAll(this.scene, room.drawn);
    this.addColliders(room);
  }

  // Le sol de la pièce et les murs qui l'entourent, au thème choisi : on remplace les tuiles de la carte.
  private repaint(room: Room, decor: DeskDecor): void {
    const floor = floorTheme(decor.floor);
    const wall = wallTheme(decor.wall);
    const [roomX, roomY] = [Math.round(room.zone.x / TILE_SIZE), Math.round(room.zone.y / TILE_SIZE)];
    if (floor && this.layers.sol) {
      for (let y = roomY; y < roomY + DESK_ROOM.height; y++) for (let x = roomX; x < roomX + DESK_ROOM.width; x++) this.layers.sol.putTileAt(floor.gid, x, y);
    }
    if (wall && this.layers.murs && room.slot) {
      for (const cell of room.slot.walls) this.layers.murs.putTileAt(wall[cell.part], cell.x, cell.y);
    }
  }

  private clear(room: Room): void {
    for (const collider of room.colliders) collider.destroy();
    for (const sprite of room.sprites) sprite.destroy();
    for (const body of room.bodies) body.destroy();
    room.sprites = [];
    room.bodies = [];
    room.colliders = [];
  }

  private addColliders(room: Room): void {
    if (!this.player) return;
    for (const { item, footprint } of room.drawn) {
      if (!item.solid || item.kind === 'wall' || footprint.w === 0) continue;
      const [w, h] = [footprint.w * TILE_SIZE, footprint.h * TILE_SIZE];
      const body = this.scene.add.zone(footprint.x * TILE_SIZE + w / 2, footprint.y * TILE_SIZE + h / 2, w, h);
      this.scene.physics.add.existing(body, true);
      room.bodies.push(body);
      room.colliders.push(this.scene.physics.add.collider(this.player, body));
    }
  }
}
