import type { InitPayload, MovePayload, PublicPlayer, ServerToClientEvents, Status, WorldTick } from '@bureau/shared';
import type { StoreApi } from 'zustand';
import type { OfficeState } from '../state/office-store';
import { setSimRoom, simConnectionLost } from '../sim/sim-room';
import type { OfficeSocket } from './socket';

// Les événements du bus (game/EventBus.ts) entre la connexion et le jeu. `net:*` va de la connexion au jeu ; `local:*`, du jeu à la
// connexion, qui l'envoie au serveur ; `media:*`, de l'audio/vidéo (media/use-media.ts) au jeu.
export interface OfficeBusEvents {
  'net:init': (p: InitPayload) => void;
  'net:tick': (p: WorldTick) => void;
  'net:joined': (p: PublicPlayer) => void;
  'net:left': (p: { id: string }) => void;
  'net:correct': (p: { x: number; y: number }) => void;
  'net:status': (p: { id: string; status: Status }) => void;
  'net:profile': (p: { id: string; name: string; avatarKey: string | null }) => void;
  'local:move': (p: MovePayload) => void;
  // window.__office.teleport (tests de bout en bout seulement) : `debug:teleport`, que le serveur n'accepte qu'avec E2E=1.
  'local:teleport': (p: { x: number; y: number }) => void;
  // Qui parle dans la room audio/vidéo, soi-même compris (les identifiants des comptes), à chaque changement ; [] en la quittant. Le
  // jeu dessine l'anneau de parole sur leurs étiquettes (tâche 20).
  'media:speaking': (ids: string[]) => void;
}

// Un écouteur, typé comme ceux d'eventemitter3 : ce que l'événement porte, il le reçoit (emitOnBus et listenOnBus le typent).
type Listener = (...args: any[]) => void;

// Le bus : EventBus (un EventEmitter d'eventemitter3, celui de Phaser), ou n'importe quel émetteur qui en a ces trois méthodes (les
// tests).
export interface OfficeBus {
  on(event: string, fn: Listener): unknown;
  off(event: string, fn: Listener): unknown;
  emit(event: string, ...args: unknown[]): unknown;
}

// Émet sur le bus, avec la charge utile de l'événement.
export function emitOnBus<E extends keyof OfficeBusEvents>(bus: OfficeBus, event: E, ...args: Parameters<OfficeBusEvents[E]>): void {
  bus.emit(event, ...args);
}

// Écoute un événement du bus ; renvoie la fonction qui arrête d'écouter.
export function listenOnBus<E extends keyof OfficeBusEvents>(bus: OfficeBus, event: E, fn: OfficeBusEvents[E]): () => void {
  bus.on(event, fn);
  return () => bus.off(event, fn);
}

