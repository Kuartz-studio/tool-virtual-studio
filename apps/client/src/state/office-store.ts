import {
  CHAT_HISTORY_LIMIT,
  EMPTY_ARENA,
  type ActivityState,
  type ArenaState,
  type ChatMessage,
  type ConversationLock,
  type DecorError,
  type DeskBan,
  type DeskDecor,
  type DeskInfo,
  type DeskInvite,
  type DeskKnock,
  type GameId,
  type GameInvite,
  type GameMatchView,
  type GameTableView,
  type InitPayload,
  type LightsState,
  type MediaJoinPayload,
  type MediaState,
  type MyProgress,
  type OfficeMap,
  type PublicPlayer,
  type RoomMusic,
  type Status,
  type TaskView,
  type TreadmillRef,
} from '@bureau/shared';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { boundZoomPercent, clampZoomFloor, clampZoomPercent, stepZoomPercent, ZOOM_DEFAULT_PERCENT, ZOOM_MIN_PERCENT, ZOOM_WHEEL_STEP } from '../game/zoom';
import { anchorFor, planPlace, removeAt, roomOfDesk, type DecorSnap } from '../office/decor-draft';
import type { PanelId } from '../office/panels';

// Ce que l'interface (React) sait du bureau : qui y est, avec quel statut, quels médias et quel profil, si la connexion est prête, la
// dernière consigne audio/vidéo, et les messages du chat. Le serveur le dit à chaque (re)connexion (`init`), puis par événements
// (arrivées, départs, statuts, médias, profils, consignes, messages) ; office-connection.ts les applique ici.
//
// Les positions ne sont pas dans l'état réactif : elles changent 10 fois par seconde, et seul le jeu (Phaser) les dessine. Celles de
// `self` et de `players` sont celles de l'`init` ou de l'arrivée. Les dernières reçues sont gardées à part, dans `positions`, que
// React ne voit pas changer : le jeu y lit où sont les autres quand il démarre (ou redémarre avec une autre carte), même si des
// ticks sont arrivés pendant son chargement, et suit ensuite les ticks lui-même.
export type PlayerPosition = Pick<PublicPlayer, 'x' | 'y' | 'dir' | 'moving'>;

// Une consigne audio/vidéo du serveur : rejoindre la room de son groupe (media:join), ou la quitter (media:leave ; `park` : en gardant sa
// connexion parquée, pour y revenir en un instant).
export type MediaInstruction = { type: 'join'; p: MediaJoinPayload } | { type: 'leave'; park?: boolean };

// L'éditeur de la déco de son bureau : le brouillon (ce que le jeu montre dans la pièce à la place de ce que le serveur a), l'élément qu'on tient
// pour le poser au prochain clic, et pourquoi le dernier geste a été refusé. `saved` est ce qu'avait le serveur à l'ouverture : on sait
// s'il y a des changements à enregistrer.
export interface DecorEditor {
  deskKey: string;
  saved: DeskDecor;
  draft: DeskDecor;
  held: string | null;
  error: DecorError | null;
  // L'outil : poser ce qu'on tient (`place`), ou la gomme (`erase`) : un clic sur un élément de la pièce l'efface.
  tool: DecorTool;
  // Un remplacement qui attend la réponse de la personne (la fenêtre « voulez-vous vraiment le remplacer ? ») : l'élément qu'on voulait poser,
  // où, et le rang (dans le brouillon) de ceux qu'il remplacerait. Rien d'autre ne change tant qu'elle n'a pas répondu.
  replace: PendingReplace | null;
}

export type DecorTool = 'place' | 'erase';

// Ouvrir un panneau depuis ailleurs que ses boutons (voir OfficeState.panelRequest).
export interface PanelRequest {
  panel: PanelId;
  tab?: 'todo' | 'sheet';
  userId?: string;
}

export interface PendingReplace {
  id: string;
  at: { x: number; y: number };
  replacing: number[];
}

// Une invitation à une table, telle que le magasin la garde : ce que le serveur a dit, et jusqu'à quand elle vaut, en ms sur l'horloge de la page (performance.now), puisque le
// serveur ne donne que ce qu'il lui reste à vivre à la réception.
export type GameInviteEntry = GameInvite & { until: number };
// De même pour une invitation dans un bureau.
export type DeskInviteEntry = DeskInvite & { until: number };

// Le menu d'une personne (un clic droit sur son avatar, ou sur sa ligne du panneau Personnes) : de qui, où l'ouvrir (en pixels de la page), et ce qui l'a
// ouvert, à qui rendre le focus à sa fermeture (une ligne du panneau ; rien pour le jeu).
export interface PersonMenuRequest {
  userId: string;
  x: number;
  y: number;
  // Son nom, quand le magasin ne le connaît pas (une personne hors ligne, que seul le panneau Personnes connaît).
  name?: string;
  opener?: HTMLElement | null;
}

