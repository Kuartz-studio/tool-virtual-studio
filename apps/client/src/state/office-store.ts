import type { InitPayload, MediaState, PublicPlayer, Status } from '@bureau/shared';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

// Ce que l'interface (React) sait du bureau : qui y est, avec quel statut, quels médias et quel profil. Le serveur le dit à chaque
// (re)connexion (`init`), puis par événements (arrivées, départs, statuts, médias, profils) ; office-connection.ts les applique ici.
//
// Les positions ne sont pas dans l'état réactif : elles changent 10 fois par seconde, et seul le jeu (Phaser) les dessine. Celles de
// `self` et de `players` sont celles de l'`init` ou de l'arrivée. Les dernières reçues sont gardées à part, dans `positions`, que
// React ne voit pas changer : le jeu y lit où sont les autres quand il démarre (ou redémarre avec une autre carte), même si des
// ticks sont arrivés pendant son chargement, et suit ensuite les ticks lui-même.
export type PlayerPosition = Pick<PublicPlayer, 'x' | 'y' | 'dir' | 'moving'>;

export interface OfficeState {
  // Le compte connecté, d'après le dernier `init` ; null avant le premier.
  selfId: string | null;
  // Les autres joueurs présents, par identifiant. Soi-même n'y est jamais : c'est `self`.
  players: Record<string, PublicPlayer>;
  // Un autre onglet a pris la place de celui-ci (`session:replaced`) : le serveur l'a déconnecté, sans reconnexion automatique.
  replaced: boolean;
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
  // Les mouvements d'un tick : la dernière position de chaque joueur connu (soi-même et les inconnus sont ignorés), sans prévenir
  // personne et sans changer l'état réactif.
  recordMoves(moves: ReadonlyArray<{ id: string } & PlayerPosition>): void;
  // Retour à l'état de départ : le bureau quitté (déconnexion, autre compte).
  reset(): void;
}

type Data = Pick<OfficeState, 'selfId' | 'players' | 'replaced' | 'self' | 'mapKey' | 'positions'>;

const initialData = (): Data => ({ selfId: null, players: {}, replaced: false, self: null, mapKey: null, positions: new Map() });

const positionOf = (p: PlayerPosition): PlayerPosition => ({ x: p.x, y: p.y, dir: p.dir, moving: p.moving });

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
        set({
          selfId: p.self.id,
          self: p.self,
          mapKey: p.mapKey,
          players: Object.fromEntries(others.map((player) => [player.id, player])),
          positions: new Map(others.map((player) => [player.id, positionOf(player)])),
          // Un init n'arrive qu'à un onglet connecté : s'il avait été remplacé, il a repris la main.
          replaced: false,
        });
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
      reset: () => set(initialData()),
    };
  });
}

export const useOfficeStore: UseBoundStore<StoreApi<OfficeState>> = createOfficeStore();
