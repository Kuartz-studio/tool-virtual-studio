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
  // L'audio et la vidéo : la room LiveKit où l'on est, ou que l'on rejoint (null hors conversation), et le nombre de vignettes
  // (tâche 20). C'est l'objet mediaDebug, ci-dessous.
  media: { room: string | null; tiles: number; speak(on: boolean): void };
  // Place l'avatar local à cet endroit (en pixels) et le dit au serveur, qui l'accepte si la case est praticable (événement
  // `debug:teleport`, que le serveur n'enregistre qu'avec E2E=1 ; refusé, le `move` qui suit est corrigé).
  teleport(x: number, y: number): void;
  // Donne du café à l'avatar local pendant `ms` ms (0 : le retire) : il va à la vitesse du café, et le serveur le sait (événement `debug:boost`, que le
  // serveur n'enregistre qu'avec E2E=1 : sans lui, sa limite de vitesse refuserait la course), comme avec la machine.
  boost(ms: number): void;
  // L'avatar local a-t-il un café en ce moment ?
  boosted(): boolean;
  // La vitesse que la physique donne à l'avatar local en ce moment, en px/s (0 à l'arrêt) : exacte, quelle que soit la charge de la machine,
  // contrairement à une vitesse mesurée sur le temps que prend le navigateur à dessiner.
  speed(): number;
  // Montre ou cache les autres joueurs (ils restent dans `players`). Les tests qui regardent l'avatar local à l'écran cachent ceux
  // des autres tests, qui tournent en même temps sur le même serveur.
  showOthers(visible: boolean): void;
  // Ceux dont la bulle de parole est allumée en ce moment (identifiants, soi compris).
  bubbles(): string[];
  // Ceux dont la tasse de café est montrée au-dessus de la tête en ce moment (identifiants, soi compris).
  cups(): string[];
  // Combien d'anneaux de lumière (un voyage voulu : un mode qui conduit à la salle de sport) sont en vie à l'écran en ce moment.
  rings(): number;
  // La machine à café s'agite-t-elle (elle tourne plus vite pendant MACHINE_EXCITED_MS quand quelqu'un se sert) ?
  machineExcited(): boolean;
  // Le nombre d'avatars que la scène dessine pour ce joueur, local ou distant : 1 s'il est là (jamais de doublon), 0 sinon.
  avatarsOf(id: string): number;
  // L'avatar local : celui qu'il doit avoir (sa clé) et la texture qu'il montre (la même quand son personnage est assemblé, sinon la silhouette).
  selfAvatar(): { wanted: string; shown: string } | null;
  // Où est ce point de la carte (en pixels) à l'écran (pixels de la page) : la caméra, son zoom et son défilement du moment.
  toScreen(x: number, y: number): { x: number; y: number };
  // La pièce que l'éditeur de déco montre (le coin haut-gauche, en pixels de la carte), ou null quand il est fermé ou que la caméra n'y est
  // pas encore arrivée.
  editorRoom(): { x: number; y: number } | null;
  // Le zoom de la caméra en ce moment (celui de la vue de départ, multiplié par le niveau choisi).
  zoom(): number;
  // La nuit en ce moment, de 0 (la lumière est allumée : la couche de nuit n'est pas à l'écran) à 1 (pleine nuit) ; entre les deux pendant le
  // fondu ou le clignotement.
  nightLevel(): number;
  // La phase de chaque porte de bureau, par clé de place : `open`, `closing`, `closed` ou `opening` (door-state.ts). Vide sur une carte sans portes.
  doors(): Record<string, 'open' | 'closing' | 'closed' | 'opening'>;
  // L'avatar local marche-t-il tout seul (« Aller à mon bureau », voir auto-walk.ts) ? Faux dès qu'il est arrivé, qu'une touche de déplacement
  // l'a interrompu, ou qu'il est bloqué.
  autoWalking(): boolean;
  // Les tables de jeu de la carte, en pixels : le jeu, le rectangle de la table, et le centre de chacune de ses chaises, dans l'ordre. Vide sur une carte sans table.
  tables(): Array<{ game: string; x: number; y: number; width: number; height: number; seats: Array<{ x: number; y: number }> }>;
  // La vue que le magasin a de la table de ce jeu (celle que le serveur a dite : chaises, spectateurs, partie), ou null sans table.
  gameTable(game: string): unknown;
  // Remplace l'état de la partie en cours à cette table par un état fabriqué (événement `debug:game`, que le serveur n'enregistre qu'avec E2E=1), et impose les prochains dés
  // (de 1 à 6) : de quoi jouer la fin d'une partie sans en jouer toute la longueur.
  debugGame(game: string, state: unknown, rolls?: number[]): void;
  // Donne de l'XP d'un coup à la personne (et des écus), comme une mission (événement `debug:xp`, que le serveur n'enregistre qu'avec E2E=1) : de quoi passer un
  // niveau ou acheter à la boutique sans accomplir de missions.
  xp(xp: number, ecus?: number): void;
  // Combien d'effets de la progression (un « +XP » qui monte, une gerbe d'étoiles) sont en vie à l'écran en ce moment.
  effects(): number;
}

// Ce que les tests de bout en bout lisent du son : window.__audio, dans le même build. Le son démarre avant le jeu (dès la page de connexion) :
// c'est donc un objet à part, que tient audio/audio.ts.
export interface AudioDebug {
  // Le son marche-t-il (`running`), attend-il un geste (`locked`), ou n'existe-t-il pas (`unsupported`) ?
  status(): 'locked' | 'running' | 'unsupported';
  // L'ambiance qu'on entend, ou null.
  playing(): string | null;
  // Les effets que l'appli a demandés depuis le chargement de la page, dans l'ordre (qu'ils aient sonné ou non : un effet coupé, ou trop
  // rapproché du précédent, est demandé quand même).
  sfx(): string[];
}

declare global {
  interface Window {
    __office?: OfficeDebug;
    __audio?: AudioDebug;
  }
}

// La part audio/vidéo de window.__office. Elle vit avec la connexion média (media/use-media.ts tient `room` et `speak` à jour), et non avec la
// scène, qui n'existe qu'une fois le jeu chargé et que la page recrée pour une autre carte : la scène met cet objet-là dans le sien.
// `speak(true)` : l'avatar local parle, comme si la détection de la room l'entendait (sans room audio, les tests n'ont pas de voix) ; `speak(false)`, il se tait.
export const mediaDebug: OfficeDebug['media'] = { room: null, tiles: 0, speak: () => {} };

// Expose l'objet sous window.__office dans le build des tests de bout en bout, et ne fait rien dans les autres.
export function exposeDebug(h: OfficeDebug): void {
  if (import.meta.env.VITE_E2E !== '1') return;
  window.__office = h;
}