export interface OfficeState {
  // Le compte connecté, d'après le dernier `init` ; null avant le premier.
  selfId: string | null;
  // Les autres joueurs présents, par identifiant. Soi-même n'y est jamais : c'est `self`.
  players: Record<string, PublicPlayer>;
  // Un autre onglet a pris la place de celui-ci (`session:replaced`) : le serveur l'a déconnecté, sans reconnexion automatique.
  replaced: boolean;
  // La connexion est prête : connectée, et l'`init` de cette connexion reçu (le serveur nous a placés, et écoute ce qu'on lui
  // envoie). Faux avant le premier `init`, et dès que la connexion est coupée, jusqu'à l'`init` du retour. Le reste de l'état reste
  // là pendant une coupure : celui d'avant, que l'`init` du retour remplacera.
  ready: boolean;
  // La dernière consigne audio/vidéo reçue par la connexion en cours : l'audio et la vidéo la rejouent en se branchant
  // (media/use-media.ts), puisque le serveur ne redit pas une consigne. null avant la première, et dès que la connexion qui l'a reçue
  // est coupée : pendant la coupure, le serveur a pu sortir la personne de son groupe, et il redit la consigne du moment après l'init
  // de la connexion suivante.
  mediaInstruction: MediaInstruction | null;
  // La conversation verrouillée où l'on est (celle de l'`init`, puis ce que dit `conversation:lock`) ; null : aucune. Ses membres restent ensemble
  // où qu'ils aillent, à plein volume (spatial-audio.ts), et les vignettes le montrent (VideoStrip).
  conversationLock: ConversationLock | null;
  // Le chat « Tout le monde » : les 200 derniers messages (CHAT_HISTORY_LIMIT), du plus ancien au plus récent, sans doublon d'`id`.
  // L'historique du dernier `init` (le serveur le redit à chaque arrivée, retour après une coupure ou nouvel onglet : il fait foi), puis
  // les messages reçus depuis, celui qu'on envoie compris (le serveur le renvoie à tout le bureau, émetteur compris).
  chatAll: ChatMessage[];
  // Le chat « À proximité » : les messages reçus depuis l'ouverture de la page, les 200 derniers. Le serveur ne les garde pas et ne les
  // redit jamais : un `init` de retour les laisse là.
  chatNearby: ChatMessage[];
  // Le dernier message « Tout le monde » que la personne a eu sous les yeux (le panneau Chat ouvert sur cet onglet) : ceux qui le suivent,
  // écrits par d'autres, sont les non-lus (selectChatUnread). Le premier `init` lit tout son historique ; null sans message lu.
  chatReadId: string | null;
  // Soi-même, tel que le serveur le voit (position de l'`init`, statut, médias, profil) ; null avant le premier `init`.
  self: PublicPlayer | null;
  // La carte du bureau, d'après le dernier `init` : le jeu ne démarre qu'avec elle.
  mapKey: string | null;
  // Le dernier statut que la personne a choisi dans le menu de la puce « Moi » (MeMenu), dans cet onglet ; null si elle n'en a pas choisi. Le serveur
  // ne garde les statuts qu'en mémoire : redémarré (un déploiement), son `init` dit « Disponible », et la connexion lui redit ce choix
  // (office-connection.ts). Un `init` ne le change donc pas. Il ne survit pas au rechargement de la page.
  chosenStatus: Status | null;
  // Les états d'activité que la personne a créés (GET /api/me/states, lus à son arrivée, puis tenus à jour par ce qu'elle en fait).
  myStates: ActivityState[];
  // L'état d'activité que la personne a pris dans le menu (identifiant), dans cet onglet ; null si elle n'en a pas pris. Comme chosenStatus :
  // le serveur ne le garde qu'en mémoire, la connexion le lui redit après un redémarrage.
  chosenActivityId: string | null;
  // Elle l'a pris sur son tapis de course (la ligne « Mon tapis de course » du menu) : la connexion le redit ainsi. Un autre mode l'oublie.
  chosenTreadmill: boolean;
  // Les places de bureau, dans l'ordre de la carte (celui de l'`init`), tenues à jour par `desk:changed`.
  desks: DeskInfo[];
  // Les places dont la porte est fermée pour soi (verrou, état d'activité de son propriétaire, ou exclusion) : l'avatar n'y entre pas.
  closedDesks: string[];
  // Ceux que soi-même a exclus de son bureau.
  deskBans: DeskBan[];
  // Ceux qui toquent à la porte de son bureau, dans l'ordre d'arrivée, une fois chacun (une personne qui retoque remplace l'ancien toc).
  deskKnocks: DeskKnock[];
  // Un message passager sur les bureaux (porte fermée, toc toc envoyé), qui s'efface de lui-même ; null sans message.
  deskNotice: string | null;
  // La lumière du bureau, la même pour tout le monde : allumée tant que le serveur n'a rien dit, puis celle du dernier `init` ou de
  // `lights:changed`. Le jeu l'obscurcit quand elle est éteinte, à moitié quand elle est tamisée ; `by` et `at` disent qui l'a changée en dernier, et quand.
  lights: LightsState;
  // Jusqu'à quand chaque personne a un café, en ms sur l'horloge de la page (performance.now) : le serveur dit ce qu'il lui reste (`coffee:changed`, ou
  // `boost` dans l'`init`), le magasin en fait une échéance. Qui n'a pas de ligne n'a pas de café. Le jeu y lit ceux dont la tasse se montre (et si
  // l'avatar local va à la vitesse du café), la pastille ce qu'il reste à soi-même.
  coffee: Record<string, number>;
  // La musique des pièces que quelqu'un a réglées, par clé de lieu (celle de la carte, `desk:A1` pour un bureau) : celle du dernier `init`, puis ce que dit
  // `music:changed`. Une pièce qui n'y est pas est allumée, avec son ambiance par défaut. L'audio y lit ce qu'il joue (selectWantedScene), la puce du lieu ce qu'on
  // règle.
  music: Record<string, RoomMusic>;
  // Les tables de jeu, par jeu : la dernière vue que le serveur en a donnée (celle de l'`init`, puis `game:table`, qui ne remplace que par une version plus récente).
  // Un jeu sans table sur la carte n'y est pas : la petite carte de développement n'en a aucune.
  games: Partial<Record<GameId, GameTableView>>;
  // Les invitations à une table qui attendent sa réponse (celles de l'`init`, puis `game:invite`) ; une invitation y reste jusqu'à ce qu'on réponde, qu'elle expire
  // ou que le serveur la retire (`game:invite:gone`).
  gameInvites: GameInviteEntry[];
  // La table dont le panneau est ouvert, ou que l'on demande d'ouvrir (la touche E à une table, « Accepter » une invitation) : la coque ouvre alors le panneau, la
  // caméra va à la table. null : aucun panneau de jeu.
  gameOpen: GameId | null;
  // La table où une partie que l'on jouait a disparu pendant une coupure (le serveur a redémarré : les parties en cours ne sont pas gardées) : le panneau dit
  // « Partie interrompue ». null sans interruption à signaler.
  gameInterrupted: GameId | null;
  // L'octogone, tel que le serveur l'annonce (`arena:state`), et l'heure (horloge de la page, performance.now) de la fin de son compte à rebours.
  arena: ArenaState;
  arenaCountdownEndsAt: number;
  // La carte, lue par le jeu au chargement (la même que celle du serveur) : l'interface y lit les zones (qui est dans mon bureau ?).
  // null avant le jeu, et en dehors de lui.
  officeMap: OfficeMap | null;
  // L'éditeur de la déco de son bureau ; null quand il est fermé.
  decorEditor: DecorEditor | null;
  // Le zoom de la caméra : le pourcentage choisi (zoom.ts), 100 % au début. Le jeu le lit (la caméra y glisse), les boutons de zoom, la
  // molette et le clavier l'écrivent.
  zoomPercent: number;
  // Le plancher du zoom (zoom.ts, zoomFloorPercent) : le pourcentage le plus loin, où l'on voit la carte et sa marge, pas plus. Le jeu le
  // calcule pour sa carte et la taille du canevas, à chaque mise en page de la caméra (setZoomFloor) ; 25 % (le plancher absolu) avant lui.
  zoomFloor: number;
  // Sa progression (XP, kuartzons, série de pointage, ce qu'elle possède de la boutique), telle que le serveur la dit (l'`init`, puis `progress:mine`), sans le gain
  // qui l'y amène (la connexion l'annonce) ; null avant le premier `init`. Son niveau s'en déduit (levelOf) ; celui des autres est dans leur PublicPlayer.
  progress: MyProgress | null;
  // Combien de fois sa progression a changé ici (setProgress) : la réponse d'une route ne la remplace que si rien n'est arrivé pendant l'appel
  // (setProgressSince). Le serveur envoie `progress:mine` avant de répondre : ce qui est arrivé entre-temps est au moins aussi récent.
  progressSeq: number;
  // Sa liste de tâches (GET /api/me/tasks, lue à chaque connexion prête, puis tenue à jour : une mission reçue, une tâche cochée, une mission retirée) : les
  // ouvertes, puis celles fermées depuis une semaine. null avant la lecture : un changement qui arrive avant n'invente pas une liste incomplète.
  tasks: TaskView[] | null;
  // Les derniers changements de sa liste (upsertTask, removeTask), numérotés (taskSeq : le dernier numéro) : une liste lue pendant qu'ils arrivaient
  // les reprend par-dessus (setTasks avec `since`), au lieu de les effacer.
  taskLog: TaskChange[];
  taskSeq: number;
  // Les missions qu'elle a confiées (GET /api/me/missions, lues quand on parle à une administratrice, puis tenues à jour par `task:changed`) ; null avant.
  given: TaskView[] | null;
  // L'administratrice de l'accueil à qui l'on parle (sa clé : margot, ines, lucie) : la fenêtre de dialogue est ouverte. null : aucune.
  clerk: string | null;
  // Un panneau que quelqu'un d'autre que ses boutons demande d'ouvrir (le bouton « Voir » d'un toast, l'administratrice, une ligne du panneau Personnes) : la coque
  // l'ouvre, puis l'oublie. `tab` : l'onglet du panneau Missions ; `userId` : de qui montrer les caractéristiques. null : rien à ouvrir.
  panelRequest: PanelRequest | null;
  // Les invitations dans un bureau qui attendent sa réponse (celles de l'`init`, puis `desk:invite`) ; une invitation y reste jusqu'à ce qu'on réponde, qu'elle
  // expire ou que le serveur la retire (`desk:invite:gone`).
  deskInvites: DeskInviteEntry[];
  // Le menu d'une personne, ouvert ; null : fermé.
  personMenu: PersonMenuRequest | null;
  // La personne que l'avatar suit (le jeu le fait marcher derrière elle), ou null.
  following: string | null;
  // La dernière position connue de chaque autre joueur présent (init, arrivée, ticks). Un Map modifié sur place, sans prévenir les
  // abonnés : un `init` et reset() le remplacent, un départ en retire le joueur ; rien n'y reste de ceux qui sont partis.
  positions: Map<string, PlayerPosition>;
  // Une place a changé (`desk:changed`) : remplace celle de même clé.
  setDesk(desk: DeskInfo): void;
  setClosedDesks(keys: string[]): void;
  setDeskBans(bans: DeskBan[]): void;
  addDeskKnock(knock: DeskKnock): void;
  dismissDeskKnock(userId: string): void;
  setOfficeMap(map: OfficeMap | null): void;
  // La lumière du bureau, telle que le serveur l'annonce (`lights:changed`) : le serveur fait foi, rien n'est changé avant son annonce.
  setLights(lights: LightsState): void;
  // Le café de cette personne, tel que le serveur l'annonce (`coffee:changed`) : `ms` ms à partir de maintenant, qui remplacent ce qui restait ; 0 : fini,
  // l'échéance disparaît.
  setCoffee(id: string, ms: number): void;
  // La musique de cette pièce, telle que le serveur l'annonce (`music:changed`) : le serveur fait foi, rien n'est changé avant son annonce.
  setRoomMusic(place: string, state: RoomMusic): void;
  setDeskNotice(text: string | null): void;
  // Une table a changé (`game:table`) : la vue remplace celle de ce jeu si sa version est plus récente ; une version égale ou plus ancienne est ignorée.
  setGameTable(view: GameTableView): void;
  // L'octogone a changé (`arena:state`, ou l'init) : le serveur fait foi.
  setArena(arena: ArenaState): void;
  // Une invitation arrive (`game:invite`) : elle remplace celle de même identifiant ; elle est retirée quand on répond ou que le serveur la retire.
  addGameInvite(invite: GameInvite): void;
  removeGameInvite(id: string): void;
  // Ouvre le panneau de cette table, ou le ferme (null).
  openGame(game: GameId | null): void;
  // « Partie interrompue » a été lu.
  dismissGameInterrupted(): void;
  // Le zoom : un pourcentage donné (ramené entre le plancher et 200 %, et au cran de 5 % le plus proche), des crans de `size` % plus près
  // (positifs) ou plus loin (négatifs ; 5 % par cran si `size` n'est pas dit), jamais sous le plancher, la vue de départ (100 %, ou le
  // plancher s'il est plus haut). Et le plancher, que le jeu donne : un pourcentage passé dessous y remonte (la caméra y glisse) ; un plancher
  // qui descend laisse le pourcentage où il est.
  setZoomPercent(percent: number): void;
  stepZoom(steps: number, size?: number): void;
  resetZoom(): void;
  setZoomFloor(floor: number): void;
  // L'éditeur de déco : ouvert sur ce bureau (le sien), fermé ; le thème ; l'élément en main ; poser l'élément en main sur cette case de la pièce
  // (refusé si la pièce cesse d'être valable : `error` dit pourquoi) ; reprendre en main, ou jeter, l'élément n° i ; remplacer tout le brouillon.
  openDecorEditor(desk: DeskInfo): void;
  closeDecorEditor(): void;
  patchDecorTheme(patch: Partial<Pick<DeskDecor, 'floor' | 'wall'>>): void;
  holdDecorItem(id: string | null): void;
  // La gomme, ou de nouveau la pose (on ne tient plus rien dans les deux cas : en changeant d'outil, la main se vide).
  setDecorTool(tool: DecorTool): void;
  // Poser l'élément tenu : sur du vide, c'est fait ; sur un élément de la même sorte, la personne doit confirmer (confirmReplace) ou renoncer
  // (cancelReplace) ; si la pièce ne serait plus valable, `error` dit pourquoi. `point` est le pointeur, en cases de la pièce (anchorFor) ; `snap`,
  // au dixième (`free`) ou à la case près (`cell`, par défaut : un point entier est alors une case).
  placeHeld(point: { x: number; y: number }, snap?: DecorSnap): void;
  confirmReplace(): void;
  cancelReplace(): void;
  pickDecorItem(index: number): void;
  removeDecorItem(index: number): void;
  setDecorDraft(draft: DeskDecor): void;
  // Le brouillon est enregistré : il devient ce que le serveur a.
  markDecorSaved(): void;
  // Tout l'état d'une (re)connexion : remplace tous les joueurs (ceux qui sont partis pendant la coupure disparaissent).
  applyInit(p: InitPayload): void;
  upsertPlayer(p: PublicPlayer): void;
  removePlayer(id: string): void;
  setStatus(id: string, s: Status): void;
  // L'état d'activité d'un joueur (`activity:changed`) ; null : plus aucun.
  setActivity(id: string, activity: ActivityState | null): void;
  // Le tapis de course où court un joueur (`treadmill:changed`) ; null : il en est descendu (le champ disparaît, comme dans les messages du serveur).
  setTreadmill(id: string, treadmill: TreadmillRef | null): void;
  setMyStates(states: ActivityState[]): void;
  // Un de ses états créé ou remplacé (même identifiant : il prend sa place dans la liste) ; ou supprimé.
  upsertMyState(state: ActivityState): void;
  removeMyState(id: string): void;
  // Le mode choisi (un autre que celui d'avant oublie le tapis), et s'il l'est sur son tapis de course.
  setChosenActivity(id: string | null): void;
  setChosenTreadmill(on: boolean): void;
  setMedia(id: string, m: MediaState): void;
  // Cette personne se met à parler (vrai), ou se tait (faux : la clé disparaît, comme dans les messages du serveur) : `speaking:changed`.
  setSpeaking(id: string, speaking: boolean): void;
  // Le profil d'un joueur (`profile:changed`, ou la réponse de PATCH /api/me) : son nom, son personnage et son fuseau horaire. Sans fuseau, il garde le sien.
  setProfile(p: { id: string; name: string; avatarKey: string | null; timezone?: string }): void;
  setReplaced(v: boolean): void;
  // La connexion coupée : setReady(false). (L'`init` la rend prête : applyInit.)
  setReady(ready: boolean): void;
  setMediaInstruction(i: MediaInstruction | null): void;
  // Sa conversation verrouillée, telle que le serveur l'annonce (`conversation:lock`) ; null : plus aucune.
  setConversationLock(lock: ConversationLock | null): void;
  // Le statut choisi dans le menu ; null l'oublie (un autre onglet a pris la place : c'est lui qui parle pour la personne).
  setChosenStatus(s: Status | null): void;
  // Un message du chat (`chat:message`), dans la liste de son canal. Un `id` déjà là est ignoré (l'état reste le même objet).
  addChatMessage(m: ChatMessage): void;
  // Tout ce que « Tout le monde » contient maintenant est lu.
  markChatRead(): void;
  // Les mouvements d'un tick : la dernière position de chaque joueur connu (soi-même et les inconnus sont ignorés), sans prévenir
  // personne et sans changer l'état réactif.
  recordMoves(moves: ReadonlyArray<{ id: string } & PlayerPosition>): void;
  // Sa progression, telle que le serveur la dit (`progress:mine`, une route) : le gain qui l'accompagne n'est pas gardé.
  setProgress(progress: MyProgress): void;
  // La progression qu'une route a rendue, si elle n'a pas changé depuis `seq` (le progressSeq d'avant l'appel) ; sinon, celle qu'on a est plus récente.
  setProgressSince(progress: MyProgress, seq: number): void;
  // Le niveau d'un autre (ou de soi), que le serveur annonce à tout le bureau (`progress:level`).
  setLevel(id: string, level: number): void;
  // Sa liste. Lue d'une route : `since`, le taskSeq d'avant la lecture ; les changements arrivés pendant la lecture sont repris par-dessus.
  setTasks(tasks: TaskView[] | null, since?: number): void;
  // Une tâche de sa liste, nouvelle (en tête) ou changée (à sa place) ; ou retirée. Avant la lecture de la liste, le changement est seulement noté.
  upsertTask(task: TaskView): void;
  removeTask(id: string): void;
  setGiven(given: TaskView[] | null): void;
  // Une mission qu'elle a confiée, nouvelle (en tête) ou changée (à sa place).
  upsertGiven(task: TaskView): void;
  // Parler à cette administratrice (sa clé), ou finir la conversation (null).
  openClerk(clerk: string | null): void;
  // Demander l'ouverture d'un panneau ; la coque l'ouvre, puis l'oublie (null).
  requestPanel(request: PanelRequest | null): void;
  addDeskInvite(invite: DeskInvite): void;
  removeDeskInvite(id: string): void;
  // Ouvrir le menu d'une personne, ou le fermer (null).
  openPersonMenu(menu: PersonMenuRequest | null): void;
  // Le jeu suit cette personne, ou plus personne (null).
  setFollowing(id: string | null): void;
  // Retour à l'état de départ : le bureau quitté (déconnexion, autre compte).
  reset(): void;
}

