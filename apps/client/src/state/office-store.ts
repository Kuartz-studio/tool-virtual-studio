import {
  CHAT_HISTORY_LIMIT,
  type ActivityState,
  type ChatMessage,
  type DecorError,
  type DeskBan,
  type DeskDecor,
  type DeskInfo,
  type DeskKnock,
  type InitPayload,
  type LightsState,
  type MediaJoinPayload,
  type MediaState,
  type OfficeMap,
  type PublicPlayer,
  type Status,
} from '@bureau/shared';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { clampZoomPercent, stepZoomPercent, ZOOM_DEFAULT_PERCENT, ZOOM_WHEEL_STEP } from '../game/zoom';
import { anchorFor, planPlace, removeAt, roomOfDesk } from '../office/decor-draft';

// Ce que l'interface (React) sait du bureau : qui y est, avec quel statut, quels médias et quel profil, si la connexion est prête, la
// dernière consigne audio/vidéo, et les messages du chat. Le serveur le dit à chaque (re)connexion (`init`), puis par événements
// (arrivées, départs, statuts, médias, profils, consignes, messages) ; office-connection.ts les applique ici.
//
// Les positions ne sont pas dans l'état réactif : elles changent 10 fois par seconde, et seul le jeu (Phaser) les dessine. Celles de
// `self` et de `players` sont celles de l'`init` ou de l'arrivée. Les dernières reçues sont gardées à part, dans `positions`, que
// React ne voit pas changer : le jeu y lit où sont les autres quand il démarre (ou redémarre avec une autre carte), même si des
// ticks sont arrivés pendant son chargement, et suit ensuite les ticks lui-même.
export type PlayerPosition = Pick<PublicPlayer, 'x' | 'y' | 'dir' | 'moving'>;

// Une consigne audio/vidéo du serveur : rejoindre la room de son groupe (media:join), ou la quitter (media:leave).
export type MediaInstruction = { type: 'join'; p: MediaJoinPayload } | { type: 'leave' };

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

