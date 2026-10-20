import { CHAT_HISTORY_LIMIT, type ChatMessage, type InitPayload, type MediaJoinPayload, type MediaState, type PublicPlayer, type Status } from '@bureau/shared';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

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
  // La dernière consigne audio/vidéo reçue par la connexion en cours : l'audio et la vidéo, branchés après « Entrer », la rejouent
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
  // La dernière position connue de chaque autre joueur présent (init, arrivée, ticks). Un Map modifié sur place, sans prévenir les
  // abonnés : un `init` et reset() le remplacent, un départ en retire le joueur ; rien n'y reste de ceux qui sont partis.
  positions: Map<string, PlayerPosition>;
  // Tout l'état d'une (re)connexion : remplace tous les joueurs (ceux qui sont partis pendant la coupure disparaissent).
  applyInit(p: InitPayload): void;
  upsertPlayer(p: PublicPlayer): void;
  removePlayer(id: string): void;
  setStatus(id: string, s: Status): void;
  setMedia(id: string, m: MediaState): void;
  setProfile(p: { id: string; name: string; avatarKey: string | null }): void;
  setReplaced(v: boolean): void;
  // La connexion coupée : setReady(false). (L'`init` la rend prête : applyInit.)
  setReady(ready: boolean): void;
  setMediaInstruction(i: MediaInstruction | null): void;
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
  'selfId' | 'players' | 'replaced' | 'ready' | 'mediaInstruction' | 'chatAll' | 'chatNearby' | 'chatReadId' | 'self' | 'mapKey' | 'positions'
>;

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
  positions: new Map(),
});

const positionOf = (p: PlayerPosition): PlayerPosition => ({ x: p.x, y: p.y, dir: p.dir, moving: p.moving });

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
          self: p.self,
          mapKey: p.mapKey,
          players: Object.fromEntries(others.map((player) => [player.id, player])),
          positions: new Map(others.map((player) => [player.id, positionOf(player)])),
          // Un init n'arrive qu'à un onglet connecté : s'il avait été remplacé, il a repris la main.
          replaced: false,
          ready: true,
          // L'historique remplace « Tout le monde ». Le premier init (personne n'était connu) le donne pour lu ; un retour garde où l'on
          // en était, si bien que ce qui est arrivé pendant la coupure est non lu. « À proximité » reste : le serveur ne le redit pas.
          chatAll: history,
          chatReadId: state.selfId === null ? (history.at(-1)?.id ?? null) : state.chatReadId,
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
          if (!Object.hasOwn(state.players, id)) return state;
          const players = { ...state.players };
          delete players[id];
          return { players };
        });
      },

      recordMoves: (moves) => {
        const { players, positions } = get();
        for (const m of moves) {
          if (Object.hasOwn(players, m.id)) positions.set(m.id, positionOf(m));
        }
      },

      setStatus: (id, status) => updatePlayer(id, (p) => ({ ...p, status })),
      setMedia: (id, m) => updatePlayer(id, (p) => ({ ...p, media: { mic: m.mic, cam: m.cam, screen: m.screen } })),
      setProfile: ({ id, name, avatarKey }) => updatePlayer(id, (p) => ({ ...p, name, avatarKey })),
      setReplaced: (replaced) => set({ replaced }),
      setReady: (ready) => set({ ready }),
      setMediaInstruction: (mediaInstruction) => set({ mediaInstruction }),

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
