import {
  DEFAULT_TIMEZONE,
  OFFICE_DESK_SLOTS,
  TILE_SIZE,
  TREADMILL_ID,
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
import { propAnimationKey, propTextureKey } from './prop-textures';
import { prefersReducedMotion } from './reduced-motion';
import { TileAnimator } from './tile-animator';
import { TREADMILL_SHEET_OFFSET_Y, treadmillKey } from './treadmill';
import { WallClocks } from './wall-clocks';

// Ce que le jeu dessine des éléments posés : les meubles de la carte (calque `objets`), et dans chaque bureau le sol, les murs et les éléments
// de son occupant (DeskInfo : le poste de travail par défaut tant qu'il n'a rien réglé). Un bureau est redessiné quand son réglage change ;
// l'éditeur (DecorEditor) peut lui substituer un brouillon (`preview`). Les meubles solides d'un bureau sont des obstacles pour l'avatar local,
// comme ceux de la carte (le serveur, lui, ne connaît que les cases de la carte : un meuble de bureau n'arrête que celui qui le voit).
// Les horloges murales donnent l'heure en direct (WallClocks) : celle du fuseau de l'occupant du bureau (DeskInfo.ownerTimezone), celle de Paris pour
// une place libre et pour les horloges de la carte ; la scène les fait avancer à chaque image (tickClocks). Les sols et les murs des bureaux bougent
// (TileAnimator : un reflet qui passe, des étincelles, le néon qui pulse), ceux des espaces communs non ; la scène les fait avancer aussi (tickTiles).
// Le tapis de course sous qui y court tourne (spinTreadmills, que la scène appelle à chaque image) ; les autres gardent l'image fixe du décor.

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
  // Les tapis de course qui tournent (par treadmillKey) : la planche animée du pack, posée sur l'image du décor, qu'elle cache.
  spinning: Map<string, GameObjects.Sprite>;
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
      this.rooms.set(key, {
        key,
        zone,
        spec,
        fallback: defaultDeskDecor(spec),
        slot: OFFICE_DESK_SLOTS.find((s) => s.key === key) ?? null,
        signature: '',
        sprites: [],
        clocks: [],
        bodies: [],
        colliders: [],
        drawn: [],
        spinning: new Map(),
      });
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

  // Les tapis de course où quelqu'un court (leurs treadmillKey) tournent : la planche animée du pack recouvre l'image du décor, posée TREADMILL_SHEET_OFFSET_Y plus
  // bas (son tapis est plus haut dans sa case), à la même profondeur ; les autres reviennent à l'image fixe. En mouvement réduit, ou sans planche (le fichier n'a pas
  // chargé), aucun ne tourne. Appelé à chaque image : rien ne change tant que ce sont les mêmes.
  spinTreadmills(keys: ReadonlySet<string>): void {
    const can = !prefersReducedMotion() && this.scene.textures.exists(propTextureKey('treadmill')) && this.scene.anims.exists(propAnimationKey('treadmill'));
    for (const room of this.rooms.values()) {
      const [roomX, roomY] = [Math.round(room.zone.x / TILE_SIZE), Math.round(room.zone.y / TILE_SIZE)];
      room.drawn.forEach((drawn, index) => {
        if (drawn.item.id !== TREADMILL_ID) return;
        const key = treadmillKey({ desk: room.key, x: drawn.placed.x - roomX, y: drawn.placed.y - roomY });
        const sprite = room.spinning.get(key);
        const spin = can && keys.has(key);
        if (spin === (sprite !== undefined)) return;
        if (sprite) {
          sprite.destroy();
          room.spinning.delete(key);
          room.sprites[index]?.setVisible(true);
          return;
        }
        const belt = snapToPixels(this.scene.add.sprite(drawn.left, drawn.bottom + TREADMILL_SHEET_OFFSET_Y, propTextureKey('treadmill'), 0).setOrigin(0, 1).setDepth(drawn.depth));
        belt.play(propAnimationKey('treadmill'));
        room.spinning.set(key, belt);
        room.sprites[index]?.setVisible(false);
      });
    }
  }

  // Les tapis qui tournent en ce moment (leurs treadmillKey), pour les tests de bout en bout.
  spinningTreadmills(): string[] {
    return [...this.rooms.values()].flatMap((room) => [...room.spinning.keys()]);
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
    // Les tapis qui tournaient : la scène les refait tourner à l'image suivante, s'ils sont encore là et qu'on y court encore.
    for (const sprite of room.spinning.values()) sprite.destroy();
    room.spinning.clear();
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