type Data = Pick<
  OfficeState,
  | 'selfId'
  | 'players'
  | 'replaced'
  | 'ready'
  | 'mediaInstruction'
  | 'conversationLock'
  | 'chatAll'
  | 'chatNearby'
  | 'chatReadId'
  | 'self'
  | 'mapKey'
  | 'chosenStatus'
  | 'myStates'
  | 'chosenActivityId'
  | 'chosenTreadmill'
  | 'desks'
  | 'closedDesks'
  | 'deskBans'
  | 'deskKnocks'
  | 'deskNotice'
  | 'lights'
  | 'coffee'
  | 'music'
  | 'games'
  | 'gameInvites'
  | 'gameOpen'
  | 'gameInterrupted'
  | 'arena'
  | 'arenaCountdownEndsAt'
  | 'officeMap'
  | 'decorEditor'
  | 'zoomPercent'
  | 'zoomFloor'
  | 'positions'
  | 'progress'
  | 'progressSeq'
  | 'tasks'
  | 'taskLog'
  | 'taskSeq'
  | 'given'
  | 'clerk'
  | 'panelRequest'
  | 'deskInvites'
  | 'personMenu'
  | 'following'
>;

// La lumière que personne n'a touchée : allumée, jamais changée. C'est aussi celle d'un `init` qui n'en dit rien.
const LIGHTS_ON: LightsState = { level: 'on', by: null, at: 0 };

