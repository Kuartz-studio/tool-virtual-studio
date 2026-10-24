import {
  DEFAULT_TIMEZONE,
  OFFICE_DESK_SLOTS,
  TILE_SIZE,
  decorAtlasOf,
  defaultDeskDecor,
  deskKey,
  deskRoomSpecOf,
  floorTheme,
  isClockId,
  timezoneOrDefault,
  wallTheme,
  type DeskDecor,
  type DeskInfo,
  type DeskRoomSpec,
  type OfficeDeskSlot,
  type OfficeMap,
  type Zone,
} from '@bureau/shared';
import type { GameObjects, Tilemaps } from 'phaser';
import { decorTextureKey } from './decor-textures';
import { layoutDecor, placedFromObjects, type Drawn } from './decor-layout';
import { snapToPixels } from './pixel-snap';
import { TileAnimator } from './tile-animator';
import { WallClocks } from './wall-clocks';

// Ce que le jeu dessine des éléments posés : les meubles de la carte (calque `objets`), et dans chaque bureau le sol, les murs et les éléments
// de son occupant (DeskInfo : le poste de travail par défaut tant qu'il n'a rien réglé). Un bureau est redessiné quand son réglage change ;
// l'éditeur (DecorEditor) peut lui substituer un brouillon (`preview`). Les meubles solides d'un bureau sont des obstacles pour l'avatar local,
// comme ceux de la carte (le serveur, lui, ne connaît que les cases de la carte : un meuble de bureau n'arrête que celui qui le voit).
// Les horloges murales donnent l'heure en direct (WallClocks) : celle du fuseau de l'occupant du bureau (DeskInfo.ownerTimezone), celle de Paris pour
// une place libre et pour les horloges de la carte ; la scène les fait avancer à chaque image (tickClocks). Les sols et les murs des bureaux bougent
// (TileAnimator : un reflet qui passe, des étincelles, le néon qui pulse), ceux des espaces communs non ; la scène les fait avancer aussi (tickTiles).

interface Room {
  key: string;
  zone: Zone;
  // Sa taille et le côté de sa porte, lus sur la carte ; le poste par défaut qui va avec (une place libre, ou dont personne n'a rien réglé).
  spec: DeskRoomSpec;
  fallback: DeskDecor;
  slot: OfficeDeskSlot | null;
  signature: string;
  sprites: GameObjects.Image[];
  // Les textures d'horloge que montrent ses images (WallClocks), à rendre quand elles partent.
  clocks: string[];
  bodies: GameObjects.Zone[];
  colliders: Phaser.Physics.Arcade.Collider[];
  drawn: Drawn[];
}

// Les images des éléments posés (celles de la carte ne changent pas : elles sont dessinées une fois). Une horloge murale montre sa texture vivante, à
// l'heure de `zone` (sa clé rejoint `clockKeys`, pour être rendue avec l'image) ; sans elle, l'image de la banque.
function drawAll(scene: Phaser.Scene, drawn: readonly Drawn[], clocks: WallClocks, zone: string, clockKeys: string[]): GameObjects.Image[] {
  const now = Date.now();
  return drawn.map(({ item, left, bottom, depth }) => {
    const live = isClockId(item.id) ? clocks.acquire(item.id, zone, now) : null;
    if (live) clockKeys.push(live);
    const image = live ? scene.add.image(left, bottom, live) : scene.add.image(left, bottom, decorTextureKey(decorAtlasOf(item)), item.id);
    return snapToPixels(image.setOrigin(0, 1).setDepth(depth));
  });
}

