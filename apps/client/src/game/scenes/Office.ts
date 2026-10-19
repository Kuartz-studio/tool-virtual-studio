import { parseOfficeMap, type InitPayload, type OfficeMap, type PublicPlayer, type Status, type TiledMapJson, type WorldTick } from '@bureau/shared';
import { Scale, Scene, Scenes } from 'phaser';
import { emitOnBus, listenOnBus } from '../../net/office-connection';
import { useOfficeStore } from '../../state/office-store';
import { avatarObjectName } from '../avatars';
import { exposeDebug, type OfficeDebug } from '../debug';
import { EventBus } from '../EventBus';
import { bindKeyboard, DirectionInput } from '../input';
import { addZoneLabels, buildMapLayers } from '../map-layers';
import { MoveSender } from '../move-sender';
import { LocalPlayer } from '../objects/LocalPlayer';
import { RemotePlayer } from '../objects/RemotePlayer';
import { cameraBounds, chooseZoom } from '../zoom';

// L'horloge des mouvements : celle de la cadence des `move` (MoveSender) et de la réception des positions des autres (SnapshotBuffer),
// en ms. Jamais l'heure `t` des ticks du serveur, qui est celle de son horloge à lui.
const clock = () => performance.now();

// Le bureau : la carte, vue de dessus, l'avatar de la personne qui joue, que le clavier déplace entre les murs et les meubles, ceux
// des autres, et une caméra qui suit le sien sans sortir de la carte.
//
// Le jeu ne démarre qu'après le premier `init` du serveur (OfficePage) : la scène lit au magasin où le serveur l'a placée et qui est
// là, puis suit le bus (office-connection.ts) : positions des autres, arrivées, départs, statuts, profils, corrections, et un nouvel
// `init` à chaque reconnexion. Elle envoie l'état de l'avatar local sur le bus (`local:move`), au rythme de MoveSender.
export class Office extends Scene {
  private officeMap: OfficeMap;
  private tilemap: Phaser.Tilemaps.Tilemap;
  private debug: OfficeDebug;
  private player: LocalPlayer;
  private directions: DirectionInput;
  private moveSender: MoveSender;
  private selfId: string;
  private readonly remotes = new Map<string, RemotePlayer>();
  private othersVisible = true;

  constructor(private readonly mapKey: string) {
    super('Office');
  }

  create() {
    this.debug = {
      ready: false,
      self: null,
      players: {},
      media: { room: null, tiles: 0 },
      teleport: (x, y) => this.teleport(x, y),
      showOthers: (visible) => this.showOthers(visible),
      avatarsOf: (id) => this.children.list.filter((object) => object.name === avatarObjectName(id)).length,
    };
    exposeDebug(this.debug);

    // Le Preloader a chargé la carte. parseOfficeMap, que le serveur applique au même fichier, donne le point d'apparition et les
    // zones, tels que le serveur les voit.
    this.officeMap = parseOfficeMap(this.cache.tilemap.get(this.mapKey).data as TiledMapJson);
    this.tilemap = this.add.tilemap(this.mapKey);
    const { collisions } = buildMapLayers(this, this.tilemap);
    addZoneLabels(this, this.officeMap.zones);
    // Le zoom d'abord : les étiquettes des avatars en dépendent.
    this.layoutCamera();

    // Là où le serveur nous a placés (le dernier init). Sans lui (le magasin vidé pendant le chargement : la page se ferme), au point
    // d'apparition.
    const { self, players } = useOfficeStore.getState();
    const { spawn } = this.officeMap;
    const me = self ?? { id: '', name: '', avatarKey: null, x: spawn.x, y: spawn.y, dir: 'down' as const, status: 'available' as const };
    this.selfId = me.id;
    this.player = new LocalPlayer(this, me, this.cameras.main.zoom);
    this.physics.add.collider(this.player, collisions);
    this.debug.self = { id: me.id, ...this.feet() };
    this.moveSender = new MoveSender();

    const now = clock();
    for (const player of Object.values(players)) this.addRemote(player, now);

    this.directions = new DirectionInput();
    const unbindKeyboard = bindKeyboard(this.directions);

    // La caméra suit l'avatar, dans les bornes de la carte. Le décalage met le milieu de l'avatar au centre de l'écran, et non ses
    // pieds (que suit la caméra : l'origine du sprite est aux pieds). `true` : startFollow règle camera.roundPixels, et le remettrait
    // à false (c'est son défaut) malgré roundPixels de config.ts ; à lui seul, il n'arrondit pas le défilement (voir pixel-snap.ts).
    this.cameras.main.startFollow(this.player, true, 1, 1, 0, this.player.displayHeight / 2);
    this.scale.on(Scale.Events.RESIZE, this.layoutCamera);
    this.events.on(Scenes.Events.POST_UPDATE, this.afterPhysics, this);

    const unlisten = [
      listenOnBus(EventBus, 'net:init', (p) => this.onInit(p)),
      listenOnBus(EventBus, 'net:tick', (p) => this.onTick(p)),
      listenOnBus(EventBus, 'net:joined', (p) => this.onJoined(p)),
      listenOnBus(EventBus, 'net:left', ({ id }) => this.removeRemote(id)),
      listenOnBus(EventBus, 'net:correct', ({ x, y }) => this.onCorrect(x, y)),
      listenOnBus(EventBus, 'net:status', ({ id, status }) => this.onStatus(id, status)),
      listenOnBus(EventBus, 'net:profile', (p) => this.onProfile(p)),
    ];
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    // SHUTDOWN puis DESTROY (le jeu détruit) : la seconde fois, il ne reste rien à retirer.
    const stop = () => {
      this.scale.off(Scale.Events.RESIZE, this.layoutCamera);
      this.events.off(Scenes.Events.POST_UPDATE, this.afterPhysics, this);
      unbindKeyboard();
      for (const off of unlisten.splice(0)) off();
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      for (const id of [...this.remotes.keys()]) this.removeRemote(id);
      this.debug.ready = false;
      this.debug.self = null;
    };
    this.events.once(Scenes.Events.SHUTDOWN, stop);
    this.events.once(Scenes.Events.DESTROY, stop);

    this.debug.ready = true;
    EventBus.emit('current-scene-ready', this);
  }