const initialData = (): Data => ({
  selfId: null,
  players: {},
  replaced: false,
  ready: false,
  mediaInstruction: null,
  conversationLock: null,
  chatAll: [],
  chatNearby: [],
  chatReadId: null,
  self: null,
  mapKey: null,
  chosenStatus: null,
  myStates: [],
  chosenActivityId: null,
  chosenTreadmill: false,
  desks: [],
  closedDesks: [],
  deskBans: [],
  deskKnocks: [],
  deskNotice: null,
  lights: LIGHTS_ON,
  coffee: {},
  music: {},
  games: {},
  gameInvites: [],
  gameOpen: null,
  gameInterrupted: null,
  arena: EMPTY_ARENA,
  arenaCountdownEndsAt: 0,
  officeMap: null,
  decorEditor: null,
  zoomPercent: ZOOM_DEFAULT_PERCENT,
  zoomFloor: ZOOM_MIN_PERCENT,
  positions: new Map(),
  progress: null,
  progressSeq: 0,
  tasks: null,
  taskLog: [],
  taskSeq: 0,
  given: null,
  clerk: null,
  panelRequest: null,
  deskInvites: [],
  personMenu: null,
  following: null,
});

const positionOf = (p: PlayerPosition): PlayerPosition => ({ x: p.x, y: p.y, dir: p.dir, moving: p.moving });

