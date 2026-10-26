import {
  avatarBodyFits,
  deskKey,
  insideRing,
  isSimBot,
  parseOfficeMap,
  type ActivityState,
  type Direction,
  type ArenaState,
  type GameId,
  type GameTable,
  type InitPayload,
  type OfficeMap,
  type PublicPlayer,
  type Status,
  type TiledMapJson,
  type TreadmillRef,
  type WorldTick,
  type Zone,
} from '@bureau/shared';
import { Scale, Scene, Scenes } from 'phaser';
import { fr, t } from '../../i18n/fr';
import { chairOf } from '../../games/table-view';
import { deskTitle } from '../../office/desks';
import { emitOnBus, listenOnBus } from '../../net/office-connection';
import { selectDeskOf, useOfficeStore } from '../../state/office-store';
import { AutoWalk, cancelOnMoveKey, planDeskWalk } from '../auto-walk';
import { AVATAR_HEAD_PX, avatarAt } from '../avatar-hover';
import { avatarObjectName } from '../avatars';
import { coffeeTarget, MACHINE_EXCITED_MS, machineTimeScale } from '../coffee';
import { exposeDebug, mediaDebug, type OfficeDebug } from '../debug';
import { Follow, followWalkMap } from '../follow';
import { DecorEditorView } from '../decor-editor';
import { DecorLayer } from '../decor-layer';
import { ArenaLayer } from '../arena-layer';
import { bindCameraDrag } from '../camera-drag';
import { gameTableTarget, tableFocus, type TableState } from '../game-tables';
import { PropLayer } from '../prop-layer';
import { EventBus } from '../EventBus';
import { DeskLayer } from '../desk-layer';
import { bindArenaKeys, bindKeyboard, bindUseKey, bindWheelZoom, bindZoomKeys, DirectionInput } from '../input';
import { Interactions } from '../interactions';
import { clerkTarget, stillWithClerk } from '../clerks';
import { ProgressEffects } from '../progress-effects';
import { sourcesFromItems, sourcesFromProps } from '../light-sources';
import { LightSwitch, nextLightLevel } from '../light-switch';
import { LightingLayer } from '../lighting';
import { addZoneLabels, buildMapLayers } from '../map-layers';
import { addMapSigns } from '../map-signs';
import { MoveSender } from '../move-sender';
import { speakerPlaying, speakerSprites, speakerTarget } from '../speakers';
import { TeleportEffect } from '../teleport-effect';
import { runningAt, spinningTreadmills, stepOffSpot, treadmillRun, type TreadmillRun } from '../treadmill';
import { InteractionPrompt } from '../objects/InteractionPrompt';
import { LocalPlayer } from '../objects/LocalPlayer';
import { SpeakingBubbles } from '../objects/NameTag';
import { RemotePlayer } from '../objects/RemotePlayer';
import { prefersReducedMotion } from '../reduced-motion';
import { CAMERA_MARGIN_TILES, cameraBounds, cameraZoom, easeZoom, ZOOM_BUTTON_STEP } from '../zoom';
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
// la conversation (`media:speaking`, de l'audio et de la vidéo), ou dans le bureau (`net:speaking`, même loin de soi), fait paraître une bulle de
// parole au-dessus de son étiquette (SpeakingBubbles). L'interrupteur de la lumière (une
// plaque au mur du couloir, LightSwitch) demande l'état qui suit celui qu'on voit (`local:lights` : allumée, tamisée, éteinte) quand on l'actionne de près ;
// il bascule à l'annonce du serveur, avec tout le monde (le magasin dit la lumière). La machine à café (une cible de la touche E devant le bar) demande
// un café (`local:coffee`) ; il commence à l'annonce du serveur (`coffee:changed`) : le magasin en tient l'échéance de chacun, l'avatar local en prend la vitesse
// du café, et chacun, soi compris, a une tasse fumante au-dessus de la tête et de la poussière derrière lui quand il court. La machine s'agite 1 s quand quelqu'un
// se sert. Lumière éteinte, c'est la nuit (LightingLayer), et tamisée, une pièce plus sombre, comme moins exposée :
// l'obscurité, trouée par les lampes, le feu et les écrans de la carte et des bureaux, et par un halo autour de chaque personne. Ce qu'on actionne
// de près (la touche E, ou un clic) passe par un seul gestionnaire (Interactions), qui retient la cible la plus proche et dont l'étiquette
// « [E] … » est unique. « Aller à mon
// bureau » (`local:walk-to-desk`) fait marcher l'avatar tout seul jusqu'à sa place (AutoWalk), comme le ferait le clavier ; une touche de
// déplacement, `local:walk-cancel` ou un obstacle l'arrête, et `walk:state` dit à l'interface s'il marche. « Suivre » quelqu'un (`local:follow`, du menu
// d'une personne) le fait marcher derrière elle, à une case (Follow), jusqu'à une touche de déplacement, son départ ou son saut ailleurs. Un clic droit sur un
// avatar ouvre le menu de sa personne (le magasin : `personMenu`), à la place de celui du navigateur. Le serveur dit qui court sur son tapis de course
// (`net:treadmill`, un mode pris sur son tapis) : chacun y court sur place, et le tapis tourne sous lui (treadmill.ts) ; une touche de déplacement, « Aller à mon
// bureau » ou « Suivre » font descendre l'avatar local devant le tapis, d'où il repart.
export class Office extends Scene {
  private officeMap: OfficeMap;
  private tilemap: Phaser.Tilemaps.Tilemap;
  private debug: OfficeDebug;
  private player: LocalPlayer;
  private directions: DirectionInput;
  // « Aller à mon bureau » : la marche automatique, qui prend la place du clavier tant qu'elle dure.
  private autoWalk: AutoWalk;
  // « Suivre » quelqu'un : la marche automatique vers une personne qui bouge ; et la carte de cette marche (les meubles et les portes fermées en plus), refaite
  // quand les bureaux changent.
  private readonly follow = new Follow();
  // Son nom, pris quand on commence à la suivre : quand elle part, le magasin ne la connaît plus.
  private followName = '';
  private followMap: { desks: unknown; closed: unknown; map: OfficeMap } | null = null;
  private moveSender: MoveSender;
  private selfId: string;
  private readonly remotes = new Map<string, RemotePlayer>();
  private othersVisible = true;
  private bubbles: SpeakingBubbles;
  private deskLayer: DeskLayer;
  private decorLayer: DecorLayer;
  private propLayer: PropLayer;
  // Les interrupteurs de lumière de la carte (un seul sur la grande carte, aucun sur celle de développement).
  private switches: LightSwitch[] = [];
  // Ce qu'on actionne de près (touche E, ou un clic) : un seul gestionnaire, et l'étiquette « [E] … » unique qu'il commande.
  private interactions: Interactions;
  private prompt: InteractionPrompt;
  // La machine à café s'agite jusqu'à cette heure (ms, horloge du jeu) ; la vitesse de son animation, telle qu'on l'a réglée.
  private machineExcitedUntil = 0;
  private machineScale = 1;
  // Les images d'amplificateur de chaque enceinte (par clé de pièce) : elles tournent tant que la pièce joue.
  private readonly speakerImages = new Map<string, Phaser.GameObjects.Sprite[]>();
  // Les anneaux de lumière d'un voyage voulu (un mode qui conduit à la salle de sport, ou ramène au bureau), pour soi comme pour ceux qu'on voit sauter.
  private teleportEffect: TeleportEffect;
  // La progression au-dessus des avatars : le « +XP » de ses gains, la gerbe d'étoiles d'une montée de niveau (la sienne, celle des autres qu'on voit).
  private progressEffects: ProgressEffects;
  private lighting: LightingLayer;
  private decorEditor: DecorEditorView;
  // L'éditeur de déco a la caméra : elle ne suit plus l'avatar tant qu'il est ouvert.
  private editingRoom: Zone | null = null;
  // Le panneau d'une table de jeu aussi : la caméra est sur la table, dans la partie de l'écran qu'il laisse libre.
  private focusedTable: GameTable | null = null;
  // La carte a été glissée à la souris : la caméra ne suit plus l'avatar, jusqu'à un double-clic ou jusqu'à ce qu'il se remette à marcher.
  private cameraFree = false;
  // Le zoom que la caméra montre en ce moment, et celui où elle va : elle glisse de l'un à l'autre quand la personne change de pourcentage.
  private zoomShown = 1;
  private zoomTarget = 1;
  // L'octogone (la carte en a un) : la cage, les barres de vie et les coups. Les pieds de l'avatar local à la dernière image où il était là où il en a le
  // droit (un combattant dans le ring, les autres dehors pendant un combat).
  private arena: ArenaLayer | null = null;
  private arenaFeet: { x: number; y: number } | null = null;
  // Le faux live (VITE_SIM=1) : le glisser-déposer des personnes fictives. Absent d'un build normal.
  private readonly simDrag = __SIM__ ? new SimDrag(this) : undefined;
  // La zone de collision d'un avatar tient-elle là ? Pour borner l'extrapolation des autres avatars (SnapshotBuffer).
  private readonly bodyFits = (x: number, y: number): boolean => avatarBodyFits(this.officeMap, x, y);
  // L'avatar que la souris survole (`avatar:hover`), et si elle est sur le jeu (pas sur l'interface, ni hors de la page).
  private hoveredAvatar: string | null = null;
  private pointerInGame = false;
  // Le tapis de course où le serveur dit qu'on court (null : aucun) : l'avatar local y court sur place tant que ses pieds sont sur la bande (runningNow).
  private selfRun: TreadmillRun | null = null;

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
      bubbles: () => this.bubbles?.ids() ?? [],
      cups: () => [...(this.player?.coffeeShown() ? [this.selfId] : []), ...[...this.remotes].filter(([, remote]) => remote.coffeeShown()).map(([id]) => id)],
      machineExcited: () => clock() < this.machineExcitedUntil,
      rings: () => this.teleportEffect?.count(clock()) ?? 0,
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
      following: () => this.follow.id,
      doors: () => this.deskLayer?.phases() ?? {},
      tables: () => (this.officeMap?.tables ?? []).map((table) => ({ game: table.game, ...table.rect, seats: table.seats.map((seat) => ({ x: seat.x, y: seat.y })) })),
      gameTable: (game) => useOfficeStore.getState().games[game as GameId] ?? null,
      debugGame: (game, state, rolls) => emitOnBus(EventBus, 'local:debug-game', { game: game as GameId, state, ...(rolls ? { rolls } : {}) }),
      xp: (xp, kuartzons) => emitOnBus(EventBus, 'local:xp', { xp, ...(kuartzons !== undefined ? { kuartzons } : {}) }),
      effects: () => this.progressEffects?.count(clock()) ?? 0,
      treadmills: () => this.decorLayer?.spinningTreadmills() ?? [],
    };
    exposeDebug(this.debug);

    // Le Preloader a chargé la carte. parseOfficeMap, que le serveur applique au même fichier, donne le point d'apparition et les
    // zones, tels que le serveur les voit.
    this.officeMap = parseOfficeMap(this.cache.tilemap.get(this.mapKey).data as TiledMapJson);
    this.tilemap = this.add.tilemap(this.mapKey);
    const { collisions, sol, murs } = buildMapLayers(this, this.tilemap);
    addZoneLabels(this, this.officeMap.zones);
    addMapSigns(this, this.officeMap.signs);
    if (this.officeMap.arena) this.arena = new ArenaLayer(this, this.officeMap.arena);
    // Les meubles de la carte, et dans chaque bureau le décor de son occupant (thèmes compris).
    this.decorLayer = new DecorLayer(this, this.tilemap, { sol, murs }, this.officeMap);
    // Les objets animés de la carte (machine à café, cheminée, enceintes, sport, bougies, aquarium).
    this.propLayer = new PropLayer(this, this.tilemap);
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
    this.selfRun = treadmillRun(this.officeMap, self?.treadmill);
    this.physics.add.collider(this.player, collisions);
    this.debug.self = { id: me.id, ...this.feet() };
    this.moveSender = new MoveSender();
    // Les noms des bureaux et leurs portes vitrées : celles qui sont fermées pour soi sont des obstacles pour l'avatar local ; elles s'ouvrent devant qui s'en
    // approche (la sienne, ou son propriétaire qu'on voit y entrer), et le son des portes en est prévenu.
    this.deskLayer = new DeskLayer(this, this.officeMap, {
      feet: () => this.feet(),
      ownerAt: (id) => (id === this.selfId ? this.feet() : (this.remotes.get(id)?.position ?? null)),
      onKnock: (key) => emitOnBus(EventBus, 'local:knock', { key }),
      onBlocked: (key) => this.deskBlocked(key),
      onDoorMoved: (move) => emitOnBus(EventBus, 'door:moved', move),
    });
    this.deskLayer.collideWith(this.player);
    this.decorLayer.collideWith(this.player);
    // La nuit : la couche est là dès le départ, invisible tant que la lumière est allumée. Chacun porte son halo, au milieu de son avatar.
    this.teleportEffect = new TeleportEffect(this);
    this.progressEffects = new ProgressEffects(this, this.cameras.main.zoom);
    this.lighting = new LightingLayer(this);
    this.lighting.track(this.selfId, () => ({ x: this.player.x, y: this.player.y - this.player.displayHeight / 2 }));
    const showDesks = () => {
      this.deskLayer.update(useOfficeStore.getState().desks, useOfficeStore.getState().closedDesks);
      this.decorLayer.setDesks(useOfficeStore.getState().desks);
      this.showLightSources();
    };
    showDesks();
    this.decorEditor.sync(useOfficeStore.getState().decorEditor);
    this.bubbles = new SpeakingBubbles((id) => (id === this.selfId ? this.player : this.remotes.get(id)));
    // Ceux que le serveur dit parler déjà (le magasin les a suivis, même avant le jeu) ont leur bulle d'emblée.
    this.bubbles.resetServer(Object.values(players).filter((player) => player.speaking).map((player) => player.id));

    // Ce qu'on actionne de près : la portée est celle des pieds de l'avatar, relue à chaque appui (la touche E, ou un clic).
    this.interactions = new Interactions({ feet: () => this.feet() });
    this.prompt = new InteractionPrompt(this);
    this.prompt.setZoom(this.cameras.main.zoom);
    // Les interrupteurs de lumière : la plaque se met à l'état que dit le magasin, et le suit.
    this.switches = this.officeMap.switches.map((position) => new LightSwitch(this, position, this.interactions, () => this.useLights()));
    const unbindCoffee = this.bindCoffeeMachines();
    const unbindSpeakers = this.bindSpeakers();
    const unbindTables = this.bindGameTables();
    const unbindClerks = this.bindClerks();
    const showLights = (instant = false) => {
      const { level } = useOfficeStore.getState().lights;
      for (const lightSwitch of this.switches) lightSwitch.setLevel(level);
      this.lighting.setLevel(level, { instant });
    };
    // On arrive dans le noir : la nuit tout de suite, sans fondu ni éclair de jour.
    showLights(true);

    // Les autres, à leur dernière position connue : celle de l'init, ou d'un tick arrivé pendant le chargement du jeu (que la scène,
    // qui n'existait pas encore, n'a pas reçu).
    const now = clock();
    for (const player of Object.values(players)) this.addRemote({ ...player, ...positions.get(player.id) }, now);
    // Ceux qui ont un café en arrivant (le magasin le sait), soi compris.
    this.showCoffee();

    this.directions = new DirectionInput();
    const unbindKeyboard = bindKeyboard(this.directions);
    // La touche E actionne la cible la plus proche (une seule, quel que soit le nombre d'objets à portée).
    const unbindUse = bindUseKey(() => void this.interactions.use());
    // L'octogone : son état du moment, puis les attaques, au clavier, quand on s'y bat.
    this.showArena();
    const unbindArena = bindArenaKeys(
      () => this.arenaRole() === 'fighting',
      () => emitOnBus(EventBus, 'local:arena', { type: 'attack', dir: this.player.movePayload().dir }),
    );
    // La marche automatique le dit à l'interface (`walk:state`) à chaque départ et à chaque arrêt ; une touche de déplacement l'interrompt, et arrête aussi de suivre.
    this.autoWalk = new AutoWalk((walking) => emitOnBus(EventBus, 'walk:state', { walking }));
    const unbindWalkKeys = cancelOnMoveKey(this.autoWalk, this.directions);
    const unbindFollowKeys = this.directions.onPress(() => this.stopFollowing());
    // Elle fait aussi descendre de son tapis de course, même relâchée aussitôt (update ne verrait pas cette touche-là).
    const unbindTreadmillKeys = this.directions.onPress(() => this.stepOffTreadmill());

    // Le zoom : la molette sur le jeu (et le pincement d'un pavé tactile, que le navigateur envoie comme Ctrl + molette, et qu'il ne doit
    // pas prendre pour le zoom de la page), et les touches + - 0. Le pourcentage est au magasin ; la caméra y glisse (glideZoom).
    // La carte se fait glisser à la souris (la caméra quitte l'avatar), et un double-clic la recentre sur lui. Pas pendant l'éditeur de déco ni devant une
    // table de jeu : la caméra y montre une pièce, ou une table.
    const unbindDrag = bindCameraDrag(this, {
      canDrag: () => this.editingRoom === null && this.focusedTable === null,
      onStart: () => {
        const camera = this.cameras.main;
        camera.panEffect.reset();
        camera.stopFollow();
        this.cameraFree = true;
      },
      onDrag: (dx, dy) => {
        const camera = this.cameras.main;
        camera.setScroll(camera.scrollX - dx / camera.zoom, camera.scrollY - dy / camera.zoom);
      },
      onDoubleClick: () => this.recenterCamera(),
    });
    const unbindWheel = bindWheelZoom(this.game.canvas, (steps) => useOfficeStore.getState().stepZoom(steps));
    const unbindZoomKeys = bindZoomKeys((step) => {
      const store = useOfficeStore.getState();
      if (step === 0) store.resetZoom();
      else store.stepZoom(step, ZOOM_BUTTON_STEP);
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
      listenOnBus(EventBus, 'net:correct', ({ x, y, reason }) => this.onCorrect(x, y, reason)),
      listenOnBus(EventBus, 'net:status', ({ id, status }) => this.onStatus(id, status)),
      listenOnBus(EventBus, 'net:activity', ({ id, activity }) => this.onActivity(id, activity)),
      listenOnBus(EventBus, 'net:treadmill', ({ id, treadmill }) => this.onTreadmill(id, treadmill)),
      listenOnBus(EventBus, 'net:profile', (p) => this.onProfile(p)),
      listenOnBus(EventBus, 'media:speaking', (ids) => this.bubbles.updateMedia(ids)),
      // La parole des autres, d'après le serveur. La sienne vient de la room (media:speaking), tout de suite : l'écho du serveur la ferait durer.
      listenOnBus(EventBus, 'net:speaking', ({ id, speaking }) => {
        if (id !== this.selfId) this.bubbles.setServer(id, speaking);
      }),
      // Quelqu'un se sert (le café vient d'être annoncé) : la machine s'agite un instant. La fin d'un café (`ms` 0) ne la touche pas.
      listenOnBus(EventBus, 'coffee:changed', ({ ms }) => {
        if (ms > 0) this.machineExcitedUntil = clock() + MACHINE_EXCITED_MS;
      }),
      listenOnBus(EventBus, 'arena:action', (action) => this.arena?.play(action, this.selfId, clock())),
      // La progression : son gain monte au-dessus de sa tête ; une montée de niveau (la sienne, ou celle d'un autre qu'on voit) fait jaillir des étoiles.
      listenOnBus(EventBus, 'progress:gain', (gain) => {
        const head = this.aboveHead(this.feet());
        const now = clock();
        if (gain.levelAfter > gain.levelBefore) this.progressEffects.levelUp(head, t(fr.progress.levelShort, { level: gain.levelAfter }), now);
        else this.progressEffects.float(head, `+${gain.amount} XP`, now);
      }),
      listenOnBus(EventBus, 'net:level', ({ id, level, before }) => {
        if (id === this.selfId || level <= before) return;
        const remote = this.remotes.get(id);
        if (remote) this.progressEffects.levelUp(this.aboveHead(remote.position), t(fr.progress.levelShort, { level }), clock());
      }),
      listenOnBus(EventBus, 'local:walk-to-desk', () => this.walkToDesk()),
      listenOnBus(EventBus, 'local:walk-cancel', () => this.autoWalk.cancel()),
      listenOnBus(EventBus, 'local:follow', ({ id }) => (id === null ? this.stopFollowing() : this.startFollowing(id))),
      useOfficeStore.subscribe((state, previous) => {
        if (state.desks !== previous.desks || state.closedDesks !== previous.closedDesks) showDesks();
        if (state.lights !== previous.lights) showLights();
        if (state.coffee !== previous.coffee) this.showCoffee();
        if (state.music !== previous.music) this.showSpeakers();
        if (state.decorEditor !== previous.decorEditor) {
          this.decorEditor.sync(state.decorEditor);
          // Le brouillon de l'éditeur montre peut-être une lampe de plus, ou de moins.
          this.showLightSources();
        }
        if (state.zoomPercent !== previous.zoomPercent) this.retargetZoom();
        if (state.gameOpen !== previous.gameOpen) this.syncGameFocus(state.gameOpen);
        if (state.arena !== previous.arena) this.showArena();
      }),
    ];
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    // La souris bouge sur le canevas, ou le quitte (pour un panneau, un dock posés dessus, ou hors de la page) : hors de lui, elle ne survole aucun
    // avatar. Les événements du canevas lui-même, et non ceux de Phaser, qui suit aussi la souris au-dessus de l'interface : un avatar caché sous le
    // panneau Personnes aurait sa carte. Un mouvement, et pas seulement l'entrée : la souris est peut-être déjà sur le canevas quand la scène démarre.
    // Au doigt, pas de survol.
    const canvas = this.game.canvas;
    const pointerIn = (event: PointerEvent) => {
      this.pointerInGame = event.pointerType !== 'touch';
    };
    const pointerOut = () => {
      this.pointerInGame = false;
      this.hoverAvatars();
    };
    canvas.addEventListener('pointermove', pointerIn);
    canvas.addEventListener('pointerleave', pointerOut);
    // Un clic droit sur un avatar (le sien compris) : le menu de sa personne, à la place de celui du navigateur ; ailleurs, celui du navigateur.
    const onContextMenu = (event: MouseEvent) => {
      const id = this.avatarAtPage(event.clientX, event.clientY);
      if (id === null) return;
      event.preventDefault();
      const { players, self } = useOfficeStore.getState();
      useOfficeStore.getState().openPersonMenu({ userId: id, x: event.clientX, y: event.clientY, name: (id === self?.id ? self : players[id])?.name });
    };
    canvas.addEventListener('contextmenu', onContextMenu);

    // SHUTDOWN puis DESTROY (le jeu détruit) : la seconde fois, il ne reste rien à retirer.
    const stop = () => {
      this.scale.off(Scale.Events.RESIZE, this.layoutCamera);
      this.events.off(Scenes.Events.POST_UPDATE, this.afterPhysics, this);
      // Une marche en cours s'arrête, et l'interface le sait (le bus est encore branché). On ne suit plus personne.
      this.autoWalk.cancel();
      this.stopFollowing();
      unbindWalkKeys();
      unbindFollowKeys();
      unbindTreadmillKeys();
      unbindKeyboard();
      unbindUse();
      unbindArena();
      unbindZoomKeys();
      unbindWheel();
      unbindDrag();
      for (const off of unlisten.splice(0)) off();
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      canvas.removeEventListener('pointermove', pointerIn);
      canvas.removeEventListener('pointerleave', pointerOut);
      canvas.removeEventListener('contextmenu', onContextMenu);
      this.pointerInGame = false;
      this.hoverAvatars();
      for (const id of [...this.remotes.keys()]) this.removeRemote(id);
      for (const lightSwitch of this.switches.splice(0)) lightSwitch.destroy();
      unbindCoffee();
      unbindSpeakers();
      unbindTables();
      unbindClerks();
      this.prompt.destroy();
      this.teleportEffect.destroy();
      this.progressEffects.destroy();
      this.lighting.destroy();
      this.deskLayer.destroy();
      this.decorEditor.destroy();
      this.decorLayer.destroy();
      this.propLayer.destroy();
      this.arena?.destroy();
      this.arena = null;
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
  //
  // Sur son tapis de course, l'avatar y court sur place ; une touche de déplacement enfoncée l'en fait descendre, devant le tapis, d'où il repart à cette image
  // même.
  update() {
    const now = clock();
    if (this.directions.current() !== null) this.stepOffTreadmill();
    const run = this.runningNow();
    const autoDirection = this.autoWalk.update({ x: this.player.x, y: this.player.y }, now);
    const followStep = autoDirection === null ? this.followStep(now) : null;
    // Pendant le compte à rebours, les combattants attendent dans leur coin : le clavier ne les déplace pas.
    // La carte avait été glissée ailleurs : l'avatar se remet en marche, la caméra revient à lui.
    if (this.cameraFree && (autoDirection !== null || followStep !== null || this.directions.current() !== null)) this.recenterCamera();
    this.player.setRunning(run?.depth ?? null);
    if (run !== null) this.player.run();
    else if (this.arenaRole() === 'waiting') this.player.step(null);
    else if (autoDirection !== null) this.player.step(autoDirection);
    else if (followStep !== null) this.player.step(followStep.dir, followStep.sprint);
    else this.player.step(this.directions.current(), this.directions.sprinting(), this.boosted());
    this.player.tick(now);
    // Les horloges murales et les sols et les murs qui bougent : l'heure du navigateur (Date.now), et non celle du jeu, qui ne dit pas l'heure qu'il est.
    this.decorLayer.tickClocks(Date.now());
    this.decorLayer.tickTiles(Date.now());
    this.shakeMachine(now);
    this.teleportEffect.tick(now);
    this.progressEffects.tick(now);
    this.arena?.tick(now, this.game.loop.delta);
    for (const remote of this.remotes.values()) {
      const drawn = remote.render(now);
      const entry = this.debug.players[remote.id];
      if (entry) {
        entry.x = Math.round(drawn.x);
        entry.y = Math.round(drawn.y);
      }
      this.simDrag?.arrived(remote.id, drawn);
    }
    // Le tapis tourne sous qui y court : soi, et les autres tels qu'on les dessine à cette image.
    this.decorLayer.spinTreadmills(spinningTreadmills([run, ...[...this.remotes.values()].map((remote) => remote.runningOn())]));
    // Les portes s'ouvrent devant qui s'en approche, avec les positions de cette image.
    this.deskLayer.tick();
    this.hoverAvatars();
  }

  // Le tapis de course où l'avatar local court en ce moment : celui que le serveur dit, tant que ses pieds sont sur la bande ; null sinon (il n'y court pas,
  // ou il en est déjà descendu, avant que le serveur ne le dise).
  private runningNow(): TreadmillRun | null {
    return runningAt(this.selfRun, this.feet());
  }

  // Descendre de son tapis de course, si l'on y court (une touche, « Aller à mon bureau », « Suivre ») : l'avatar va tout de suite à la case libre devant lui
  // (stepOffSpot), et le serveur l'apprend par le `move` qui part aussitôt : un pas qui la pose hors du tapis, qu'il accepte tel quel, et qui la fait descendre
  // chez lui aussi (il le dit ensuite : `net:treadmill`). Un refus du serveur la remet sur la bande, où elle court de nouveau. Sans case (son bureau n'est plus
  // sur la carte), l'avatar cesse de courir et repart d'où il est : le serveur, qui reçoit un pas sur le tapis, le pose devant.
  private stepOffTreadmill(): void {
    const run = this.runningNow();
    if (run === null) return;
    const { desks, positions } = useOfficeStore.getState();
    const spot = stepOffSpot(this.officeMap, run.ref, desks, [...positions.values()]);
    this.player.setRunning(null);
    if (spot === null) {
      this.selfRun = null;
      return;
    }
    this.player.placeAt(spot.x, spot.y);
    this.moveSender.reset();
    this.sendLocalState(clock());
  }

  // Suivre cette personne (`local:follow`) : la marche vers son bureau s'arrête, et le magasin dit qui l'on suit. Soi-même, ou quelqu'un qu'on ne voit pas : rien.
  // Sur son tapis de course, l'avatar en descend d'abord : la marche part de devant le tapis.
  private startFollowing(id: string): void {
    if (id === this.selfId || !this.remotes.has(id)) return;
    this.stepOffTreadmill();
    this.autoWalk.cancel();
    this.follow.start(id);
    this.followName = useOfficeStore.getState().players[id]?.name ?? '';
    useOfficeStore.getState().setFollowing(id);
  }

  // Ne plus suivre personne. `reason` : ce n'est pas la personne qui l'a demandé (la suivie est partie, a sauté ailleurs, est hors d'atteinte ; ou l'on a été posé
  // ailleurs) : l'interface le lui dit (`follow:lost`).
  private stopFollowing(reason?: 'left' | 'jumped' | 'blocked' | 'moved'): void {
    const id = this.follow.id;
    if (id === null) return;
    this.follow.stop();
    useOfficeStore.getState().setFollowing(null);
    if (reason) emitOnBus(EventBus, 'follow:lost', { id, name: this.followName, reason });
  }

  // Une image de « Suivre » : la direction à prendre, et s'il faut courir ; null hors de cette marche, ou à côté de la personne suivie.
  private followStep(now: number): { dir: Direction; sprint: boolean } | null {
    const id = this.follow.id;
    if (id === null) return null;
    const remote = this.remotes.get(id);
    if (!remote) {
      this.stopFollowing('left');
      return null;
    }
    const step = this.follow.update(this.followWalkMap(), { x: this.player.x, y: this.player.y }, remote.position, now);
    if (step === 'blocked') {
      this.stopFollowing('blocked');
      return null;
    }
    return step;
  }

  // La carte de la marche de qui suit (et d'« Aller à mon bureau ») : celle du jeu, plus les meubles des bureaux, dedans comme devant eux, et les portes qui
  // nous sont fermées (followWalkMap) ; refaite seulement quand les bureaux ou ces portes changent.
  private followWalkMap(): OfficeMap {
    const { desks, closedDesks } = useOfficeStore.getState();
    if (this.followMap?.desks !== desks || this.followMap.closed !== closedDesks) {
      this.followMap = { desks, closed: closedDesks, map: followWalkMap(this.officeMap, desks, closedDesks) };
    }
    return this.followMap.map;
  }

  // L'avatar à ce point de la page (celui d'un clic droit), le sien compris : le point est ramené au canevas, puis à la carte. Lu sur l'événement lui-même, pas
  // sur le pointeur de Phaser, qui n'a peut-être pas vu la souris arriver là. null : aucun, ou les autres sont cachés.
  private avatarAtPage(clientX: number, clientY: number): string | null {
    const canvas = this.game.canvas.getBoundingClientRect();
    if (canvas.width === 0 || canvas.height === 0) return null;
    const x = ((clientX - canvas.left) * this.scale.width) / canvas.width;
    const y = ((clientY - canvas.top) * this.scale.height) / canvas.height;
    const avatars = [{ id: this.selfId, ...this.feet() }, ...(this.othersVisible ? [...this.remotes.values()].map((remote) => ({ id: remote.id, ...remote.position })) : [])];
    return avatarAt(this.cameras.main.getWorldPoint(x, y), avatars);
  }

  // Quel avatar la souris survole-t-elle, à cette image (les avatars bougent, la caméra aussi) ? Quand cela change, l'interface le sait (`avatar:hover`),
  // avec le haut de sa tête en pixels de la page : elle y pose la carte de l'heure qu'il est chez cette personne. Bouton enfoncé (on fait glisser la
  // carte), ou autres avatars cachés : aucun.
  private hoverAvatars(): void {
    let id: string | null = null;
    // La souris n'est lue que sur le jeu : hors de lui (et à l'arrêt de la scène), il n'y a rien à lire.
    if (this.pointerInGame && this.othersVisible) {
      const pointer = this.input.activePointer;
      if (!pointer.isDown) id = avatarAt(this.cameras.main.getWorldPoint(pointer.x, pointer.y), [...this.remotes.values()].map((remote) => ({ id: remote.id, ...remote.position })));
    }
    if (id === this.hoveredAvatar) return;
    this.hoveredAvatar = id;
    const remote = id === null ? undefined : this.remotes.get(id);
    if (id === null || !remote) {
      emitOnBus(EventBus, 'avatar:hover', null);
      return;
    }
    const { worldView, zoom } = this.cameras.main;
    const canvas = this.game.canvas.getBoundingClientRect();
    const head = { x: remote.position.x, y: remote.position.y - AVATAR_HEAD_PX };
    emitOnBus(EventBus, 'avatar:hover', { id, x: canvas.left + (head.x - worldView.x) * zoom, y: canvas.top + (head.y - worldView.y) * zoom });
  }

  // Après la physique de l'image (POST_UPDATE, où Arcade, abonné avant nous, vient de déplacer l'avatar) : l'état de l'avatar local
  // part au serveur si MoveSender le décide. Pas dans update() : Arcade avance les corps avant elle (UPDATE) mais ne recopie leur
  // position dans les sprites qu'après ; lu dans update(), l'arrêt partirait un pas de physique avant l'endroit où l'avatar s'arrête
  // vraiment, et les autres le verraient s'arrêter 2 ou 3 px trop tôt.
  private afterPhysics(): void {
    // La caméra glisse vers son zoom avant que la nuit ne se dessine : elle la dessine à la vue de cette image.
    this.glideZoom();
    this.keepArenaRules();
    this.sendLocalState(clock());
    const feet = this.feet();
    if (this.debug.self) Object.assign(this.debug.self, feet);
    // La cible qu'on peut actionner de près (l'interrupteur, à 3 cases…) et son étiquette : d'après les pieds de cette image.
    this.prompt.show(this.interactions.update(feet));
    // On s'éloigne du comptoir pendant qu'on parle à une administratrice : la conversation se ferme.
    const { clerk } = useOfficeStore.getState();
    if (clerk !== null && !stillWithClerk(this.officeMap.clerks, clerk, feet)) useOfficeStore.getState().openClerk(null);
    // La nuit, d'après les avatars à leur place de cette image.
    this.lighting.update();
  }

  // Ce qu'est la personne pour l'octogone en ce moment : `fighting` (elle s'y bat), `waiting` (elle va s'y battre : le compte à rebours), `outside`
  // (un combat a lieu et elle n'y est pas : le ring lui est fermé), ou null (aucun combat).
  private arenaRole(): 'fighting' | 'waiting' | 'outside' | null {
    const { arena } = useOfficeStore.getState();
    if (!this.arena || (arena.phase !== 'countdown' && arena.phase !== 'fight')) return null;
    if (!arena.fighters.some((fighter) => fighter.id === this.selfId)) return 'outside';
    return arena.phase === 'fight' ? 'fighting' : 'waiting';
  }

  // L'état de l'octogone, d'après le magasin.
  private showArena(): void {
    const { arena, arenaCountdownEndsAt } = useOfficeStore.getState();
    this.arena?.setState(arena as ArenaState, arenaCountdownEndsAt, clock());
  }

  // Après la physique : la cage de l'octogone est un mur. Un combattant, du compte à rebours à la fin du combat, reste dedans ; tous les autres, tout le
  // temps, restent dehors (le serveur pose les combattants dans le ring au Start, et les en sort à la fin). Un pas qui traverse la cage est défait, un
  // axe après l'autre (on glisse le long du grillage au lieu de s'y coller). Quelqu'un qui se trouve du mauvais côté (une ancienne position, le serveur
  // qui ne l'a pas encore sorti) n'est pas retenu : il peut rejoindre son côté, pas en repartir.
  private keepArenaRules(): void {
    const ring = this.officeMap.arena;
    const feet = { x: this.player.x, y: this.player.y };
    if (!ring) return;
    const { arena } = useOfficeStore.getState();
    const caged = arena.fighters.some((fighter) => fighter.id === this.selfId) && (arena.phase === 'countdown' || arena.phase === 'fight' || arena.phase === 'over');
    const allowed = (x: number, y: number) => (caged ? insideRing(ring, x, y, 12) : !insideRing(ring, x, y, -6));
    const last = this.arenaFeet;
    if (allowed(feet.x, feet.y) || last === null || !allowed(last.x, last.y)) {
      this.arenaFeet = feet;
      return;
    }
    const slide = allowed(feet.x, last.y) ? { x: feet.x, y: last.y } : allowed(last.x, feet.y) ? { x: last.x, y: feet.y } : last;
    this.player.placeAt(slide.x, slide.y);
    this.arenaFeet = slide;
  }

  // Les lumières de la nuit : les lampes, le feu et les écrans posés, ceux de la carte et ceux des bureaux tels qu'on les voit.
  private showLightSources(): void {
    this.lighting.setStatic([...sourcesFromItems(this.decorLayer.placedImages()), ...sourcesFromProps(this.propLayer.images())]);
  }

  // Le point où poser un anneau pour quelqu'un dont les pieds sont là : à hauteur de son milieu, pas du sol.
  private aroundFeet(feet: { x: number; y: number }): { x: number; y: number } {
    return { x: feet.x, y: feet.y - 14 };
  }

  // Au-dessus de la tête d'un avatar (et de son étiquette) dont les pieds sont ici : là où montent les effets de la progression.
  private aboveHead(feet: { x: number; y: number }): { x: number; y: number } {
    return { x: feet.x, y: feet.y - 74 };
  }

  // Les administratrices de l'accueil : une cible de la touche E devant chacune (« [E] Parler à Margot »), qui ouvre la conversation ; un clic sur la réceptionniste
  // fait de même, de près. Rend la fonction qui les retire.
  private bindClerks(): () => void {
    const targets = this.officeMap.clerks.map((clerk) => clerkTarget(clerk, (name) => useOfficeStore.getState().openClerk(name)));
    const unregister = targets.map((target) => this.interactions.register(target));
    for (const sprite of [...this.propLayer.byKey('receptionist'), ...this.propLayer.byKey('receptionist-2')]) {
      const middle = sprite.x + sprite.displayWidth / 2;
      const target = targets.find((candidate) => Math.abs(candidate.pos.x - middle) < sprite.displayWidth / 2);
      if (target) sprite.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.interactions.useTarget(target));
    }
    return () => {
      for (const off of unregister) off();
    };
  }

  private feet(): { x: number; y: number } {
    const { x, y } = this.player.movePayload();
    return { x, y };
  }

  // L'éditeur de déco s'ouvre : la caméra quitte l'avatar et va à la pièce, qu'elle place dans la partie de l'écran que le panneau du bureau
  // laisse libre (il est à droite).
  private focusRoom(room: Zone): void {
    this.editingRoom = room;
    this.cameraFree = false;
    const camera = this.cameras.main;
    camera.stopFollow();
    camera.pan(...this.roomFocus(room, camera.zoom), 450, 'Sine.easeInOut', true);
  }

  // Le point de la carte où la caméra se centre pour montrer cette pièce dans la partie libre de l'écran, à ce zoom : de la bande de mur du nord (deux
  // cases au-dessus de la pièce) jusqu'à son dehors, qui se décore aussi (la bande du sud et la rangée de la rue, trois cases sous elle), d'où la demi-case.
  private roomFocus(room: Zone, zoom: number): [x: number, y: number] {
    return [room.x + room.width / 2 + EDITOR_PANEL_WIDTH_PX / 2 / zoom, room.y + room.height / 2 + this.officeMap.tileSize / 2];
  }

  // Un double-clic, ou l'avatar qui se remet en marche, après avoir glissé la carte : la caméra revient à l'avatar.
  private recenterCamera(): void {
    if (!this.cameraFree || this.editingRoom !== null || this.focusedTable !== null) return;
    this.cameraFree = false;
    this.followPlayer();
  }

  // Il se ferme (ou le panneau de la table de jeu) : la caméra revient à l'avatar.
  private followPlayer(): void {
    this.editingRoom = null;
    this.focusedTable = null;
    const camera = this.cameras.main;
    camera.pan(this.player.x, this.player.y - this.player.displayHeight / 2, 350, 'Sine.easeInOut', true, (_camera: Phaser.Cameras.Scene2D.Camera, progress: number) => {
      if (progress === 1 && this.editingRoom === null && this.focusedTable === null && !this.cameraFree) camera.startFollow(this.player, true, 1, 1, 0, this.player.displayHeight / 2);
    });
  }

  // Les tables de jeu de la carte : une cible de la touche E devant chacune (« [E] Échecs : jouer »), qui demande l'ouverture de son panneau ; un clic sur la table fait de même,
  // de près. Rend la fonction qui les retire.
  private bindGameTables(): () => void {
    const targets = this.officeMap.tables.map((table) =>
      gameTableTarget(
        table,
        () => this.tableState(table.game),
        () => useOfficeStore.getState().openGame(table.game),
      ),
    );
    const unregister = targets.map((target) => this.interactions.register(target));
    // Une zone invisible sur chaque table : un clic y actionne la cible (de près seulement : `useTarget` relit la portée).
    const zones = this.officeMap.tables.map((table, index) =>
      this.add
        .zone(table.rect.x + table.rect.width / 2, table.rect.y + table.rect.height / 2, table.rect.width, table.rect.height)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.interactions.useTarget(targets[index]!)),
    );
    return () => {
      for (const off of unregister) off();
      for (const zone of zones) zone.destroy();
    };
  }

  // Ce que la personne et cette table sont l'une pour l'autre (assise, une partie en cours) : de quoi écrire l'étiquette « [E] … ».
  private tableState(game: GameId): TableState {
    const { games, selfId } = useOfficeStore.getState();
    const table = games[game];
    return { seated: chairOf(table, selfId) !== null, playing: table?.match?.status === 'playing' };
  }

  // Le panneau d'une table s'ouvre (le magasin le dit) : la caméra quitte l'avatar et va à la table, qu'elle place dans la partie de l'écran que le panneau laisse libre. Il se ferme :
  // elle revient à l'avatar.
  private syncGameFocus(game: GameId | null): void {
    const table = game === null ? undefined : this.officeMap.tables.find((candidate) => candidate.game === game);
    if (!table) {
      if (this.focusedTable) this.followPlayer();
      return;
    }
    this.focusedTable = table;
    this.cameraFree = false;
    const camera = this.cameras.main;
    camera.stopFollow();
    camera.pan(...tableFocus(table.rect, camera.zoom, this.scale.gameSize), 450, 'Sine.easeInOut', true);
  }

  // L'interrupteur est actionné de près (E, ou un clic sur la plaque) : on demande l'état qui suit celui qu'on voit (allumée, tamisée, éteinte, puis de
  // nouveau allumée). La lumière ne change qu'à l'annonce du serveur ; sans réponse (un autre vient de l'actionner, la connexion est coupée), rien ne bouge.
  private useLights(): void {
    emitOnBus(EventBus, 'local:lights', { level: nextLightLevel(useOfficeStore.getState().lights.level) });
  }

  // « Aller à mon bureau » (`local:walk-to-desk`) : l'avatar marche tout seul jusqu'à sa place, par le plus court chemin (auto-walk.ts), autour des meubles
  // de tous les bureaux (ceux qu'on a posés devant sa pièce sont dans la rue) et des portes qui nous sont fermées : la carte de la marche de « Suivre ». Mon
  // bureau est celui que le magasin donne à mon identifiant. Sans bureau ou sans chemin, il ne bouge pas, et le jeu le dit (`walk:state` faux). Sur son tapis
  // de course, il en descend d'abord : le chemin part de devant le tapis, et non du meuble.
  private walkToDesk(): void {
    this.stopFollowing();
    this.stepOffTreadmill();
    const { desks, selfId } = useOfficeStore.getState();
    const desk = selectDeskOf({ desks }, selfId);
    const room = desk ? this.officeMap.zones.find((zone) => zone.type === 'desk' && deskKey(zone) === desk.key) : undefined;
    const feet = { x: this.player.x, y: this.player.y };
    this.autoWalk.start(desk && room ? planDeskWalk(this.followWalkMap(), room, desk.items, feet) : null, feet, clock());
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
    // L'avatar est replacé là où le serveur le voit : le trajet qu'il suivait n'est plus le sien, ni la personne qu'il suivait.
    this.autoWalk.cancel();
    this.stopFollowing();
    this.player.placeAt(p.self.x, p.self.y, p.self.dir);
    this.arenaFeet = null;
    this.player.setAvatar(p.self.avatarKey);
    this.player.setDisplayedName(p.self.name);
    this.player.setStatus(p.self.status);
    this.player.setActivity(p.self.activity ?? null);
    this.selfRun = treadmillRun(this.officeMap, p.self.treadmill);
    this.moveSender.reset();

    const present = new Set(p.players.map((player) => player.id));
    for (const id of [...this.remotes.keys()]) {
      if (!present.has(id)) this.removeRemote(id);
    }
    // Ce que le serveur dit de la parole remplace tout ce qu'il disait avant cet init.
    this.bubbles.resetServer(p.players.filter((player) => player.speaking).map((player) => player.id));
    for (const player of p.players) this.placeRemote(player, now);
  }

  // Les positions acceptées depuis le dernier tick. Les nôtres en font partie : l'avatar local, lui, va où le clavier le mène.
  private onTick({ moves }: WorldTick): void {
    const at = clock();
    for (const move of moves) {
      if (move.id === this.selfId) continue;
      const remote = this.remotes.get(move.id);
      // Quelqu'un saute (un mode le conduit à la salle de sport, ou le ramène au bureau) : un anneau de lumière là où il était, un autre là où il arrive. Celle
      // qu'on suivait est partie ailleurs : on ne la suit plus.
      if (remote && move.tp === true) {
        this.teleportEffect.play(this.aroundFeet(remote.position), at);
        this.teleportEffect.play(this.aroundFeet(move), at);
        if (move.id === this.follow.id) this.stopFollowing('jumped');
      }
      remote?.push(at, move, move.tp === true);
    }
  }

  private onJoined(p: PublicPlayer): void {
    if (p.speaking) this.bubbles.setServer(p.id, true);
    this.placeRemote(p, clock());
  }

  // Le serveur a refusé un `move` : l'avatar retourne à la dernière position acceptée, et le serveur relit tout de suite notre état
  // (direction, marche) à cet endroit.
  private onCorrect(x: number, y: number, reason?: 'teleport'): void {
    // Le serveur n'est pas d'accord avec le trajet (une porte, un meuble qu'il connaît mieux que nous) : on s'arrête, au lieu de buter en boucle. Posé ailleurs
    // (un voyage voulu : un mode, « Rejoindre », une invitation), on ne suit plus personne.
    this.autoWalk.cancel();
    if (reason === 'teleport') this.stopFollowing('moved');
    // Un voyage voulu (un mode) : un anneau de lumière au départ et à l'arrivée (le son, lui, vient de sfx-events).
    if (reason === 'teleport') {
      const now = clock();
      this.teleportEffect.play(this.aroundFeet(this.feet()), now);
      this.teleportEffect.play(this.aroundFeet({ x, y }), now);
    }
    this.player.placeAt(x, y);
    // Le serveur pose l'avatar là (dans la cage au début d'un combat, dehors à la fin) : la règle de la cage repart de cette position.
    this.arenaFeet = null;
    if (reason === 'teleport') this.snapCameraToPlayer();
    this.moveSender.reset();
    this.sendLocalState(clock());
  }

  // Un voyage (un mode qui conduit ailleurs) : la caméra saute avec l'avatar, au lieu de rester où il était ou de glisser derrière lui. Un glissement en cours
  // (le retour à l'avatar après la fermeture d'un panneau) s'arrête, et elle le suit de nouveau. Pendant l'éditeur de déco ou devant une table de jeu, elle
  // garde la pièce ou la table qu'elle montre : elle reviendra à l'avatar à leur fermeture (followPlayer).
  private snapCameraToPlayer(): void {
    if (this.editingRoom !== null || this.focusedTable !== null) return;
    this.cameraFree = false;
    const camera = this.cameras.main;
    camera.panEffect.reset();
    camera.startFollow(this.player, true, 1, 1, 0, this.player.displayHeight / 2);
    camera.centerOn(this.player.x, this.player.y - this.player.displayHeight / 2);
  }

  private onStatus(id: string, status: Status): void {
    if (id === this.selfId) this.player.setStatus(status);
    else this.remotes.get(id)?.setStatus(status);
  }

  private onActivity(id: string, activity: ActivityState | null): void {
    if (id === this.selfId) this.player.setActivity(activity);
    else this.remotes.get(id)?.setActivity(activity);
  }

  // Quelqu'un se met à courir sur ce tapis de course, ou en descend (null), d'après le serveur. Il y court dès que ses pieds y sont (le saut qui l'y pose arrive
  // juste avant) ; descendu, il ne court déjà plus.
  private onTreadmill(id: string, ref: TreadmillRef | null): void {
    const run = treadmillRun(this.officeMap, ref);
    if (id === this.selfId) this.selfRun = run;
    else this.remotes.get(id)?.setRunning(run);
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
      existing.setRunning(treadmillRun(this.officeMap, p.treadmill));
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
    remote.setSpeaking(this.bubbles.isSpeaking(p.id));
    remote.setCoffeeUntil(useOfficeStore.getState().coffee[p.id] ?? 0);
    remote.setRunning(treadmillRun(this.officeMap, p.treadmill));
    this.remotes.set(p.id, remote);
    this.lighting.track(p.id, () => remote.lightPoint());
    this.debug.players[p.id] = { x: p.x, y: p.y, avatarKey: remote.avatarKey };
  }

  private removeRemote(id: string): void {
    if (id === this.follow.id) this.stopFollowing('left');
    this.simDrag?.clear(id);
    this.remotes.get(id)?.destroy();
    this.remotes.delete(id);
    this.bubbles.forget(id);
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

  // Un café (window.__office.boost, pour les tests ; la machine à café en donne un aussi) : l'avatar local va à la vitesse du café pendant `ms` ms, et la
  // connexion le dit au serveur (`debug:boost`), qui relève sa limite de vitesse et l'annonce à tout le bureau. L'échéance est au magasin dès maintenant :
  // le test n'attend pas la réponse du serveur.
  private boost(ms: number): void {
    useOfficeStore.getState().setCoffee(this.selfId, ms);
    emitOnBus(EventBus, 'local:boost', { ms });
  }

  // L'avatar local a-t-il un café ? Le magasin en tient l'échéance (ce que dit le serveur : la machine, ou `debug:boost`).
  private boosted(): boolean {
    return clock() < (useOfficeStore.getState().coffee[this.selfId] ?? 0);
  }

  // Le café de chacun, d'après le magasin : la tasse et la poussière de soi et de ceux qu'on voit, jusqu'à leur échéance.
  private showCoffee(): void {
    const { coffee } = useOfficeStore.getState();
    this.player.setCoffeeUntil(coffee[this.selfId] ?? 0);
    for (const [id, remote] of this.remotes) remote.setCoffeeUntil(coffee[id] ?? 0);
  }

  // Les machines à café de la carte : une cible de la touche E devant chacune (« [E] Prendre un café »), qui demande un café ; un clic sur la machine
  // fait de même, de près. Rend la fonction qui les retire.
  private bindCoffeeMachines(): () => void {
    const targets = this.officeMap.coffees.map((position) => coffeeTarget(position, () => emitOnBus(EventBus, 'local:coffee')));
    const unregister = targets.map((target) => this.interactions.register(target));
    for (const sprite of this.propLayer.byKey('coffee')) {
      // La cible de cette machine : la case de service la plus proche d'elle, en largeur.
      const middle = sprite.x + sprite.displayWidth / 2;
      const target = targets.reduce<(typeof targets)[number] | undefined>((best, next) => (best === undefined || Math.abs(next.pos.x - middle) < Math.abs(best.pos.x - middle) ? next : best), undefined);
      if (target) sprite.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.interactions.useTarget(target));
    }
    return () => {
      for (const off of unregister) off();
    };
  }

  // Les enceintes de la carte : une cible de la touche E devant chacune (« [E] Couper la musique » / « [E] Lancer la musique »), qui demande l'état contraire de celui qu'on voit
  // pour sa pièce (`local:music`) ; son amplificateur tourne tant que la pièce joue. Rend la fonction qui les retire.
  private bindSpeakers(): () => void {
    const targets = this.officeMap.speakers.map((speaker) =>
      speakerTarget(speaker, () => useOfficeStore.getState().music[speaker.place], (request) => emitOnBus(EventBus, 'local:music', request)),
    );
    const unregister = targets.map((target) => this.interactions.register(target));
    const amplifiers = [...this.propLayer.byKey('amplifier-big'), ...this.propLayer.byKey('amplifier')];
    for (const speaker of this.officeMap.speakers) this.speakerImages.set(speaker.place, speakerSprites(speaker, amplifiers));
    this.showSpeakers();
    return () => {
      for (const off of unregister) off();
      this.speakerImages.clear();
    };
  }

  // Chaque amplificateur tourne tant que sa pièce joue, d'après la musique que le serveur a annoncée ; éteinte, il s'arrête sur sa première image.
  private showSpeakers(): void {
    const { music } = useOfficeStore.getState();
    for (const [place, sprites] of this.speakerImages) for (const sprite of sprites) this.propLayer.setPlaying(sprite, speakerPlaying(music[place]));
  }

  // La machine à café tourne plus vite pendant MACHINE_EXCITED_MS après qu'on s'est servi : on ne retouche son animation que quand sa vitesse change.
  private shakeMachine(now: number): void {
    const scale = machineTimeScale(now, this.machineExcitedUntil);
    if (scale === this.machineScale) return;
    this.machineScale = scale;
    for (const sprite of this.propLayer.byKey('coffee')) sprite.anims.timeScale = scale;
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
    // La marche automatique s'arrête aussi, et l'on ne suit plus personne : l'avatar reste où il est, et ne repart pas seul au retour de la personne.
    this.autoWalk.cancel();
    this.stopFollowing();
    this.directions.clear();
    this.player.step(null);
    this.sendLocalState(clock());
  };

  // Le zoom et les bornes de la caméra dépendent de la taille du canevas et du pourcentage de zoom choisi. Au démarrage et à chaque
  // redimensionnement, la caméra prend tout de suite le zoom du moment ; à chaque changement de pourcentage, elle y glisse (retargetZoom,
  // puis glideZoom à chaque image).
  private layoutCamera = (): void => {
    this.zoomTarget = this.targetZoom();
    this.zoomShown = this.zoomTarget;
    this.applyZoom(this.zoomShown);
  };

  // Le zoom que la caméra doit avoir : celui du pourcentage choisi, pour la taille du canevas.
  private targetZoom(): number {
    const { width, height } = this.scale.gameSize;
    return cameraZoom(width, height, useOfficeStore.getState().zoomPercent);
  }

  // La personne a changé de pourcentage : la caméra glisse vers le nouveau zoom, ou y saute si elle demande moins de mouvement.
  private retargetZoom(): void {
    this.zoomTarget = this.targetZoom();
    if (!prefersReducedMotion()) return;
    this.zoomShown = this.zoomTarget;
    this.applyZoom(this.zoomShown);
  }

  // À chaque image : un pas du glissement, tant que la caméra n'est pas au zoom voulu.
  private glideZoom(): void {
    if (this.zoomShown === this.zoomTarget) return;
    this.zoomShown = easeZoom(this.zoomShown, this.zoomTarget, this.game.loop.delta);
    this.applyZoom(this.zoomShown);
  }

  // Le zoom de la caméra, ses bornes, et la résolution des étiquettes à ce zoom. Où elle regarde, en revanche, n'est pas à régler ici : elle
  // suit l'avatar, et continue (sauf devant la pièce que l'éditeur montre : on la recentre, le panneau n'occupant pas la même part de l'écran
  // à un autre zoom).
  private applyZoom(zoom: number): void {
    const { width, height } = this.scale.gameSize;
    const map = { width: this.tilemap.widthInPixels, height: this.tilemap.heightInPixels };
    const bounds = cameraBounds(map, { width, height }, zoom, CAMERA_MARGIN_TILES * this.tilemap.tileWidth);
    const camera = this.cameras.main;
    camera.setZoom(zoom);
    camera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    if (this.editingRoom) camera.centerOn(...this.roomFocus(this.editingRoom, zoom));
    else if (this.focusedTable) camera.centerOn(...tableFocus(this.focusedTable.rect, zoom, { width, height }));
    // À la création, layoutCamera passe avant les avatars.
    this.player?.setZoom(zoom);
    for (const remote of this.remotes.values()) remote.setZoom(zoom);
    this.prompt?.setZoom(zoom);
    this.progressEffects?.setZoom(zoom);
  }
}