  // À chaque image : la direction que demande le clavier devient la vitesse et l'animation de l'avatar, et les autres avatars
  // glissent vers leurs dernières positions reçues. L'état de l'avatar local part après la physique (afterPhysics).
  update() {
    const now = clock();
    this.player.step(this.directions.current());
    for (const remote of this.remotes.values()) {
      const drawn = remote.render(now);
      const entry = this.debug.players[remote.id];
      if (entry) {
        entry.x = Math.round(drawn.x);
        entry.y = Math.round(drawn.y);
      }
    }
  }

  // Après la physique de l'image (POST_UPDATE, où Arcade, abonné avant nous, vient de déplacer l'avatar) : l'état de l'avatar local
  // part au serveur si MoveSender le décide. Pas dans update() : Arcade avance les corps avant elle (UPDATE) mais ne recopie leur
  // position dans les sprites qu'après ; lu dans update(), l'arrêt partirait un pas de physique avant l'endroit où l'avatar s'arrête
  // vraiment, et les autres le verraient s'arrêter 2 ou 3 px trop tôt.
  private afterPhysics(): void {
    this.sendLocalState(clock());
    if (this.debug.self) Object.assign(this.debug.self, this.feet());
  }

  private feet(): { x: number; y: number } {
    const { x, y } = this.player.movePayload();
    return { x, y };
  }

  private sendLocalState(now: number): void {
    const move = this.moveSender.next(now, this.player.movePayload());
    if (move) emitOnBus(EventBus, 'local:move', move);
  }

  // Un nouvel init (reconnexion, redémarrage du serveur) : l'état du serveur remplace le nôtre. L'avatar local va là où le serveur
  // le voit (un serveur redémarré lui rend sa position enregistrée), les autres sont remplacés : ceux partis pendant la coupure
  // disparaissent, ceux arrivés apparaissent, ceux restés sont posés à leur position, sans doublon. Une autre carte : OfficePage
  // recrée le jeu avec elle, cette scène va s'arrêter.
  private onInit(p: InitPayload): void {
    if (p.mapKey !== this.mapKey) return;
    const now = clock();
    this.player.placeAt(p.self.x, p.self.y, p.self.dir);
    this.player.setAvatar(p.self.avatarKey);
    this.player.setDisplayedName(p.self.name);
    this.player.setStatus(p.self.status);
    this.moveSender.reset();

    const present = new Set(p.players.map((player) => player.id));
    for (const id of [...this.remotes.keys()]) {
      if (!present.has(id)) this.removeRemote(id);
    }
    for (const player of p.players) this.placeRemote(player, now);
  }