// Ce même enregistrement sans la clé `id` : une copie.
function without<T>(record: Record<string, T>, id: string): Record<string, T> {
  const rest = { ...record };
  delete rest[id];
  return rest;
}

// Les échéances de café que dit un `init` : celles de ceux qui en ont un (leur `boost`, ce qu'il leur reste), à partir de maintenant.
function coffeeDeadlines(players: readonly PublicPlayer[]): Record<string, number> {
  const now = performance.now();
  return Object.fromEntries(players.flatMap((p) => (p.boost !== undefined && p.boost > 0 ? [[p.id, now + p.boost] as const] : [])));
}

// Un joueur tel que le magasin le garde : sans `boost`, qui n'est que ce qu'il restait de café à l'instant de l'`init` (l'échéance, elle, est dans `coffee`).
function withoutBoost(p: PublicPlayer): PublicPlayer {
  if (p.boost === undefined) return p;
  const rest = { ...p };
  delete rest.boost;
  return rest;
}

// Une invitation reçue, avec l'échéance que lui donne ce qu'il lui reste à vivre.
const inviteEntry = (invite: GameInvite): GameInviteEntry => ({ ...invite, until: performance.now() + invite.ttlMs });
const deskInviteEntry = (invite: DeskInvite): DeskInviteEntry => ({ ...invite, until: performance.now() + invite.ttlMs });

// Les tables d'un `init`, par jeu.
const gamesOf = (tables: readonly GameTableView[] | undefined): Partial<Record<GameId, GameTableView>> => Object.fromEntries((tables ?? []).map((table) => [table.game, table]));

// Le jeu où une partie que cette personne jouait n'existe plus dans les tables du nouvel `init` : le serveur a redémarré, ou une autre partie a pris la place. Une partie qui
// continue, ou qui a fini pendant la coupure (le serveur la garde jusqu'à la suivante), n'est pas interrompue ; ni celle des autres, ni celle qui était déjà finie.
function interruptedGame(before: Partial<Record<GameId, GameTableView>>, after: Partial<Record<GameId, GameTableView>>, selfId: string): GameId | null {
  for (const table of Object.values(before)) {
    const match: GameMatchView | null = table.match;
    if (match?.status !== 'playing' || !match.players.some((player) => player.userId === selfId)) continue;
    if (after[table.game]?.match?.id !== match.id) return table.game;
  }
  return null;
}

// Les messages sans doublon d'`id` : le premier exemplaire reste.
function uniqueById(messages: readonly ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const unique: ChatMessage[] = [];
  for (const message of messages) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    unique.push(message);
  }
  return unique;
}

// Les CHAT_HISTORY_LIMIT derniers messages seulement : une page ouverte des jours ne les garde pas tous.
const lastMessages = (messages: ChatMessage[]): ChatMessage[] => (messages.length > CHAT_HISTORY_LIMIT ? messages.slice(-CHAT_HISTORY_LIMIT) : messages);

