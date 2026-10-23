import { z } from 'zod';
import type { Rect } from '../map/places';
import { directionSchema, type Direction } from '../protocol';

// L'octogone : un ring de combat (zone `arena` de la carte) où deux personnes se battent à l'arme pendant que les autres regardent. Le serveur fait foi
// (arena-controller) : il tient les rôles, les armes, les points de vie, les délais entre deux coups, les flèches en vol et l'issue ; le client dessine
// la cage, les armes en main, les barres de vie, les coups et les flèches, et garde les combattants dans le ring.
//
// Le déroulé : on entre dans la salle, on se dit combattant (deux places) ou spectateur (sans limite). Chaque combattant choisit son arme
// (ARENA_WEAPONS). Avec deux combattants armés, l'un d'eux lance le combat (« Start ») : ARENA_COUNTDOWN_MS de compte à rebours, les deux sont posés
// face à face dans le ring, puis ils se battent : une seule touche, l'attaque de son arme, dans la direction où l'on regarde. Les armes de mêlée
// touchent à leur portée ; l'arc tire une flèche qui vole tout droit, qu'on peut esquiver, et qui s'arrête à la cage. Le premier à 0 point de vie
// perd ; ARENA_OVER_MS plus tard, le ring revient à l'attente, les combattants gardent leur place et leur arme (une revanche n'attend qu'un Start).
// Sortir de la salle, ou se déconnecter, c'est quitter son rôle : un combattant qui part pendant le combat le perd.

export const ARENA_MAX_HP = 100;
export const ARENA_COUNTDOWN_MS = 3_000;
export const ARENA_OVER_MS = 6_000;
// La limite de débit des commandes d'une socket (`arena:do`) : de quoi taper vite, pas de quoi inonder le serveur.
export const ARENA_RATE = { max: 30, windowMs: 2_000 };

// La planche des armes (apps/client/public/assets/weapons/weapons.png) : 14 × 14 icônes de 32 px, la lame vers le haut à droite.
export const WEAPON_SHEET = { url: '/assets/weapons/weapons.png', columns: 14, frameSize: 32 } as const;

export const ARENA_WEAPON_IDS = ['sword', 'katana', 'spear', 'axe', 'hammer', 'bow'] as const;
export type ArenaWeaponId = (typeof ARENA_WEAPON_IDS)[number];

// Une arme : son nom, son icône (le numéro de sa case sur la planche, rangée × 14 + colonne), ses dégâts, sa portée (entre les pieds des deux
// combattants, en pixels ; pour l'arc, la distance que vole la flèche) et le délai avant le coup suivant. `style` dit comment le client l'anime :
// `slash` (un arc de cercle), `thrust` (un coup d'estoc, la lance), `smash` (un coup de haut en bas, lourd), `shoot` (une flèche). Pour l'arc,
// `arrowSpeedPx` : la vitesse de la flèche, en px/s.
export interface ArenaWeapon {
  label: string;
  frame: number;
  damage: number;
  rangePx: number;
  cooldownMs: number;
  style: 'slash' | 'thrust' | 'smash' | 'shoot';
  arrowSpeedPx?: number;
}

export const ARENA_WEAPONS: Readonly<Record<ArenaWeaponId, ArenaWeapon>> = {
  sword: { label: 'Épée', frame: 3 * 14 + 0, damage: 12, rangePx: 62, cooldownMs: 480, style: 'slash' },
  katana: { label: 'Katana', frame: 3 * 14 + 6, damage: 7, rangePx: 58, cooldownMs: 260, style: 'slash' },
  spear: { label: 'Lance', frame: 3 * 14 + 1, damage: 11, rangePx: 92, cooldownMs: 650, style: 'thrust' },
  axe: { label: 'Hache', frame: 11 * 14 + 6, damage: 17, rangePx: 60, cooldownMs: 850, style: 'slash' },
  hammer: { label: 'Marteau', frame: 1 * 14 + 6, damage: 24, rangePx: 56, cooldownMs: 1150, style: 'smash' },
  bow: { label: 'Arc', frame: 1 * 14 + 3, damage: 10, rangePx: 420, cooldownMs: 700, style: 'shoot', arrowSpeedPx: 460 },
};

