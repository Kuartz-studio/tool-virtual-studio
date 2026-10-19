// Ce que les tests de bout en bout lisent du jeu : window.__office, seulement dans le build qu'ils utilisent (VITE_E2E=1, voir
// e2e/playwright.config.ts). Le jeu est dans un canevas, que Playwright ne sait pas interroger : la scène tient cet objet à
// jour, le test le lit.
//
// Ce fichier n'importe rien : e2e/tsconfig.json l'inclut (avec les types de Vite, pour import.meta.env), ce qui type
// `window.__office` dans les tests.
export interface OfficeDebug {
  // La carte est construite et la scène tourne.
  ready: boolean;
  // L'avatar local : l'identifiant du compte et ses pieds, en pixels de la carte, entiers (c'est ce que le serveur reçoit). Mis à jour à
  // chaque image ; null tant que la scène n'a pas d'avatar.
  self: { id: string; x: number; y: number } | null;
  // Les autres joueurs que la scène dessine, par identifiant : leurs pieds à l'écran (en pixels de la carte, arrondis : ils glissent
  // d'une position reçue à l'autre, avec un peu de retard), et l'avatar dessiné. Une entrée par avatar créé, retirée avec lui.
  players: Record<string, { x: number; y: number; avatarKey: string | null }>;
  media: { room: string | null; tiles: number };
  // Place l'avatar local à cet endroit (en pixels) et le dit au serveur, qui l'accepte si la case est praticable (événement
  // `debug:teleport`, que le serveur n'enregistre qu'avec E2E=1 ; refusé, le `move` qui suit est corrigé).
  teleport(x: number, y: number): void;
  // Montre ou cache les autres joueurs (ils restent dans `players`). Les tests qui regardent l'avatar local à l'écran cachent ceux
  // des autres tests, qui tournent en même temps sur le même serveur.
  showOthers(visible: boolean): void;
  // Le nombre d'avatars que la scène dessine pour ce joueur, local ou distant : 1 s'il est là (jamais de doublon), 0 sinon.
  avatarsOf(id: string): number;
}

declare global {
  interface Window {
    __office?: OfficeDebug;
  }
}

// Expose l'objet sous window.__office dans le build des tests de bout en bout, et ne fait rien dans les autres.
export function exposeDebug(h: OfficeDebug): void {
  if (import.meta.env.VITE_E2E !== '1') return;
  window.__office = h;
}