// Le nombre de messages « Tout le monde » non lus : ceux des autres, reçus après le dernier lu (chatReadId). S'il n'est plus dans la
// liste (null, ou plus de 200 messages depuis), c'est tout ce que la liste contient. Les siens, et « À proximité », ne comptent pas.
export function selectChatUnread(state: Pick<OfficeState, 'chatAll' | 'chatReadId' | 'selfId'>): number {
  const { chatAll, chatReadId, selfId } = state;
  const read = chatReadId === null ? -1 : chatAll.findIndex((m) => m.id === chatReadId);
  let unread = 0;
  for (let i = read + 1; i < chatAll.length; i++) {
    if (chatAll[i]!.userId !== selfId) unread++;
  }
  return unread;
}

// Ses missions ouvertes qu'elle n'a pas encore vues (la pastille du bouton Missions).
export function selectNewMissions(state: Pick<OfficeState, 'tasks'>): number {
  return (state.tasks ?? []).filter((task) => task.kind === 'mission' && task.status === 'open' && !task.seen).length;
}

// Sa progression sans le gain qui l'accompagne : le magasin ne garde que l'état.
function withoutGain(progress: MyProgress): MyProgress {
  if (progress.gain === undefined) return progress;
  const rest = { ...progress };
  delete rest.gain;
  return rest;
}

// Cette liste, avec la tâche mise à jour à sa place, ou ajoutée en tête si elle n'y était pas.
function upsert(list: readonly TaskView[] | null, task: TaskView): TaskView[] {
  const known = list ?? [];
  return known.some((t) => t.id === task.id) ? known.map((t) => (t.id === task.id ? task : t)) : [task, ...known];
}

// Un changement de sa liste : une tâche nouvelle ou changée, ou retirée (son identifiant).
export type TaskChange = { seq: number } & ({ task: TaskView; removed?: undefined } | { task?: undefined; removed: string });
// Combien de changements le magasin garde : bien plus qu'il n'en arrive pendant une lecture de la liste.
const TASK_LOG_MAX = 100;

function applyTaskChange(list: TaskView[], change: TaskChange): TaskView[] {
  return change.task ? upsert(list, change.task) : list.filter((t) => t.id !== change.removed);
}

// La liste avec ce changement (gardée null tant qu'elle n'est pas lue), et le changement noté.
function withTaskChange(state: Pick<OfficeState, 'tasks' | 'taskLog'>, change: TaskChange): Pick<OfficeState, 'tasks' | 'taskLog' | 'taskSeq'> {
  return { tasks: state.tasks === null ? null : applyTaskChange(state.tasks, change), taskLog: [...state.taskLog, change].slice(-TASK_LOG_MAX), taskSeq: change.seq };
}

// Une liste lue, avec par-dessus les changements arrivés depuis `since`.
function replayTasks(list: TaskView[], log: readonly TaskChange[], since: number): TaskView[] {
  return log.filter((change) => change.seq > since).reduce(applyTaskChange, list);
}

// La place de la personne `userId`, ou undefined si elle n'en a pas.
export function selectDeskOf(state: Pick<OfficeState, 'desks'>, userId: string | null): DeskInfo | undefined {
  return userId === null ? undefined : state.desks.find((desk) => desk.ownerId === userId);
}

