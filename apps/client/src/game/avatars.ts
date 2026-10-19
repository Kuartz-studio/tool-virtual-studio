import { DEFAULT_AVATAR_KEY, DEV_AVATAR_KEYS, DIRECTIONS, type Direction } from '@bureau/shared';
import type { Animations } from 'phaser';

// Un avatar : sa planche d'images (une image par pose) et les images de ses animations, pour chacune des 4 directions.
export interface AvatarSpec {
  // La clé du registre, et de la texture de la planche dans Phaser.
  key: string;
  // L'adresse de la planche, que charge le Preloader.
  url: string;
  frameWidth: number;
  frameHeight: number;
  // Les images (numéros de la planche, ligne après ligne) de l'avatar immobile et de l'avatar qui marche.
  idle: Record<Direction, number[]>;
  walk: Record<Direction, number[]>;
  frameRate: number;
}

function perDirection<T>(valueOf: (dir: Direction) => T): Record<Direction, T> {
  return { up: valueOf('up'), down: valueOf('down'), left: valueOf('left'), right: valueOf('right') };
}

// Les avatars de développement (apps/client/scripts/gen-dev-assets.ts) : une planche de 96 × 128 px, en images de 32 × 32 px, sur
// 3 colonnes (immobile, pas 1, pas 2) et 4 lignes. Les lignes sont dans l'ordre bas, gauche, droite, haut, qui n'est pas celui de
// Direction.
const DEV_FRAME_SIZE = 32;
const DEV_COLUMNS = 3;
const DEV_ROWS: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };
const DEV_FRAME_RATE = 8;

function devAvatar(key: string): AvatarSpec {
  // L'image de l'avatar immobile : la première colonne de sa ligne.
  const standing = (dir: Direction) => DEV_ROWS[dir] * DEV_COLUMNS;
  return {
    key,
    url: `/assets/dev/avatars/${key}.png`,
    frameWidth: DEV_FRAME_SIZE,
    frameHeight: DEV_FRAME_SIZE,
    idle: perDirection((dir) => [standing(dir)]),
    // Debout, pas 1, debout, pas 2 : un pied puis l'autre, en repassant par la position debout.
    walk: perDirection((dir) => [standing(dir), standing(dir) + 1, standing(dir), standing(dir) + 2]),
    frameRate: DEV_FRAME_RATE,
  };
}

// Tous les avatars que ce build connaît. La galerie (tâche 23) s'ajoute ici, avec les lignes de ses planches.
export const AVATARS: Record<string, AvatarSpec> = Object.fromEntries(DEV_AVATAR_KEYS.map((key) => [key, devAvatar(key)]));

// Le nom des objets d'avatar dans la scène (local ou distant) : `player:<identifiant>`. Les tests de bout en bout comptent ainsi les
// avatars dessinés pour un joueur (window.__office.avatarsOf).
export const avatarObjectName = (id: string): string => `player:${id}`;

// La clé de l'animation d'un avatar : `dev-red-walk-left`.
export function animKey(avatarKey: string, kind: 'idle' | 'walk', dir: Direction): string {
  return `${avatarKey}-${kind}-${dir}`;
}

// L'avatar à afficher pour cette clé : la sienne si ce build la connaît, sinon l'avatar par défaut (la personne n'en a pas encore
// choisi, ou la clé vient d'une galerie que ce client n'a pas).
export function resolveAvatarKey(avatarKey: string | null | undefined): string {
  return avatarKey != null && Object.hasOwn(AVATARS, avatarKey) ? avatarKey : DEFAULT_AVATAR_KEY;
}

// La fiche de l'avatar à afficher pour cette clé (resolveAvatarKey) : celle de l'avatar par défaut pour une clé inconnue. L'avatar
// local et ceux des autres passent par elle.
export function avatarSpec(avatarKey: string | null | undefined): AvatarSpec {
  return AVATARS[resolveAvatarKey(avatarKey)]!;
}

// Crée les 8 animations de cet avatar (immobile et marche, dans les 4 directions), qui bouclent. Le gestionnaire d'animations est
// celui du jeu, partagé par les scènes : une animation déjà créée est laissée telle quelle.
export function createAvatarAnimations(anims: Animations.AnimationManager, spec: AvatarSpec): void {
  for (const kind of ['idle', 'walk'] as const) {
    for (const dir of DIRECTIONS) {
      const key = animKey(spec.key, kind, dir);
      if (anims.exists(key)) continue;
      const frames = anims.generateFrameNumbers(spec.key, { frames: spec[kind][dir] });
      anims.create({ key, frames, frameRate: spec.frameRate, repeat: -1 });
    }
  }
}

// La zone de collision de l'avatar, aux pieds : 20 × 12 px. Le reste du personnage (la tête, le corps) passe devant les murs et les
// meubles ; seuls les pieds butent.
const BODY_WIDTH = 20;
const BODY_HEIGHT = 12;
// Le bas de la zone dépasse d'un pixel sous les pieds (le bas de l'image, où est l'origine du sprite). Arrêtés contre un obstacle
// au sud, le bas de la zone touche son bord : y = 480, par exemple, pour le mur de la dernière ligne. Les pieds sont alors en
// y = 479, dans leur case. Sans ce pixel, ils seraient en y = 480 : le serveur, qui place des pieds dans la case floor(y / 32),
// les verrait déjà dans le mur et refuserait la position.
const BODY_BELOW_FEET = 1;

// La zone de collision d'un avatar dont l'image est de cette taille, et son décalage dans l'image (celui de Body.setOffset).
export function feetBody({ frameWidth, frameHeight }: Pick<AvatarSpec, 'frameWidth' | 'frameHeight'>): {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
} {
  return {
    width: BODY_WIDTH,
    height: BODY_HEIGHT,
    offsetX: (frameWidth - BODY_WIDTH) / 2,
    offsetY: frameHeight + BODY_BELOW_FEET - BODY_HEIGHT,
  };
}