// Branche la connexion sur l'état de l'interface (le magasin) et sur le jeu (le bus) :
// - ce que le serveur dit va au magasin (arrivées, départs, statuts, médias, profils, onglet remplacé), puis au jeu, qui le lit déjà
//   à jour ; les positions (`world:tick`) vont au jeu, et aux dernières positions du magasin, que React ne voit pas changer ;
// - le statut choisi dans le menu (chosenStatus, au magasin) est redit au serveur après chaque `init` qui en dit un autre : le serveur
//   ne garde les statuts qu'en mémoire, et l'`init` d'un serveur redémarré dit « Disponible » ;
// - le chat est pour l'interface seule : l'historique « Tout le monde » (dans l'`init`) et chaque message (`chat:message`, le sien
//   compris) vont au magasin, pas au jeu ;
// - les consignes audio/vidéo (`media:join`, `media:leave`) : la dernière est retenue au magasin (mediaInstruction), le temps de la
//   connexion qui l'a reçue. L'audio et la vidéo (useMedia) la rejouent en se branchant, par sûreté : le serveur ne redit pas une
//   consigne. La connexion coupée l'oublie : pendant la coupure, le serveur a pu sortir la personne de son groupe (au-delà du
//   délai de grâce), et il redit la consigne du moment après l'init de la connexion suivante ;
// - la connexion est prête (`ready`, au magasin) une fois l'`init` de cette connexion reçu, et ne l'est plus dès qu'elle est coupée ;
// - ce que le jeu produit (`local:move`, `local:teleport`) part au serveur, mais seulement quand la connexion est prête. Avant, le
//   serveur ne sait pas encore où l'on est (ou l'a oublié) ; pendant une coupure, Socket.io garderait les messages et les enverrait au
//   retour, périmés. Au retour, l'`init` replace l'avatar (le jeu repart de là).
//
// La connexion elle-même (connect, refus, nouveaux essais) est l'affaire de l'appelant (superviseConnection). Renvoie la fonction
// qui retire tous les écouteurs posés ici.
export function connectOffice(socket: OfficeSocket, store: StoreApi<OfficeState>, bus: OfficeBus): () => void {
  const state = () => store.getState();

  const handlers: { [E in keyof ServerToClientEvents]?: ServerToClientEvents[E] } = {
    // applyInit rend aussi la connexion prête. Le statut choisi dans le menu que l'init ne dit pas (le serveur redémarré l'a oublié) lui
    // est redit tout de suite : les groupes attendent 500 ms avant de prendre quelqu'un, il arrive avant.
    init: (p) => {
      state().applyInit(p);
      // Un statut autre que « Disponible » que cet onglet n'a pas choisi (rechargement, « Utiliser ici ») : le serveur l'a gardé, donc c'est
      // celui de la personne. Seul le menu fixe un statut côté serveur, et « Disponible » est le statut par défaut.
      if (state().chosenStatus === null && p.self.status !== 'available') state().setChosenStatus(p.self.status);
      const { chosenStatus } = state();
      if (chosenStatus !== null && chosenStatus !== p.self.status) socket.emit('status:set', chosenStatus);
      emitOnBus(bus, 'net:init', p);
    },
    // Les positions vont aussi au magasin, hors de son état réactif : un jeu qui démarre plus tard (encore en chargement, ou recréé
    // pour une autre carte) y lit où sont les autres, au lieu de leur position de l'init.
    'world:tick': (p) => {
      state().recordMoves(p.moves);
      emitOnBus(bus, 'net:tick', p);
    },
    'player:joined': (p) => {
      state().upsertPlayer(p);
      emitOnBus(bus, 'net:joined', p);
    },
    'player:left': (p) => {
      state().removePlayer(p.id);
      emitOnBus(bus, 'net:left', p);
    },
    'move:correct': (p) => emitOnBus(bus, 'net:correct', p),
    'status:changed': (p) => {
      state().setStatus(p.id, p.status);
      emitOnBus(bus, 'net:status', p);
    },
    'media:changed': (p) => state().setMedia(p.id, p.media),
    'profile:changed': (p) => {
      state().setProfile(p);
      emitOnBus(bus, 'net:profile', p);
    },
    // Le serveur ne dira plus rien à cet onglet : la room retenue est maintenant celle de l'autre onglet, que le même compte ne doit
    // pas rejoindre d'ici (LiveKit l'en chasserait).
    // Et c'est l'autre onglet qui choisit le statut maintenant : le choix de celui-ci, peut-être plus ancien, est oublié (« Utiliser ici »
    // ne le redira pas).
    'session:replaced': () => {
      state().setReplaced(true);
      state().setMediaInstruction({ type: 'leave' });
      state().setChosenStatus(null);
    },
    'media:join': (p) => state().setMediaInstruction({ type: 'join', p }),
    'media:leave': () => state().setMediaInstruction({ type: 'leave' }),
    'chat:message': (m) => state().addChatMessage(m),
    // Le faux live (SIM=1 côté serveur) : qui est dans la room, et leur son. Le serveur n'en envoie jamais autrement.
    'sim:room': (p) => setSimRoom(p),
  };
  const onDisconnect = () => {
    state().setReady(false);
    state().setMediaInstruction(null);
    // Le faux live (SIM=1) : sans serveur, plus rien ne dit quand quitter la room, dont les sons tourneraient sans fin. Sans effet ailleurs.
    simConnectionLost();
  };

  // Les écouteurs de Socket.io sont typés événement par événement : la boucle passe par un type plus lâche.
  const loose = socket as unknown as { on(event: string, fn: Listener): unknown; off(event: string, fn: Listener): unknown };
  const entries = Object.entries(handlers) as Array<[string, Listener]>;
  for (const [event, fn] of entries) loose.on(event, fn);
  socket.on('disconnect', onDisconnect);
  const unlisten = [
    listenOnBus(bus, 'local:move', (m) => {
      if (state().ready) socket.emit('move', m);
    }),
    listenOnBus(bus, 'local:teleport', (p) => {
      if (state().ready) socket.emit('debug:teleport', p);
    }),
  ];

  return () => {
    for (const [event, fn] of entries) loose.off(event, fn);
    socket.off('disconnect', onDisconnect);
    for (const off of unlisten) off();
  };
}