// Un magasin neuf (les tests en créent un chacun) ; l'appli utilise useOfficeStore.
export function createOfficeStore(): UseBoundStore<StoreApi<OfficeState>> {
  return create<OfficeState>()((set, get) => {
    // Change le joueur `id` (soi-même ou un autre) ; un identifiant inconnu ne change rien, et l'état reste le même objet.
    const updatePlayer = (id: string, change: (p: PublicPlayer) => PublicPlayer) =>
      set((state) => {
        if (state.self && id === state.self.id) return { self: change(state.self) };
        if (!Object.hasOwn(state.players, id)) return state;
        return { players: { ...state.players, [id]: change(state.players[id]!) } };
      });

    return {
      ...initialData(),

      applyInit: (p) => {
        const others = p.players.filter((player) => player.id !== p.self.id);
        const history = lastMessages(uniqueById(p.chatHistory));
        set((state) => ({
          selfId: p.self.id,
          self: withoutBoost(p.self),
          mapKey: p.mapKey,
          players: Object.fromEntries(others.map((player) => [player.id, withoutBoost(player)])),
          positions: new Map(others.map((player) => [player.id, positionOf(player)])),
          // Un init n'arrive qu'à un onglet connecté : s'il avait été remplacé, il a repris la main.
          replaced: false,
          ready: true,
          // L'historique remplace « Tout le monde ». Le premier init (personne n'était connu) le donne pour lu ; un retour garde où l'on
          // en était, si bien que ce qui est arrivé pendant la coupure est non lu. « À proximité » reste : le serveur ne le redit pas.
          chatAll: history,
          chatReadId: state.selfId === null ? (history.at(-1)?.id ?? null) : state.chatReadId,
          desks: p.desks,
          closedDesks: p.closedDesks,
          deskBans: p.deskBans,
          // Les toc toc d'avant la coupure sont périmés : la personne n'est peut-être plus là pour les entendre.
          deskKnocks: [],
          // Le verrou de sa conversation, tel qu'il est maintenant (pendant une coupure, il a pu finir, ou la perdre).
          conversationLock: p.conversationLock ?? null,
          // La lumière du moment : celle que l'on croyait avant une coupure n'a plus cours. Les cafés non plus : ceux d'avant la coupure ont fini, ou
          // été remis, sans que personne nous le dise.
          lights: p.lights ?? LIGHTS_ON,
          coffee: coffeeDeadlines([p.self, ...others]),
          // La musique des pièces du moment : un init sans `music` dit que personne n'a rien réglé.
          music: p.music ?? {},
          // Les tables et les invitations du moment ; une partie qu'on jouait et que le serveur ne connaît plus est signalée (et le reste jusqu'à ce qu'on l'ait lue).
          games: gamesOf(p.games),
          gameInvites: (p.gameInvites ?? []).map(inviteEntry),
          deskInvites: (p.deskInvites ?? []).map(deskInviteEntry),
          arena: p.arena ?? EMPTY_ARENA,
          arenaCountdownEndsAt: performance.now() + (p.arena?.countdownMs ?? 0),
          // Sa progression du moment ; un init qui n'en dit rien (la base n'a pas répondu) garde celle qu'on connaissait.
          progress: p.progress ? withoutGain(p.progress) : state.progress,
          progressSeq: p.progress ? state.progressSeq + 1 : state.progressSeq,
          gameInterrupted: interruptedGame(state.games, gamesOf(p.games), p.self.id) ?? state.gameInterrupted,
        }));
      },

      upsertPlayer: (p) => {
        const { self, positions } = get();
        if (!self || p.id !== self.id) positions.set(p.id, positionOf(p));
        set((state) => (state.self && p.id === state.self.id ? { self: p } : { players: { ...state.players, [p.id]: p } }));
      },

      removePlayer: (id) => {
        get().positions.delete(id);
        set((state) => {
          const players = Object.hasOwn(state.players, id) ? without(state.players, id) : state.players;
          // Son café part avec lui : plus personne ne dira qu'il est fini.
          const coffee = Object.hasOwn(state.coffee, id) ? without(state.coffee, id) : state.coffee;
          return players === state.players && coffee === state.coffee ? state : { players, coffee };
        });
      },

      recordMoves: (moves) => {
        const { players, positions } = get();
        for (const m of moves) {
          if (Object.hasOwn(players, m.id)) positions.set(m.id, positionOf(m));
        }
      },

      setDesk: (desk) =>
        set((state) => {
          const index = state.desks.findIndex((d) => d.key === desk.key);
          if (index === -1) return { desks: [...state.desks, desk] };
          const desks = [...state.desks];
          desks[index] = desk;
          return { desks };
        }),
      setClosedDesks: (closedDesks) => set({ closedDesks }),
      setDeskBans: (deskBans) => set({ deskBans }),
      addDeskKnock: (knock) =>
        set((state) => ({ deskKnocks: [...state.deskKnocks.filter((k) => k.userId !== knock.userId), knock] })),
      dismissDeskKnock: (userId) => set((state) => ({ deskKnocks: state.deskKnocks.filter((k) => k.userId !== userId) })),
      setOfficeMap: (officeMap) => set({ officeMap }),
      setLights: (lights) => set({ lights }),
      setArena: (arena) => set({ arena, arenaCountdownEndsAt: performance.now() + arena.countdownMs }),
      setGameTable: (view) =>
        set((state) => {
          const known = state.games[view.game];
          return known && known.version >= view.version ? state : { games: { ...state.games, [view.game]: view } };
        }),
      addGameInvite: (invite) =>
        set((state) => {
          const entry = inviteEntry(invite);
          const index = state.gameInvites.findIndex((known) => known.id === invite.id);
          if (index === -1) return { gameInvites: [...state.gameInvites, entry] };
          const invites = [...state.gameInvites];
          invites[index] = entry;
          return { gameInvites: invites };
        }),
      removeGameInvite: (id) => set((state) => (state.gameInvites.some((invite) => invite.id === id) ? { gameInvites: state.gameInvites.filter((invite) => invite.id !== id) } : state)),
      openGame: (game) => set({ gameOpen: game }),
      dismissGameInterrupted: () => set({ gameInterrupted: null }),
      setCoffee: (id, ms) =>
        set((state) => {
          if (ms > 0) return { coffee: { ...state.coffee, [id]: performance.now() + ms } };
          return Object.hasOwn(state.coffee, id) ? { coffee: without(state.coffee, id) } : state;
        }),
      setRoomMusic: (place, state) => set((s) => ({ music: { ...s.music, [place]: state } })),
      setDeskNotice: (deskNotice) => set({ deskNotice }),
      setZoomPercent: (percent) => set((state) => ({ zoomPercent: clampZoomPercent(percent, state.zoomFloor) })),
      stepZoom: (steps, size = ZOOM_WHEEL_STEP) => set((state) => ({ zoomPercent: stepZoomPercent(state.zoomPercent, steps, size, state.zoomFloor) })),
      resetZoom: () => set((state) => ({ zoomPercent: boundZoomPercent(ZOOM_DEFAULT_PERCENT, state.zoomFloor) })),
      // À chaque redimensionnement : rien ne change (le même état, aucun abonné prévenu) tant que le plancher reste le même.
      setZoomFloor: (floor) =>
        set((state) => {
          const zoomFloor = clampZoomFloor(floor);
          const zoomPercent = boundZoomPercent(state.zoomPercent, zoomFloor);
          return zoomFloor === state.zoomFloor && zoomPercent === state.zoomPercent ? state : { zoomFloor, zoomPercent };
        }),

      openDecorEditor: (desk) => {
        const saved: DeskDecor = { floor: desk.floor, wall: desk.wall, items: desk.items };
        set({ decorEditor: { deskKey: desk.key, saved, draft: saved, held: null, error: null, tool: 'place', replace: null } });
      },
      closeDecorEditor: () => set({ decorEditor: null }),
      patchDecorTheme: (patch) =>
        set((state) => (state.decorEditor ? { decorEditor: { ...state.decorEditor, draft: { ...state.decorEditor.draft, ...patch }, error: null } } : state)),
      // Prendre un élément en main, c'est reprendre la pose ; le lâcher laisse l'outil où il est.
      holdDecorItem: (held) =>
        set((state) =>
          state.decorEditor ? { decorEditor: { ...state.decorEditor, held, tool: held === null ? state.decorEditor.tool : 'place', error: null, replace: null } } : state,
        ),
      setDecorTool: (tool) => set((state) => (state.decorEditor ? { decorEditor: { ...state.decorEditor, tool, held: null, error: null, replace: null } } : state)),
      placeHeld: (point, snap = 'cell') =>
        set((state) => {
          const editor = state.decorEditor;
          if (!editor || editor.held === null || editor.replace !== null) return state;
          const room = roomOfDesk(state.officeMap, editor.deskKey);
          const at = anchorFor(editor.held, point, room, snap);
          if (!at) return state;
          const plan = planPlace(editor.draft, editor.held, at, room);
          if (plan.kind === 'place') return { decorEditor: { ...editor, draft: plan.decor, error: null } };
          if (plan.kind === 'replace') return { decorEditor: { ...editor, error: null, replace: { id: editor.held, at, replacing: plan.replacing } } };
          return { decorEditor: { ...editor, error: plan.error } };
        }),
      confirmReplace: () =>
        set((state) => {
          const editor = state.decorEditor;
          if (!editor?.replace) return state;
          // Le brouillon est recalculé : c'est celui d'aujourd'hui qui compte, et la pièce doit encore être valable.
          const plan = planPlace(editor.draft, editor.replace.id, editor.replace.at, roomOfDesk(state.officeMap, editor.deskKey));
          if (plan.kind === 'refused') return { decorEditor: { ...editor, error: plan.error, replace: null } };
          return { decorEditor: { ...editor, draft: plan.decor, error: null, replace: null } };
        }),
      cancelReplace: () => set((state) => (state.decorEditor?.replace ? { decorEditor: { ...state.decorEditor, replace: null } } : state)),
      pickDecorItem: (index) =>
        set((state) => {
          const editor = state.decorEditor;
          const item = editor?.draft.items[index];
          return editor && item ? { decorEditor: { ...editor, draft: removeAt(editor.draft, index), held: item.id, tool: 'place', error: null, replace: null } } : state;
        }),
      removeDecorItem: (index) =>
        set((state) => (state.decorEditor ? { decorEditor: { ...state.decorEditor, draft: removeAt(state.decorEditor.draft, index), error: null, replace: null } } : state)),
      setDecorDraft: (draft) => set((state) => (state.decorEditor ? { decorEditor: { ...state.decorEditor, draft, held: null, error: null, replace: null } } : state)),
      markDecorSaved: () => set((state) => (state.decorEditor ? { decorEditor: { ...state.decorEditor, saved: state.decorEditor.draft } } : state)),

      setActivity: (id, activity) => updatePlayer(id, (p) => ({ ...p, activity })),
      setTreadmill: (id, treadmill) =>
        updatePlayer(id, (p) => {
          if (treadmill) return { ...p, treadmill };
          const off = { ...p };
          delete off.treadmill;
          return off;
        }),
      setMyStates: (myStates) => set({ myStates }),
      upsertMyState: (state) =>
        set((s) => (s.myStates.some((m) => m.id === state.id) ? { myStates: s.myStates.map((m) => (m.id === state.id ? state : m)) } : { myStates: [...s.myStates, state] })),
      removeMyState: (id) => set((s) => ({ myStates: s.myStates.filter((m) => m.id !== id) })),
      setChosenActivity: (chosenActivityId) => set((state) => (state.chosenActivityId === chosenActivityId ? state : { chosenActivityId, chosenTreadmill: false })),
      setChosenTreadmill: (chosenTreadmill) => set({ chosenTreadmill }),

      setStatus: (id, status) => updatePlayer(id, (p) => ({ ...p, status })),
      setMedia: (id, m) => updatePlayer(id, (p) => ({ ...p, media: { mic: m.mic, cam: m.cam, screen: m.screen } })),
      setSpeaking: (id, speaking) =>
        updatePlayer(id, (p) => {
          if (speaking) return { ...p, speaking: true };
          const quiet = { ...p };
          delete quiet.speaking;
          return quiet;
        }),
      setProfile: ({ id, name, avatarKey, timezone }) => updatePlayer(id, (p) => ({ ...p, name, avatarKey, ...(timezone !== undefined ? { timezone } : {}) })),
      setReplaced: (replaced) => set({ replaced }),
      setReady: (ready) => set({ ready }),
      setMediaInstruction: (mediaInstruction) => set({ mediaInstruction }),
      setConversationLock: (conversationLock) => set({ conversationLock }),
      setChosenStatus: (chosenStatus) => set({ chosenStatus }),

      addChatMessage: (message) =>
        set((state) => {
          if (message.channel === 'nearby') {
            return state.chatNearby.some((m) => m.id === message.id) ? state : { chatNearby: lastMessages([...state.chatNearby, message]) };
          }
          return state.chatAll.some((m) => m.id === message.id) ? state : { chatAll: lastMessages([...state.chatAll, message]) };
        }),

      markChatRead: () =>
        set((state) => {
          const last = state.chatAll.at(-1)?.id ?? null;
          return last === state.chatReadId ? state : { chatReadId: last };
        }),

      setProgress: (progress) => set((state) => ({ progress: withoutGain(progress), progressSeq: state.progressSeq + 1 })),
      setProgressSince: (progress, seq) =>
        set((state) => (state.progressSeq === seq ? { progress: withoutGain(progress), progressSeq: state.progressSeq + 1 } : state)),
      setLevel: (id, level) => updatePlayer(id, (p) => ({ ...p, level })),
      setTasks: (tasks, since) => set((state) => ({ tasks: tasks === null || since === undefined ? tasks : replayTasks(tasks, state.taskLog, since) })),
      upsertTask: (task) => set((state) => withTaskChange(state, { seq: state.taskSeq + 1, task })),
      removeTask: (id) => set((state) => withTaskChange(state, { seq: state.taskSeq + 1, removed: id })),
      setGiven: (given) => set({ given }),
      upsertGiven: (task) => set((state) => ({ given: upsert(state.given, task) })),
      openClerk: (clerk) => set({ clerk }),
      requestPanel: (panelRequest) => set({ panelRequest }),
      // Une invitation de plus ; la même (une seconde fois) prend la place de la première, avec sa nouvelle échéance.
      addDeskInvite: (invite) => set((state) => ({ deskInvites: [...state.deskInvites.filter((known) => known.id !== invite.id), deskInviteEntry(invite)] })),
      removeDeskInvite: (id) => set((state) => (state.deskInvites.some((invite) => invite.id === id) ? { deskInvites: state.deskInvites.filter((invite) => invite.id !== id) } : state)),
      openPersonMenu: (personMenu) => set({ personMenu }),
      setFollowing: (following) => set((state) => (state.following === following ? state : { following })),

      reset: () => set(initialData()),
    };
  });
}

export const useOfficeStore: UseBoundStore<StoreApi<OfficeState>> = createOfficeStore();
