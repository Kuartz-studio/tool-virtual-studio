// Ce que les tests de bout en bout lisent du jeu : window.__office, seulement dans le build qu'ils utilisent (VITE_E2E=1, voir
// e2e/playwright.config.ts). Le jeu est dans un canevas, que Playwright ne sait pas interroger : la scène tient cet objet à
// jour, le test le lit.
//
// Ce fichier n'importe rien : e2e/tsconfig.json l'inclut (avec les types de Vite, pour import.meta.env), ce qui type
// `window.__office` dans les tests.
export interface OfficeDebug {
  // La carte est construite et la scène tourne.
  ready: boolean;
  self: { id: string; x: number; y: number } | null;
  players: Record<string, { x: number; y: number; avatarKey: string | null }>;
  media: { room: string | null; tiles: number };
  // Place l'avatar local à cet endroit (en pixels) : le serveur l'accepte si la case est praticable (événement `debug:teleport`,
  // que le serveur n'enregistre qu'avec E2E=1).
  teleport(x: number, y: number): void;
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
