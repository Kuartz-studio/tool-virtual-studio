import type { InitPayload, MediaState, PublicPlayer, Status } from '@bureau/shared';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

// Ce que l'interface (React) sait du bureau : qui y est, avec quel statut, quels médias et quel profil. Le serveur le dit à chaque
// (re)connexion (`init`), puis par événements (arrivées, départs, statuts, médias, profils) ; office-connection.ts les applique ici.
//
// Les positions n'y sont pas suivies : elles changent 10 fois par seconde, et seul le jeu (Phaser) les dessine. Celles de `self` et
// de `players` sont celles de l'`init` ou de l'arrivée.
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
  // Tout l'état d'une (re)connexion : remplace tous les joueurs (ceux qui sont partis pendant la coupure disparaissent).
  applyInit(p: InitPayload): void;
  upsertPlayer(p: PublicPlayer): void;
  removePlayer(id: string): void;
  setStatus(id: string, s: Status): void;
  setMedia(id: string, m: MediaState): void;
  setProfile(p: { id: string; name: string; avatarKey: string | null }): void;
  setReplaced(v: boolean): void;
  // Retour à l'état de départ : le bureau quitté (déconnexion, autre compte).
  reset(): void;
}

type Data = Pick<OfficeState, 'selfId' | 'players' | 'replaced' | 'self' | 'mapKey'>;

const initialData = (): Data => ({ selfId: null, players: {}, replaced: false, self: null, mapKey: null });

// Un magasin neuf (les tests en créent un chacun) ; l'appli utilise useOfficeStore.
export function createOfficeStore(): UseBoundStore<StoreApi<OfficeState>> {
  return create<OfficeState>()((set) => {
    // Change le joueur `id` (soi-même ou un autre) ; un identifiant inconnu ne change rien, et l'état reste le même objet.
    const updatePlayer = (id: string, change: (p: PublicPlayer) => PublicPlayer) =>
      set((state) => {
        if (state.self && id === state.self.id) return { self: change(state.self) };
        if (!Object.hasOwn(state.players, id)) return state;
        return { players: { ...state.players, [id]: change(state.players[id]!) } };
      });

    return {
      ...initialData(),

      applyInit: (p) =>
        set({
          selfId: p.self.id,
          self: p.self,
          mapKey: p.mapKey,
          players: Object.fromEntries(p.players.filter((player) => player.id !== p.self.id).map((player) => [player.id, player])),
          // Un init n'arrive qu'à un onglet connecté : s'il avait été remplacé, il a repris la main.
          replaced: false,
        }),

      upsertPlayer: (p) =>
        set((state) => (state.self && p.id === state.self.id ? { self: p } : { players: { ...state.players, [p.id]: p } })),

      removePlayer: (id) =>
        set((state) => {
          if (!Object.hasOwn(state.players, id)) return state;
          const players = { ...state.players };
          delete players[id];
          return { players };
        }),

      setStatus: (id, status) => updatePlayer(id, (p) => ({ ...p, status })),
      setMedia: (id, m) => updatePlayer(id, (p) => ({ ...p, media: { mic: m.mic, cam: m.cam, screen: m.screen } })),
      setProfile: ({ id, name, avatarKey }) => updatePlayer(id, (p) => ({ ...p, name, avatarKey })),
      setReplaced: (replaced) => set({ replaced }),
      reset: () => set(initialData()),
    };
  });
}

export const useOfficeStore: UseBoundStore<StoreApi<OfficeState>> = createOfficeStore();
