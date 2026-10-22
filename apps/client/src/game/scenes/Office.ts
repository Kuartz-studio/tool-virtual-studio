import {
  avatarBodyFits,
  deskKey,
  isSimBot,
  parseOfficeMap,
  type ActivityState,
  type InitPayload,
  type OfficeMap,
  type PublicPlayer,
  type Status,
  type TiledMapJson,
  type WorldTick,
  type Zone,
} from '@bureau/shared';
import { Scale, Scene, Scenes } from 'phaser';
import { fr, t } from '../../i18n/fr';
import { deskTitle } from '../../office/desks';
import { emitOnBus, listenOnBus } from '../../net/office-connection';
import { selectDeskOf, useOfficeStore } from '../../state/office-store';
import { AutoWalk, cancelOnMoveKey, planDeskWalk } from '../auto-walk';
import { avatarObjectName } from '../avatars';
import { exposeDebug, mediaDebug, type OfficeDebug } from '../debug';
import { DecorEditorView } from '../decor-editor';
import { DecorLayer } from '../decor-layer';
import { EventBus } from '../EventBus';
import { DeskLayer } from '../desk-layer';
import { bindKeyboard, bindUseKey, bindZoomKeys, DirectionInput } from '../input';
import { Interactions } from '../interactions';
import { sourcesFromItems } from '../light-sources';
import { LightSwitch } from '../light-switch';
import { LightingLayer } from '../lighting';
import { addZoneLabels, buildMapLayers } from '../map-layers';
import { MoveSender } from '../move-sender';
import { InteractionPrompt } from '../objects/InteractionPrompt';
import { LocalPlayer } from '../objects/LocalPlayer';
import { SpeakingRings } from '../objects/NameTag';
import { RemotePlayer } from '../objects/RemotePlayer';
import { cameraBounds, cameraZoom, WheelZoom } from '../zoom';
import { SimDrag } from '../../sim/sim-drag';

// La largeur du panneau de déco (à droite de l'écran), en pixels de l'écran : la pièce se centre dans le reste.
const EDITOR_PANEL_WIDTH_PX = 380;

// L'horloge des mouvements : celle de la cadence des `move` (MoveSender) et de la réception des positions des autres (SnapshotBuffer),
// en ms. Jamais l'heure `t` des ticks du serveur, qui est celle de son horloge à lui.
const clock = () => performance.now();

// Le bureau : la carte, vue de dessus, l'avatar de la personne qui joue, que le clavier déplace entre les murs et les meubles, ceux
// des autres, et une caméra qui suit le sien sans sortir de la carte.
//
// Le jeu ne démarre qu'après le premier `init` du serveur (OfficePage) : la scène lit au magasin où le serveur l'a placée et qui est
// là, puis suit le bus (office-connection.ts) : positions des autres, arrivées, départs, statuts, profils, corrections, et un nouvel
// `init` à chaque reconnexion. Elle envoie l'état de l'avatar local sur le bus (`local:move`), au rythme de MoveSender. Qui parle dans
// la conversation (`media:speaking`, de l'audio et de la vidéo) entoure le point de son étiquette. L'interrupteur de la lumière (une
// plaque au mur du couloir, LightSwitch) demande l'état contraire de celui qu'on voit (`local:lights`) quand on l'actionne de près ;
// il bascule à l'annonce du serveur, avec tout le monde (le magasin dit la lumière). Lumière éteinte, c'est la nuit (LightingLayer) :
// l'obscurité, trouée par les lampes, le feu et les écrans de la carte et des bureaux, et par un halo autour de chaque personne. Ce qu'on actionne
// de près (la touche E, ou un clic) passe par un seul gestionnaire (Interactions), qui retient la cible la plus proche et dont l'étiquette
// « [E] … » est unique. « Aller à mon
// bureau » (`local:walk-to-desk`) fait marcher l'avatar tout seul jusqu'à sa place (AutoWalk), comme le ferait le clavier ; une touche de
// déplacement, `local:walk-cancel` ou un obstacle l'arrête, et `walk:state` dit à l'interface s'il marche.
export class Office extends Scene {
  private officeMap: OfficeMap;
  private tilemap: Phaser.Tilemaps.Tilemap;
  private debug: OfficeDebug;
  private player: LocalPlayer;
  private directions: DirectionInput;
  // « Aller à mon bureau » : la marche automatique, qui prend la place du clavier tant qu'elle dure.
  private autoWalk: AutoWalk;
  // Jusqu'à quand l'avatar local a un café (ms, horloge du jeu) : 0, il n'en a pas.
  private boostedUntil = 0;
  private moveSender: MoveSender;
  private selfId: string;
  private readonly remotes = new Map<string, RemotePlayer>();
  private othersVisible = true;
  private rings: SpeakingRings;
  private deskLayer: DeskLayer;
  private decorLayer: DecorLayer;
  // Les interrupteurs de lumière de la carte (un seul sur la grande carte, aucun sur celle de développement).
  private switches: LightSwitch[] = [];
  // Ce qu'on actionne de près (touche E, ou un clic) : un seul gestionnaire, et l'étiquette « [E] … » unique qu'il commande.
  private interactions: Interactions;
  private prompt: InteractionPrompt;
  private lighting: LightingLayer;
  private decorEditor: DecorEditorView;
  // L'éditeur de déco a la caméra : elle ne suit plus l'avatar tant qu'il est ouvert.
  private editingRoom: Zone | null = null;
  // Le faux live (VITE_SIM=1) : le glisser-déposer des personnes fictives. Absent d'un build normal.
  private readonly simDrag = __SIM__ ? new SimDrag(this) : undefined;
  // La zone de collision d'un avatar tient-elle là ? Pour borner l'extrapolation des autres avatars (SnapshotBuffer).
  private readonly bodyFits = (x: number, y: number): boolean => avatarBodyFits(this.officeMap, x, y);

