// Les panneaux latéraux du bureau : un seul est ouvert à la fois (`panel: PanelId | null` dans OfficeShell). Ouvrir l'un ferme l'autre.
export type PanelId = 'chat' | 'people' | 'character' | 'desk' | 'decor' | 'states' | 'sound' | 'admin' | 'sim';

// Ce que la coque donne à la barre du bas pour ouvrir et fermer les panneaux.
export interface PanelControls {
  // Le panneau ouvert, s'il y en a un.
  open: PanelId | null;
  // Ouvre ce panneau, ou le ferme s'il est ouvert (les boutons Chat et Personnes). `opener` est ce qui rendra le focus quand le panneau se fermera.
  toggle(id: PanelId, opener: HTMLElement | null): void;
  // Ouvre ce panneau (le choix d'un menu), dont `opener`, le bouton du menu, reprendra le focus à la fermeture.
  show(id: PanelId, opener: HTMLElement | null): void;
  // L'identifiant du panneau, pour `aria-controls`.
  idOf(id: PanelId): string;
  // Le serveur a dit qui est là : avant, Chat, Personnes, Mon bureau, Personnage et Décorer n'ont rien à montrer.
  ready: boolean;
  // Les messages « Tout le monde » des autres que le panneau Chat, fermé, n'a pas montrés (la pastille du bouton).
  unread: number;
  // Le compte est celui d'un admin : le panneau Admin existe pour lui seul.
  admin: boolean;
  // Le bac à sable (le faux live, `pnpm dev:sim`) : absent d'un build normal.
  sim: boolean;
}
