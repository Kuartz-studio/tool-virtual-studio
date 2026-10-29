import { create } from 'zustand';

// Une demande d'ouvrir la fenêtre « Quoi de neuf ? » sur tout l'historique : la ligne « Nouveautés » du menu « Moi » la pose, la fenêtre (WhatsNew, que la
// coque du bureau garde montée) la lit, et l'efface en se fermant, ou si la page du bureau part. `from` est ce qui l'a demandée (la puce « Moi ») : le
// focus y revient à la fermeture.
interface WhatsNewStore {
  history: { from: HTMLElement | null } | null;
  openHistory(from: HTMLElement | null): void;
  closeHistory(): void;
}

export const useWhatsNewStore = create<WhatsNewStore>((set) => ({
  history: null,
  openHistory: (from) => set({ history: { from } }),
  closeHistory: () => set({ history: null }),
}));