// Une flèche touche qui passe à moins de cette distance (en pixels) des pieds de l'adversaire.
export const ARROW_HIT_RADIUS_PX = 22;

export type ArenaRole = 'fighter' | 'spectator';
export type ArenaPhase = 'idle' | 'countdown' | 'fight' | 'over';

// `weapon` : l'arme choisie (null : pas encore).
export interface ArenaFighter { id: string; name: string; hp: number; weapon: ArenaWeaponId | null }
// L'octogone tel que tout le bureau le voit. `countdownMs` : ce qu'il reste du compte à rebours au moment de l'envoi (pas une heure : les horloges
// diffèrent) ; `winnerId` : le vainqueur, une fois le combat fini.
export interface ArenaState {
  phase: ArenaPhase;
  fighters: ArenaFighter[];
  spectators: Array<{ id: string; name: string }>;
  countdownMs: number;
  winnerId: string | null;
}

export const EMPTY_ARENA: Readonly<ArenaState> = { phase: 'idle', fighters: [], spectators: [], countdownMs: 0, winnerId: null };

// Une flèche qui part : son identifiant, d'où (les pieds de l'archer, en pixels), vers où, à quelle vitesse et jusqu'où elle vole.
export interface ArenaArrow { id: string; x: number; y: number; dir: Direction; speedPx: number; rangePx: number }

// Une attaque, pour que chacun la voie : qui attaque, avec quelle arme, vers où. `arrow` : l'arc vient de tirer cette flèche. `hit` : ce que l'attaque
// touche (absent : dans le vide) ; pour une flèche, `arrowId` dit laquelle a touché (elle disparaît là, au lieu de finir sa course).
export interface ArenaAction {
  id: string;
  weapon: ArenaWeaponId;
  dir: Direction;
  arrow?: ArenaArrow;
  arrowId?: string;
  hit?: { target: string; damage: number; ko: boolean };
}

// Les commandes de l'octogone (`arena:do`) : prendre un rôle, le quitter, choisir son arme, lancer le combat, attaquer (dans la direction où l'on
// regarde).
export const arenaCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join'), role: z.enum(['fighter', 'spectator']) }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('weapon'), weapon: z.enum(ARENA_WEAPON_IDS) }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('attack'), dir: directionSchema }),
]);
export type ArenaCommand = z.infer<typeof arenaCommandSchema>;

// La réponse à `arena:do` : `not_here` (hors de la salle de l'octogone), `full` (deux combattants déjà), `busy` (un combat est en cours),
// `not_fighter`, `need_two` (lancer à moins de deux), `no_weapon` (lancer avant que chacun ait son arme), `cooldown` (une attaque trop tôt),
// `no_arena` (la carte n'en a pas).
export type ArenaAck =
  | { ok: true }
  | { ok: false; error: 'invalid' | 'rate_limited' | 'no_arena' | 'not_here' | 'full' | 'busy' | 'not_fighter' | 'need_two' | 'no_weapon' | 'cooldown' };

// ---- Géométrie --------------------------------------------------------------------------------------------------------------------------------

// Le pan coupé de chaque coin de l'octogone, en pixels : 30 % du petit côté du ring.
export function ringCorner(ring: Rect): number {
  return Math.round(Math.min(ring.width, ring.height) * 0.3);
}