// Les nouveaux essais après un refus du serveur : 1 s, 2 s, 4 s… au plus 30 s.
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 30_000;

export function retryDelay(attempt: number): number {
  return Math.min(RETRY_FIRST_MS * 2 ** attempt, RETRY_MAX_MS);
}

// Veille sur la connexion, une fois ouverte (socket.connect()) :
// - une panne du réseau, ou le serveur qui redémarre : Socket.io réessaie seul (la socket reste « active ») ;
// - un refus du serveur (connect_error de son middleware) : Socket.io ne réessaie pas. `unauthorized` (pas de session valable) et
//   `disabled` (compte retiré) renvoient à la connexion (signedOut) ; `forbidden_origin` (la page n'est pas celle de l'appli) ne se
//   règle pas en réessayant (forbidden) ; `unavailable` (le serveur n'a pas pu lire la session), `rate_limited` (trop de connexions
//   dans la minute) ou tout autre refus : nouvel essai, après retryDelay ;
// - le serveur ferme la connexion exprès : après `session:replaced`, jamais de reconnexion toute seule (un autre onglet a pris la
//   place ; l'écran « Ouvert dans un autre onglet » propose de la reprendre : restart()). Sinon (compte retiré pendant la visite,
//   arrivée impossible), un nouvel essai : le serveur dira pourquoi (`disabled`), ou nous laissera revenir.
export interface ConnectionSupervisor {
  // Arrête de veiller : annule l'essai prévu et retire les écouteurs.
  stop(): void;
  // Relance la connexion tout de suite, de la part de la personne : l'essai prévu est annulé, les délais repartent de 1 s, et :
  // - une socket qui n'est ni connectée ni en train d'essayer se reconnecte (« Utiliser ici » : le serveur remplace alors l'autre
  //   onglet ; une déconnexion qui a échoué) ;
  // - une socket connectée est fermée puis rouverte (« Reconnecter », après un échec de la connexion audio/vidéo) : le serveur redit
  //   tout à la nouvelle connexion, l'`init` puis la consigne média, avec un jeton neuf ;
  // - une socket qui essaie déjà (une panne du réseau, que Socket.io surmonte seul) : rien de plus.
  // Sans effet après stop().
  restart(): void;
}

export function superviseConnection(
  socket: OfficeSocket,
  store: StoreApi<OfficeState>,
  on: { signedOut(): void; forbidden(): void },
): ConnectionSupervisor {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const retryLater = () => {
    if (timer !== undefined) return;   // un essai est déjà prévu
    timer = setTimeout(() => {
      timer = undefined;
      if (!socket.active) socket.connect();
    }, retryDelay(attempt++));
  };

  const onConnect = () => {
    attempt = 0;
  };
  const onConnectError = (err: Error) => {
    if (socket.active) return;
    if (err.message === 'unauthorized' || err.message === 'disabled') on.signedOut();
    else if (err.message === 'forbidden_origin') on.forbidden();
    else retryLater();
  };
  const onDisconnect = (reason: string) => {
    if (reason === 'io server disconnect' && !store.getState().replaced) retryLater();
  };

  socket.on('connect', onConnect);
  socket.on('connect_error', onConnectError);
  socket.on('disconnect', onDisconnect);
  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
    },
    restart: () => {
      if (stopped) return;
      clearTimeout(timer);
      timer = undefined;
      attempt = 0;
      if (socket.connected) socket.disconnect();
      if (!socket.active) socket.connect();
    },
  };
}