export interface PendingReplace {
  id: string;
  at: { x: number; y: number };
  replacing: number[];
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
  // `lights:changed`. Le jeu l'obscurcit quand elle est éteinte ; `by` et `at` disent qui l'a changée en dernier, et quand.
  lights: LightsState;
  // Jusqu'à quand chaque personne a un café, en ms sur l'horloge de la page (performance.now) : le serveur dit ce qu'il lui reste (`coffee:changed`, ou
  // `boost` dans l'`init`), le magasin en fait une échéance. Qui n'a pas de ligne n'a pas de café. Le jeu y lit ceux dont la tasse se montre (et si
  // l'avatar local va à la vitesse du café), la pastille ce qu'il reste à soi-même.
  coffee: Record<string, number>;
  // La carte, lue par le jeu au chargement (la même que celle du serveur) : l'interface y lit les zones (qui est dans mon bureau ?).
  // null avant le jeu, et en dehors de lui.
  officeMap: OfficeMap | null;
  // L'éditeur de la déco de son bureau ; null quand il est fermé.
  decorEditor: DecorEditor | null;
  // Le zoom de la caméra : le pourcentage choisi (zoom.ts), 100 % au début. Le jeu le lit (la caméra y glisse), les boutons de zoom, la
  // molette et le clavier l'écrivent.
  zoomPercent: number;
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
  setDeskNotice(text: string | null): void;
  // Le zoom : un pourcentage donné (ramené aux bornes et au cran de 5 % le plus proche), des crans de `size` % plus près (positifs) ou plus
  // loin (négatifs ; 5 % par cran si `size` n'est pas dit), la vue de départ.
  setZoomPercent(percent: number): void;
  stepZoom(steps: number, size?: number): void;
  resetZoom(): void;
  // L'éditeur de déco : ouvert sur ce bureau (le sien), fermé ; le thème ; l'élément en main ; poser l'élément en main sur cette case de la pièce
  // (refusé si la pièce cesse d'être valable : `error` dit pourquoi) ; reprendre en main, ou jeter, l'élément n° i ; remplacer tout le brouillon.
  openDecorEditor(desk: DeskInfo): void;
  closeDecorEditor(): void;
  patchDecorTheme(patch: Partial<Pick<DeskDecor, 'floor' | 'wall'>>): void;
  holdDecorItem(id: string | null): void;
  // La gomme, ou de nouveau la pose (on ne tient plus rien dans les deux cas : en changeant d'outil, la main se vide).
  setDecorTool(tool: DecorTool): void;
  // Poser l'élément tenu : sur du vide, c'est fait ; sur un élément de la même sorte, la personne doit confirmer (confirmReplace) ou renoncer
  // (cancelReplace) ; si la pièce ne serait plus valable, `error` dit pourquoi.
  placeHeld(cell: { x: number; y: number }): void;
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
  setMyStates(states: ActivityState[]): void;
  // Un de ses états créé ou remplacé (même identifiant : il prend sa place dans la liste) ; ou supprimé.
  upsertMyState(state: ActivityState): void;
  removeMyState(id: string): void;
  setChosenActivity(id: string | null): void;
  setMedia(id: string, m: MediaState): void;
  // Cette personne se met à parler (vrai), ou se tait (faux : la clé disparaît, comme dans les messages du serveur) : `speaking:changed`.
  setSpeaking(id: string, speaking: boolean): void;
  setProfile(p: { id: string; name: string; avatarKey: string | null }): void;
  setReplaced(v: boolean): void;
  // La connexion coupée : setReady(false). (L'`init` la rend prête : applyInit.)
  setReady(ready: boolean): void;
  setMediaInstruction(i: MediaInstruction | null): void;
  // Le statut choisi dans le menu ; null l'oublie (un autre onglet a pris la place : c'est lui qui parle pour la personne).
  setChosenStatus(s: Status | null): void;
  // Un message du chat (`chat:message`), dans la liste de son canal. Un `id` déjà là est ignoré (l'état reste le même objet).
  addChatMessage(m: ChatMessage): void;
  // Tout ce que « Tout le monde » contient maintenant est lu.
  markChatRead(): void;
  // Les mouvements d'un tick : la dernière position de chaque joueur connu (soi-même et les inconnus sont ignorés), sans prévenir
  // personne et sans changer l'état réactif.
  recordMoves(moves: ReadonlyArray<{ id: string } & PlayerPosition>): void;
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
  | 'chatAll'
  | 'chatNearby'
  | 'chatReadId'
  | 'self'
  | 'mapKey'
  | 'chosenStatus'
  | 'myStates'
  | 'chosenActivityId'
  | 'desks'
  | 'closedDesks'
  | 'deskBans'
  | 'deskKnocks'
  | 'deskNotice'
  | 'lights'
  | 'coffee'
  | 'officeMap'
  | 'decorEditor'
  | 'zoomPercent'
  | 'positions'
>;

// La lumière que personne n'a touchée : allumée, jamais changée. C'est aussi celle d'un `init` qui n'en dit rien.
const LIGHTS_ON: LightsState = { on: true, by: null, at: 0 };

const initialData = (): Data => ({
  selfId: null,
  players: {},
  replaced: false,
  ready: false,
  mediaInstruction: null,
  chatAll: [],
  chatNearby: [],
  chatReadId: null,
  self: null,
  mapKey: null,
  chosenStatus: null,
  myStates: [],
  chosenActivityId: null,
  desks: [],
  closedDesks: [],
  deskBans: [],
  deskKnocks: [],
  deskNotice: null,
  lights: LIGHTS_ON,
  coffee: {},
  officeMap: null,
  decorEditor: null,
  zoomPercent: ZOOM_DEFAULT_PERCENT,
  positions: new Map(),
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
          // La lumière du moment : celle que l'on croyait avant une coupure n'a plus cours. Les cafés non plus : ceux d'avant la coupure ont fini, ou
          // été remis, sans que personne nous le dise.
          lights: p.lights ?? LIGHTS_ON,
          coffee: coffeeDeadlines([p.self, ...others]),
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
      setCoffee: (id, ms) =>
        set((state) => {
          if (ms > 0) return { coffee: { ...state.coffee, [id]: performance.now() + ms } };
          return Object.hasOwn(state.coffee, id) ? { coffee: without(state.coffee, id) } : state;
        }),
      setDeskNotice: (deskNotice) => set({ deskNotice }),
      setZoomPercent: (percent) => set({ zoomPercent: clampZoomPercent(percent) }),
      stepZoom: (steps, size = ZOOM_WHEEL_STEP) => set((state) => ({ zoomPercent: stepZoomPercent(state.zoomPercent, steps, size) })),
      resetZoom: () => set({ zoomPercent: ZOOM_DEFAULT_PERCENT }),

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
      placeHeld: (cell) =>
        set((state) => {
          const editor = state.decorEditor;
          if (!editor || editor.held === null || editor.replace !== null) return state;
          const room = roomOfDesk(state.officeMap, editor.deskKey);
          const at = anchorFor(editor.held, cell, room);
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
      setMyStates: (myStates) => set({ myStates }),
      upsertMyState: (state) =>
        set((s) => (s.myStates.some((m) => m.id === state.id) ? { myStates: s.myStates.map((m) => (m.id === state.id ? state : m)) } : { myStates: [...s.myStates, state] })),
      removeMyState: (id) => set((s) => ({ myStates: s.myStates.filter((m) => m.id !== id) })),
      setChosenActivity: (chosenActivityId) => set({ chosenActivityId }),

      setStatus: (id, status) => updatePlayer(id, (p) => ({ ...p, status })),
      setMedia: (id, m) => updatePlayer(id, (p) => ({ ...p, media: { mic: m.mic, cam: m.cam, screen: m.screen } })),
      setSpeaking: (id, speaking) =>
        updatePlayer(id, (p) => {
          if (speaking) return { ...p, speaking: true };
          const quiet = { ...p };
          delete quiet.speaking;
          return quiet;
        }),
      setProfile: ({ id, name, avatarKey }) => updatePlayer(id, (p) => ({ ...p, name, avatarKey })),
      setReplaced: (replaced) => set({ replaced }),
      setReady: (ready) => set({ ready }),
      setMediaInstruction: (mediaInstruction) => set({ mediaInstruction }),
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

      reset: () => set(initialData()),
    };
  });
}

export const useOfficeStore: UseBoundStore<StoreApi<OfficeState>> = createOfficeStore();