  constructor(private readonly mapKey: string) {
    super('Office');
  }

  create() {
    this.debug = {
      ready: false,
      self: null,
      players: {},
      media: mediaDebug,
      teleport: (x, y) => this.teleport(x, y),
      boost: (ms) => this.boost(ms),
      boosted: () => this.boosted(),
      speed: () => this.player?.currentSpeed() ?? 0,
      showOthers: (visible) => this.showOthers(visible),
      avatarsOf: (id) => this.children.list.filter((object) => object.name === avatarObjectName(id)).length,
      selfAvatar: () => (this.player ? { wanted: this.player.avatarWanted, shown: this.player.avatarShown } : null),
      toScreen: (x, y) => {
        const { worldView, zoom } = this.cameras.main;
        return { x: (x - worldView.x) * zoom, y: (y - worldView.y) * zoom };
      },
      editorRoom: () => (this.editingRoom ? { x: this.editingRoom.x, y: this.editingRoom.y } : null),
      zoom: () => this.cameras.main.zoom,
      nightLevel: () => this.lighting?.level ?? 0,
      autoWalking: () => this.autoWalk?.walking ?? false,
    };
    exposeDebug(this.debug);

    // Le Preloader a chargé la carte. parseOfficeMap, que le serveur applique au même fichier, donne le point d'apparition et les
    // zones, tels que le serveur les voit.
    this.officeMap = parseOfficeMap(this.cache.tilemap.get(this.mapKey).data as TiledMapJson);
    this.tilemap = this.add.tilemap(this.mapKey);
    const { collisions, sol, murs } = buildMapLayers(this, this.tilemap);
    addZoneLabels(this, this.officeMap.zones);
    // Les meubles de la carte, et dans chaque bureau le décor de son occupant (thèmes compris).
    this.decorLayer = new DecorLayer(this, this.tilemap, { sol, murs }, this.officeMap);
    this.decorEditor = new DecorEditorView(this, this.decorLayer, { onOpen: (room) => this.focusRoom(room), onClose: () => this.followPlayer() });
    useOfficeStore.getState().setOfficeMap(this.officeMap);
    // Le zoom d'abord : les étiquettes des avatars en dépendent.
    this.layoutCamera();

    // Là où le serveur nous a placés (le dernier init). Sans lui (le magasin vidé pendant le chargement : la page se ferme), au point
    // d'apparition.
    const { self, players, positions } = useOfficeStore.getState();
    const { spawn } = this.officeMap;
    const me = self ?? { id: '', name: '', avatarKey: null, x: spawn.x, y: spawn.y, dir: 'down' as const, status: 'available' as const };
    this.selfId = me.id;
    this.player = new LocalPlayer(this, me, this.cameras.main.zoom);
    this.physics.add.collider(this.player, collisions);
    this.debug.self = { id: me.id, ...this.feet() };
    this.moveSender = new MoveSender();
    // Les noms des bureaux et leurs portes : celles qui sont fermées pour soi sont des obstacles pour l'avatar local.
    this.deskLayer = new DeskLayer(this, this.officeMap, {
      feet: () => this.feet(),
      onKnock: (key) => emitOnBus(EventBus, 'local:knock', { key }),
      onBlocked: (key) => this.deskBlocked(key),
    });
    this.deskLayer.collideWith(this.player);
    this.decorLayer.collideWith(this.player);
    // La nuit : la couche est là dès le départ, invisible tant que la lumière est allumée. Chacun porte son halo, au milieu de son avatar.
    this.lighting = new LightingLayer(this);
    this.lighting.track(this.selfId, () => ({ x: this.player.x, y: this.player.y - this.player.displayHeight / 2 }));
    const showDesks = () => {
      this.deskLayer.update(useOfficeStore.getState().desks, useOfficeStore.getState().closedDesks);
      this.decorLayer.setDesks(useOfficeStore.getState().desks);
      this.showLightSources();
    };
    showDesks();
    this.decorEditor.sync(useOfficeStore.getState().decorEditor);
    this.rings = new SpeakingRings((id) => (id === this.selfId ? this.player : this.remotes.get(id)));

    // Ce qu'on actionne de près : la portée est celle des pieds de l'avatar, relue à chaque appui (la touche E, ou un clic).
    this.interactions = new Interactions({ feet: () => this.feet() });
    this.prompt = new InteractionPrompt(this);
    this.prompt.setZoom(this.cameras.main.zoom);
    // Les interrupteurs de lumière : la plaque se met à l'état que dit le magasin, et le suit.
    this.switches = this.officeMap.switches.map((position) => new LightSwitch(this, position, this.interactions, () => this.useLights()));
    const showLights = (instant = false) => {
      const { on } = useOfficeStore.getState().lights;
      for (const lightSwitch of this.switches) lightSwitch.setOn(on);
      this.lighting.setOn(on, { instant });
    };
    // On arrive dans le noir : la nuit tout de suite, sans fondu ni éclair de jour.
    showLights(true);

    // Les autres, à leur dernière position connue : celle de l'init, ou d'un tick arrivé pendant le chargement du jeu (que la scène,
    // qui n'existait pas encore, n'a pas reçu).
    const now = clock();
    for (const player of Object.values(players)) this.addRemote({ ...player, ...positions.get(player.id) }, now);

    this.directions = new DirectionInput();
    const unbindKeyboard = bindKeyboard(this.directions);
    // La touche E actionne la cible la plus proche (une seule, quel que soit le nombre d'objets à portée).
    const unbindUse = bindUseKey(() => void this.interactions.use());
    // La marche automatique le dit à l'interface (`walk:state`) à chaque départ et à chaque arrêt ; une touche de déplacement l'interrompt.
    this.autoWalk = new AutoWalk((walking) => emitOnBus(EventBus, 'walk:state', { walking }));
    const unbindWalkKeys = cancelOnMoveKey(this.autoWalk, this.directions);

    // Le zoom : la molette sur le jeu (et le pincement d'un pavé tactile, que le navigateur envoie comme Ctrl + molette, et qu'il ne doit
    // pas prendre pour le zoom de la page), et les touches + - 0. Le niveau est au magasin ; layoutCamera le lit.
    const wheelZoom = new WheelZoom();
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const step = wheelZoom.feed(event.deltaY, event.deltaMode, event.ctrlKey, event.timeStamp);
      if (step !== 0) useOfficeStore.getState().stepZoom(step);
    };
    const canvas = this.game.canvas;
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const unbindZoomKeys = bindZoomKeys((step) => {
      const store = useOfficeStore.getState();
      if (step === 0) store.resetZoom();
      else store.stepZoom(step);
    });

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
      listenOnBus(EventBus, 'net:activity', ({ id, activity }) => this.onActivity(id, activity)),
      listenOnBus(EventBus, 'net:profile', (p) => this.onProfile(p)),
      listenOnBus(EventBus, 'media:speaking', (ids) => this.rings.update(ids)),
      listenOnBus(EventBus, 'local:walk-to-desk', () => this.walkToDesk()),
      listenOnBus(EventBus, 'local:walk-cancel', () => this.autoWalk.cancel()),
      useOfficeStore.subscribe((state, previous) => {
        if (state.desks !== previous.desks || state.closedDesks !== previous.closedDesks) showDesks();
        if (state.lights !== previous.lights) showLights();
        if (state.decorEditor !== previous.decorEditor) {
          this.decorEditor.sync(state.decorEditor);
          // Le brouillon de l'éditeur montre peut-être une lampe de plus, ou de moins.
          this.showLightSources();
        }
        if (state.zoomLevel !== previous.zoomLevel) this.layoutCamera();
      }),
    ];
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    // SHUTDOWN puis DESTROY (le jeu détruit) : la seconde fois, il ne reste rien à retirer.
    const stop = () => {
      this.scale.off(Scale.Events.RESIZE, this.layoutCamera);
      this.events.off(Scenes.Events.POST_UPDATE, this.afterPhysics, this);
      // Une marche en cours s'arrête, et l'interface le sait (le bus est encore branché).
      this.autoWalk.cancel();
      unbindWalkKeys();
      unbindKeyboard();
      unbindUse();
      unbindZoomKeys();
      canvas.removeEventListener('wheel', onWheel);
      for (const off of unlisten.splice(0)) off();
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      for (const id of [...this.remotes.keys()]) this.removeRemote(id);
      for (const lightSwitch of this.switches.splice(0)) lightSwitch.destroy();
      this.prompt.destroy();
      this.lighting.destroy();
      this.deskLayer.destroy();
      this.decorEditor.destroy();
      this.decorLayer.destroy();
      useOfficeStore.getState().setOfficeMap(null);
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
  //
  // « Aller à mon bureau » prend la place du clavier tant que la marche dure : elle donne la direction, toujours à la vitesse de la marche (jamais
  // en courant). L'avatar l'applique comme celle du clavier : murs, meubles, animations et positions envoyées sont les mêmes.
  update() {
    const now = clock();
    const autoDirection = this.autoWalk.update({ x: this.player.x, y: this.player.y }, now);
    if (autoDirection !== null) this.player.step(autoDirection);
    else this.player.step(this.directions.current(), this.directions.sprinting(), this.boosted());
    for (const remote of this.remotes.values()) {
      const drawn = remote.render(now);
      const entry = this.debug.players[remote.id];
      if (entry) {
        entry.x = Math.round(drawn.x);
        entry.y = Math.round(drawn.y);
      }
      this.simDrag?.arrived(remote.id, drawn);
    }
  }

  // Après la physique de l'image (POST_UPDATE, où Arcade, abonné avant nous, vient de déplacer l'avatar) : l'état de l'avatar local
  // part au serveur si MoveSender le décide. Pas dans update() : Arcade avance les corps avant elle (UPDATE) mais ne recopie leur
  // position dans les sprites qu'après ; lu dans update(), l'arrêt partirait un pas de physique avant l'endroit où l'avatar s'arrête
  // vraiment, et les autres le verraient s'arrêter 2 ou 3 px trop tôt.
  private afterPhysics(): void {
    this.sendLocalState(clock());
    const feet = this.feet();
    if (this.debug.self) Object.assign(this.debug.self, feet);
    // La cible qu'on peut actionner de près (l'interrupteur, à 3 cases…) et son étiquette : d'après les pieds de cette image.
    this.prompt.show(this.interactions.update(feet));
    // La nuit, d'après les avatars à leur place de cette image.
    this.lighting.update();
  }

  // Les lumières de la nuit : les lampes, le feu et les écrans posés, ceux de la carte et ceux des bureaux tels qu'on les voit.
  private showLightSources(): void {
    this.lighting.setStatic(sourcesFromItems(this.decorLayer.placedImages()));
  }

  private feet(): { x: number; y: number } {
    const { x, y } = this.player.movePayload();
    return { x, y };
  }

  // L'éditeur de déco s'ouvre : la caméra quitte l'avatar et va à la pièce, qu'elle place dans la partie de l'écran que le panneau du bureau
  // laisse libre (il est à droite).
  private focusRoom(room: Zone): void {
    this.editingRoom = room;
    const camera = this.cameras.main;
    camera.stopFollow();
    camera.pan(...this.roomFocus(room, camera.zoom), 450, 'Sine.easeInOut', true);
  }

  // Le point de la carte où la caméra se centre pour montrer cette pièce dans la partie libre de l'écran, à ce zoom.
  private roomFocus(room: Zone, zoom: number): [x: number, y: number] {
    return [room.x + room.width / 2 + EDITOR_PANEL_WIDTH_PX / 2 / zoom, room.y + room.height / 2];
  }

  // Il se ferme : la caméra revient à l'avatar.
  private followPlayer(): void {
    this.editingRoom = null;
    const camera = this.cameras.main;
    camera.pan(this.player.x, this.player.y - this.player.displayHeight / 2, 350, 'Sine.easeInOut', true, (_camera: Phaser.Cameras.Scene2D.Camera, progress: number) => {
      if (progress === 1 && this.editingRoom === null) camera.startFollow(this.player, true, 1, 1, 0, this.player.displayHeight / 2);
    });
  }

  // L'interrupteur est actionné de près (E, ou un clic sur la plaque) : on demande l'état contraire de celui qu'on voit. La lumière ne change qu'à
  // l'annonce du serveur ; sans réponse (un autre vient de l'actionner, la connexion est coupée), rien ne bouge.
  private useLights(): void {
    emitOnBus(EventBus, 'local:lights', { on: !useOfficeStore.getState().lights.on });
  }

  // « Aller à mon bureau » (`local:walk-to-desk`) : l'avatar marche tout seul jusqu'à sa place, par le plus court chemin (auto-walk.ts). Mon bureau est
  // celui que le magasin donne à mon identifiant. Sans bureau ou sans chemin, il ne bouge pas, et le jeu le dit (`walk:state` faux).
  private walkToDesk(): void {
    const { desks, selfId } = useOfficeStore.getState();
    const desk = selectDeskOf({ desks }, selfId);
    const room = desk ? this.officeMap.zones.find((zone) => zone.type === 'desk' && deskKey(zone) === desk.key) : undefined;
    const feet = { x: this.player.x, y: this.player.y };
    this.autoWalk.start(desk && room ? planDeskWalk(this.officeMap, room, desk.items, feet) : null, feet, clock());
  }

  // L'avatar bute contre la porte fermée d'un bureau : on dit à qui il appartient, et comment toquer (ou qu'on n'y est plus le bienvenu).
  private deskBlocked(key: string): void {
    const desk = useOfficeStore.getState().desks.find((d) => d.key === key);
    if (!desk) return;
    const closedByOwner = desk.locked || desk.closedByState;
    const name = deskTitle(desk);
    useOfficeStore.getState().setDeskNotice(t(closedByOwner ? fr.desk.doorClosed : fr.desk.doorBanned, { name }));
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
    // L'avatar est replacé là où le serveur le voit : le trajet qu'il suivait n'est plus le sien.
    this.autoWalk.cancel();
    this.player.placeAt(p.self.x, p.self.y, p.self.dir);
    this.player.setAvatar(p.self.avatarKey);
    this.player.setDisplayedName(p.self.name);
    this.player.setStatus(p.self.status);
    this.player.setActivity(p.self.activity ?? null);
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
      if (move.id !== this.selfId) this.remotes.get(move.id)?.push(at, move, move.tp === true);
    }
  }

  private onJoined(p: PublicPlayer): void {
    this.placeRemote(p, clock());
  }

  // Le serveur a refusé un `move` : l'avatar retourne à la dernière position acceptée, et le serveur relit tout de suite notre état
  // (direction, marche) à cet endroit.
  private onCorrect(x: number, y: number): void {
    // Le serveur n'est pas d'accord avec le trajet (une porte, un meuble qu'il connaît mieux que nous) : on s'arrête, au lieu de buter en boucle.
    this.autoWalk.cancel();
    this.player.placeAt(x, y);
    this.moveSender.reset();
    this.sendLocalState(clock());
  }

  private onStatus(id: string, status: Status): void {
    if (id === this.selfId) this.player.setStatus(status);
    else this.remotes.get(id)?.setStatus(status);
  }

  private onActivity(id: string, activity: ActivityState | null): void {
    if (id === this.selfId) this.player.setActivity(activity);
    else this.remotes.get(id)?.setActivity(activity);
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
    const remote = new RemotePlayer(this, p, now, { zoom: this.cameras.main.zoom, bodyFits: this.bodyFits });
    remote.setVisible(this.othersVisible);
    if (isSimBot(p.id)) this.simDrag?.attach(remote);
    remote.setSpeaking(this.rings.isSpeaking(p.id));
    this.remotes.set(p.id, remote);
    this.lighting.track(p.id, () => remote.lightPoint());
    this.debug.players[p.id] = { x: p.x, y: p.y, avatarKey: remote.avatarKey };
  }

  private removeRemote(id: string): void {
    this.simDrag?.clear(id);
    this.remotes.get(id)?.destroy();
    this.remotes.delete(id);
    this.lighting.untrack(id);
    delete this.debug.players[id];
  }

  // window.__office.teleport : l'avatar local va là tout de suite, puis le serveur l'apprend (debug:teleport, avant le `move` qui
  // suit, qu'il vérifiera depuis là). Des entiers, comme tout ce que reçoit le serveur.
  private teleport(x: number, y: number): void {
    const [tx, ty] = [Math.floor(x), Math.floor(y)];
    this.autoWalk.cancel();
    this.player.placeAt(tx, ty);
    emitOnBus(EventBus, 'local:teleport', { x: tx, y: ty });
    this.moveSender.reset();
    this.sendLocalState(clock());
  }

  // Un café (window.__office.boost, pour les tests ; la machine à café le fera aussi) : l'avatar local va à la vitesse du café pendant `ms` ms, et
  // la connexion le dit au serveur (`debug:boost`), qui relève sa limite de vitesse.
  private boost(ms: number): void {
    this.boostedUntil = ms > 0 ? clock() + ms : 0;
    emitOnBus(EventBus, 'local:boost', { ms });
  }

  private boosted(): boolean {
    return clock() < this.boostedUntil;
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
    // La marche automatique s'arrête aussi : l'avatar reste où il est, et ne repart pas seul au retour de la personne.
    this.autoWalk.cancel();
    this.directions.clear();
    this.player.step(null);
    this.sendLocalState(clock());
  };

  // Le zoom et les bornes de la caméra dépendent de la taille du canevas et du niveau de zoom choisi : on les refait à chaque
  // redimensionnement et à chaque cran de zoom. Où elle regarde, en revanche, n'est pas à régler ici : elle suit l'avatar, et continue
  // après le redimensionnement (sauf devant la pièce que l'éditeur montre : on la recentre, le panneau n'occupant pas la même part de
  // l'écran à un autre zoom). Les étiquettes des avatars suivent le zoom.
  private layoutCamera = (): void => {
    const { width, height } = this.scale.gameSize;
    const zoom = cameraZoom(width, height, useOfficeStore.getState().zoomLevel);
    const bounds = cameraBounds({ width: this.tilemap.widthInPixels, height: this.tilemap.heightInPixels }, { width, height }, zoom);
    const camera = this.cameras.main;
    camera.setZoom(zoom);
    camera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    if (this.editingRoom) camera.centerOn(...this.roomFocus(this.editingRoom, zoom));
    // À la création, layoutCamera passe avant les avatars.
    this.player?.setZoom(zoom);
    for (const remote of this.remotes.values()) remote.setZoom(zoom);
    this.prompt?.setZoom(zoom);
  };
}
