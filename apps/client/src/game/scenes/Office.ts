import { parseOfficeMap, type OfficeMap, type TiledMapJson } from '@bureau/shared';
import { Scale, Scene, Scenes } from 'phaser';
import { resolveAvatarKey } from '../avatars';
import { exposeDebug, type OfficeDebug } from '../debug';
import { EventBus } from '../EventBus';
import { bindKeyboard, DirectionInput } from '../input';
import { addZoneLabels, buildMapLayers } from '../map-layers';
import { LocalPlayer } from '../objects/LocalPlayer';
import { cameraBounds, chooseZoom } from '../zoom';

// Qui joue : le compte connecté, et l'avatar qu'il a choisi (null tant qu'il n'en a pas choisi : l'avatar par défaut).
export interface SelfProfile {
  id: string;
  avatarKey: string | null;
}

// Le bureau : la carte, vue de dessus, l'avatar de la personne qui joue, que le clavier déplace entre les murs et les meubles, et
// une caméra qui le suit sans sortir de la carte.
export class Office extends Scene {
  private officeMap: OfficeMap;
  private tilemap: Phaser.Tilemaps.Tilemap;
  private debug: OfficeDebug;
  private player: LocalPlayer;
  private directions: DirectionInput;

  constructor(
    private readonly mapKey: string,
    private readonly self: SelfProfile,
  ) {
    super('Office');
  }

  create() {
    // Pas encore de joueurs ni de média : seuls `ready` et `self` disent quelque chose, et teleport attend le serveur temps réel.
    this.debug = { ready: false, self: null, players: {}, media: { room: null, tiles: 0 }, teleport: () => {} };
    exposeDebug(this.debug);

    // Le Preloader a chargé la carte. parseOfficeMap, que le serveur applique au même fichier, donne le point d'apparition et les
    // zones, tels que le serveur les voit.
    this.officeMap = parseOfficeMap(this.cache.tilemap.get(this.mapKey).data as TiledMapJson);
    this.tilemap = this.add.tilemap(this.mapKey);
    const { collisions } = buildMapLayers(this, this.tilemap);
    addZoneLabels(this, this.officeMap.zones);

    // L'avatar apparaît au point d'apparition de la carte : sans serveur, personne ne dit où il était. Le calque `collisions`
    // l'arrête.
    const { spawn } = this.officeMap;
    this.player = new LocalPlayer(this, spawn.x, spawn.y, resolveAvatarKey(this.self.avatarKey));
    this.physics.add.collider(this.player, collisions);
    this.debug.self = { id: this.self.id, x: spawn.x, y: spawn.y };

    this.directions = new DirectionInput();
    const unbindKeyboard = bindKeyboard(this.directions);

    // La caméra suit l'avatar, dans les bornes de la carte. Le décalage met le milieu de l'avatar au centre de l'écran, et non ses
    // pieds (que suit la caméra : l'origine du sprite est aux pieds). `true` : startFollow règle camera.roundPixels, et le remettrait
    // à false (c'est son défaut) malgré roundPixels de config.ts ; à lui seul, il n'arrondit pas le défilement (voir pixel-snap.ts).
    this.layoutCamera();
    this.cameras.main.startFollow(this.player, true, 1, 1, 0, this.player.displayHeight / 2);
    this.scale.on(Scale.Events.RESIZE, this.layoutCamera);

    const stop = () => {
      this.scale.off(Scale.Events.RESIZE, this.layoutCamera);
      unbindKeyboard();
      this.debug.ready = false;
      this.debug.self = null;
    };
    this.events.once(Scenes.Events.SHUTDOWN, stop);
    this.events.once(Scenes.Events.DESTROY, stop);

    this.debug.ready = true;
    EventBus.emit('current-scene-ready', this);
  }

  // À chaque image : la direction que demande le clavier devient la vitesse et l'animation de l'avatar.
  update() {
    this.player.step(this.directions.current());
    const { x, y } = this.player.movePayload();
    if (this.debug.self) {
      this.debug.self.x = x;
      this.debug.self.y = y;
    }
  }

  // Le zoom et les bornes de la caméra dépendent de la taille du canevas : on les refait à chaque redimensionnement. Où elle regarde,
  // en revanche, n'est pas à régler ici : elle suit l'avatar, et continue après le redimensionnement.
  private layoutCamera = (): void => {
    const { width, height } = this.scale.gameSize;
    const zoom = chooseZoom(width, height);
    const bounds = cameraBounds({ width: this.tilemap.widthInPixels, height: this.tilemap.heightInPixels }, { width, height }, zoom);
    const camera = this.cameras.main;
    camera.setZoom(zoom);
    camera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
  };
}