// Le point (en pixels) est-il dans l'octogone, rétréci de `inset` pixels de chaque côté ?
export function insideRing(ring: Rect, x: number, y: number, inset = 0): boolean {
  const left = ring.x + inset;
  const top = ring.y + inset;
  const right = ring.x + ring.width - inset;
  const bottom = ring.y + ring.height - inset;
  if (x < left || x > right || y < top || y > bottom) return false;
  const c = Math.max(0, ringCorner(ring) - inset * 0.4);
  return x - left + (y - top) >= c && right - x + (y - top) >= c && x - left + (bottom - y) >= c && right - x + (bottom - y) >= c;
}

// Les huit sommets de l'octogone, dans le sens des aiguilles d'une montre depuis le haut-gauche.
export function ringPoints(ring: Rect): Array<{ x: number; y: number }> {
  const c = ringCorner(ring);
  const [l, t, r, b] = [ring.x, ring.y, ring.x + ring.width, ring.y + ring.height];
  return [
    { x: l + c, y: t }, { x: r - c, y: t }, { x: r, y: t + c }, { x: r, y: b - c },
    { x: r - c, y: b }, { x: l + c, y: b }, { x: l, y: b - c }, { x: l, y: t + c },
  ];
}

// Où les deux combattants commencent : face à face, à mi-hauteur, à un quart du ring de chaque bord.
export function ringStarts(ring: Rect): [{ x: number; y: number; dir: Direction }, { x: number; y: number; dir: Direction }] {
  const y = Math.round(ring.y + ring.height / 2 + 12);
  return [
    { x: Math.round(ring.x + ring.width / 4), y, dir: 'right' },
    { x: Math.round(ring.x + (ring.width * 3) / 4), y, dir: 'left' },
  ];
}

const HEADING: Readonly<Record<Direction, { x: number; y: number }>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function headingOf(dir: Direction): { x: number; y: number } {
  return HEADING[dir];
}

// Le coup d'une arme de mêlée touche-t-il ? À portée, et l'adversaire devant soi (ou presque collé). Rend les dégâts faits ; null si le coup part dans
// le vide (et toujours pour l'arc, dont les flèches volent : arrowStep).
export function resolveMelee(weapon: ArenaWeaponId, attacker: { x: number; y: number; dir: Direction }, defender: { x: number; y: number }): number | null {
  const spec = ARENA_WEAPONS[weapon];
  if (spec.style === 'shoot') return null;
  const dx = defender.x - attacker.x;
  const dy = defender.y - attacker.y;
  const distance = Math.hypot(dx, dy);
  if (distance > spec.rangePx) return null;
  const facing = HEADING[attacker.dir];
  if (distance > 16 && dx * facing.x + dy * facing.y <= 0) return null;
  return spec.damage;
}

// Une flèche avance de `stepPx` : rend sa nouvelle position, si elle a touché la cible (le segment parcouru passe à moins de ARROW_HIT_RADIUS_PX de ses
// pieds), et si elle a fini sa course (sa portée, ou la cage du ring).
export function arrowStep(
  arrow: { x: number; y: number; dir: Direction; traveled: number; rangePx: number },
  stepPx: number,
  target: { x: number; y: number } | null,
  ring: Rect | null,
): { x: number; y: number; traveled: number; hit: boolean; done: boolean } {
  const h = HEADING[arrow.dir];
  const length = Math.min(stepPx, arrow.rangePx - arrow.traveled);
  const x = arrow.x + h.x * length;
  const y = arrow.y + h.y * length;
  let hit = false;
  if (target) {
    // La distance des pieds de la cible au segment parcouru.
    const along = Math.max(0, Math.min(length, (target.x - arrow.x) * h.x + (target.y - arrow.y) * h.y));
    const px = arrow.x + h.x * along;
    const py = arrow.y + h.y * along;
    hit = Math.hypot(target.x - px, target.y - py) <= ARROW_HIT_RADIUS_PX;
  }
  const traveled = arrow.traveled + length;
  const done = hit || traveled >= arrow.rangePx || (ring !== null && !insideRing(ring, x, y, -4));
  return { x, y, traveled, hit, done };
}
