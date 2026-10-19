import { parseOfficeMap, type OfficeMap, type TiledMapJson } from '@bureau/shared';
import { Scale, Scene, Scenes } from 'phaser';
import { exposeDebug, type OfficeDebug } from '../debug';
import { EventBus } from '../EventBus';
import { addZoneLabels, buildMapLayers } from '../map-layers';
import { cameraBounds, chooseZoom } from '../zoom';

// Le bureau : la carte, vue de dessus, dans une caméra bornée à la carte. Sans avatar pour l'instant, la caméra regarde le point
// d'apparition.
export class Office extends Scene {
  private officeMap: OfficeMap;
  private tilemap: Phaser.Tilemaps.Tilemap;
  private debug: OfficeDebug;

  constructor(private readonly mapKey: string) {
    super('Office');
  }

  create() {
    // Pas encore d'avatar, de joueurs ni de média : seul `ready` dit quelque chose, et teleport attend le serveur temps réel.
    this.debug = { ready: false, self: null, players: {}, media: { room: null, tiles: 0 }, teleport: () => {} };
    exposeDebug(this.debug);

    // Le Preloader a chargé la carte. parseOfficeMap, que le serveur applique au même fichier, donne le point d'apparition et les
    // zones, tels que le serveur les voit.
    this.officeMap = parseOfficeMap(this.cache.tilemap.get(this.mapKey).data as TiledMapJson);
    this.tilemap = this.add.tilemap(this.mapKey);
    buildMapLayers(this, this.tilemap);
    addZoneLabels(this, this.officeMap.zones);

    this.layoutCamera();
    this.scale.on(Scale.Events.RESIZE, this.layoutCamera);
    const stop = () => {
      this.scale.off(Scale.Events.RESIZE, this.layoutCamera);
      this.debug.ready = false;
    };
    this.events.once(Scenes.Events.SHUTDOWN, stop);
    this.events.once(Scenes.Events.DESTROY, stop);

    this.debug.ready = true;
    EventBus.emit('current-scene-ready', this);
  }

  // Le zoom et les bornes de la caméra dépendent de la taille du canevas : on les refait à chaque redimensionnement.
  private layoutCamera = (): void => {
    const { width, height } = this.scale.gameSize;
    const zoom = chooseZoom(width, height);
    const bounds = cameraBounds({ width: this.tilemap.widthInPixels, height: this.tilemap.heightInPixels }, { width, height }, zoom);
    const camera = this.cameras.main;
    camera.setZoom(zoom);
    camera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    // Sans avatar à suivre, la caméra regarde le point d'apparition (dans les bornes : au bord de la carte si l'apparition en est
    // proche, au milieu si la carte tient dans la vue).
    camera.centerOn(this.officeMap.spawn.x, this.officeMap.spawn.y);
  };
}