  // Les positions acceptées depuis le dernier tick. Les nôtres en font partie : l'avatar local, lui, va où le clavier le mène.
  private onTick({ moves }: WorldTick): void {
    const at = clock();
    for (const move of moves) {
      if (move.id !== this.selfId) this.remotes.get(move.id)?.push(at, move);
    }
  }

  private onJoined(p: PublicPlayer): void {
    this.placeRemote(p, clock());
  }

  // Le serveur a refusé un `move` : l'avatar retourne à la dernière position acceptée, et le serveur relit tout de suite notre état
  // (direction, marche) à cet endroit.
  private onCorrect(x: number, y: number): void {
    this.player.placeAt(x, y);
    this.moveSender.reset();
    this.sendLocalState(clock());
  }

  private onStatus(id: string, status: Status): void {
    if (id === this.selfId) this.player.setStatus(status);
    else this.remotes.get(id)?.setStatus(status);
  }

  private onProfile(p: { id: string; name: string; avatarKey: string | null }): void {
    if (p.id === this.selfId) {
      this.player.setDisplayedName(p.name);
      this.player.setAvatar(p.avatarKey);
      return;
    }
    const remote = this.remotes.get(p.id);
    if (!remote) return;
    remote.setProfile(p.name, p.avatarKey);
    const entry = this.debug.players[p.id];
    if (entry) entry.avatarKey = remote.avatarKey;
  }

  // Un autre joueur, à l'état donné par le serveur : créé s'il n'est pas déjà là, posé à sa position sinon. Jamais soi-même.
  private placeRemote(p: PublicPlayer, now: number): void {
    if (p.id === this.selfId) return;
    const existing = this.remotes.get(p.id);
    if (existing) {
      existing.reset(p, now);
      const entry = this.debug.players[p.id];
      if (entry) entry.avatarKey = existing.avatarKey;
      return;
    }
    this.addRemote(p, now);
  }

  private addRemote(p: PublicPlayer, now: number): void {
    if (p.id === this.selfId || this.remotes.has(p.id)) return;
    const remote = new RemotePlayer(this, p, now, this.cameras.main.zoom);
    remote.setVisible(this.othersVisible);
    this.remotes.set(p.id, remote);
    this.debug.players[p.id] = { x: p.x, y: p.y, avatarKey: remote.avatarKey };
  }

  private removeRemote(id: string): void {
    this.remotes.get(id)?.destroy();
    this.remotes.delete(id);
    delete this.debug.players[id];
  }

  // window.__office.teleport : l'avatar local va là tout de suite, puis le serveur l'apprend (debug:teleport, avant le `move` qui
  // suit, qu'il vérifiera depuis là). Des entiers, comme tout ce que reçoit le serveur.
  private teleport(x: number, y: number): void {
    const [tx, ty] = [Math.floor(x), Math.floor(y)];
    this.player.placeAt(tx, ty);
    emitOnBus(EventBus, 'local:teleport', { x: tx, y: ty });
    this.moveSender.reset();
    this.sendLocalState(clock());
  }

  private showOthers(visible: boolean): void {
    this.othersVisible = visible;
    for (const remote of this.remotes.values()) remote.setVisible(visible);
  }

  // L'onglet passe en arrière-plan : le jeu ne dessine plus d'image (donc plus d'update) jusqu'à son retour. L'avatar local s'arrête
  // tout de suite, et le serveur le sait : sinon, il marcherait chez les autres tout ce temps. Au retour, les autres avatars sont
  // tout de suite à leur dernière position reçue, sans glisser depuis celle d'il y a des heures.
  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      for (const remote of this.remotes.values()) remote.snapToLatest();
      return;
    }
    this.directions.clear();
    this.player.step(null);
    this.sendLocalState(clock());
  };

  // Le zoom et les bornes de la caméra dépendent de la taille du canevas : on les refait à chaque redimensionnement. Où elle regarde,
  // en revanche, n'est pas à régler ici : elle suit l'avatar, et continue après le redimensionnement. Les étiquettes des avatars
  // suivent le zoom.
  private layoutCamera = (): void => {
    const { width, height } = this.scale.gameSize;
    const zoom = chooseZoom(width, height);
    const bounds = cameraBounds({ width: this.tilemap.widthInPixels, height: this.tilemap.heightInPixels }, { width, height }, zoom);
    const camera = this.cameras.main;
    camera.setZoom(zoom);
    camera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    // À la création, layoutCamera passe avant les avatars.
    this.player?.setZoom(zoom);
    for (const remote of this.remotes.values()) remote.setZoom(zoom);
  };
}
