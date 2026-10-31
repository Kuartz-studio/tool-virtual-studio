import { create } from 'zustand';

// La carte du bureau (OfficePlan), ouverte ou fermée : la touche M et la ligne « Carte » du menu « Plus » l'ouvrent, la carte elle-même se ferme (M, Échap, la
// croix, un clic à côté, ou un voyage). `from` est ce qui l'a ouverte (le bouton « Plus ») : le focus y revient à la fermeture.
interface MapStore {
  open: boolean;
  from: HTMLElement | null;
  show(from: HTMLElement | null): void;
  hide(): void;
  toggle(from: HTMLElement | null): void;
}

export const useMapStore = create<MapStore>((set, get) => ({
  open: false,
  from: null,
  show: (from) => set({ open: true, from }),
  hide: () => set({ open: false, from: null }),
  toggle: (from) => (get().open ? get().hide() : get().show(from)),
}));