export class DecorLayer {
  private readonly rooms = new Map<string, Room>();
  private readonly previews = new Map<string, DeskDecor>();
  private readonly staticDrawn: Drawn[];
  private readonly staticSprites: GameObjects.Image[];
  private readonly staticClocks: string[] = [];
  private readonly clocks: WallClocks;
  private readonly tiles = new TileAnimator();
  private player: Phaser.GameObjects.GameObject | null = null;
  private desks: readonly DeskInfo[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    tilemap: Tilemaps.Tilemap,
    private readonly layers: { sol: Tilemaps.TilemapLayer | null; murs: Tilemaps.TilemapLayer | null },
    map: OfficeMap,
  ) {
    this.clocks = new WallClocks(scene.textures);
    // Les meubles de la carte : le nom de chaque objet est la clé de l'élément, sa position le coin haut-gauche de son empreinte. Une horloge posée
    // par la carte est à l'heure de Paris.
    const objects = tilemap.getObjectLayer('objets')?.objects ?? [];
    this.staticDrawn = layoutDecor(placedFromObjects(objects));
    this.staticSprites = drawAll(scene, this.staticDrawn, this.clocks, DEFAULT_TIMEZONE, this.staticClocks);

    // Les pièces de bureau que la carte décrit, chacune avec sa taille et sa porte : une carte sans portes (celle de développement) n'a pas de déco.
    for (const zone of map.zones.filter((z) => z.type === 'desk')) {
      const key = deskKey(zone);
      const spec = deskRoomSpecOf(map, key);
      if (!spec) continue;
      this.rooms.set(key, { key, zone, spec, fallback: defaultDeskDecor(spec), slot: OFFICE_DESK_SLOTS.find((s) => s.key === key) ?? null, signature: '', sprites: [], clocks: [], bodies: [], colliders: [], drawn: [] });
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

  // Les horloges murales avancent : l'heure de cet instant (Date.now()), à chaque image.
  tickClocks(now: number): void {
    this.clocks.tick(now);
  }

  // Les sols et les murs des bureaux qui bougent montrent l'image de cet instant (Date.now()), à chaque image.
  tickTiles(now: number): void {
    this.tiles.tick(now);
  }

  // Combien de cases des bureaux bougent (pour les tests de bout en bout).
  animatedTiles(): number {
    return this.tiles.size;
  }

  // La pièce de ce bureau (taille et porte), pour que l'éditeur sache où l'on peut poser.
  specOf(key: string): DeskRoomSpec | undefined {
    return this.rooms.get(key)?.spec;
  }

  // Tout ce qui est dessiné, meubles de la carte et éléments des bureaux (brouillons de l'éditeur compris) : la clé de chaque élément et le
  // rectangle de son image, en pixels de la carte. Pour les lumières de la nuit (sourcesFromItems).
  placedImages(): Array<{ id: string; x: number; y: number; w: number; h: number }> {
    return [this.staticDrawn, ...[...this.rooms.values()].map((room) => room.drawn)].flat().map(({ item, left, bottom }) => ({
      id: item.id,
      x: left,
      y: bottom - item.h * TILE_SIZE,
      w: item.w * TILE_SIZE,
      h: item.h * TILE_SIZE,
    }));
  }

  destroy(): void {
    for (const sprite of this.staticSprites) sprite.destroy();
    for (const key of this.staticClocks.splice(0)) this.clocks.release(key);
    for (const room of this.rooms.values()) this.clear(room);
    this.rooms.clear();
    this.previews.clear();
    this.clocks.destroy();
    this.tiles.destroy();
  }

  private decorOf(room: Room): DeskDecor {
    const preview = this.previews.get(room.key);
    if (preview) return preview;
    const desk = this.desks.find((d) => d.key === room.key);
    return desk ? { floor: desk.floor, wall: desk.wall, items: desk.items } : room.fallback;
  }

  // Le fuseau de ses horloges : celui de son occupant ; une place libre est à l'heure de Paris.
  private timezoneOf(room: Room): string {
    return timezoneOrDefault(this.desks.find((d) => d.key === room.key)?.ownerTimezone);
  }

  private refresh(room: Room): void {
    const decor = this.decorOf(room);
    const zone = this.timezoneOf(room);
    // Le fuseau en fait partie : l'occupant qui change de fuseau change l'heure de ses horloges.
    const signature = JSON.stringify([decor.floor, decor.wall, decor.items, zone]);
    if (signature === room.signature) return;
    room.signature = signature;
    this.repaint(room, decor);
    this.clear(room);
    const [roomX, roomY] = [Math.round(room.zone.x / TILE_SIZE), Math.round(room.zone.y / TILE_SIZE)];
    room.drawn = layoutDecor(decor.items.map((item) => ({ id: item.id, x: roomX + item.x, y: roomY + item.y })));
    room.sprites = drawAll(this.scene, room.drawn, this.clocks, zone, room.clocks);
    this.addColliders(room);
  }

  // Le sol de la pièce et les murs qui l'entourent, au thème choisi : on remplace les tuiles de la carte, et celles qui ont une animation se mettent à bouger.
  private repaint(room: Room, decor: DeskDecor): void {
    const floor = floorTheme(decor.floor);
    const wall = wallTheme(decor.wall);
    const [roomX, roomY] = [Math.round(room.zone.x / TILE_SIZE), Math.round(room.zone.y / TILE_SIZE)];
    const sol = this.layers.sol;
    if (floor && sol) {
      for (let y = roomY; y < roomY + room.spec.height; y++) {
        for (let x = roomX; x < roomX + room.spec.width; x++) {
          sol.putTileAt(floor.gid, x, y);
          this.tiles.place(sol, x, y, floor.gid);
        }
      }
    }
    const murs = this.layers.murs;
    if (wall && murs && room.slot) {
      for (const cell of room.slot.walls) {
        murs.putTileAt(wall[cell.part], cell.x, cell.y);
        this.tiles.place(murs, cell.x, cell.y, wall[cell.part]);
      }
    }
  }

  private clear(room: Room): void {
    for (const collider of room.colliders) collider.destroy();
    for (const sprite of room.sprites) sprite.destroy();
    for (const body of room.bodies) body.destroy();
    // Les images détruites d'abord : une texture d'horloge que plus rien ne montre peut partir.
    for (const key of room.clocks) this.clocks.release(key);
    room.clocks = [];
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
